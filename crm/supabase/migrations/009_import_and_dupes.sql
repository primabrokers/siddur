-- ==========================================================================
-- 009 — CSV import batches + the duplicates queue the merge tool works from
--       (spec 06 §5, 11 §7 "the import wizard's batch-undo as application-
--       level recovery").
--
-- Two things land here:
--
--   1. `import_batches` — one row per committed wizard run, plus an
--      `import_batch` stamp on the rows that run created. That stamp is the
--      whole undo story: "delete everything this batch made that nobody has
--      touched since". A nullable FK with `on delete set null` means removing
--      a batch row never cascades into donor data.
--
--   2. `duplicates_queue` — already created by 003c (the nightly
--      `duplicate_scan` writes it). It is re-declared here `if not exists`
--      only so a fresh database built from this folder in order still gets
--      it, and then *aligned*: two resolution columns the merge tool stamps
--      when a pair leaves the queue, and the index the queue screen reads on.
--      Nothing existing is altered.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- import_batches
-- --------------------------------------------------------------------------

create table if not exists public.import_batches (
  id             uuid primary key default gen_random_uuid(),
  filename       text not null,
  started_by     uuid references public.team_members (id) on delete set null,
  created_at     timestamptz not null default now(),
  contact_count  integer not null default 0,
  donation_count integer not null default 0,
  status         text not null default 'committed'
                 check (status in ('committed', 'undone')),
  -- When the run finished writing. This is the line the undo draws between
  -- "the import did this" and "somebody has used it since": inserting a gift
  -- fires the automation triggers (08 §7), which create a thank-you task and a
  -- signal against the brand-new contact. Without a finish time those look
  -- exactly like a fundraiser's own work, and undo would refuse to remove a
  -- single row it had just written.
  completed_at   timestamptz,
  undone_at      timestamptz
);

comment on table public.import_batches is
  'One committed CSV import run (06 §5). `import_batch` on contacts/donations points here; undo deletes by that stamp.';

-- Added after the first live run, so an existing table gets it too.
alter table public.import_batches add column if not exists completed_at timestamptz;

-- The stamp. Nullable everywhere: hand-entered records simply carry null.
alter table public.contacts
  add column if not exists import_batch uuid references public.import_batches (id) on delete set null;
alter table public.donations
  add column if not exists import_batch uuid references public.import_batches (id) on delete set null;

-- Partial indexes: the vast majority of rows are hand-entered and never
-- looked up this way, so only the stamped ones are worth indexing.
create index if not exists contacts_import_batch_idx
  on public.contacts (import_batch) where import_batch is not null;
create index if not exists donations_import_batch_idx
  on public.donations (import_batch) where import_batch is not null;

-- --------------------------------------------------------------------------
-- import_batches RLS — the 11 §1 matrix row for import.
--   select  any active team member (the done screen and the batch list)
--   insert  admin + fundraiser (whoever may create contacts may import them)
--   update  admin (marking a batch undone accompanies deletes, admin-only)
--   delete  admin
-- --------------------------------------------------------------------------

alter table public.import_batches enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'import_batches'
                   and policyname = 'import_batches_sel') then
    create policy import_batches_sel on public.import_batches
      for select to authenticated using (public.crm_is_member());
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'import_batches'
                   and policyname = 'import_batches_ins') then
    create policy import_batches_ins on public.import_batches
      for insert to authenticated
      with check (public.crm_role() in ('admin', 'fundraiser'));
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'import_batches'
                   and policyname = 'import_batches_upd') then
    create policy import_batches_upd on public.import_batches
      for update to authenticated
      using (public.crm_role() = 'admin')
      with check (public.crm_role() = 'admin');
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'import_batches'
                   and policyname = 'import_batches_del') then
    create policy import_batches_del on public.import_batches
      for delete to authenticated using (public.crm_role() = 'admin');
  end if;
end $$;

grant select, insert, update, delete on public.import_batches to authenticated;
grant all on public.import_batches to service_role;

-- --------------------------------------------------------------------------
-- duplicates_queue — created by 003c; this block only makes a fresh build
-- from this folder self-sufficient and adds the resolution stamps.
-- --------------------------------------------------------------------------

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

-- Who took the pair out of the queue, and when. The nightly scan re-inserts
-- `on conflict do nothing`, so a resolved pair stays resolved.
alter table public.duplicates_queue
  add column if not exists resolved_at timestamptz;
alter table public.duplicates_queue
  add column if not exists resolved_by uuid references public.team_members (id) on delete set null;

-- The queue screen reads open pairs, newest first.
create index if not exists duplicates_queue_state_idx
  on public.duplicates_queue (state, created_at desc);

alter table public.duplicates_queue enable row level security;

-- 003c granted select/update/delete to admins but no insert policy (only the
-- security-definer nightly writes). The merge tool never inserts either; the
-- policy exists so an admin can file a pair by hand from the queue screen.
do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'duplicates_queue'
                   and policyname = 'duplicates_queue_ins') then
    create policy duplicates_queue_ins on public.duplicates_queue
      for insert to authenticated with check (public.crm_role() = 'admin');
  end if;
end $$;
