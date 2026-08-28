-- ============================================================================
-- 008_ai_fields — M9a: the rolling holding line, the brief cache, the digest log
-- ============================================================================
-- Everything the three M9a edge functions (`donor-brief`, `draft-message`,
-- `send-digest`) need on the database side. Additive only: no existing column,
-- policy, view or trigger is altered.
--
-- Four things land here:
--   1. contacts.holding_line / holding_line_at — the "Where we're holding" line
--      (04 §5.8), maintained by donor-brief.
--   2. ai_briefs — the per-viewer brief cache (09 §3 "cached until a new
--      interaction lands"), invalidated by a trigger, not by a client.
--   3. digest_log — what the morning digest actually said and how it left the
--      building (08 §6), plus the hourly tick that fires it.
--   4. The 005_function_hardening pass over everything §1–§3 creates. Postgres
--      grants EXECUTE on new functions to PUBLIC, and this project's default
--      ACL hands anon/authenticated EXECUTE on every new `public` function, so
--      each function created here is revoked explicitly (lints 0028/0029).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. contacts.holding_line — "Where we're holding"
-- ---------------------------------------------------------------------------
-- **Deviation from 02-DATA-MODEL.md, stated plainly.** Spec 02 §3.1 lists every
-- contact column and does *not* include a holding line; 04 §5.8 and 09 §3
-- nevertheless require one ("a rolling AI-maintained one-liner under the
-- header, rewritten after each captured interaction" ▸ Gong Next_Steps). The
-- two sections disagree, so 04/09 win on the feature and 02 gains two columns:
--
--   holding_line     text          the line itself, or null when never written
--   holding_line_at  timestamptz   when it was last rewritten
--
-- Modelled as columns on `contacts` rather than as a fifth "notes" category
-- because it is exactly one value per contact, is overwritten (not appended),
-- and is read on every profile render — a note row would need an extra query
-- and a "which one is current" rule. When 02 is next revised these two lines
-- belong in §3.1.
--
-- Labelling (03 §5.7 / 09 §1.4) is a *client* concern: the line renders with
-- the "Drafted with AI" chip until a human accepts it, at which point the chip
-- becomes "Reviewed". Acceptance is recorded in `ai_activity_log`, not here,
-- so the column stays a plain value with no review state to keep in sync.
--
-- No new policy is needed: `contacts_upd` already restricts writes to
-- admin/fundraiser, so a viewer's brief simply cannot rewrite the line — which
-- is the correct outcome, not a bug to work around.

alter table public.contacts
  add column if not exists holding_line     text,
  add column if not exists holding_line_at  timestamptz;

comment on column public.contacts.holding_line is
  'The rolling "Where we''re holding" line (04 §5.8 / 09 §3), rewritten by the donor-brief edge function. Deviation from 02 §3.1 — see 008_ai_fields.sql.';
comment on column public.contacts.holding_line_at is
  'When holding_line was last rewritten. Null while the line has never been generated.';


-- ---------------------------------------------------------------------------
-- 2. ai_briefs — the brief cache
-- ---------------------------------------------------------------------------
-- **Why a table and not `ai_activity_log`.** The ledger (02 §3.17) is an
-- append-only audit trail: one row per *run*, carrying resolution
-- accepted/edited/rejected, latency and tokens, and it is what Settings
-- aggregates into the per-feature edit rate and monthly cost (09 §1.5, §8).
-- A cache is the opposite shape — at most one *current* row per (contact,
-- viewer), overwritten in place, and carrying a mutable `stale` flag. Putting
-- the cache in the ledger would mean (a) "newest brief for contact X" becomes a
-- jsonb-ordered scan of an ever-growing audit table, (b) invalidation would
-- UPDATE audit rows, which is precisely what an audit table must not permit,
-- and (c) a cache hit is not a run, so counting it would corrupt the KPI the
-- ledger exists to produce. The two stay separate; `ai_briefs.ai_activity_id`
-- links a cached brief back to the ledger row of the run that produced it.
--
-- **Why the key is (contact_id, team_member_id) and not contact_id alone.**
-- A brief is built through the requesting user's own RLS (09 §1.7): it may
-- contain a private note only its author can see, and its giving figures are
-- zeroed for a viewer without `can_see_amounts`. One shared cache row would
-- therefore either leak a private note to the next reader or serve them a
-- redacted brief as if it were complete. Per-viewer rows make the cache
-- inherit exactly the visibility of the request that filled it. The cost is a
-- second generation per user per contact — pennies (09 §8).

create table if not exists public.ai_briefs (
  contact_id      uuid not null references public.contacts (id) on delete cascade,
  team_member_id  uuid not null references public.team_members (id) on delete cascade,
  brief           jsonb not null,                    -- the five 09 §3 bullets + echoed numbers
  holding_line    text,                              -- what this run proposed for the rolling line
  model           text,
  ai_activity_id  uuid references public.ai_activity_log (id),
  stale           boolean not null default false,    -- set by the trigger below
  generated_at    timestamptz not null default now(),
  primary key (contact_id, team_member_id)
);

comment on table public.ai_briefs is
  'Per-viewer cache of the 09 §3 pre-meeting brief. Keyed by viewer because the brief is built through that viewer''s RLS. Invalidated by trg_ai_briefs_stale_*, never by a client.';

create index if not exists ai_briefs_member_idx on public.ai_briefs (team_member_id);

-- Invalidation lives in the database because the rule is a fact about the data,
-- not about a screen: "cached until a new interaction lands" (09 §3). A gift is
-- material to a brief too, so it stales as well.
create or replace function public.ai_briefs_mark_stale()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.ai_briefs set stale = true where contact_id = new.contact_id;
  return null;
end;
$$;

comment on function public.ai_briefs_mark_stale() is
  'Marks every cached brief for a contact stale when a new interaction or gift lands (09 §3).';

drop trigger if exists trg_ai_briefs_stale_interactions on public.interactions;
create trigger trg_ai_briefs_stale_interactions
  after insert or update on public.interactions
  for each row execute function public.ai_briefs_mark_stale();

drop trigger if exists trg_ai_briefs_stale_donations on public.donations;
create trigger trg_ai_briefs_stale_donations
  after insert or update on public.donations
  for each row execute function public.ai_briefs_mark_stale();

-- RLS: your own cache rows, nobody else's. Admin is *not* excepted — an admin
-- reading another member's cached brief would read that member's private notes
-- through the back door, which the notes policy in 002 exists to prevent.
alter table public.ai_briefs enable row level security;

drop policy if exists ai_briefs_sel on public.ai_briefs;
create policy ai_briefs_sel on public.ai_briefs
  for select to authenticated
  using (public.crm_is_member() and team_member_id = auth.uid());

drop policy if exists ai_briefs_ins on public.ai_briefs;
create policy ai_briefs_ins on public.ai_briefs
  for insert to authenticated
  with check (public.crm_is_member() and team_member_id = auth.uid());

drop policy if exists ai_briefs_upd on public.ai_briefs;
create policy ai_briefs_upd on public.ai_briefs
  for update to authenticated
  using (public.crm_is_member() and team_member_id = auth.uid())
  with check (team_member_id = auth.uid());

drop policy if exists ai_briefs_del on public.ai_briefs;
create policy ai_briefs_del on public.ai_briefs
  for delete to authenticated
  using (public.crm_is_member() and team_member_id = auth.uid());

revoke all on public.ai_briefs from anon;
grant select, insert, update, delete on public.ai_briefs to authenticated;


-- ---------------------------------------------------------------------------
-- 3. digest_log — what the morning digest said, and how it left
-- ---------------------------------------------------------------------------
-- 08 §6: the digest is per team member, at their `digest_hour`, and a quiet day
-- still sends a two-line digest — never silence. This table is both the
-- once-per-day idempotency key and the "did it actually go?" record Settings
-- can show. `delivery = 'log'` is the honest state when no mail provider is
-- configured: the digest was composed and stored, and nothing was sent.

create table if not exists public.digest_log (
  id             uuid primary key default gen_random_uuid(),
  team_member_id uuid not null references public.team_members (id) on delete cascade,
  digest_on      date not null default current_date,
  payload        jsonb not null,                     -- the composed sections (08 §6)
  narrative      text,                               -- the two-sentence AI line, or null
  subject        text,
  body_text      text,
  delivery       text not null default 'log'
                   check (delivery in ('email','log','skipped','failed')),
  delivered_at   timestamptz,
  error          text,
  created_at     timestamptz not null default now(),
  unique (team_member_id, digest_on)
);

comment on table public.digest_log is
  'One row per member per day: the composed morning digest (08 §6), its AI narrative if any, and how it was delivered. delivery=''log'' means composed but not emailed (no mail provider configured).';

create index if not exists digest_log_day_idx on public.digest_log (digest_on desc);

alter table public.digest_log enable row level security;

-- Members read their own; admins read all (it is operational, not personal).
-- Writes come from the send-digest function under the service role, which
-- bypasses RLS — so there is deliberately no insert policy here.
drop policy if exists digest_log_sel on public.digest_log;
create policy digest_log_sel on public.digest_log
  for select to authenticated
  using (public.crm_is_member() and (team_member_id = auth.uid() or public.crm_role() = 'admin'));

revoke all on public.digest_log from anon;
revoke insert, update, delete on public.digest_log from authenticated;
grant select on public.digest_log to authenticated;
grant select, insert, update, delete on public.digest_log to service_role;


-- ---------------------------------------------------------------------------
-- 4. The hourly digest tick
-- ---------------------------------------------------------------------------
-- The digest fires **hourly**, and `send-digest` sends only to members whose
-- `digest_hour` matches the current UTC hour (08 §6: "per team member, at
-- digest_hour"). Scheduling hourly and filtering inside the function keeps one
-- cron entry instead of twenty-four.
--
-- Transport is pg_net (`net.http_post`), which is async and therefore safe to
-- call from a cron job. Two secrets are read from Supabase Vault rather than
-- baked into this file:
--
--   crm_functions_url      https://<ref>.functions.supabase.co
--   crm_service_role_key   the service-role JWT the function gateway accepts
--
-- Set them once with:
--   select vault.create_secret('https://zyvhcnhablkgbsgtljma.functions.supabase.co', 'crm_functions_url');
--   select vault.create_secret('<service-role key>', 'crm_service_role_key');
--
-- **If pg_net is unavailable** (the extension cannot be created on this plan,
-- or the schedule below is skipped), the function is still deployed and ready:
-- schedule it instead from the Supabase dashboard under
-- Edge Functions → send-digest → Schedules with the cron expression `0 * * * *`,
-- which invokes the function over HTTPS with a platform-managed token and needs
-- neither pg_net nor the Vault secrets above. Nothing here fakes a schedule:
-- `crm_digest_tick()` raises a notice and returns `no_pg_net` / `no_secrets`
-- when it cannot actually POST, and that string is what the cron run records.

do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice '[008] pg_net unavailable (%): schedule send-digest from the dashboard instead.', sqlerrm;
end;
$$;

create or replace function public.crm_digest_tick()
returns text
language plpgsql
security definer
set search_path = public, extensions, net, pg_temp
as $fn$
declare
  v_schema text;
  v_url    text;
  v_key    text;
begin
  -- pg_net lands in `net` or `extensions` depending on how it was installed;
  -- find http_post wherever it is rather than guessing.
  select n.nspname into v_schema
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.proname = 'http_post'
  order by case n.nspname when 'net' then 0 when 'extensions' then 1 else 2 end
  limit 1;

  if v_schema is null then
    raise notice '[crm-digest] pg_net is not installed — schedule send-digest from the dashboard.';
    return 'no_pg_net';
  end if;

  select decrypted_secret into v_url  from vault.decrypted_secrets where name = 'crm_functions_url'    limit 1;
  select decrypted_secret into v_key  from vault.decrypted_secrets where name = 'crm_service_role_key' limit 1;

  if v_url is null or v_key is null then
    raise notice '[crm-digest] vault secrets crm_functions_url / crm_service_role_key are not set — nothing sent.';
    return 'no_secrets';
  end if;

  execute format(
    'select %I.http_post(url := $1, headers := $2::jsonb, body := $3::jsonb)', v_schema)
  using
    rtrim(v_url, '/') || '/send-digest',
    jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    jsonb_build_object('scheduled', true, 'hour', extract(hour from (now() at time zone 'utc'))::int);

  return 'posted';
end;
$fn$;

comment on function public.crm_digest_tick() is
  'Hourly pg_net POST to the send-digest edge function (08 §6). Returns no_pg_net / no_secrets / posted; never raises, so a missing dependency cannot break the cron run.';

do $$
begin
  if exists (select 1 from cron.job where jobname = 'crm-digest') then
    perform cron.unschedule('crm-digest');
  end if;
  perform cron.schedule('crm-digest', '0 * * * *', 'select public.crm_digest_tick()');
  raise notice '[008] scheduled crm-digest hourly.';
exception when others then
  raise notice '[008] could not schedule crm-digest (%): use the dashboard schedule instead.', sqlerrm;
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. Function hardening (the 005_function_hardening pattern)
-- ---------------------------------------------------------------------------
-- PostgREST exposes every `public` function as /rest/v1/rpc/<name>, and this
-- project's default ACL grants EXECUTE on new functions to anon, authenticated
-- and service_role. Neither function created above is part of any caller's
-- surface:
--
--   ai_briefs_mark_stale()  is a trigger function. A trigger's privilege check
--                           happens when the trigger is created, not when it
--                           fires, so revoking EXECUTE costs nothing and closes
--                           an RPC that would let any signed-in user stale
--                           every cached brief in the database.
--   crm_digest_tick()       is called by pg_cron as `postgres` (the owner, which
--                           needs no grant). Left executable it would be an
--                           unauthenticated-ish "send everyone's digest now"
--                           button, and it reads Vault secrets under SECURITY
--                           DEFINER — precisely the shape 005 exists to close.
--
-- Nothing here is granted back to service_role: the send-digest function calls
-- the REST API, not this RPC.

revoke all on function public.ai_briefs_mark_stale() from public, anon, authenticated, service_role;
revoke all on function public.crm_digest_tick()      from public, anon, authenticated, service_role;
