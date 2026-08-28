-- ============================================================================
-- 005c_journeys_hardening — finish what 005_journeys_and_ics started
-- ============================================================================
-- 005 shipped the tables, the seeds, the engine and the `crm-journeys` cron.
-- Three things it left open, all fixed forward here (nothing in 005, 005b or
-- run_nightly() is dropped or re-run):
--
--   1. **The RPC surface.** 005b (`005_function_hardening` live) closed
--      run_nightly() and the internal machinery, but it was written against
--      the automation layer as it stood — `run_journey_steps()` and
--      `cancel_journey_tasks()` landed one migration later and kept Postgres's
--      default `EXECUTE to PUBLIC`. PostgREST publishes every public function
--      as /rest/v1/rpc/<name>, so any signed-in user — a viewer included —
--      could run the journey engine or cancel another fundraiser's tasks.
--      Both are revoked here, exactly as 005b revoked run_nightly().
--
--   2. **Attach had no same-day effect.** A journey whose first step is
--      `offset_days = 0` (lapsed reactivation) produced nothing until the next
--      05:15 cron. The per-enrolment half of the engine is factored out into
--      `crm_journey_materialise()` and fired by an AFTER INSERT trigger, so
--      attaching creates whatever is already due inside the same transaction.
--      A trigger, not an RPC: the client stays on plain RLS-governed table
--      writes (no `.rpc()` anywhere in `src/`), and the privilege that creates
--      the tasks is the trigger's, never the caller's.
--
--   3. **The engine duplicated itself.** run_journey_steps() now loops and
--      delegates; there is one implementation of "what is due for this
--      enrolment", so the cron, the trigger and the smoke test agree by
--      construction.
--
-- Semantics are unchanged from 005: same due-date rule, same
-- depends_on_previous wait, same exit_on_gift, same completion test, same
-- `origin = 'journey:<key>'`, same idempotency (a step with a `journey_tasks`
-- row is never materialised twice).
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. crm_journey_materialise() — the engine, for exactly one enrolment
-- --------------------------------------------------------------------------
-- Internal: called by run_journey_steps() (the cron) and by the enrolment
-- trigger, both of which are SECURITY DEFINER, so the EXECUTE revoke below
-- costs them nothing.
--
--   due         a step is materialised when started_on + offset_days <= today.
--               Every step that has come due is created in the same call, so
--               one pass converges and a second call the same day is a no-op.
--   depends_on  a step with depends_on_previous waits for step n-1's task to
--               be `done`; the whole tail waits with it. When it unblocks its
--               due date is max(offset date, today) — a step that waited is
--               never born already overdue.
--   completion  every step materialised and no journey task still open →
--               status 'completed'.
--
-- Archived contacts and non-active enrolments fall out of the lookup and get
-- a zero result rather than an error: the cron must never fail on one row.

create or replace function public.crm_journey_materialise(p_enrollment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_e         record;
  v_step      record;
  v_due       date;
  v_ok        boolean;
  v_task      uuid;
  v_created   int := 0;
  v_completed int := 0;
  v_guard     int := 0;
begin
  select en.id, en.contact_id, en.template_id, en.started_on,
         en.assigned_to, en.created_by, t.key, c.relationship_owner_id
    into v_e
  from public.journey_enrollments en
  join public.journey_templates t on t.id = en.template_id
  join public.contacts c on c.id = en.contact_id and not c.is_archived
  where en.id = p_enrollment
    and en.status = 'active';

  if not found then
    return jsonb_build_object('tasks_created', 0, 'completed', 0);
  end if;

  loop
    v_guard := v_guard + 1;
    exit when v_guard > 100;                         -- a template is a handful of steps

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
      exit when not v_ok;                            -- the tail waits with it
      if v_due < current_date then v_due := current_date; end if;
    end if;

    exit when v_due > current_date;                  -- not due yet

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
    v_completed := 1;
  end if;

  return jsonb_build_object('tasks_created', v_created, 'completed', v_completed);
end;
$fn$;

comment on function public.crm_journey_materialise(uuid) is
  'One enrolment''s due journey steps → tasks (08 §4). Internal: run_journey_steps() and the enrolment trigger call it. Idempotent.';

-- --------------------------------------------------------------------------
-- 2. run_journey_steps() — same contract, now a loop over the above
-- --------------------------------------------------------------------------
-- Still deliberately SEPARATE from run_nightly() / `crm-nightly`, which this
-- migration does not read, drop or alter (05:15 vs 05:00 — see 005's header).
--
--   exit_on_gift  a received gift dated on/after started_on AND recorded no
--                 earlier than the enrolment ends the journey (reason
--                 'gift_received') and cancels the steps still open. The
--                 created_at half matters: a "lapsed reactivation" journey is
--                 attached *because* they have not given, so the older gift
--                 that prompted the attach must not end it the same night.

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
  v_result    jsonb;
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
    select en.id
    from public.journey_enrollments en
    join public.contacts c on c.id = en.contact_id and not c.is_archived
    where en.status = 'active'
    order by en.started_on
  loop
    v_result := public.crm_journey_materialise(v_e.id);
    v_created   := v_created   + coalesce((v_result ->> 'tasks_created')::int, 0);
    v_completed := v_completed + coalesce((v_result ->> 'completed')::int, 0);
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
-- 3. Attach materialises immediately
-- --------------------------------------------------------------------------
-- AFTER INSERT so the enrolment row exists for the lookup, and STATEMENT-safe
-- because it is per row with no recursion: crm_journey_materialise() writes to
-- `tasks` and `journey_tasks`, never back to `journey_enrollments` except the
-- completion UPDATE, which no trigger listens to.

create or replace function public.journey_enrollments_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.status = 'active' then
    perform public.crm_journey_materialise(new.id);
  end if;
  return null;
end;
$fn$;

drop trigger if exists journey_enrollments_ai on public.journey_enrollments;
create trigger journey_enrollments_ai
  after insert on public.journey_enrollments
  for each row execute function public.journey_enrollments_after_insert();

-- --------------------------------------------------------------------------
-- 4. The revokes 005b would have carried had journeys existed yet
-- --------------------------------------------------------------------------
-- Trigger functions do not need EXECUTE to fire, and a SECURITY DEFINER
-- function calling another checks the privilege against the definer — so all
-- four of these keep working for the cron and the trigger.
--
-- The client needs none of them: attaching is an INSERT on
-- `journey_enrollments` and detaching is an UPDATE on `tasks` +
-- `journey_enrollments`, both governed by the 005 RLS policies (fundraiser+).

do $$
declare f text;
begin
  foreach f in array array[
    'run_journey_steps()',
    'cancel_journey_tasks(uuid)',
    'crm_journey_materialise(uuid)',
    'journey_enrollments_after_insert()'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

grant execute on function public.run_journey_steps() to service_role;
