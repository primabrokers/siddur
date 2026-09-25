-- ============================================================================
-- 007_gift_aid_claim_flow — the Gift Aid workspace's server side (05 §5, 07 §8)
-- ============================================================================
-- What M7 needs that 001–004 do not already provide:
--
--   * `ga_house_number`        the HMRC "House name or number" rule, one place
--   * `ga_declaration_covers`  the declaration-coverage predicate, extracted
--                              from `crm_gift_aid_status` so the validation
--                              pass and the trigger cannot drift apart
--   * `ga_claim_validation`    per-gift claim blockers, one row per failure
--   * `ga_submit_claim`        the submit transition (admin only): stamp the
--                              gifts `claimed`, total the claim, record the
--                              HMRC reference, open a fresh rolling claim
--   * `gift_aid_claim_totals`  live per-claim totals — the hero's numbers come
--                              from the database, never from client arithmetic
--                              (I-8/I-9)
--   * `ga_missing_declarations` the found-money queue and the 4-year back-claim
--                              figure, per donor
--   * `donations.ga_excluded_at`  the Review & export "exclude this gift" fix
--   * `gift_aid_claims.paid_on`   when HMRC actually paid (the history's PAID pill)
--
-- Everything here is additive: no existing table, trigger, view or policy is
-- redefined. The two new donations columns arrive with a *second* BEFORE
-- trigger (`trg_ga_exclusion_before`) rather than an edit to
-- `donations_before_write`; Postgres fires row triggers of the same event in
-- name order, and `trg_ga_exclusion_before` sorts after `trg_donations_before`,
-- so it gets the last word on `gift_aid_claim_id` without touching M4's code.
-- ============================================================================

-- --------------------------------------------------------------------------
-- Two fields spec 02 §3.7 does not name but 05 §5 needs (deviation, declared):
--
--   * `donations.ga_excluded_at` — the Review & export validation list offers
--     "exclude this gift" as a one-click fix for a row that cannot be claimed
--     (non-GBP, a donor who will never declare). Without a stored flag the
--     rolling-claim trigger simply re-attaches the gift on the next write.
--   * `gift_aid_claims.paid_on` — the claim history's "PAID 21 Jul" pill in the
--     A7 wireframe. `status = 'paid'` alone cannot render the date.
-- --------------------------------------------------------------------------

alter table public.donations
  add column if not exists ga_excluded_at   timestamptz,
  add column if not exists ga_exclude_reason text;

comment on column public.donations.ga_excluded_at is
  'Held back from Gift Aid claiming by a human (05 §5 Review & export). Detaches the gift from the rolling claim until cleared.';

alter table public.gift_aid_claims
  add column if not exists paid_on date;

comment on column public.gift_aid_claims.paid_on is
  'Date HMRC paid the claim — the claim history''s PAID pill (05 §5, artboard A7).';

create or replace function public.ga_exclusion_before_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Runs after donations_before_write (name order). A held-back gift leaves the
  -- rolling claim; a claim already filed is never disturbed.
  if new.ga_excluded_at is not null and new.gift_aid_status is distinct from 'claimed' then
    if new.gift_aid_claim_id is not null and exists (
      select 1 from public.gift_aid_claims c
      where c.id = new.gift_aid_claim_id and c.status in ('draft-rolling', 'ready')
    ) then
      new.gift_aid_claim_id := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_ga_exclusion_before on public.donations;
create trigger trg_ga_exclusion_before
  before insert or update on public.donations
  for each row execute function public.ga_exclusion_before_write();

-- --------------------------------------------------------------------------
-- HMRC "House name or number" (05 §5 CSV column 4).
-- `contacts.ga_house_no` is the explicit override; otherwise the leading token
-- of address_line1 — "12 The Drive" -> "12", "Elm House, ..." -> "Elm".
-- --------------------------------------------------------------------------

create or replace function public.ga_house_number(p_ga_house_no text, p_address_line1 text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(btrim(coalesce(p_ga_house_no, '')), ''),
    (regexp_match(btrim(coalesce(p_address_line1, '')), '^([^,[:space:]]+)'))[1],
    ''
  )
$$;

comment on function public.ga_house_number(text, text) is
  'HMRC Charities Online house name/number: ga_house_no, else the leading token of address_line1 (05 §5).';

-- --------------------------------------------------------------------------
-- Does any uncancelled declaration cover a gift made on this date?
--
-- Same rule as `crm_gift_aid_status` (003b): anchored on covers_from when set,
-- else declared_on; forward from the anchor when covers_future; back up to
-- `back_years` (rule params, default 4) when covers_past; oral declarations
-- only count once the written confirmation HMRC requires has been sent.
-- --------------------------------------------------------------------------

create or replace function public.ga_declaration_covers(p_contact uuid, p_donated_on date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.gift_aid_declarations g
    where g.contact_id = p_contact
      and (g.cancelled_on is null or g.cancelled_on > p_donated_on)
      and (g.method <> 'oral' or g.oral_confirmation_sent_on is not null)
      and (
        (g.covers_future and p_donated_on >= coalesce(g.covers_from, g.declared_on))
        or (
          g.covers_past
          and p_donated_on < coalesce(g.covers_from, g.declared_on)
          and p_donated_on >= (
            coalesce(g.covers_from, g.declared_on)
            - make_interval(years => coalesce(
                (public.crm_rule('gift_aid_evaluate')->>'back_years')::int, 4))
          )::date
        )
      )
  )
$$;

comment on function public.ga_declaration_covers(uuid, date) is
  'Declaration coverage for one gift date — the predicate crm_gift_aid_status uses (02 §3.7).';

-- --------------------------------------------------------------------------
-- ga_claim_validation — one row per *failure*, so an empty result means the
-- claim is ready to export (05 §5 "failures listed with one-click fixes").
--
-- GASDS lines carry no donor detail and never appear in the CSV, so they are
-- not validated here.
-- --------------------------------------------------------------------------

create or replace function public.ga_claim_validation(p_claim_id uuid)
returns table (
  donation_id uuid,
  contact_id  uuid,
  donor_name  text,
  donated_on  date,
  amount_gbp  numeric,
  code        text,
  message     text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with lines as (
    select
      d.id, d.contact_id, d.donated_on, d.amount_gbp, d.currency,
      coalesce(
        nullif(btrim(concat_ws(' ', c.title, c.first_name, nullif(c.last_name, ''))), ''),
        c.organization)                                                              as donor_name,
      c.contact_kind, c.postcode,
      public.ga_house_number(c.ga_house_no, c.address_line1)                         as house_no
    from public.donations d
    join public.contacts c on c.id = d.contact_id
    where d.gift_aid_claim_id = p_claim_id
      and coalesce(d.is_gasds, false) = false
      and d.status = 'received'
  )
  select l.id, l.contact_id, nullif(l.donor_name, ''), l.donated_on, l.amount_gbp, v.code, v.message
  from lines l
  cross join lateral (
    values
      ('missing_postcode', 'Postcode missing — HMRC needs it to match the donor',
        (l.postcode is null or btrim(l.postcode) = '')),
      ('missing_house_no', 'House name or number missing',
        (l.house_no = '')),
      ('not_gbp', 'Only sterling gifts can be claimed',
        (upper(coalesce(l.currency, 'GBP')) <> 'GBP')),
      ('not_individual', 'Only an individual can Gift Aid a donation',
        (coalesce(l.contact_kind, 'individual') <> 'individual')),
      ('no_declaration', 'No declaration covering this gift date',
        (not public.ga_declaration_covers(l.contact_id, l.donated_on)))
  ) as v(code, message, failed)
  where v.failed
  order by l.donated_on, l.id, v.code
$$;

comment on function public.ga_claim_validation(uuid) is
  'Per-gift Gift Aid claim blockers, one row per failure — the Review & export validation pass (05 §5).';

-- --------------------------------------------------------------------------
-- ga_submit_claim — the one state transition the workspace performs (07 §8.3).
--
-- Admin only (11 §1). Idempotent-safe: re-submitting the same claim with the
-- same reference is a no-op, a different reference is refused rather than
-- silently overwriting a filed claim.
-- --------------------------------------------------------------------------

create or replace function public.ga_submit_claim(p_claim_id uuid, p_reference text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claim        public.gift_aid_claims;
  v_ref          text := nullif(btrim(coalesce(p_reference, '')), '');
  v_period_start date;
  v_donations    numeric(12,2);
  v_gasds        numeric(12,2);
begin
  if public.crm_role() is distinct from 'admin' then
    raise exception 'Submitting a Gift Aid claim is an admin action (11 §1)'
      using errcode = '42501';
  end if;

  select * into v_claim from public.gift_aid_claims where id = p_claim_id for update;
  if not found then
    raise exception 'Gift Aid claim % does not exist', p_claim_id using errcode = 'P0002';
  end if;

  -- Already filed: the same reference is the caller retrying, anything else is
  -- a second submission of a claim HMRC already has.
  if v_claim.status in ('submitted', 'paid') then
    if v_claim.hmrc_reference is not distinct from v_ref then
      return;
    end if;
    raise exception 'Claim % is already % under reference %',
      p_claim_id, v_claim.status, coalesce(v_claim.hmrc_reference, '(none)')
      using errcode = '22023';
  end if;

  if v_claim.status not in ('draft-rolling', 'ready') then
    raise exception 'Claim % is %; only a draft-rolling or ready claim can be submitted',
      p_claim_id, v_claim.status using errcode = '22023';
  end if;

  if v_ref is null then
    raise exception 'An HMRC reference is required to record a submission'
      using errcode = '22023';
  end if;

  -- GASDS (02 §3.4): small cash/contactless gifts need no declaration, so they
  -- never attach at entry — they are swept in at submission, from the day after
  -- the last filed claim. Status and claim id move together: `claimed` is
  -- terminal in crm_gift_aid_status, so the BEFORE trigger leaves both alone.
  select coalesce(max(submitted_on), date '1900-01-01') into v_period_start
  from public.gift_aid_claims
  where status in ('submitted', 'paid') and id <> p_claim_id;

  update public.donations d
     set gift_aid_claim_id = p_claim_id,
         gift_aid_status   = 'claimed'
   where coalesce(d.is_gasds, false)
     and d.status = 'received'
     and upper(coalesce(d.currency, 'GBP')) = 'GBP'
     and d.gift_aid_claim_id is null
     and d.ga_excluded_at is null
     and d.donated_on > v_period_start
     and d.donated_on <= current_date;

  -- Every gift on the claim is stamped claimed (02 §3.4 / 07 §8.3).
  update public.donations
     set gift_aid_status = 'claimed'
   where gift_aid_claim_id = p_claim_id
     and gift_aid_status is distinct from 'claimed';

  select
    coalesce(sum(amount_gbp) filter (where not coalesce(is_gasds, false)), 0),
    coalesce(sum(amount_gbp) filter (where coalesce(is_gasds, false)), 0)
  into v_donations, v_gasds
  from public.donations
  where gift_aid_claim_id = p_claim_id and status = 'received';

  update public.gift_aid_claims
     set status          = 'submitted',
         submitted_on    = current_date,
         hmrc_reference  = v_ref,
         total_donations = v_donations,
         total_claimed   = round(v_donations * 0.25, 2),
         gasds_total     = v_gasds
   where id = p_claim_id;

  -- Exactly one rolling claim exists at a time (02 §3.7): opening the next one
  -- is part of filing this one, so the next eligible gift has somewhere to go.
  perform public.crm_rolling_ga_claim();
end $$;

comment on function public.ga_submit_claim(uuid, text) is
  'File a Gift Aid claim: stamp its gifts claimed, total it, record the HMRC reference, open the next rolling claim (07 §8).';

revoke all on function public.ga_submit_claim(uuid, text) from public;
grant execute on function public.ga_submit_claim(uuid, text)   to authenticated;
grant execute on function public.ga_claim_validation(uuid)     to authenticated;
grant execute on function public.ga_declaration_covers(uuid, date) to authenticated;
grant execute on function public.ga_house_number(text, text)   to authenticated;

-- --------------------------------------------------------------------------
-- gift_aid_claim_totals — the rolling-claim hero and the history table read
-- their numbers here, never by summing rows in the client (I-8/I-9).
--
-- A filed claim reports what was filed; an open one reports live totals,
-- including the GASDS gifts that will be swept in at submission.
-- security_invoker: donations' own RLS decides what a member may aggregate.
-- --------------------------------------------------------------------------

create or replace view public.gift_aid_claim_totals with (security_invoker = true) as
select
  c.id                                      as claim_id,
  c.status,
  c.created_at::date                        as building_since,
  c.submitted_on,
  c.paid_on,
  c.hmrc_reference,
  coalesce(
    case when c.status in ('submitted', 'paid') then c.total_donations end,
    (select coalesce(sum(d.amount_gbp), 0) from public.donations d
      where d.gift_aid_claim_id = c.id and d.status = 'received'
        and not coalesce(d.is_gasds, false))
  )                                         as donations_total,
  coalesce(
    case when c.status in ('submitted', 'paid') then c.total_claimed end,
    round(
      (select coalesce(sum(d.amount_gbp), 0) from public.donations d
        where d.gift_aid_claim_id = c.id and d.status = 'received'
          and not coalesce(d.is_gasds, false)) * 0.25, 2)
  )                                         as claimable_total,
  coalesce(
    case when c.status in ('submitted', 'paid') then c.gasds_total end,
    (select coalesce(sum(d.amount_gbp), 0) from public.donations d
      where d.gift_aid_claim_id = c.id and d.status = 'received'
        and coalesce(d.is_gasds, false))
    + (select coalesce(sum(d.amount_gbp), 0) from public.donations d
        where d.gift_aid_claim_id is null and d.status = 'received'
          and coalesce(d.is_gasds, false)
          and d.ga_excluded_at is null
          and upper(coalesce(d.currency, 'GBP')) = 'GBP'
          and d.donated_on <= current_date
          and d.donated_on > coalesce(
                (select max(s.submitted_on) from public.gift_aid_claims s
                  where s.status in ('submitted', 'paid')), date '1900-01-01'))
  )                                         as gasds_total,
  (select count(*) from public.donations d
    where d.gift_aid_claim_id = c.id and d.status = 'received'
      and not coalesce(d.is_gasds, false)) as gift_count,
  (select count(distinct d.contact_id) from public.donations d
    where d.gift_aid_claim_id = c.id and d.status = 'received'
      and not coalesce(d.is_gasds, false)) as donor_count
from public.gift_aid_claims c;

comment on view public.gift_aid_claim_totals is
  'Live per-claim Gift Aid totals — the rolling-claim hero and the claim history (05 §5).';

-- --------------------------------------------------------------------------
-- ga_missing_declarations — found money (05 §5 panel 2): donors with eligible
-- gifts that only a declaration is missing, ranked by what a declaration would
-- recover. `recoverable_4y` is the slice HMRC will still accept (07 §10).
-- --------------------------------------------------------------------------

create or replace view public.ga_missing_declarations with (security_invoker = true) as
select
  d.contact_id,
  count(*)                                                          as gift_count,
  coalesce(sum(d.amount_gbp), 0)                                    as eligible_total,
  round(coalesce(sum(d.amount_gbp), 0) * 0.25, 2)                   as recoverable,
  coalesce(sum(d.amount_gbp) filter (
    where d.donated_on >= (current_date - interval '4 years')::date), 0) as eligible_total_4y,
  round(coalesce(sum(d.amount_gbp) filter (
    where d.donated_on >= (current_date - interval '4 years')::date), 0) * 0.25, 2) as recoverable_4y,
  min(d.donated_on)                                                 as first_gift_on,
  max(d.donated_on)                                                 as last_gift_on
from public.donations d
where d.gift_aid_status = 'pending_declaration'
  and d.status = 'received'
  and d.ga_excluded_at is null
  and upper(coalesce(d.currency, 'GBP')) = 'GBP'
group by d.contact_id;

comment on view public.ga_missing_declarations is
  'Donors with eligible-but-undeclared gifts and what a declaration would recover (05 §5, 07 §10).';

grant select on public.gift_aid_claim_totals, public.ga_missing_declarations
  to authenticated, service_role;
