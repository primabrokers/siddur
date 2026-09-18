-- ============================================================================
-- 003b_triggers — audit trail (11 §4) + the instant trigger library (08 §2)
-- ============================================================================
-- Two laws from 01 hold throughout: automations create tasks/flags/drafts and
-- never send (I-10); anything computable is computed, not stored (I-9).
-- Every automation-created task carries an `origin` and is idempotent — a rule
-- never opens a second task of the same origin for the same contact (08 §1).
--
-- All functions are SECURITY DEFINER with a pinned search_path so they can
-- maintain rows (soft credits, the rolling GA claim, audit) that the calling
-- role may not write directly under RLS.
-- ============================================================================

-- --------------------------------------------------------------------------
-- Rule accessor: returns the params of an ENABLED rule, or null when the rule
-- is switched off / absent. Callers treat null as "do nothing" (08 §7).
-- --------------------------------------------------------------------------

create or replace function public.crm_rule(p_key text)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when r.is_enabled then coalesce(r.params, '{}'::jsonb) end
  from public.automation_rules r
  where r.rule_key = p_key
$$;

-- --------------------------------------------------------------------------
-- Audit trail (11 §4). record_id is derived generically so the one function
-- serves both uuid-keyed tables and automation_rules (keyed by rule_key).
-- --------------------------------------------------------------------------

create or replace function public.audit_row()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_id  uuid;
begin
  v_id := coalesce(
    (v_new->>'id')::uuid,
    (v_old->>'id')::uuid,
    md5(coalesce(v_new->>'rule_key', v_old->>'rule_key'))::uuid
  );

  insert into public.audit_log (table_name, record_id, action, changed_by, old_values, new_values)
  values (tg_table_name, v_id, lower(tg_op), auth.uid(), v_old, v_new);

  return case when tg_op = 'DELETE' then old else new end;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'contacts','donations','pledges','gift_aid_declarations','gift_aid_claims',
    'tasks','notes','opportunities','team_members','automation_rules'
  ]
  loop
    execute format(
      'create trigger trg_audit_%s after insert or update or delete on public.%I
         for each row execute function public.audit_row()', t, t);
  end loop;
end $$;

-- updated_at housekeeping
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trg_contacts_touch before update on public.contacts
  for each row execute function public.touch_updated_at();

create or replace function public.touch_rule_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trg_rules_touch before update on public.automation_rules
  for each row execute function public.touch_rule_updated_at();

-- ==========================================================================
-- Gift Aid (08 §2 `gift_aid_evaluate`) ▸ Beacon
-- ==========================================================================

-- Exactly one rolling draft claim exists at a time (02 §3.7).
create or replace function public.crm_rolling_ga_claim()
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  select id into v_id
  from public.gift_aid_claims
  where status = 'draft-rolling'
  order by created_at
  limit 1;

  if v_id is null then
    insert into public.gift_aid_claims (status) values ('draft-rolling') returning id into v_id;
  end if;
  return v_id;
end $$;

-- Per-gift Gift Aid status. A declaration covers a gift when it is uncancelled
-- at the gift date and either runs forward from its start (covers_future) or
-- reaches back up to `back_years` (covers_past). Oral declarations only count
-- once the written confirmation HMRC requires has been sent.
create or replace function public.crm_gift_aid_status(
  p_contact uuid, p_donated_on date, p_is_gasds boolean, p_status text, p_current text)
returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_params jsonb := public.crm_rule('gift_aid_evaluate');
  v_kind text;
  v_back int;
  v_require_oral boolean;
  v_ok boolean;
begin
  if v_params is null then return p_current; end if;         -- rule off: leave as found
  if p_current = 'claimed' then return 'claimed'; end if;    -- a claimed gift is never re-evaluated
  if p_status <> 'received' or coalesce(p_is_gasds, false) then return 'ineligible'; end if;

  select contact_kind into v_kind from public.contacts where id = p_contact;
  if v_kind is distinct from 'individual' then return 'ineligible'; end if;  -- companies cannot Gift Aid

  v_back := coalesce((v_params->>'back_years')::int, 4);
  v_require_oral := coalesce((v_params->>'require_oral_confirmation')::boolean, true);

  select exists (
    select 1
    from public.gift_aid_declarations g
    where g.contact_id = p_contact
      and (g.cancelled_on is null or g.cancelled_on > p_donated_on)
      and (not v_require_oral or g.method <> 'oral' or g.oral_confirmation_sent_on is not null)
      and (
        (g.covers_future and p_donated_on >= coalesce(g.covers_from, g.declared_on))
        or
        (g.covers_past
          and p_donated_on < coalesce(g.covers_from, g.declared_on)
          and p_donated_on >= (coalesce(g.covers_from, g.declared_on)
                               - make_interval(years => v_back))::date)
      )
  ) into v_ok;

  return case when v_ok then 'eligible' else 'pending_declaration' end;
end $$;

-- ==========================================================================
-- Household soft credits (08 §2 `household_soft_credit`) ▸ NPSP
-- Hard credit stays with the legal donor; the rest of the household receives
-- soft credit, kept in parallel columns so finance never double-counts (D2).
-- ==========================================================================

create or replace function public.crm_sync_household_soft_credits(p_donation uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_contact uuid; v_hh uuid; v_amt numeric;
begin
  select d.contact_id, d.amount_gbp, c.household_id
    into v_contact, v_amt, v_hh
  from public.donations d
  join public.contacts c on c.id = d.contact_id
  where d.id = p_donation;

  if not found then return; end if;

  delete from public.soft_credits sc
  where sc.donation_id = p_donation
    and sc.role = 'household'
    and (v_hh is null
         or sc.contact_id not in (
              select c2.id from public.contacts c2
              where c2.household_id = v_hh and c2.id <> v_contact));

  if v_hh is null then return; end if;

  insert into public.soft_credits (donation_id, contact_id, role, amount)
  select p_donation, c2.id, 'household', v_amt
  from public.contacts c2
  where c2.household_id = v_hh
    and c2.id <> v_contact
    and not c2.is_archived
  on conflict (donation_id, contact_id, role) do update set amount = excluded.amount;
end $$;

-- ==========================================================================
-- Pledge fulfilment (08 §2 `pledge_schedule`, balance half)
-- ==========================================================================

create or replace function public.crm_recompute_pledge(p_pledge uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total numeric; v_wo numeric; v_status text; v_paid numeric; v_target text;
begin
  if p_pledge is null then return; end if;

  select amount_gbp, coalesce(write_off_amount, 0), status
    into v_total, v_wo, v_status
  from public.pledges where id = p_pledge;
  if not found then return; end if;

  -- installment states follow the payments applied to them
  update public.pledge_installments pi
     set status = case
                    when x.paid >= pi.amount then 'paid'
                    when x.paid > 0          then 'partly_paid'
                    else 'expected'
                  end
  from (
    select d.installment_id, sum(d.amount_gbp) as paid
    from public.donations d
    where d.status = 'received' and d.installment_id is not null
    group by d.installment_id
  ) x
  where pi.pledge_id = p_pledge
    and x.installment_id = pi.id
    and pi.status <> 'written_off';

  if v_status not in ('open','fulfilled') then return; end if;   -- written off / cancelled: leave alone

  select coalesce(sum(d.amount_gbp), 0) into v_paid
  from public.donations d
  where d.pledge_id = p_pledge and d.status = 'received';

  v_target := case when v_paid + v_wo >= v_total then 'fulfilled' else 'open' end;
  if v_target <> v_status then
    update public.pledges set status = v_target where id = p_pledge;
  end if;
end $$;

-- ==========================================================================
-- donations — BEFORE: stamp receipt / thank-you / Gift Aid on the row itself.
-- Doing this before the write keeps the trigger non-recursive.
-- ==========================================================================

create or replace function public.donations_before_write()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_p jsonb; v_pref text;
begin
  if tg_op = 'INSERT' then
    -- receipt_on_gift: preference cascade gift -> donor -> system default.
    -- Schema v2 has no donor-level receipt preference column, so the donor
    -- level reads contacts.preferred_channel where it names a channel we can
    -- honour; otherwise the cascade falls straight through to the system default.
    v_p := public.crm_rule('receipt_on_gift');
    if v_p is not null and new.receipt_status = 'not_sent' then
      v_pref := coalesce(
        new.receipt_pref,
        (select case c.preferred_channel when 'send_email' then 'email' end
           from public.contacts c where c.id = new.contact_id),
        v_p->>'system_default');
      new.receipt_status := case when v_pref = 'none' then 'not_required' else 'queued' end;
    end if;

    -- thank_you_on_gift stamps the gift here; the task is created AFTER insert.
    if public.crm_rule('thank_you_on_gift') is not null and new.thank_you_status = 'not_done' then
      new.thank_you_status := 'task_open';
    end if;
  end if;

  -- gift_aid_evaluate on every write, plus attach/detach the rolling claim
  new.gift_aid_status := public.crm_gift_aid_status(
    new.contact_id, new.donated_on, new.is_gasds, new.status, new.gift_aid_status);

  if new.gift_aid_status = 'eligible' and new.gift_aid_claim_id is null then
    new.gift_aid_claim_id := public.crm_rolling_ga_claim();
  elsif new.gift_aid_status in ('ineligible','pending_declaration')
        and new.gift_aid_claim_id is not null
        and exists (select 1 from public.gift_aid_claims c
                    where c.id = new.gift_aid_claim_id and c.status = 'draft-rolling') then
    new.gift_aid_claim_id := null;   -- only ever detach from a still-draft claim
  end if;

  return new;
end $$;

-- ==========================================================================
-- donations — AFTER: the task/signal/soft-credit side effects.
-- ==========================================================================

create or replace function public.donations_after_write()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_p jsonb; v_owner uuid; v_assignee uuid;
  v_big numeric; v_major numeric; v_prior int; v_money text;
begin
  if tg_op = 'DELETE' then
    perform public.crm_recompute_pledge(old.pledge_id);
    return old;
  end if;

  if public.crm_rule('household_soft_credit') is not null then
    perform public.crm_sync_household_soft_credits(new.id);
  end if;

  if tg_op = 'INSERT' then
    select c.relationship_owner_id into v_owner from public.contacts c where c.id = new.contact_id;
    v_money := to_char(new.amount_gbp, 'FM999G999G990D00');

    -- thank_you_on_gift: routed by size (08 §2) ▸ DonorPerfect SmartActions
    v_p := public.crm_rule('thank_you_on_gift');
    if v_p is not null then
      v_big   := coalesce((v_p->>'big_gift_threshold')::numeric, 500);
      v_major := coalesce((v_p->>'major_gift_threshold')::numeric, 5000);
      v_assignee := case when new.amount_gbp >= v_big
                         then v_owner
                         else coalesce((v_p->>'default_assignee')::uuid, v_owner) end;

      if not exists (
        select 1 from public.tasks t
        where t.contact_id = new.contact_id
          and t.origin = 'auto:thank_you'
          and t.status in ('todo','in_progress','waiting','queued'))
      then
        insert into public.tasks (contact_id, title, action_type, details, assigned_to,
                                  due_on, priority, status, origin)
        values (new.contact_id,
                'Thank you for £' || v_money,
                'thank_you',
                'Gift of £' || v_money || ' received ' || to_char(new.donated_on, 'DD Mon YYYY') || '.',
                v_assignee,
                current_date + coalesce((v_p->>'due_in_days')::int, 2),
                case when new.amount_gbp >= v_big then 'high' else 'medium' end,
                'todo', 'auto:thank_you');
      end if;

      if new.amount_gbp >= v_major then     -- major gift: a same-day nudge as well
        insert into public.signals (contact_id, rule_key, reason, dedupe_key)
        values (new.contact_id, 'thank_you_on_gift',
                'Major gift of £' || v_money || ' — thank personally, today.',
                'major_gift:' || new.id::text)
        on conflict (dedupe_key) do nothing;
      end if;
    end if;

    -- first_gift_call ▸ Bloomerang
    v_p := public.crm_rule('first_gift_call');
    if v_p is not null then
      select count(*) into v_prior
      from public.donations d
      where d.contact_id = new.contact_id and d.status = 'received' and d.id <> new.id;

      if v_prior = 0 then
        insert into public.signals (contact_id, rule_key, reason, dedupe_key)
        values (new.contact_id, 'first_gift_call',
                'First gift of £' || v_money || ' — a thank-you call within '
                  || coalesce(v_p->>'within_hours', '48') || 'h is the strongest retention move.',
                'first_gift:' || new.contact_id::text)
        on conflict (dedupe_key) do nothing;

        if not exists (
          select 1 from public.tasks t
          where t.contact_id = new.contact_id
            and t.origin = 'auto:signal'
            and t.action_type = 'call'
            and t.status in ('todo','in_progress','waiting','queued'))
        then
          insert into public.tasks (contact_id, title, action_type, details, assigned_to,
                                    due_on, priority, status, origin)
          values (new.contact_id, 'Call to thank — first gift', 'call',
                  'First-ever gift received ' || to_char(new.donated_on, 'DD Mon YYYY')
                    || '. Call within ' || coalesce(v_p->>'within_hours', '48') || ' hours.',
                  v_owner, current_date + 2, 'high', 'todo', 'auto:signal');
        end if;
      end if;
    end if;
  end if;

  perform public.crm_recompute_pledge(new.pledge_id);
  if tg_op = 'UPDATE' and old.pledge_id is distinct from new.pledge_id then
    perform public.crm_recompute_pledge(old.pledge_id);
  end if;

  return new;
end $$;

create trigger trg_donations_before before insert or update on public.donations
  for each row execute function public.donations_before_write();

create trigger trg_donations_after after insert or update or delete on public.donations
  for each row execute function public.donations_after_write();

-- ==========================================================================
-- gift_aid_declarations — a declaration change re-evaluates the donor's gifts
-- ==========================================================================

create or replace function public.gift_aid_declarations_after_write()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_contact uuid := coalesce(new.contact_id, old.contact_id);
begin
  update public.donations d
     set gift_aid_status = public.crm_gift_aid_status(
           d.contact_id, d.donated_on, d.is_gasds, d.status, d.gift_aid_status)
  where d.contact_id = v_contact
    and d.gift_aid_status <> 'claimed'
    and d.gift_aid_status is distinct from public.crm_gift_aid_status(
           d.contact_id, d.donated_on, d.is_gasds, d.status, d.gift_aid_status);
  -- donations_before_write then attaches newly-eligible gifts to the rolling claim
  return coalesce(new, old);
end $$;

create trigger trg_ga_declarations_after
  after insert or update or delete on public.gift_aid_declarations
  for each row execute function public.gift_aid_declarations_after_write();

-- ==========================================================================
-- tributes — the acknowledgee loop (08 §2 `tribute_acknowledgee`) ▸ Neon
-- Distinct from the donor's own thank-you: a different letter to a different
-- person. origin 'auto:tribute' extends the 02 §3.3 origin list.
-- ==========================================================================

create or replace function public.tributes_after_write()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_p jsonb := public.crm_rule('tribute_acknowledgee'); v_contact uuid;
begin
  if v_p is null or not new.notify or new.notified_at is not null then
    return new;
  end if;

  select coalesce(new.acknowledgee_contact_id, d.contact_id) into v_contact
  from public.donations d where d.id = new.donation_id;
  if v_contact is null then return new; end if;

  if not exists (
    select 1 from public.tasks t
    where t.contact_id = v_contact
      and t.origin = 'auto:tribute'
      and t.details like '%[tribute:' || new.id::text || ']%'
      and t.status in ('todo','in_progress','waiting','queued'))
  then
    insert into public.tasks (contact_id, title, action_type, details, due_on, priority, status, origin)
    values (v_contact,
            'Acknowledgement letter — ' || new.honoree_name,
            'other',
            'Tribute (' || new.tribute_type || ') for ' || new.honoree_name
              || coalesce(' — write to ' || new.acknowledgee_name, '')
              || ' [tribute:' || new.id::text || ']',
            current_date + coalesce((v_p->>'due_in_days')::int, 3),
            'medium', 'todo', 'auto:tribute');
  end if;
  return new;
end $$;

create trigger trg_tributes_after after insert or update on public.tributes
  for each row execute function public.tributes_after_write();

-- ==========================================================================
-- contacts — moving between households re-derives the affected soft credits
-- ==========================================================================

create or replace function public.contacts_after_household_change()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  if old.household_id is not distinct from new.household_id then
    return new;
  end if;

  for r in
    select d.id
    from public.donations d
    where d.contact_id = new.id
       or d.contact_id in (
            select c.id from public.contacts c
            where c.household_id in (old.household_id, new.household_id))
  loop
    perform public.crm_sync_household_soft_credits(r.id);
  end loop;

  return new;
end $$;

create trigger trg_contacts_household_change after update of household_id on public.contacts
  for each row execute function public.contacts_after_household_change();

-- --------------------------------------------------------------------------
-- Not implemented as triggers, deliberately:
--   influencer_prompt   — a UI chip at gift entry (05 §1), not a write (08 §2).
--   stage_change_prompts — starts the proposal timer, which the nightly
--                          proposal_follow_up rule already derives from
--                          contacts.stage; the opportunity half is a UI prompt (I-4).
--   pledge_schedule (generation half) — installments are authored with the
--                          pledge; only the balance/fulfilment half is automated.
-- --------------------------------------------------------------------------
