-- ============================================================================
-- 003c_nightly — run_nightly() per 08 §3 + §5, its two supporting tables,
--                and the pg_cron schedule.
-- ============================================================================
-- Order of operations (08 §5):
--   1. recompute: engagement -> donor statuses -> auto-tags -> duplicate scan
--   2. task rules (§3), created idempotently by `origin`
--   3. signal rules, deduped by `dedupe_key` so a dismissed signal never
--      re-fires until the underlying condition resets
--   4. (no materialised aggregates — contact_stats stays a live view, I-9)
--   5. digest payloads are assembled by the app, not here [P1]
--   6. a run-log row, visible in Settings for trust/debugging
--
-- Two tables are added here that schema-v2.sql does not define; both exist
-- purely to serve rules 08 §3 names but gives no storage for:
--   * duplicates_queue — the `duplicate_scan` rule's output, consumed by the
--     merge tool (06 §5). Pairs are stored once, ordered a<b.
--   * nightly_runs     — the §5.6 run log (started, finished, created counts).
-- ============================================================================

create table if not exists public.nightly_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean not null default false,
  counts      jsonb not null default '{}',
  error       text
);

create table if not exists public.duplicates_queue (
  id           uuid primary key default gen_random_uuid(),
  contact_a_id uuid not null references public.contacts (id) on delete cascade,
  contact_b_id uuid not null references public.contacts (id) on delete cascade,
  score        numeric(4,3),
  reason       text not null,
  state        text not null default 'open' check (state in ('open','dismissed','merged')),
  created_at   timestamptz not null default now(),
  check (contact_a_id < contact_b_id),
  unique (contact_a_id, contact_b_id)
);

-- Merge and the run log both live behind admin-only surfaces (11 §1).
alter table public.nightly_runs      enable row level security;
alter table public.duplicates_queue  enable row level security;

create policy nightly_runs_sel on public.nightly_runs
  for select to authenticated using (public.crm_role() = 'admin');

create policy duplicates_queue_sel on public.duplicates_queue
  for select to authenticated using (public.crm_role() = 'admin');
create policy duplicates_queue_upd on public.duplicates_queue
  for update to authenticated using (public.crm_role() = 'admin')
  with check (public.crm_role() = 'admin');
create policy duplicates_queue_del on public.duplicates_queue
  for delete to authenticated using (public.crm_role() = 'admin');

grant select, insert, update, delete on public.nightly_runs, public.duplicates_queue
  to authenticated;
grant all on public.nightly_runs, public.duplicates_queue to service_role;

-- --------------------------------------------------------------------------
-- Engagement tiers are ordered, so a *drop* can be detected (08 §3) ▸ Bloomerang
-- --------------------------------------------------------------------------

create or replace function public.crm_tier_rank(p_tier text)
returns int language sql immutable as $$
  select case p_tier
    when 'cold' then 1 when 'cool' then 2 when 'warm' then 3
    when 'hot'  then 4 when 'on_fire' then 5 else 0 end
$$;

-- --------------------------------------------------------------------------
-- auto_tags interpreter (08 §3 `auto_tags`) ▸ Donorfy.
-- A tag's auto_rule is saved-view-shaped criteria. The supported vocabulary is
-- deliberately small; an unrecognised rule type is a documented no-op rather
-- than an error, so a half-configured tag can never break the nightly run.
-- --------------------------------------------------------------------------

create or replace function public.crm_auto_tag_contacts(p_rule jsonb)
returns table (contact_id uuid)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_type text := p_rule->>'type';
begin
  if v_type = 'lybunt' then
    return query select cs.contact_id from public.contact_stats cs where cs.is_lybunt;
  elsif v_type = 'sybunt' then
    return query select cs.contact_id from public.contact_stats cs where cs.is_sybunt;
  elsif v_type = 'donor_status' then
    return query select cs.contact_id from public.contact_stats cs
                 where cs.donor_status = p_rule->>'value';
  elsif v_type = 'stage' then
    return query select c.id from public.contacts c where c.stage = p_rule->>'value';
  elsif v_type = 'min_lifetime' then
    return query select cs.contact_id from public.contact_stats cs
                 where cs.lifetime_giving >= (p_rule->>'amount')::numeric;
  elsif v_type = 'gave_to_appeal' then
    return query select distinct d.contact_id from public.donations d
                 where d.status = 'received' and d.appeal_id = (p_rule->>'appeal_id')::uuid;
  else
    return;   -- unknown rule type: no-op
  end if;
end $$;

-- ==========================================================================
-- run_nightly()
-- ==========================================================================

create or replace function public.run_nightly()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_run   bigint;
  v_counts jsonb := '{}'::jsonb;
  v_p     jsonb;
  v_n     int;
  v_days  int;
  v_thr   numeric;
  r       record;
begin
  insert into public.nightly_runs default values returning id into v_run;

  -- ---------------------------------------------------------------- 1a. engagement
  v_p := public.crm_rule('engagement_recompute');
  if v_p is not null then
    drop table if exists _crm_prev_tier;
    create temp table _crm_prev_tier as
      select id, engagement_tier from public.contacts;

    with cfg as (
      select
        coalesce((v_p->>'lookback_days')::int, 365)        as lookback,
        coalesce((v_p->>'halflife_days')::numeric, 120)    as halflife,
        coalesce((v_p->>'gift_points')::numeric, 25)       as gift_points,
        coalesce((v_p->>'gift_points_cap')::numeric, 50)   as gift_cap,
        coalesce((v_p->>'recency_bonus')::numeric, 15)     as recency_bonus,
        coalesce((v_p->>'recency_days')::int, 30)          as recency_days,
        coalesce((v_p->>'unknown_days')::int, 30)          as unknown_days,
        coalesce(v_p->'weights', '{}'::jsonb)              as weights,
        coalesce(v_p->'tiers', '{}'::jsonb)                as tiers
    ),
    -- Σ interaction points, type-weighted, halved per halflife of age (02 §4.3)
    inter as (
      select i.contact_id,
             sum(
               coalesce(
                 (cfg.weights ->> i.kind)::numeric,
                 (select (lo.meta->>'weight')::numeric from public.lookup_options lo
                   where lo.list_name = 'interaction_kind' and lo.value = i.kind),
                 5)
               * power(0.5, (current_date - i.occurred_at::date)::numeric / cfg.halflife)
             ) as pts
      from public.interactions i cross join cfg
      where i.status = 'logged'
        and i.occurred_at <= now()
        and i.occurred_at >= now() - make_interval(days => cfg.lookback)
      group by i.contact_id
    ),
    gift_pts as (
      select d.contact_id, least(count(*) * min(cfg.gift_points), min(cfg.gift_cap)) as pts
      from public.donations d cross join cfg
      where d.status = 'received'
        and d.donated_on >= current_date - cfg.lookback
      group by d.contact_id
    ),
    recency as (
      select i.contact_id, max(cfg.recency_bonus) as pts
      from public.interactions i cross join cfg
      where i.is_meaningful and i.status = 'logged'
        and i.occurred_at <= now()
        and i.occurred_at >= now() - make_interval(days => cfg.recency_days)
      group by i.contact_id
    ),
    scored as (
      select c.id,
             round(coalesce(inter.pts,0) + coalesce(gift_pts.pts,0) + coalesce(recency.pts,0))::int as score,
             (c.created_at >= now() - make_interval(days => cfg.unknown_days)) as too_new,
             (inter.contact_id is null and gift_pts.contact_id is null)        as no_history,
             cfg.tiers as tiers
      from public.contacts c
      cross join cfg
      left join inter    on inter.contact_id    = c.id
      left join gift_pts on gift_pts.contact_id = c.id
      left join recency  on recency.contact_id  = c.id
    )
    update public.contacts c
       set engagement_score = s.score,
           engagement_tier = case
             when s.too_new or s.no_history then 'unknown'
             when s.score >= coalesce((s.tiers->>'on_fire')::numeric, 120) then 'on_fire'
             when s.score >= coalesce((s.tiers->>'hot')::numeric, 70)      then 'hot'
             when s.score >= coalesce((s.tiers->>'warm')::numeric, 35)     then 'warm'
             when s.score >= coalesce((s.tiers->>'cool')::numeric, 15)     then 'cool'
             else 'cold' end,
           engagement_computed_at = now()
      from scored s
     where c.id = s.id;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('engagement_scored', v_n);

    -- a tier DROP is a relationship warning, not a statistic
    insert into public.signals (contact_id, rule_key, reason, dedupe_key)
    select c.id, 'engagement_recompute',
           'Engagement dropped from ' || p.engagement_tier || ' to ' || c.engagement_tier
             || ' — worth a call.',
           'engagement_drop:' || c.id::text || ':' || p.engagement_tier || '>' || c.engagement_tier
    from public.contacts c
    join _crm_prev_tier p on p.id = c.id
    where p.engagement_tier <> 'unknown'
      and public.crm_tier_rank(c.engagement_tier) < public.crm_tier_rank(p.engagement_tier)
    on conflict (dedupe_key) do nothing;

    drop table if exists _crm_prev_tier;
  end if;

  -- ---------------------------------------------------------------- 1b. donor status
  -- Statuses themselves are computed in contact_stats (I-9); the nightly rule
  -- only raises the pre-lapse rescue signal (08 §3) ▸ Virtuous.
  if public.crm_rule('donor_status_recompute') is not null then
    insert into public.signals (contact_id, rule_key, reason, dedupe_key)
    select cs.contact_id, 'donor_status_recompute',
           'Entered pre-lapsed — last gift ' || to_char(cs.last_gift_date, 'Mon YYYY')
             || '. The rescue window is open before the annual cycle closes.',
           'pre_lapsed:' || cs.contact_id::text || ':' || to_char(cs.last_gift_date, 'YYYY-MM')
    from public.contact_stats cs
    where cs.donor_status = 'pre_lapsed'
    on conflict (dedupe_key) do nothing;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('pre_lapsed_signals', v_n);
  end if;

  -- ---------------------------------------------------------------- 1c. auto-tags
  if public.crm_rule('auto_tags') is not null then
    v_n := 0;
    for r in select id, auto_rule from public.tags where is_auto and auto_rule is not null loop
      insert into public.taggings (tag_id, contact_id)
      select r.id, m.contact_id from public.crm_auto_tag_contacts(r.auto_rule) m
      on conflict (tag_id, contact_id) do nothing;

      delete from public.taggings tg
      where tg.tag_id = r.id
        and tg.contact_id not in (select m.contact_id from public.crm_auto_tag_contacts(r.auto_rule) m);
      v_n := v_n + 1;
    end loop;
    v_counts := v_counts || jsonb_build_object('auto_tag_rules_applied', v_n);
  end if;

  -- ---------------------------------------------------------------- 1d. duplicate scan
  v_p := public.crm_rule('duplicate_scan');
  if v_p is not null then
    v_thr := coalesce((v_p->>'name_similarity')::numeric, 0.6);
    insert into public.duplicates_queue (contact_a_id, contact_b_id, score, reason)
    select a.id, b.id,
           round(similarity(a.first_name || ' ' || a.last_name,
                            b.first_name || ' ' || b.last_name)::numeric, 3),
           case
             when a.email is not null and lower(a.email) = lower(b.email) then 'same email'
             when a.phone is not null and a.phone = b.phone               then 'same phone'
             else 'similar name'
           end
    from public.contacts a
    join public.contacts b on a.id < b.id
    where not a.is_archived and not b.is_archived
      and a.merged_into_id is null and b.merged_into_id is null
      and not a.is_organisation_self and not b.is_organisation_self
      and (
        (a.email is not null and b.email is not null and lower(a.email) = lower(b.email))
        or (a.phone is not null and b.phone is not null and a.phone = b.phone)
        or (
          (a.first_name || ' ' || a.last_name) % (b.first_name || ' ' || b.last_name)
          and similarity(a.first_name || ' ' || a.last_name,
                         b.first_name || ' ' || b.last_name) >= v_thr
        )
      )
    on conflict (contact_a_id, contact_b_id) do nothing;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('duplicate_pairs', v_n);
  end if;

  -- ---------------------------------------------------------------- 2a. kit_due
  if public.crm_rule('kit_due') is not null then
    insert into public.tasks (contact_id, title, action_type, details, assigned_to,
                              due_on, priority, status, origin)
    select cs.contact_id,
           'Keep in touch — ' || btrim(c.first_name || ' ' || c.last_name),
           'keep_in_touch',
           'Cadence every ' || c.contact_frequency_days || ' days; was due '
             || to_char(cs.kit_due_on, 'DD Mon YYYY') || '.',
           c.relationship_owner_id,
           cs.kit_due_on,
           case c.priority when 'high' then 'high' else 'medium' end,
           'todo', 'auto:kit'
    from public.contact_stats cs
    join public.contacts c on c.id = cs.contact_id
    where cs.kit_due_on is not null
      and cs.kit_due_on < current_date
      and not c.is_archived
      and not exists (
        select 1 from public.tasks t
        where t.contact_id = cs.contact_id
          and t.origin = 'auto:kit'
          and t.status in ('todo','in_progress','waiting','queued'));
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('kit_tasks', v_n);
  end if;

  -- ---------------------------------------------------------------- 2b. proposal_follow_up
  v_p := public.crm_rule('proposal_follow_up');
  if v_p is not null then
    v_days := coalesce((v_p->>'days')::int, 7);
    insert into public.tasks (contact_id, title, action_type, details, assigned_to,
                              due_on, priority, status, origin)
    select c.id, 'Follow up the proposal', 'follow_up_proposal',
           'Proposal sent and nothing logged for ' || v_days || '+ days.',
           c.relationship_owner_id, current_date, 'high', 'todo', 'auto:proposal_follow_up'
    from public.contacts c
    where c.stage = 'proposal_sent'
      and not c.is_archived
      and not exists (
        select 1 from public.interactions i
        where i.contact_id = c.id and i.status = 'logged'
          and i.occurred_at >= now() - make_interval(days => v_days))
      and not exists (
        select 1 from public.tasks t
        where t.contact_id = c.id and t.origin = 'auto:proposal_follow_up'
          and t.status in ('todo','in_progress','waiting','queued'));
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('proposal_follow_ups', v_n);
  end if;

  -- ---------------------------------------------------------------- 2c. pledge_chase
  v_p := public.crm_rule('pledge_chase');
  if v_p is not null then
    v_days := coalesce((v_p->>'first_after_days')::int, 14);
    insert into public.tasks (contact_id, title, action_type, details, assigned_to,
                              due_on, priority, status, origin)
    select pl.contact_id,
           'Pledge installment overdue',
           'call',
           count(*) || ' installment(s) overdue, £'
             || to_char(sum(pi.amount), 'FM999G999G990D00')
             || ' outstanding; earliest due ' || to_char(min(pi.due_on), 'DD Mon YYYY') || '.',
           max(c.relationship_owner_id),
           current_date, 'high', 'todo', 'auto:pledge_chase'
    from public.pledge_installments pi
    join public.pledges pl on pl.id = pi.pledge_id
    join public.contacts c on c.id = pl.contact_id
    where pi.status = 'expected'
      and pl.status = 'open'
      and pi.due_on < current_date - v_days
      and not exists (
        select 1 from public.tasks t
        where t.contact_id = pl.contact_id and t.origin = 'auto:pledge_chase'
          and t.status in ('todo','in_progress','waiting','queued'))
    group by pl.contact_id;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('pledge_chases', v_n);
  end if;

  -- ---------------------------------------------------------------- 3a. recurring_failing
  v_p := public.crm_rule('recurring_failing');
  if v_p is not null then
    v_days := coalesce((v_p->>'late_days')::int, 7);
    with due as (
      select ra.id, ra.contact_id, ra.amount, ra.frequency, ra.ends_on,
             (coalesce(ra.last_payment_on, ra.starts_on)
               + case ra.frequency
                   when 'weekly'    then interval '7 days'
                   when 'monthly'   then interval '1 month'
                   when 'quarterly' then interval '3 months'
                   else interval '1 year'
                 end)::date as next_expected
      from public.recurring_agreements ra
      where ra.status = 'active'
    ),
    upd as (
      update public.recurring_agreements r
         set status = 'failing',
             missed_count = r.missed_count + 1
      from due
      where due.id = r.id
        and due.next_expected < current_date - v_days
        and (r.ends_on is null or r.ends_on >= current_date)
      returning r.id, r.contact_id, r.amount, r.frequency, due.next_expected
    )
    insert into public.signals (contact_id, rule_key, reason, dedupe_key)
    select u.contact_id, 'recurring_failing',
           'Standing order of £' || to_char(u.amount, 'FM999G999G990D00') || '/' || u.frequency
             || ' is ' || (current_date - u.next_expected) || ' days late. Call — don''t email.',
           'recurring_failing:' || u.id::text || ':' || to_char(u.next_expected, 'YYYY-MM-DD')
    from upd u
    on conflict (dedupe_key) do nothing;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('recurring_failing_signals', v_n);
  end if;

  -- ---------------------------------------------------------------- 3b. neglect_flags
  v_p := public.crm_rule('neglect_flags');
  if v_p is not null then
    insert into public.signals (contact_id, rule_key, reason, dedupe_key)
    select x.contact_id, 'neglect_flags',
           'No meaningful contact with ' || x.name || ' in ' || x.days_since_contact
             || ' days (threshold: ' || x.threshold || ' for ' || x.label || ').',
           'neglect:' || x.contact_id::text || ':'
             || coalesce(to_char(x.last_meaningful_contact_at, 'YYYY-MM-DD'), 'never')
    from (
      select cs.contact_id,
             btrim(c.first_name || ' ' || c.last_name) as name,
             cs.days_since_contact,
             cs.last_meaningful_contact_at,
             case
               when exists (select 1 from public.taggings tg join public.tags tt on tt.id = tg.tag_id
                             where tg.contact_id = c.id and not tg.is_excluded
                               and tt.name = coalesce(v_p->>'vip_tag','VIP'))
                 then coalesce((v_p->>'vip_days')::int, 90)
               when c.priority = 'high'
                 then coalesce((v_p->>'high_priority_days')::int, 30)
               when cs.donor_status = 'active'
                 then coalesce((v_p->>'active_donor_days')::int, 60)
             end as threshold,
             case
               when exists (select 1 from public.taggings tg join public.tags tt on tt.id = tg.tag_id
                             where tg.contact_id = c.id and not tg.is_excluded
                               and tt.name = coalesce(v_p->>'vip_tag','VIP'))
                 then 'VIPs'
               when c.priority = 'high' then 'high priority'
               else 'active donors'
             end as label
      from public.contact_stats cs
      join public.contacts c on c.id = cs.contact_id
      where not c.is_archived
        and not c.is_organisation_self
        and cs.days_since_contact is not null
    ) x
    where x.threshold is not null
      and x.days_since_contact > x.threshold
    on conflict (dedupe_key) do nothing;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('neglect_signals', v_n);
  end if;

  -- ---------------------------------------------------------------- 2d. meeting_reminder
  v_p := public.crm_rule('meeting_reminder');
  if v_p is not null then
    v_days := coalesce((v_p->>'days_before')::int, 1);
    insert into public.tasks (contact_id, title, action_type, details, assigned_to,
                              due_on, priority, status, origin)
    select m.contact_id,
           'Prepare for meeting — ' || m.what,
           'arrange_meeting',
           'Scheduled ' || to_char(m.occurred_at, 'DD Mon YYYY HH24:MI')
             || coalesce(' at ' || m.location, '') || '.',
           m.assignee, current_date, 'high', 'todo', 'auto:meeting_reminder'
    from (
      select distinct on (i.contact_id)
             i.contact_id, i.occurred_at, i.location,
             coalesce(nullif(i.purpose, ''), i.summary) as what,
             coalesce(i.team_member_id, c.relationship_owner_id) as assignee
      from public.interactions i
      join public.contacts c on c.id = i.contact_id
      where i.status = 'scheduled'
        and i.occurred_at::date = current_date + v_days
      order by i.contact_id, i.occurred_at
    ) m
    where not exists (
      select 1 from public.tasks t
      where t.contact_id = m.contact_id
        and t.origin = 'auto:meeting_reminder'
        and t.due_on = current_date
        and t.status in ('todo','in_progress','waiting','queued'));
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('meeting_reminders', v_n);
  end if;

  -- ---------------------------------------------------------------- audits (counts only)
  -- no_next_action_audit: surfaced, never auto-fixed (I-3). The number is
  -- derivable from contact_stats.flag, so nothing is stored.
  if public.crm_rule('no_next_action_audit') is not null then
    select count(*) into v_n from public.contact_stats where flag = 'none';
    v_counts := v_counts || jsonb_build_object('no_next_action', v_n);
  end if;

  v_p := public.crm_rule('stale_prospects');
  if v_p is not null then
    v_days := coalesce((v_p->>'days')::int, 90);
    select count(*) into v_n
    from public.opportunities o
    where o.status = 'open'
      and coalesce(o.last_moved_forward_at, o.stage_entered_at) < now() - make_interval(days => v_days);
    v_counts := v_counts || jsonb_build_object('stale_prospects', v_n);
  end if;

  -- ---------------------------------------------------------------- 6. run log
  update public.nightly_runs
     set finished_at = now(), ok = true, counts = v_counts
   where id = v_run;

  return v_counts;
end;
$fn$;

comment on function public.run_nightly() is
  'The nightly run (08 §3/§5): recompute, then idempotent tasks, then deduped signals, then a run-log row.';

revoke all on function public.run_nightly() from public, anon;
grant execute on function public.run_nightly() to service_role;

-- --------------------------------------------------------------------------
-- Schedule: 05:00 UTC (08 §1). Wrapped so a project without pg_cron still
-- gets the function — the schedule is the only part that would be missing.
-- --------------------------------------------------------------------------

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'crm-nightly') then
      perform cron.unschedule('crm-nightly');
    end if;
    perform cron.schedule('crm-nightly', '0 5 * * *', 'select public.run_nightly()');
  else
    raise notice 'pg_cron not installed — run_nightly() exists but is not scheduled.';
  end if;
exception when others then
  raise notice 'Could not schedule crm-nightly (%). run_nightly() still exists.', sqlerrm;
end
$do$;
