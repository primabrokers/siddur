-- ============================================================================
-- 010_pipeline_seeds — the two configuration gaps the Pipeline board (06 §2)
--                      needs, plus the one column the "Lost → reason" rule
--                      has nowhere else to live in.
-- ============================================================================
-- Everything here is idempotent so the migration can be replayed safely, and
-- additive so it cannot disturb a milestone that is already live.
--
-- 1. `opportunities.lost_reason` — 02 §3.9 lists no column for it, but 06 §2
--    requires "Lost → reason (lookup) for the conversion report". Recording it
--    in `notes` would make the report unbuildable, so it gets its own nullable
--    text column holding a `lookup_options('opportunity_lost_reason').value`.
--    (Deviation from 02 §3.9, declared here per CLAUDE.md.)
-- 2. `opportunity_stage.meta.rot_days` — the per-stage idle threshold the board
--    shades cards by (06 §2 "Rotting", ▸ Pipedrive). The exit-criteria half of
--    the same meta was seeded in 004; this adds the rot threshold beside it.
--    Both keys are admin-editable inline on the column header (I-6), so the
--    merge is written seed-first / stored-last: a replay fills in a key that is
--    missing and leaves every value an admin has since changed alone.
--    Values follow Pipeline.dc.html: qualified 30d · cultivating 45d ·
--    solicited 14d. Pledged and stewarding carry none — a pledge being paid
--    down is not idle — and the header simply omits the "· rot Nd" clause.
-- 3. `opportunity_lost_reason` — a new lookup list. The spec's §6 list of lists
--    does not name one, so these are seeds in the same spirit as the rest:
--    admin-editable, orderable, retireable (retiring never deletes history).
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. The lost-reason column
-- --------------------------------------------------------------------------

alter table public.opportunities
  add column if not exists lost_reason text;

comment on column public.opportunities.lost_reason is
  'lookup_options(''opportunity_lost_reason'').value — recorded when status goes to ''lost'' (06 §2), feeds the conversion report (06 §3).';

-- --------------------------------------------------------------------------
-- 2. Per-stage exit criteria + rot thresholds
--    `new || stored` keeps every key an admin added *and* every value they
--    edited; the seeds below only fill the gaps.
-- --------------------------------------------------------------------------

with stage_meta (value, label, sort_order, exit_criteria, rot_days) as (
  values
    ('identified',  'Identified',  10, 'We know who they are and why they might care',        45),
    ('qualified',   'Qualified',   20, 'Capacity and interest confirmed by a human conversation', 30),
    ('cultivating', 'Cultivating', 30, 'They have visited, met the Rosh Yeshiva, or seen the work', 45),
    ('solicited',   'Solicited',   40, 'A specific amount has been asked for, in person or in writing', 14),
    ('pledged',     'Pledged',     50, 'Commitment made and a payment schedule agreed',        null::int),
    ('stewarding',  'Stewarding',  60, 'Thanked, reported to, and ready to be asked again',    null::int)
)
insert into public.lookup_options (list_name, value, label, sort_order, meta)
select
  'opportunity_stage',
  s.value,
  s.label,
  s.sort_order,
  jsonb_strip_nulls(
    jsonb_build_object('exit_criteria', s.exit_criteria, 'rot_days', s.rot_days)
  )
from stage_meta s
on conflict (list_name, value) do update
  set meta = excluded.meta || coalesce(lookup_options.meta, '{}'::jsonb);

-- --------------------------------------------------------------------------
-- 3. Lost reasons (06 §2 → the win/loss half of the conversion report)
-- --------------------------------------------------------------------------

insert into public.lookup_options (list_name, value, label, sort_order, meta) values
  ('opportunity_lost_reason','no_capacity',        'No capacity right now',          10,'{}'),
  ('opportunity_lost_reason','timing',             'Wrong timing',                   20,'{}'),
  ('opportunity_lost_reason','gave_elsewhere',     'Gave elsewhere',                 30,'{}'),
  ('opportunity_lost_reason','no_response',        'Never got an answer',            40,'{}'),
  ('opportunity_lost_reason','not_interested',     'Not interested in this project', 50,'{}'),
  ('opportunity_lost_reason','wrong_ask',          'Ask was wrong (size or framing)',60,'{}'),
  ('opportunity_lost_reason','relationship_lapsed','Relationship went cold',         70,'{}'),
  ('opportunity_lost_reason','other',              'Other',                          80,'{}')
on conflict (list_name, value) do update
  set label      = excluded.label,
      sort_order = excluded.sort_order;
