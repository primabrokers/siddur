-- ============================================================================
-- 006_rfm — RFM personas in the nightly (02 §4.5) + the Reports aggregates
--           (06 §3) and the campaign page (05 §4).
-- ============================================================================
-- Two halves:
--
--   1. `run_rfm()` — recency/frequency/value quintiles over the donor base,
--      turned into the six persona tags in category `rfm_auto`. Taggings are
--      *replaced* on every recompute, so a donor holds exactly one persona and
--      running the function twice is a no-op. Previous counts are parked in
--      `automation_rules('rfm_state')` so the Reports tiles can show movement
--      since the last recompute. Scheduled at 05:30 UTC, half an hour after
--      `run_nightly()` (003c), because the personas read the same gift ledger
--      that run has just finished touching.
--
--   2. The report RPCs. Every number on /reports is a grouped aggregate the
--      database computes (I-8) — the client does presentation arithmetic only
--      (percentages of a returned pair, bar geometry, deltas). `report_overview`
--      is one round trip for the whole screen, `report_drill` is the "…and here
--      are the people" list behind every number (06 §3), and
--      `report_campaign_detail` is the per-campaign page (05 §4).
--
-- Amount redaction (11 §2, CLAUDE.md rule 7): the aggregates run as
-- `security definer` — a viewer without `can_see_amounts` must still get the
-- *counts* (donors retained, gifts recorded), which reading `donations`
-- through RLS would collapse to zero. So the entry points check
-- `crm_can_see_amounts()` themselves and null every money field on the way
-- out (`crm_scrub_money`), returning `amounts_hidden` so the UI can say so.
-- ============================================================================

-- --------------------------------------------------------------------------
-- Small shared helpers
-- --------------------------------------------------------------------------

/** The display name every report list shows: person name, else organisation. */
create or replace function public.crm_display_name(p_first text, p_last text, p_org text)
returns text language sql immutable set search_path = pg_catalog as $$
  select coalesce(
    nullif(trim(coalesce(p_first, '') || ' ' || coalesce(p_last, '')), ''),
    nullif(trim(coalesce(p_org, '')), ''),
    'Unnamed contact')
$$;

/**
 * Null out every money-carrying key, at any depth, of a report payload.
 * Recursive, so one call scrubs an entire `report_overview` blob; keys are
 * passed in rather than hard-coded so each entry point owns its own list.
 * plpgsql (not sql) because the body is self-referential.
 */
create or replace function public.crm_scrub_money(p_doc jsonb, p_keys text[])
returns jsonb
language plpgsql immutable set search_path = pg_catalog as $$
declare
  v_out jsonb;
begin
  if p_doc is null then return null; end if;

  if jsonb_typeof(p_doc) = 'object' then
    select coalesce(jsonb_object_agg(
             e.key,
             case when e.key = any(p_keys) and jsonb_typeof(e.value) in ('number', 'string')
                  then 'null'::jsonb
                  else public.crm_scrub_money(e.value, p_keys) end), '{}'::jsonb)
      into v_out
      from jsonb_each(p_doc) e;
    return v_out;
  elsif jsonb_typeof(p_doc) = 'array' then
    select coalesce(jsonb_agg(public.crm_scrub_money(a.value, p_keys)), '[]'::jsonb)
      into v_out
      from jsonb_array_elements(p_doc) a;
    return v_out;
  end if;

  return p_doc;
end $$;

-- Every key that carries money in a report payload. One list, so a new card
-- cannot accidentally leak an amount past a viewer's redaction.
create or replace function public.crm_money_keys()
returns text[] language sql immutable set search_path = pg_catalog as $$
  select array[
    'total','raised','goal','pledged_outstanding','gift_total','amount','lifetime',
    'claimed','recoverable','prior_total','largest','paid','outstanding','ytd',
    'peak_total','average','balance','ask_amount','total_amount']
$$;

-- ==========================================================================
-- 1. run_rfm() — 02 §4.5
-- ==========================================================================
-- Quintiles use `cume_dist()` rather than `ntile()` on purpose: donors that
-- tie (three donors who each gave once, on the same day) must land in the same
-- bucket, and `ntile` splits ties arbitrarily by row order. `ceil(cume_dist *
-- 5)` gives 1…5 with 5 = best (most recent / most frequent / highest value)
-- and equal inputs always the same score.
--
-- Personas, in precedence order (a donor gets exactly one):
--   Champions        R↑ F↑ M↑
--   Can't Lose Them  M↑ R↓      — the most valuable of the two alerts
--   At-Risk          F↑ R↓
--   New & Promising  first gift inside `new_months`, R↑
--   Loyal            F↑
--   Small & Steady   everyone else — the community base
-- --------------------------------------------------------------------------

create or replace function public.run_rfm(p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_p        jsonb := coalesce(public.crm_rule('rfm_recompute'), '{}'::jsonb);
  v_enabled  boolean := (select is_enabled from public.automation_rules where rule_key = 'rfm_recompute');
  v_lookback int     := coalesce((v_p->>'lookback_months')::int, 36);
  v_min      int     := coalesce((v_p->>'min_donors')::int, 5);
  v_top      int     := coalesce((v_p->>'top_score')::int, 4);
  v_low      int     := coalesce((v_p->>'low_recency')::int, 2);
  v_new      int     := coalesce((v_p->>'new_months')::int, 12);
  v_names    text[]  := array['Champions','Loyal','At-Risk','Can''t Lose Them','New & Promising','Small & Steady'];
  v_donors   int;
  v_counts   jsonb;
  v_prev     jsonb;
  v_prev_at  text;
  v_state    jsonb;
  v_removed  int;
  v_added    int;
begin
  -- The switch in Settings governs the scheduled run; a manual call can force
  -- it, so the function stays usable while the rule is off (08 §7).
  if not coalesce(v_enabled, false) and not p_force then
    return jsonb_build_object('skipped', 'rule_disabled');
  end if;

  drop table if exists _crm_rfm;
  create temp table _crm_rfm as
  with base as (
    select
      d.contact_id,
      max(d.donated_on)  as last_gift_on,
      min(d.donated_on)  as first_gift_on,
      count(*)::int      as gift_count,
      sum(d.amount_gbp)  as lifetime
    from public.donations d
    join public.contacts c on c.id = d.contact_id
    where d.status = 'received'
      and d.donated_on >= (current_date - make_interval(months => v_lookback))::date
      and c.merged_into_id is null
      and not c.is_archived
    group by d.contact_id
  ),
  scored as (
    select
      b.*,
      ceil(cume_dist() over (order by b.last_gift_on) * 5)::int as r_score,
      ceil(cume_dist() over (order by b.gift_count)   * 5)::int as f_score,
      ceil(cume_dist() over (order by b.lifetime)     * 5)::int as m_score
    from base b
  )
  select
    s.contact_id, s.last_gift_on, s.first_gift_on, s.gift_count, s.lifetime,
    s.r_score, s.f_score, s.m_score,
    case
      when s.r_score >= v_top and s.f_score >= v_top and s.m_score >= v_top then 'Champions'
      when s.m_score >= v_top and s.r_score <= v_low                        then 'Can''t Lose Them'
      when s.f_score >= v_top and s.r_score <= v_low                        then 'At-Risk'
      when s.first_gift_on >= (current_date - make_interval(months => v_new))::date
           and s.r_score >= v_top                                           then 'New & Promising'
      when s.f_score >= v_top                                               then 'Loyal'
      else 'Small & Steady'
    end as segment
  from scored s;

  select count(*) into v_donors from _crm_rfm;

  -- Quintiles over four donors are theatre, not analysis. Below the floor the
  -- existing taggings are left exactly as they are (02 §4.5 is a [P2] report,
  -- not a data-destroying job) and the report shows its empty state.
  if v_donors < v_min then
    return jsonb_build_object('skipped', 'not_enough_donors', 'donors', v_donors, 'min_donors', v_min);
  end if;

  -- The six persona tags. `is_auto` marks them as machine-maintained so the
  -- tag editor shows them read-only; colours match the Reports tiles.
  insert into public.tags (name, category, color, is_auto)
  select v.name, 'rfm_auto', v.color, true
  from (values
    ('Champions',       '#0E6E6B'),
    ('Loyal',           '#0E6E6B'),
    ('At-Risk',         '#D64545'),
    ('Can''t Lose Them','#D64545'),
    ('New & Promising', '#2E7D46'),
    ('Small & Steady',  '#6B7686')
  ) v(name, color)
  on conflict (category, name) do update set is_auto = true;

  -- Replace-on-recompute: drop the taggings that no longer hold, add the ones
  -- that now do. Only the six persona tags are touched — other `rfm_auto` tags
  -- (LYBUNT, seeded in 004) belong to the auto_tags rule, not to this one.
  delete from public.taggings t
  using public.tags g
  where t.tag_id = g.id
    and g.category = 'rfm_auto'
    and g.name = any(v_names)
    and not exists (
      select 1 from _crm_rfm s
      where s.contact_id = t.contact_id and s.segment = g.name);
  get diagnostics v_removed = row_count;

  insert into public.taggings (tag_id, contact_id, since)
  select g.id, s.contact_id, current_date
  from _crm_rfm s
  join public.tags g on g.category = 'rfm_auto' and g.name = s.segment
  on conflict (tag_id, contact_id) do nothing;
  get diagnostics v_added = row_count;

  select jsonb_object_agg(n.name, coalesce(c.n, 0))
    into v_counts
  from unnest(v_names) n(name)
  left join (select segment, count(*)::int as n from _crm_rfm group by 1) c on c.segment = n.name;

  -- Movement since the last recompute: this run's counts become `counts`, the
  -- run before it slides into `previous` (06 §3's "▲ 2 this quarter").
  select params->'counts', params->>'computed_at'
    into v_prev, v_prev_at
  from public.automation_rules where rule_key = 'rfm_state';

  v_state := jsonb_build_object(
    'counts',               v_counts,
    'previous',             coalesce(v_prev, '{}'::jsonb),
    'computed_at',          to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SSZ'),
    'previous_computed_at', v_prev_at,
    'donors',               v_donors);

  insert into public.automation_rules (rule_key, is_enabled, params)
  values ('rfm_state', true, v_state)
  on conflict (rule_key) do update set params = excluded.params;

  drop table if exists _crm_rfm;

  return jsonb_build_object(
    'donors', v_donors, 'counts', v_counts,
    'taggings_added', v_added, 'taggings_removed', v_removed);
end;
$fn$;

comment on function public.run_rfm(boolean) is
  'RFM quintiles -> the six persona tags in category rfm_auto (02 §4.5). Replace-on-recompute, idempotent; previous counts parked in automation_rules(rfm_state).';

-- Hardened exactly like `run_nightly()` (005_function_hardening): a signed-in
-- user must not be able to fire a job that rewrites the tag graph. pg_cron runs
-- it as `postgres`; a human runs it with the service role.
revoke all on function public.run_rfm(boolean) from public, anon, authenticated;
grant execute on function public.run_rfm(boolean) to service_role;

-- The rule row the function reads, and the benchmark figures the retention
-- card shows beside its own number (06 §3 — "labelled with source + year and
-- editable in settings, because they age").
update public.automation_rules
   set is_enabled = true,
       params = params || jsonb_build_object(
         'lookback_months', 36, 'min_donors', 5,
         'top_score', 4, 'low_recency', 2, 'new_months', 12)
 where rule_key = 'rfm_recompute';

insert into public.automation_rules (rule_key, is_enabled, params)
values ('benchmarks', true,
        '{"retention_overall": 43, "retention_7plus": 87, "source": "FEP", "year": 2026}'::jsonb)
on conflict (rule_key) do nothing;

-- --------------------------------------------------------------------------
-- Schedule: 05:30 UTC, after run_nightly() at 05:00 (08 §1). Wrapped so a
-- project without pg_cron still gets the function.
-- --------------------------------------------------------------------------

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'crm-rfm') then
      perform cron.unschedule('crm-rfm');
    end if;
    perform cron.schedule('crm-rfm', '30 5 * * *', $$select public.run_rfm()$$);
  else
    raise notice 'pg_cron not installed — run_rfm() exists but is not scheduled.';
  end if;
exception when others then
  raise notice 'Could not schedule crm-rfm (%). run_rfm() still exists.', sqlerrm;
end
$do$;

-- ==========================================================================
-- 2. Report aggregates (06 §3)
-- ==========================================================================
-- The pieces are separate functions so each one is readable and testable on
-- its own; only the three entry points at the bottom are granted to
-- `authenticated`, so the pieces cannot be called around the guards.
-- --------------------------------------------------------------------------

/** Donor retention for one year, with the prior year's rate for the delta. */
create or replace function public.report_retention(p_year int default null)
returns table (
  year int, gave_prior int, retained int, new_donors int, repeat_donors int,
  reactivated int, lapsed int, current_donors int,
  rate numeric, prior_rate numeric, delta_pts numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with y as (select coalesce(p_year, extract(year from current_date)::int) as yr),
  dy as (
    select d.contact_id, extract(year from d.donated_on)::int as yr
    from public.donations d
    join public.contacts c on c.id = d.contact_id
    where d.status = 'received' and c.merged_into_id is null
    group by 1, 2
  ),
  firsts as (select contact_id, min(yr) as first_yr from dy group by 1),
  cur    as (select dy.contact_id from dy, y where dy.yr = y.yr),
  prior  as (select dy.contact_id from dy, y where dy.yr = y.yr - 1),
  prior2 as (select dy.contact_id from dy, y where dy.yr = y.yr - 2),
  n as (
    select
      (select count(*) from prior)::int as gave_prior,
      (select count(*) from cur c where exists (select 1 from prior p where p.contact_id = c.contact_id))::int as retained,
      (select count(*) from cur c join firsts f on f.contact_id = c.contact_id, y where f.first_yr = y.yr)::int as new_donors,
      (select count(*) from cur c join firsts f on f.contact_id = c.contact_id, y
        where f.first_yr < y.yr
          and not exists (select 1 from prior p where p.contact_id = c.contact_id))::int as reactivated,
      (select count(*) from prior p where not exists (select 1 from cur c where c.contact_id = p.contact_id))::int as lapsed,
      (select count(*) from cur)::int as current_donors,
      (select count(*) from prior2)::int as gave_prior2,
      (select count(*) from prior p where exists (select 1 from prior2 q where q.contact_id = p.contact_id))::int as retained_prior
    from y
  )
  select
    y.yr, n.gave_prior, n.retained, n.new_donors, n.retained, n.reactivated,
    n.lapsed, n.current_donors,
    case when n.gave_prior  > 0 then round(n.retained::numeric       * 100 / n.gave_prior,  1) end,
    case when n.gave_prior2 > 0 then round(n.retained_prior::numeric * 100 / n.gave_prior2, 1) end,
    case when n.gave_prior > 0 and n.gave_prior2 > 0
         then round(n.retained::numeric * 100 / n.gave_prior
                  - n.retained_prior::numeric * 100 / n.gave_prior2, 1) end
  from n, y;
$$;

/**
 * Giving buckets — months of one year, or one bar per year for all time.
 * The current year stops at the current month rather than drawing eight empty
 * bars for a future no one has given in yet (the chart's "no fake zeros" rule).
 */
create or replace function public.report_giving_buckets(p_year int default null)
returns table (
  bucket_key text, label text, total numeric, gift_count int, donor_count int, is_current boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  with g as (
    select d.id, d.donated_on, d.amount_gbp, d.contact_id
    from public.donations d
    where d.status = 'received'
      and (p_year is null or extract(year from d.donated_on)::int = p_year)
  ),
  months as (
    select
      to_char(make_date(p_year, m, 1), 'YYYY-MM')                       as bucket_key,
      to_char(make_date(p_year, m, 1), 'Mon')                           as label,
      m                                                                  as ord,
      (p_year = extract(year from current_date)::int
        and m = extract(month from current_date)::int)                   as is_current
    from generate_series(1, 12) m
    where p_year is not null
      and (p_year <> extract(year from current_date)::int
           or m <= extract(month from current_date)::int)
  ),
  years as (
    select
      y::text as bucket_key, y::text as label, y as ord,
      (y = extract(year from current_date)::int) as is_current
    from generate_series(
      coalesce((select min(extract(year from donated_on))::int from g), extract(year from current_date)::int),
      coalesce((select max(extract(year from donated_on))::int from g), extract(year from current_date)::int)) y
    where p_year is null
  ),
  buckets as (select * from months union all select * from years)
  select
    b.bucket_key, b.label,
    coalesce(sum(g.amount_gbp), 0)::numeric(14,2),
    count(g.id)::int,
    count(distinct g.contact_id)::int,
    b.is_current
  from buckets b
  left join g on to_char(g.donated_on, case when p_year is null then 'YYYY' else 'YYYY-MM' end) = b.bucket_key
  group by b.bucket_key, b.label, b.ord, b.is_current
  order by b.ord;
$$;

/** The six persona tiles: live counts + the counts at the previous recompute. */
create or replace function public.report_rfm_segments()
returns table (segment text, tag_id uuid, headcount int, previous int, is_alert boolean, sort_order int)
language sql stable security definer set search_path = public, pg_temp as $$
  with names as (
    select * from (values
      ('Champions', false, 1), ('Loyal', false, 2), ('New & Promising', false, 3),
      ('At-Risk', true, 4), ('Can''t Lose Them', true, 5), ('Small & Steady', false, 6)
    ) v(name, is_alert, sort_order)
  ),
  state as (select params from public.automation_rules where rule_key = 'rfm_state')
  select
    n.name,
    g.id,
    coalesce((select count(*) from public.taggings t
              join public.contacts c on c.id = t.contact_id
              where t.tag_id = g.id and not t.is_excluded and not c.is_archived), 0)::int,
    nullif((select params->'previous'->>n.name from state), '')::int,
    n.is_alert,
    n.sort_order
  from names n
  left join public.tags g on g.category = 'rfm_auto' and g.name = n.name
  order by n.sort_order;
$$;

/** Campaign progress against goal, with pledges promised but not yet paid. */
create or replace function public.report_campaigns()
returns table (
  id uuid, name text, goal numeric, raised numeric, pledged_outstanding numeric,
  gift_count int, donor_count int, pct numeric, starts_on date, ends_on date)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    c.id, c.name, c.goal_amount::numeric(14,2),
    coalesce(g.raised, 0)::numeric(14,2),
    coalesce(p.outstanding, 0)::numeric(14,2),
    coalesce(g.gift_count, 0)::int,
    coalesce(g.donor_count, 0)::int,
    case when c.goal_amount > 0
         then round(coalesce(g.raised, 0) * 100 / c.goal_amount, 1) end,
    c.starts_on, c.ends_on
  from public.campaigns c
  left join (
    select d.campaign_id, sum(d.amount_gbp) as raised, count(*)::int as gift_count,
           count(distinct d.contact_id)::int as donor_count
    from public.donations d where d.status = 'received' group by 1
  ) g on g.campaign_id = c.id
  left join (
    select b.campaign_id, sum(b.balance) as outstanding
    from public.pledge_balances b where b.status = 'open' group by 1
  ) p on p.campaign_id = c.id
  where c.is_active
  order by coalesce(g.raised, 0) desc, c.name;
$$;

/**
 * Appeal performance with its year-on-year twin. The twin is the appeal whose
 * name has the same stem ("Dinner 2026" -> "Dinner") and whose year is one
 * lower — which is exactly what 05 §4 promises the year+channel columns buy.
 */
create or replace function public.report_appeals(p_year int default null)
returns table (
  id uuid, name text, year int, channel text, total numeric, gift_count int,
  prior_id uuid, prior_name text, prior_year int, prior_total numeric, delta_pct numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with totals as (
    select
      a.id, a.name, a.year, a.channel,
      regexp_replace(a.name, '\s*\d{4}\s*$', '') as stem,
      coalesce(sum(d.amount_gbp) filter (where d.status = 'received'), 0)::numeric(14,2) as total,
      (count(d.id) filter (where d.status = 'received'))::int as gift_count
    from public.appeals a
    left join public.donations d on d.appeal_id = a.id
    group by a.id, a.name, a.year, a.channel
  )
  select
    t.id, t.name, t.year, t.channel, t.total, t.gift_count,
    p.id, p.name, p.year, p.total,
    case when p.total > 0 then round((t.total - p.total) * 100 / p.total, 1) end
  from totals t
  left join totals p on p.stem = t.stem and p.year = t.year - 1
  where p_year is null or t.year = p_year or t.year is null
  order by t.year desc nulls last, t.total desc;
$$;

/** Fundraiser activity over a window — interactions, tasks closed, gifts taken. */
create or replace function public.report_activity(p_from date, p_to date)
returns table (
  member_id uuid, member_name text, interactions int, tasks_completed int,
  gifts int, gift_total numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    m.id,
    coalesce(nullif(trim(m.full_name), ''), m.email),
    coalesce(i.n, 0)::int, coalesce(t.n, 0)::int, coalesce(d.n, 0)::int,
    coalesce(d.total, 0)::numeric(14,2)
  from public.team_members m
  left join (
    select coalesce(team_member_id, created_by) as mid, count(*) as n
    from public.interactions
    where status = 'logged'
      and (p_from is null or occurred_at >= p_from::timestamptz)
      and (p_to   is null or occurred_at <  (p_to + 1)::timestamptz)
    group by 1
  ) i on i.mid = m.id
  left join (
    select coalesce(assigned_to, created_by) as mid, count(*) as n
    from public.tasks
    where status = 'done'
      and (p_from is null or completed_at >= p_from::timestamptz)
      and (p_to   is null or completed_at <  (p_to + 1)::timestamptz)
    group by 1
  ) t on t.mid = m.id
  left join (
    select created_by as mid, count(*) as n, sum(amount_gbp) as total
    from public.donations
    where status = 'received'
      and (p_from is null or donated_on >= p_from)
      and (p_to   is null or donated_on <= p_to)
    group by 1
  ) d on d.mid = m.id
  where m.is_active
  order by (coalesce(i.n, 0) + coalesce(t.n, 0) + coalesce(d.n, 0)) desc, 2;
$$;

/** Gift Aid: claimed in the period, recoverable outstanding, coverage (05 §5). */
create or replace function public.report_gift_aid(p_year int default null)
returns table (
  claimed numeric, recoverable numeric, coverage_pct numeric,
  donors_with_declaration int, donor_count int,
  eligible_gift_count int, pending_gift_count int)
language sql stable security definer set search_path = public, pg_temp as $$
  -- CTE names deliberately differ from the OUT parameter names (`claimed`,
  -- `recoverable`): a SQL function body can reference either, and a collision
  -- resolves to whichever Postgres finds first.
  with ga_claimed as (
    select coalesce(sum(c.total_claimed), 0)::numeric(14,2) as amount
    from public.gift_aid_claims c
    where c.status in ('submitted', 'paid')
      and (p_year is null or extract(year from coalesce(c.submitted_on, c.created_at::date))::int = p_year)
  ),
  outstanding as (
    select
      coalesce(sum(d.amount_gbp) filter (where d.gift_aid_status = 'eligible'), 0)::numeric(14,2) as eligible_amount,
      (count(*) filter (where d.gift_aid_status = 'eligible'))::int  as eligible_gifts,
      (count(*) filter (where d.gift_aid_status = 'pending_declaration'))::int as pending_gifts,
      coalesce(sum(d.amount_gbp) filter (where d.gift_aid_status = 'pending_declaration'), 0)::numeric(14,2) as pending_amount
    from public.donations d
    where d.status = 'received' and d.gift_aid_claim_id is null
  ),
  cover as (
    select
      count(distinct d.contact_id)::int as donors,
      (count(distinct d.contact_id) filter (where exists (
        select 1 from public.gift_aid_declarations g
        where g.contact_id = d.contact_id and g.cancelled_on is null)))::int as declared
    from public.donations d
    join public.contacts c on c.id = d.contact_id
    where d.status = 'received' and d.currency = 'GBP' and c.contact_kind = 'individual'
  )
  select
    ga_claimed.amount,
    round(outstanding.eligible_amount * 0.25, 2),
    case when cover.donors > 0 then round(cover.declared::numeric * 100 / cover.donors, 1) end,
    cover.declared, cover.donors,
    outstanding.eligible_gifts, outstanding.pending_gifts
  from ga_claimed, outstanding, cover;
$$;

-- --------------------------------------------------------------------------
-- Entry point 1: the whole Reports screen in one round trip
-- --------------------------------------------------------------------------

create or replace function public.report_overview(p_year int default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_money  boolean := public.crm_can_see_amounts();
  v_year   int     := coalesce(p_year, extract(year from current_date)::int);
  v_bench  jsonb   := coalesce((select params from public.automation_rules where rule_key = 'benchmarks'), '{}'::jsonb);
  v_state  jsonb   := coalesce((select params from public.automation_rules where rule_key = 'rfm_state'), '{}'::jsonb);
  v_from   date;
  v_to     date;
  v_label  text;
  v_out    jsonb;
begin
  if not public.crm_is_member() then
    raise exception 'not a team member' using errcode = '42501';
  end if;

  -- The activity window is the tail of the selected period: this month when
  -- looking at this year (04/06's "what has the team done lately"), the whole
  -- of a past year, everything for all time.
  if p_year is null then
    v_from := null; v_to := null; v_label := 'All time';
  elsif p_year = extract(year from current_date)::int then
    v_from := date_trunc('month', current_date)::date;
    v_to   := current_date;
    v_label := 'This month';
  else
    v_from := make_date(p_year, 1, 1); v_to := make_date(p_year, 12, 31);
    v_label := p_year::text;
  end if;

  select jsonb_build_object(
    'year', v_year,
    'scope', case when p_year is null then 'all_time' else v_year::text end,
    'granularity', case when p_year is null then 'year' else 'month' end,
    'amounts_hidden', not v_money,
    'generated_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SSZ'),

    'retention', (
      select to_jsonb(r) || jsonb_build_object(
        'benchmark_overall', (v_bench->>'retention_overall')::numeric,
        'benchmark_7plus',   (v_bench->>'retention_7plus')::numeric,
        'benchmark_source',  v_bench->>'source',
        'benchmark_year',    (v_bench->>'year')::int)
      from public.report_retention(v_year) r),

    'giving', (
      select jsonb_build_object(
        'buckets', coalesce(jsonb_agg(to_jsonb(b) order by b.bucket_key), '[]'::jsonb),
        'total',   coalesce(sum(b.total), 0),
        'gift_count', coalesce(sum(b.gift_count), 0),
        'peak_key', (select b2.bucket_key from public.report_giving_buckets(p_year) b2
                      where b2.total > 0 order by b2.total desc, b2.bucket_key limit 1))
      from public.report_giving_buckets(p_year) b),

    'rfm', (
      select jsonb_build_object(
        'segments', coalesce(jsonb_agg(to_jsonb(s) order by s.sort_order), '[]'::jsonb),
        'computed_at', v_state->>'computed_at',
        'previous_computed_at', v_state->>'previous_computed_at',
        'donors', (v_state->>'donors')::int)
      from public.report_rfm_segments() s),

    'campaigns', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.report_campaigns() c),

    'appeals', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.report_appeals(p_year) a),

    'activity', jsonb_build_object(
      'label', v_label, 'from', v_from, 'to', v_to,
      'members', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from public.report_activity(v_from, v_to) m)),

    'gift_aid', (select to_jsonb(ga) from public.report_gift_aid(p_year) ga)
  ) into v_out;

  if not v_money then
    v_out := public.crm_scrub_money(v_out, public.crm_money_keys());
  end if;
  return v_out;
end;
$fn$;

comment on function public.report_overview(int) is
  'Every number on /reports in one round trip (06 §3). Money nulled and amounts_hidden set for members without can_see_amounts (11 §2).';

-- --------------------------------------------------------------------------
-- Entry point 2: "…and here are the people" behind any number (06 §3)
-- --------------------------------------------------------------------------

create or replace function public.report_drill(
  p_key text, p_year int default null, p_arg text default null)
returns table (
  contact_id uuid, contact_name text, secondary text, amount numeric,
  gift_count int, last_gift_on date)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
-- Every column reference below is qualified: `contact_id`, `gift_count` and
-- `amount` are OUT parameters of the RETURNS TABLE, and plpgsql resolves a bare
-- name to the variable, not the column ("column reference is ambiguous"). The
-- `dy` CTE renames its key to `cid` for the same reason.
declare
  v_money boolean := public.crm_can_see_amounts();
  v_year  int     := coalesce(p_year, extract(year from current_date)::int);
begin
  if not public.crm_is_member() then
    raise exception 'not a team member' using errcode = '42501';
  end if;

  return query
  with dy as (
    select d.contact_id as cid, extract(year from d.donated_on)::int as yr
    from public.donations d where d.status = 'received' group by 1, 2
  ),
  firsts as (select dy.cid, min(dy.yr) as first_yr from dy group by 1),
  picked as (
    select c.id
    from public.contacts c
    where c.merged_into_id is null and
      case p_key
        when 'retention_new' then
          exists (select 1 from dy where dy.cid = c.id and dy.yr = v_year)
          and (select f.first_yr from firsts f where f.cid = c.id) = v_year
        when 'retention_repeat' then
          exists (select 1 from dy where dy.cid = c.id and dy.yr = v_year)
          and exists (select 1 from dy where dy.cid = c.id and dy.yr = v_year - 1)
        when 'retention_reactivated' then
          exists (select 1 from dy where dy.cid = c.id and dy.yr = v_year)
          and not exists (select 1 from dy where dy.cid = c.id and dy.yr = v_year - 1)
          and (select f.first_yr from firsts f where f.cid = c.id) < v_year
        when 'retention_lapsed' then
          exists (select 1 from dy where dy.cid = c.id and dy.yr = v_year - 1)
          and not exists (select 1 from dy where dy.cid = c.id and dy.yr = v_year)
        when 'retention_prior' then
          exists (select 1 from dy where dy.cid = c.id and dy.yr = v_year - 1)
        when 'donors' then
          exists (select 1 from dy where dy.cid = c.id and dy.yr = v_year)
        when 'rfm' then
          exists (select 1 from public.taggings t join public.tags g on g.id = t.tag_id
                  where t.contact_id = c.id and g.category = 'rfm_auto' and g.name = p_arg
                    and not t.is_excluded)
        when 'bucket' then
          exists (select 1 from public.donations d where d.contact_id = c.id and d.status = 'received'
                    and to_char(d.donated_on, case when length(coalesce(p_arg, '')) = 4 then 'YYYY' else 'YYYY-MM' end) = p_arg)
        when 'campaign' then
          exists (select 1 from public.donations d where d.contact_id = c.id and d.status = 'received'
                    and d.campaign_id = nullif(p_arg, '')::uuid)
        when 'appeal' then
          exists (select 1 from public.donations d where d.contact_id = c.id and d.status = 'received'
                    and d.appeal_id = nullif(p_arg, '')::uuid)
        when 'activity' then
          exists (select 1 from public.interactions i where i.contact_id = c.id and i.status = 'logged'
                    and coalesce(i.team_member_id, i.created_by) = nullif(p_arg, '')::uuid
                    and (p_year is null or extract(year from i.occurred_at)::int = v_year))
        when 'gift_aid_pending' then
          exists (select 1 from public.donations d where d.contact_id = c.id and d.status = 'received'
                    and d.gift_aid_status = 'pending_declaration' and d.gift_aid_claim_id is null)
        when 'gift_aid_eligible' then
          exists (select 1 from public.donations d where d.contact_id = c.id and d.status = 'received'
                    and d.gift_aid_status = 'eligible' and d.gift_aid_claim_id is null)
        else false
      end
  )
  select
    c.id,
    public.crm_display_name(c.first_name, c.last_name, c.organization),
    nullif(concat_ws(' · ', nullif(c.city, ''), nullif(c.stage, '')), ''),
    case when v_money then coalesce(sum(d.amount_gbp) filter (
      where d.status = 'received'
        and (p_key not in ('retention_new','retention_repeat','retention_reactivated','donors','bucket')
             or extract(year from d.donated_on)::int = v_year)), 0)::numeric(14,2) end,
    (count(d.id) filter (where d.status = 'received'))::int,
    max(d.donated_on) filter (where d.status = 'received')
  from picked
  join public.contacts c on c.id = picked.id
  left join public.donations d on d.contact_id = c.id
  group by c.id, c.first_name, c.last_name, c.organization, c.city, c.stage
  order by 4 desc nulls last, 2
  limit 500;
end;
$fn$;

comment on function public.report_drill(text, int, text) is
  'The contact list behind any report number (06 §3: every report ends in an actionable list).';

-- --------------------------------------------------------------------------
-- Entry point 3: the per-campaign page (05 §4)
-- --------------------------------------------------------------------------

create or replace function public.report_campaign_detail(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_money boolean := public.crm_can_see_amounts();
  v_out   jsonb;
begin
  if not public.crm_is_member() then
    raise exception 'not a team member' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'campaign', (
      select jsonb_build_object(
        'id', c.id, 'name', c.name, 'description', c.description,
        'goal', c.goal_amount, 'starts_on', c.starts_on, 'ends_on', c.ends_on,
        'is_active', c.is_active)
      from public.campaigns c where c.id = p_campaign_id),
    'amounts_hidden', not v_money,
    'progress', (
      select to_jsonb(r) from public.report_campaigns() r where r.id = p_campaign_id),
    'appeals', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', a.id, 'name', a.name, 'channel', a.channel, 'year', a.year,
               'total', coalesce(t.total, 0), 'gift_count', coalesce(t.n, 0),
               'donor_count', coalesce(t.donors, 0))
             order by coalesce(t.total, 0) desc), '[]'::jsonb)
      from public.appeals a
      left join (
        select d.appeal_id, sum(d.amount_gbp) as total, count(*)::int as n,
               count(distinct d.contact_id)::int as donors
        from public.donations d
        where d.status = 'received' and d.campaign_id = p_campaign_id
        group by 1
      ) t on t.appeal_id = a.id
      where a.campaign_id = p_campaign_id),
    'top_gifts', (
      select coalesce(jsonb_agg(g), '[]'::jsonb) from (
        select jsonb_build_object(
                 'id', d.id, 'contact_id', d.contact_id,
                 'contact_name', public.crm_display_name(c.first_name, c.last_name, c.organization),
                 'donated_on', d.donated_on, 'amount', d.amount_gbp,
                 'appeal_name', a.name) as g
        from public.donations d
        join public.contacts c on c.id = d.contact_id
        left join public.appeals a on a.id = d.appeal_id
        where d.campaign_id = p_campaign_id and d.status = 'received'
        order by d.amount_gbp desc, d.donated_on desc
        limit 10) top),
    'gifts', (
      select coalesce(jsonb_agg(g), '[]'::jsonb) from (
        select jsonb_build_object(
                 'id', d.id, 'contact_id', d.contact_id,
                 'contact_name', public.crm_display_name(c.first_name, c.last_name, c.organization),
                 'donated_on', d.donated_on, 'amount', d.amount_gbp,
                 'appeal_name', a.name, 'fund_name', f.name,
                 'thank_you_status', d.thank_you_status) as g
        from public.donations d
        join public.contacts c on c.id = d.contact_id
        left join public.appeals a on a.id = d.appeal_id
        left join public.funds f on f.id = d.fund_id
        where d.campaign_id = p_campaign_id and d.status = 'received'
        order by d.donated_on desc, d.amount_gbp desc
        limit 100) recent),
    'pledges', (
      select coalesce(jsonb_agg(p), '[]'::jsonb) from (
        select jsonb_build_object(
                 'id', b.pledge_id, 'contact_id', b.contact_id,
                 'contact_name', public.crm_display_name(c.first_name, c.last_name, c.organization),
                 'total_amount', b.amount_gbp, 'paid', b.paid_amount,
                 'outstanding', b.balance, 'status', b.status,
                 'next_due_on', b.next_installment_due_on,
                 'overdue_count', b.overdue_installment_count) as p
        from public.pledge_balances b
        join public.contacts c on c.id = b.contact_id
        where b.campaign_id = p_campaign_id and b.status = 'open' and b.balance > 0
        order by b.balance desc
        limit 50) open_pledges)
  ) into v_out;

  if not v_money then
    v_out := public.crm_scrub_money(v_out, public.crm_money_keys());
  end if;
  return v_out;
end;
$fn$;

comment on function public.report_campaign_detail(uuid) is
  'One campaign page (05 §4): progress vs goal, gifts, outstanding pledges, top gifts, per-appeal breakdown.';

-- --------------------------------------------------------------------------
-- Grants: only the three entry points are reachable from the client; the
-- pieces they compose stay internal so nothing can be called around the
-- membership guard or the redaction pass.
-- --------------------------------------------------------------------------

do $do$
declare f text;
begin
  foreach f in array array[
    'public.report_retention(int)', 'public.report_giving_buckets(int)',
    'public.report_rfm_segments()', 'public.report_campaigns()',
    'public.report_appeals(int)', 'public.report_activity(date, date)',
    'public.report_gift_aid(int)', 'public.crm_scrub_money(jsonb, text[])',
    'public.crm_money_keys()', 'public.crm_display_name(text, text, text)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end
$do$;

revoke all on function public.report_overview(int) from public, anon;
revoke all on function public.report_drill(text, int, text) from public, anon;
revoke all on function public.report_campaign_detail(uuid) from public, anon;

grant execute on function public.report_overview(int) to authenticated, service_role;
grant execute on function public.report_drill(text, int, text) to authenticated, service_role;
grant execute on function public.report_campaign_detail(uuid) to authenticated, service_role;
