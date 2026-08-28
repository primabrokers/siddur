-- ============================================================================
-- 003a_views — the derived layer (spec 02 §4, computed never stored, I-9)
-- ============================================================================
-- contact_stats carries EXACTLY the field list of 02 §4.1, plus the two
-- household rollup columns that section calls for ("and rolled up per
-- household"). Both views are security_invoker = true, so a restricted
-- viewer's donations RLS applies here too: their giving columns come back as
-- zero rather than leaking amounts through the derived layer (11 §2).
--
-- Conventions:
--   * "this year" / "last year" are calendar years (the spec names no fiscal
--     year; the dinner cycle is calendar-anchored).
--   * only status='received' gifts count towards money; refunds/cancellations
--     are excluded from every rollup.
--   * flag precedence (03 §2): overdue > today > waiting > none > queued >
--     future, with 'future' as the neutral fallback for contacts that have no
--     open work but are not entitled to the yellow "no next action" flag.
-- ============================================================================

create or replace view public.contact_stats with (security_invoker = true) as
with p as (   -- donor-status thresholds are configuration, not code (02 §4.4)
  select
    coalesce((select (params->>'new_months')::int
              from public.automation_rules where rule_key = 'donor_status'), 6)         as new_months,
    coalesce((select (params->>'active_months')::int
              from public.automation_rules where rule_key = 'donor_status'), 12)        as active_months,
    coalesce((select (params->>'pre_lapsed_months')::int
              from public.automation_rules where rule_key = 'donor_status'), 18)        as pre_lapsed_months
),
hard as (     -- hard credit: exactly one legal donor per gift (D2)
  select
    d.contact_id,
    sum(d.amount_gbp)                                          as lifetime_giving,
    sum(d.amount_gbp) filter (
      where extract(year from d.donated_on) = extract(year from current_date))     as giving_this_year,
    sum(d.amount_gbp) filter (
      where extract(year from d.donated_on) = extract(year from current_date) - 1) as giving_last_year,
    count(*)                                                   as gift_count,
    max(d.amount_gbp)                                          as largest_gift,
    round(avg(d.amount_gbp), 2)                                as average_gift
  from public.donations d
  where d.status = 'received'
  group by d.contact_id
),
soft as (     -- parallel soft-credit columns; never added to financial totals
  select
    sc.contact_id,
    sum(coalesce(sc.amount, d.amount_gbp))                     as soft_lifetime_giving,
    sum(coalesce(sc.amount, d.amount_gbp)) filter (
      where extract(year from d.donated_on) = extract(year from current_date))     as soft_giving_this_year,
    sum(coalesce(sc.amount, d.amount_gbp)) filter (
      where extract(year from d.donated_on) = extract(year from current_date) - 1) as soft_giving_last_year
  from public.soft_credits sc
  join public.donations d on d.id = sc.donation_id
  where d.status = 'received'
  group by sc.contact_id
),
first_gift as (
  select distinct on (d.contact_id) d.contact_id, d.donated_on, d.amount_gbp
  from public.donations d
  where d.status = 'received'
  order by d.contact_id, d.donated_on asc, d.amount_gbp desc
),
last_gift as (
  select distinct on (d.contact_id) d.contact_id, d.donated_on, d.amount_gbp
  from public.donations d
  where d.status = 'received'
  order by d.contact_id, d.donated_on desc, d.amount_gbp desc
),
pledge_pay as (
  select d.pledge_id, sum(d.amount_gbp) as paid_amount
  from public.donations d
  where d.status = 'received' and d.pledge_id is not null
  group by d.pledge_id
),
pledge_bal as (
  select
    pl.contact_id,
    sum(greatest(pl.amount_gbp - coalesce(pp.paid_amount, 0)
                               - coalesce(pl.write_off_amount, 0), 0)) as pledge_balance
  from public.pledges pl
  left join pledge_pay pp on pp.pledge_id = pl.id
  where pl.status = 'open'
  group by pl.contact_id
),
last_meaningful as (
  select distinct on (i.contact_id) i.contact_id, i.occurred_at, i.kind
  from public.interactions i
  where i.is_meaningful
    and i.status = 'logged'
    and i.occurred_at <= now()
  order by i.contact_id, i.occurred_at desc
),
task_agg as (
  select
    t.contact_id,
    count(*) filter (where t.status in ('todo','in_progress','waiting','queued'))      as open_task_count,
    count(*) filter (where t.status in ('todo','in_progress','waiting'))               as dated_open_count,
    count(*) filter (where t.status in ('todo','in_progress','waiting')
                       and t.due_on < current_date)                                    as overdue_count,
    count(*) filter (where t.status in ('todo','in_progress','waiting')
                       and t.due_on = current_date)                                    as today_count,
    count(*) filter (where t.status = 'waiting')                                       as waiting_count,
    count(*) filter (where t.status in ('todo','in_progress','waiting')
                       and t.due_on > current_date)                                    as future_count,
    count(*) filter (where t.status = 'queued')                                        as queued_count
  from public.tasks t
  group by t.contact_id
),
next_action as (   -- earliest open dated task (02 §4.1)
  select distinct on (t.contact_id)
    t.contact_id, t.id, t.title, t.due_on, t.action_type
  from public.tasks t
  where t.status in ('todo','in_progress','waiting')
    and t.due_on is not null
  order by t.contact_id, t.due_on asc, t.created_at asc
),
failing as (       -- a failing standing order forces 'lapsed' (02 §4.4)
  select distinct ra.contact_id
  from public.recurring_agreements ra
  where ra.status = 'failing'
),
household_roll as (
  select
    c.household_id,
    sum(coalesce(h.lifetime_giving, 0)) as household_lifetime_giving,
    sum(coalesce(h.gift_count, 0))      as household_gift_count
  from public.contacts c
  left join hard h on h.contact_id = c.id
  where c.household_id is not null
  group by c.household_id
)
select
  c.id                                             as contact_id,
  c.household_id,

  -- giving: hard credit
  coalesce(h.lifetime_giving, 0)::numeric(14,2)     as lifetime_giving,
  coalesce(h.giving_this_year, 0)::numeric(14,2)    as giving_this_year,
  coalesce(h.giving_last_year, 0)::numeric(14,2)    as giving_last_year,

  -- giving: soft credit, in parallel columns (D2)
  coalesce(s.soft_lifetime_giving, 0)::numeric(14,2)  as soft_lifetime_giving,
  coalesce(s.soft_giving_this_year, 0)::numeric(14,2) as soft_giving_this_year,
  coalesce(s.soft_giving_last_year, 0)::numeric(14,2) as soft_giving_last_year,

  coalesce(h.gift_count, 0)::int                    as gift_count,
  h.largest_gift::numeric(14,2)                     as largest_gift,
  h.average_gift::numeric(14,2)                     as average_gift,
  fg.donated_on                                     as first_gift_date,
  fg.amount_gbp::numeric(14,2)                      as first_gift_amount,
  lg.donated_on                                     as last_gift_date,
  lg.amount_gbp::numeric(14,2)                      as last_gift_amount,

  -- LYBUNT: gave last year, nothing this year. SYBUNT: gave once, neither year.
  (coalesce(h.giving_last_year, 0) > 0
     and coalesce(h.giving_this_year, 0) = 0)                       as is_lybunt,
  (coalesce(h.lifetime_giving, 0) > 0
     and coalesce(h.giving_this_year, 0) = 0
     and coalesce(h.giving_last_year, 0) = 0)                       as is_sybunt,

  coalesce(pb.pledge_balance, 0)::numeric(14,2)     as pledge_balance,

  lm.occurred_at                                    as last_meaningful_contact_at,
  lm.kind                                           as last_meaningful_contact_kind,
  case when lm.occurred_at is null then null
       else (current_date - lm.occurred_at::date) end                as days_since_contact,

  -- KIT cadence: last meaningful contact + frequency, never earlier than the
  -- end of an explicit pause (kit_paused_until); GREATEST ignores nulls.
  case when c.contact_frequency_days is null then null
       else greatest(
              (coalesce(lm.occurred_at, c.created_at))::date + c.contact_frequency_days,
              c.kit_paused_until)
  end                                                               as kit_due_on,

  coalesce(ta.open_task_count, 0)::int              as open_task_count,

  na.id                                             as next_action_id,
  na.title                                          as next_action_title,
  na.due_on                                         as next_action_due_on,
  na.action_type                                    as next_action_type,

  -- flag (03 §2). Yellow 'none' is withheld from contacts whose stage says
  -- the relationship is closed, and from anyone with a KIT cadence.
  case
    when coalesce(ta.overdue_count, 0) > 0 then 'overdue'
    when coalesce(ta.today_count, 0)   > 0 then 'today'
    when coalesce(ta.waiting_count, 0) > 0 then 'waiting'
    when coalesce(ta.dated_open_count, 0) = 0
         and c.contact_frequency_days is null
         and not c.is_archived
         and c.stage not in ('archived','inactive','not_interested') then 'none'
    when coalesce(ta.queued_count, 0) > 0 then 'queued'
    else 'future'
  end                                                               as flag,

  -- donor_status (02 §4.4), thresholds from automation_rules('donor_status')
  case
    when coalesce(h.gift_count, 0) = 0                        then 'prospect'
    when f.contact_id is not null                             then 'lapsed'
    when fg.donated_on >= (current_date - make_interval(months => p.new_months))::date
                                                              then 'new'
    when lg.donated_on >= (current_date - make_interval(months => p.active_months))::date
                                                              then 'active'
    when lg.donated_on >= (current_date - make_interval(months => p.pre_lapsed_months))::date
                                                              then 'pre_lapsed'
    else 'lapsed'
  end                                                               as donor_status,

  -- household rollup (02 §4.1)
  coalesce(hr.household_lifetime_giving, coalesce(h.lifetime_giving, 0))::numeric(14,2)
                                                                    as household_lifetime_giving,
  coalesce(hr.household_gift_count, coalesce(h.gift_count, 0))::int  as household_gift_count
from public.contacts c
cross join p
left join hard           h  on h.contact_id  = c.id
left join soft           s  on s.contact_id  = c.id
left join first_gift     fg on fg.contact_id = c.id
left join last_gift      lg on lg.contact_id = c.id
left join pledge_bal     pb on pb.contact_id = c.id
left join last_meaningful lm on lm.contact_id = c.id
left join task_agg       ta on ta.contact_id = c.id
left join next_action    na on na.contact_id = c.id
left join failing        f  on f.contact_id  = c.id
left join household_roll hr on hr.household_id = c.household_id;

comment on view public.contact_stats is
  'Derived layer per spec 02 §4.1 — every rollup, flag, KIT due date and donor status the UI shows. Never recompute these client-side (I-8/I-9).';

-- --------------------------------------------------------------------------
-- pledge_balances (02 §3.5 / §4): promised vs received, with the computed
-- 'overdue' installment state that is deliberately never stored (I-9).
-- --------------------------------------------------------------------------

create or replace view public.pledge_balances with (security_invoker = true) as
with pay as (
  select d.pledge_id, sum(d.amount_gbp) as paid_amount, count(*) as payment_count
  from public.donations d
  where d.status = 'received' and d.pledge_id is not null
  group by d.pledge_id
),
inst as (
  select
    pi.pledge_id,
    count(*)                                                     as installment_count,
    count(*) filter (where pi.status = 'paid')                    as paid_installment_count,
    count(*) filter (where pi.status = 'expected'
                       and pi.due_on < current_date)              as overdue_installment_count,
    coalesce(sum(pi.amount) filter (where pi.status = 'expected'
                       and pi.due_on < current_date), 0)          as overdue_amount
  from public.pledge_installments pi
  group by pi.pledge_id
),
next_inst as (
  select distinct on (pi.pledge_id) pi.pledge_id, pi.id, pi.due_on, pi.amount
  from public.pledge_installments pi
  where pi.status in ('expected','partly_paid')
  order by pi.pledge_id, pi.due_on asc
)
select
  pl.id                                       as pledge_id,
  pl.contact_id,
  pl.status,
  pl.pledged_on,
  pl.currency,
  pl.total_amount::numeric(14,2),
  pl.amount_gbp::numeric(14,2),
  pl.fund_id, pl.campaign_id, pl.appeal_id,
  coalesce(pay.paid_amount, 0)::numeric(14,2)          as paid_amount,
  coalesce(pay.payment_count, 0)::int                  as payment_count,
  coalesce(pl.write_off_amount, 0)::numeric(14,2)      as write_off_amount,
  greatest(pl.amount_gbp - coalesce(pay.paid_amount, 0)
                         - coalesce(pl.write_off_amount, 0), 0)::numeric(14,2) as balance,
  coalesce(inst.installment_count, 0)::int             as installment_count,
  coalesce(inst.paid_installment_count, 0)::int        as paid_installment_count,
  coalesce(inst.overdue_installment_count, 0)::int     as overdue_installment_count,
  coalesce(inst.overdue_amount, 0)::numeric(14,2)      as overdue_amount,
  ni.id                                                as next_installment_id,
  ni.due_on                                            as next_installment_due_on,
  ni.amount::numeric(14,2)                             as next_installment_amount
from public.pledges pl
left join pay       on pay.pledge_id  = pl.id
left join inst      on inst.pledge_id = pl.id
left join next_inst ni on ni.pledge_id = pl.id;

comment on view public.pledge_balances is
  'Pledge promised-vs-received with computed overdue installments (02 §3.5).';

grant select on public.contact_stats, public.pledge_balances to authenticated, service_role;
