-- ============================================================================
-- 005_journeys_and_ics — journeys (08 §4) + the tokenised ICS feed (10 §4)
-- ============================================================================
-- Two features, one migration, because both are additive and neither touches
-- anything 001–004 owns:
--
--   * Journeys are **task sequences only** (08 §4 / I-10): a template is a
--     named list of task blueprints with a day offset from enrolment and an
--     optional "wait for the previous step". No step ever sends anything to a
--     donor; every step becomes an ordinary row in `tasks` with
--     `origin = 'journey:<template key>'` (02 §3.3).
--   * The ICS feed needs one per-member secret: `team_members.ics_token`.
--
-- `run_journey_steps()` and its cron (`crm-journeys`, 05:15 UTC) are
-- deliberately SEPARATE from `run_nightly()` / `crm-nightly`, which this
-- migration does not read, drop or alter. A journey misfiring must never take
-- the nightly run down with it, and vice versa.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Tables
-- --------------------------------------------------------------------------

create table if not exists public.journey_templates (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,                    -- 'new_donor_welcome' → tasks.origin 'journey:new_donor_welcome'
  name         text not null,
  description  text,
  exit_on_gift boolean not null default false,          -- 08 §4 auto-exit: the goal was a gift
  is_active    boolean not null default true,           -- retired templates keep their history, take no new enrolments
  created_at   timestamptz not null default now()
);

comment on table public.journey_templates is
  'Journey templates (08 §4). A journey is a task sequence — never an automated donor-facing send (I-10).';
comment on column public.journey_templates.key is
  'Stable key. Tasks created by this journey carry origin = ''journey:'' || key (02 §3.3).';

create table if not exists public.journey_steps (
  id                  uuid primary key default gen_random_uuid(),
  template_id         uuid not null references public.journey_templates (id) on delete cascade,
  step_no             int  not null check (step_no > 0),
  offset_days         int  not null default 0 check (offset_days >= 0),  -- from journey_enrollments.started_on
  title               text not null,
  action_type         text,                             -- lookup:action_type (02 §6)
  details             text,
  depends_on_previous boolean not null default false,   -- ▸ NPSP engagement plans: wait for step n-1 to be done
  created_at          timestamptz not null default now(),
  unique (template_id, step_no)
);

create index if not exists journey_steps_template_idx
  on public.journey_steps (template_id, step_no);

create table if not exists public.journey_enrollments (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references public.contacts (id) on delete cascade,
  template_id   uuid not null references public.journey_templates (id) on delete cascade,
  started_on    date not null default current_date,
  status        text not null default 'active'
                  check (status in ('active','completed','exited')),
  exited_reason text,                                   -- 'gift_received' · 'detached' · free text
  ended_at      timestamptz,
  assigned_to   uuid references public.team_members (id),  -- who the steps land on; else the relationship owner
  created_by    uuid references public.team_members (id),
  created_at    timestamptz not null default now()
);

-- One live journey of a kind per contact. Re-enrolling after a completion or
-- an exit is allowed and starts a fresh clock — the partial index is the point.
create unique index if not exists journey_enrollments_active_uniq
  on public.journey_enrollments (contact_id, template_id)
  where status = 'active';

create index if not exists journey_enrollments_contact_idx
  on public.journey_enrollments (contact_id);
create index if not exists journey_enrollments_active_idx
  on public.journey_enrollments (status) where status = 'active';

-- Which task a step produced, for THIS enrolment. Two jobs:
--   * idempotency — a step with a row here is never materialised twice, which
--     is what makes run_journey_steps() safe to run any number of times a day;
--   * detach — "deleting mid-way cancels remaining steps" (08 §4) needs to know
--     exactly which open tasks belong to the journey.
-- `tasks.origin` alone cannot do this: a contact may be enrolled in the same
-- template twice over the years, and origin carries no step identity.
create table if not exists public.journey_tasks (
  id            uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.journey_enrollments (id) on delete cascade,
  step_id       uuid not null references public.journey_steps (id) on delete cascade,
  task_id       uuid not null references public.tasks (id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (enrollment_id, step_id)
);

create index if not exists journey_tasks_task_idx on public.journey_tasks (task_id);

-- --------------------------------------------------------------------------
-- 2. team_members.ics_token — the calendar feed's only credential (10 §4)
-- --------------------------------------------------------------------------
-- A volatile default is evaluated per row on ADD COLUMN, so existing members
-- each get their own token rather than sharing one.

alter table public.team_members
  add column if not exists ics_token uuid not null default gen_random_uuid();

create unique index if not exists team_members_ics_token_uniq
  on public.team_members (ics_token);

comment on column public.team_members.ics_token is
  'Per-member secret in the read-only ICS URL (10 §4). Regenerating it invalidates every existing subscription.';

-- --------------------------------------------------------------------------
-- 3. RLS — the house matrix (11 §1/§2)
--     templates + steps : read = any active member, write = admin (configuration)
--     enrollments+tasks : read = any active member, write = fundraiser+, delete = admin
-- --------------------------------------------------------------------------

do $rls$
declare t text; s text;
begin
  -- Configuration half: admin writes.
  foreach t in array array['journey_templates','journey_steps']
  loop
    execute format('alter table public.%I enable row level security', t);
    foreach s in array array['_sel','_ins','_upd','_del'] loop
      execute format('drop policy if exists %I on public.%I', t||s, t);   -- re-runnable
    end loop;
    execute format('create policy %I on public.%I for select to authenticated using (public.crm_is_member())', t||'_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.crm_role() = ''admin'')', t||'_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.crm_role() = ''admin'') with check (public.crm_role() = ''admin'')', t||'_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.crm_role() = ''admin'')', t||'_del', t);
  end loop;

  -- Operational half: a fundraiser attaches and detaches journeys.
  foreach t in array array['journey_enrollments','journey_tasks']
  loop
    execute format('alter table public.%I enable row level security', t);
    foreach s in array array['_sel','_ins','_upd','_del'] loop
      execute format('drop policy if exists %I on public.%I', t||s, t);
    end loop;
    execute format('create policy %I on public.%I for select to authenticated using (public.crm_is_member())', t||'_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.crm_role() in (''admin'',''fundraiser''))', t||'_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.crm_role() in (''admin'',''fundraiser'')) with check (public.crm_role() in (''admin'',''fundraiser''))', t||'_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.crm_role() = ''admin'')', t||'_del', t);
  end loop;
end $rls$;

-- Grants: 002 granted "all tables in schema public" as it stood then, so new
-- tables need their own line. RLS decides rows; grants decide verbs.
grant select, insert, update, delete
  on public.journey_templates, public.journey_steps,
     public.journey_enrollments, public.journey_tasks
  to authenticated;
grant all
  on public.journey_templates, public.journey_steps,
     public.journey_enrollments, public.journey_tasks
  to service_role;

-- --------------------------------------------------------------------------
-- 4. cancel_journey_tasks() — used by detach and by auto-exit
-- --------------------------------------------------------------------------
-- Only ever touches tasks this journey created (via journey_tasks), never a
-- task a person wrote by hand. `due_on` is coalesced because a dateless task
-- is legal only while `status = 'queued'` (001's check constraint).

create or replace function public.cancel_journey_tasks(p_enrollment uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare v_n int;
begin
  update public.tasks t
     set status = 'cancelled',
         due_on = coalesce(t.due_on, current_date)
    from public.journey_tasks jt
   where jt.enrollment_id = p_enrollment
     and jt.task_id = t.id
     and t.status in ('todo','in_progress','waiting','queued');
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

comment on function public.cancel_journey_tasks(uuid) is
  'Cancel the still-open tasks of one enrolment — "deleting mid-way cancels remaining steps" (08 §4).';

-- --------------------------------------------------------------------------
-- 5. run_journey_steps() — the journey engine
-- --------------------------------------------------------------------------
-- Separate from run_nightly() by design (see the header). Its contract:
--
--   exit_on_gift  a received gift dated on/after started_on AND recorded no
--                 earlier than the enrolment ends the journey (reason
--                 'gift_received') and cancels the steps still open. The
--                 created_at half matters: a "lapsed reactivation" journey is
--                 attached because they have NOT given, so the older gift that
--                 prompted the attach must not end it on the same night. A
--                 back-dated gift entered later is excluded by the donated_on
--                 half for the same reason.
--   due           a step is materialised when started_on + offset_days <=
--                 today. Every step that has come due is created in the same
--                 run, so the function converges in one pass and a second run
--                 the same day changes nothing (the idempotency the smoke test
--                 asserts).
--   depends_on    a step with depends_on_previous waits for step n-1's task to
--                 be `done`; the whole tail waits with it. When it finally
--                 unblocks, its due date is max(offset date, today) — a step
--                 that waited is never born already overdue.
--   completion    every step materialised and no journey task still open →
--                 status 'completed'.
--
-- Archived contacts are skipped (no task spam on a closed record). A template
-- switched to is_active = false takes no NEW enrolments (the picker filters on
-- it) but its live enrolments run to their end.

create or replace function public.run_journey_steps()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_created   int := 0;
  v_completed int := 0;
  v_exited    int := 0;
  v_cancelled int := 0;
  v_e         record;
  v_step      record;
  v_due       date;
  v_ok        boolean;
  v_task      uuid;
  v_guard     int;
begin
  -- ---------------------------------------------------------- 1. auto-exit
  for v_e in
    select en.id
    from public.journey_enrollments en
    join public.journey_templates t on t.id = en.template_id
    where en.status = 'active'
      and t.exit_on_gift
      and exists (
        select 1
        from public.donations d
        where d.contact_id = en.contact_id
          and d.status = 'received'
          and d.donated_on >= en.started_on
          and d.created_at >= en.created_at)
  loop
    update public.journey_enrollments
       set status = 'exited', exited_reason = 'gift_received', ended_at = now()
     where id = v_e.id;
    v_cancelled := v_cancelled + public.cancel_journey_tasks(v_e.id);
    v_exited := v_exited + 1;
  end loop;

  -- ------------------------------------------------- 2. materialise + close
  for v_e in
    select en.id, en.contact_id, en.template_id, en.started_on,
           en.assigned_to, en.created_by, t.key, c.relationship_owner_id
    from public.journey_enrollments en
    join public.journey_templates t on t.id = en.template_id
    join public.contacts c on c.id = en.contact_id and not c.is_archived
    where en.status = 'active'
    order by en.started_on
  loop
    v_guard := 0;

    loop
      v_guard := v_guard + 1;
      exit when v_guard > 100;                       -- a template is a handful of steps

      -- The lowest step this enrolment has not yet turned into a task.
      select s.* into v_step
      from public.journey_steps s
      where s.template_id = v_e.template_id
        and not exists (
          select 1 from public.journey_tasks jt
          where jt.enrollment_id = v_e.id and jt.step_id = s.id)
      order by s.step_no
      limit 1;

      exit when not found;

      v_due := v_e.started_on + v_step.offset_days;

      if v_step.depends_on_previous and v_step.step_no > 1 then
        select exists (
          select 1
          from public.journey_steps ps
          join public.journey_tasks jt on jt.step_id = ps.id and jt.enrollment_id = v_e.id
          join public.tasks tk on tk.id = jt.task_id
          where ps.template_id = v_e.template_id
            and ps.step_no = v_step.step_no - 1
            and tk.status = 'done')
        into v_ok;
        exit when not v_ok;                          -- the tail waits with it
        if v_due < current_date then v_due := current_date; end if;
      end if;

      exit when v_due > current_date;                -- not due yet

      insert into public.tasks (contact_id, title, action_type, details, assigned_to,
                                due_on, priority, status, origin, created_by)
      values (v_e.contact_id, v_step.title, v_step.action_type, v_step.details,
              coalesce(v_e.assigned_to, v_e.relationship_owner_id),
              v_due, 'medium', 'todo', 'journey:' || v_e.key, v_e.created_by)
      returning id into v_task;

      insert into public.journey_tasks (enrollment_id, step_id, task_id)
      values (v_e.id, v_step.id, v_task);

      v_created := v_created + 1;
    end loop;

    -- Completion: nothing left to materialise and nothing left open.
    if not exists (
         select 1 from public.journey_steps s
         where s.template_id = v_e.template_id
           and not exists (select 1 from public.journey_tasks jt
                           where jt.enrollment_id = v_e.id and jt.step_id = s.id))
       and not exists (
         select 1 from public.journey_tasks jt
         join public.tasks tk on tk.id = jt.task_id
         where jt.enrollment_id = v_e.id
           and tk.status in ('todo','in_progress','waiting','queued'))
    then
      update public.journey_enrollments
         set status = 'completed', ended_at = now()
       where id = v_e.id and status = 'active';
      v_completed := v_completed + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'tasks_created', v_created,
    'completed', v_completed,
    'exited', v_exited,
    'tasks_cancelled', v_cancelled);
end;
$fn$;

comment on function public.run_journey_steps() is
  'Journey engine (08 §4): materialise due steps as tasks, honour depends_on_previous, auto-exit on a gift, close finished journeys. Idempotent; independent of run_nightly().';

-- --------------------------------------------------------------------------
-- 6. Its own cron — 05:15 UTC, fifteen minutes after the nightly run so the
--    two never contend. run_nightly()'s own schedule is left untouched.
-- --------------------------------------------------------------------------

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'crm-journeys') then
      perform cron.unschedule('crm-journeys');
    end if;
    perform cron.schedule('crm-journeys', '15 5 * * *', 'select public.run_journey_steps()');
  else
    raise notice 'pg_cron not installed — run_journey_steps() exists but is not scheduled.';
  end if;
end $cron$;

-- --------------------------------------------------------------------------
-- 7. Seeds — the five templates named in 08 §4
-- --------------------------------------------------------------------------
-- Re-runnable: templates upsert on `key`, steps upsert on (template, step_no).
-- Editing a step here re-applies on the next deploy; a fundraiser's live
-- enrolments keep whatever tasks they already produced.

insert into public.journey_templates (key, name, description, exit_on_gift) values
  ('new_donor_welcome',          'New donor welcome',
   'The first ninety days after a first gift: thank, show the impact, invite them in.', false),
  ('recurring_donor_onboarding', 'Recurring donor onboarding',
   'Settle a new standing order: confirm it, welcome them properly, check the payments land.', false),
  ('lapsed_reactivation',        'Lapsed reactivation',
   'Reconnect without asking first. Exits the moment a gift arrives.', true),
  ('major_gift_stewardship',     'Major-gift stewardship',
   'After a major gift is won: thank, report at three months, visit at six.', false),
  ('new_parent',                 'New parent at the yeshiva',
   'A first year of relationship-building with a family new to the yeshiva.', false)
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      exit_on_gift = excluded.exit_on_gift;

with steps (key, step_no, offset_days, title, action_type, details, depends_on_previous) as (values
  -- New donor welcome — 08 §4: Day 1 call · Day 30 impact note · Day 90 event invite
  ('new_donor_welcome', 1,   1, 'Thank-you call for the first gift',            'call',
   'Two minutes, no ask. Say what the gift does.', false),
  ('new_donor_welcome', 2,  30, 'Send the impact note',                          'send_update',
   'One specific thing their gift paid for.', false),
  ('new_donor_welcome', 3,  90, 'Invite to the next event',                      'invite_event',
   'First invitation in person or by phone, not a mailing.', false),

  -- Recurring donor onboarding
  ('recurring_donor_onboarding', 1,   2, 'Welcome call — confirm the standing order', 'call',
   'Confirm amount, date and the fund it supports.', false),
  ('recurring_donor_onboarding', 2,  14, 'Send the welcome pack',                     'send_update',
   'Goes out once you have actually spoken to them.', true),
  ('recurring_donor_onboarding', 3,  95, 'Check the first three payments landed',     'other',
   'A missed payment is a silent relationship-ending event (D12).', false),
  ('recurring_donor_onboarding', 4, 190, 'Six-month thank-you call',                  'call',
   'Report on the year so far; no ask.', false),

  -- Lapsed reactivation (exits on a gift)
  ('lapsed_reactivation', 1,   0, 'Reconnect call — no ask',                     'call',
   'Ask after them. Do not mention giving.', false),
  ('lapsed_reactivation', 2,  21, 'Send a personal note with a recent update',   'send_update',
   'Only after the call happened.', true),
  ('lapsed_reactivation', 3,  60, 'Invite back — event or a visit',              'invite_event',
   'Bring them into the building before asking.', false),
  ('lapsed_reactivation', 4, 120, 'Make the re-engagement ask',                  'ask',
   'Modest, specific, and only if the earlier steps went well.', false),

  -- Major-gift stewardship — 08 §4: thank · 3-month update · 6-month visit
  ('major_gift_stewardship', 1,   1, 'Thank the donor personally',               'thank_you',
   'Handwritten or in person. Not a receipt.', false),
  ('major_gift_stewardship', 2,  90, 'Send the three-month impact update',       'send_update',
   'Numbers and a name — what the gift actually changed.', false),
  ('major_gift_stewardship', 3, 180, 'Arrange the six-month visit',              'arrange_meeting',
   'Show them the work in person.', true),

  -- New parent at the yeshiva
  ('new_parent', 1,   7, 'Welcome call to the new parent',                       'call',
   'How is the boy settling in? Nothing else.', false),
  ('new_parent', 2,  30, 'Coffee or a visit at the yeshiva',                     'arrange_meeting',
   'Meet the family properly in the first month.', false),
  ('new_parent', 3, 120, 'Invite to the parents'' event',                        'invite_event',
   'The first communal moment of the year.', false),
  ('new_parent', 4, 240, 'First conversation about supporting the yeshiva',      'ask',
   'Only once the relationship is real — a full two terms in.', true)
)
insert into public.journey_steps (template_id, step_no, offset_days, title, action_type, details, depends_on_previous)
select t.id, s.step_no, s.offset_days, s.title, s.action_type, s.details, s.depends_on_previous
from steps s
join public.journey_templates t on t.key = s.key
on conflict (template_id, step_no) do update
  set offset_days = excluded.offset_days,
      title = excluded.title,
      action_type = excluded.action_type,
      details = excluded.details,
      depends_on_previous = excluded.depends_on_previous;
