-- ==========================================================================
-- 012_whatsapp — WhatsApp Business Platform (Cloud API), spec 10 §2 Tier 2
--
-- Tier 2 was a decision point in the integration register until the user
-- triggered the upgrade on 18 Sep 2026. Tier 3 (unofficial bridges / WhatsApp
-- Web scraping) stays permanently rejected — nothing in this file, and nothing
-- in the two edge functions, talks to anything but Meta's official Cloud API.
--
-- Three tables and one rule:
--
--   wa_conversations  one row per wa_id (E.164), matched to a contact where we
--                     can, carrying `last_inbound_at` — the single fact the
--                     24-hour customer-service window is computed from.
--   wa_messages       the thread. Inbound and outbound, idempotent on Meta's
--                     `wa_message_id`, with the delivery status ladder.
--   wa_templates      the approved-template catalogue synced from Meta; the
--                     only way to open a conversation or to write outside the
--                     window.
--
-- **The window is computed, never stored** (I-9). A boolean written at 09:00
-- is a lie at 09:01; `wa_conversation_window` derives it from
-- `last_inbound_at` on every read, and `wa-send` re-derives it server-side
-- before it will post a free-form message.
--
-- **Nothing here sends anything** (I-10). These are tables. The only writer of
-- an outbound row is `wa-send`, which requires a signed-in human's JWT.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- Phone normalisation, shared by the matcher below.
-- The same rule as `src/features/contacts/normalise.ts::normalisePhone` and
-- `src/features/whatsapp/core.ts::normaliseWaId`: Meta sends bare digits
-- (`447700900123`), the donor record holds `+44 7700 900123`, and the two have
-- to meet. UK default dialling code, as everywhere else in this book (02 §6).
-- --------------------------------------------------------------------------

create or replace function public.crm_wa_normalise(p_input text, p_dialling_code text default '44')
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  with raw as (
    select
      btrim(coalesce(p_input, '')) as value
  ), parts as (
    select
      value,
      left(value, 1) = '+' as has_plus,
      regexp_replace(value, '[^0-9]', '', 'g') as digits
    from raw
  )
  select case
    when digits = '' then null
    when has_plus then '+' || digits
    when digits like '00%'
      then '+' || coalesce(nullif(ltrim(substr(digits, 3), '0'), ''), substr(digits, 3))
    when digits like '0%' then '+' || p_dialling_code || ltrim(digits, '0')
    when digits like p_dialling_code || '%' then '+' || digits
    else '+' || p_dialling_code || digits
  end
  from parts
$$;

comment on function public.crm_wa_normalise(text, text) is
  'Phone/wa_id to E.164 by the same rule as features/contacts/normalise.ts (02 §6, 10 §2).';

-- --------------------------------------------------------------------------
-- wa_conversations
-- --------------------------------------------------------------------------

create table if not exists public.wa_conversations (
  id              uuid primary key default gen_random_uuid(),
  -- E.164, normalised by the trigger below. One row per number, forever.
  wa_id           text not null unique,
  -- Meta's WhatsApp profile name. Free, unverified, and the only name we have
  -- until the number is matched to a donor — shown behind the contact chip.
  profile_name    text,
  -- Nullable on purpose: an unmatched conversation is a normal state, not an
  -- error. `on delete set null` so archiving donor data never loses the thread.
  contact_id      uuid references public.contacts (id) on delete set null,
  matched_by      text check (matched_by in ('whatsapp', 'phone', 'manual')),
  -- THE compliance fact. Bumped only by an inbound message.
  last_inbound_at timestamptz,
  last_message_at timestamptz,
  unread_count    integer not null default 0 check (unread_count >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.wa_conversations is
  'One WhatsApp thread per wa_id (10 §2 Tier 2). last_inbound_at is the basis of the 24-hour service window; the window itself is never stored.';
comment on column public.wa_conversations.last_inbound_at is
  'When the donor last messaged us. Free-form replies are permitted for 24 hours from this instant and no longer.';
comment on column public.wa_conversations.matched_by is
  'whatsapp | phone = matched automatically against contacts on insert; manual = a human linked it.';

-- --------------------------------------------------------------------------
-- wa_messages
-- --------------------------------------------------------------------------

create table if not exists public.wa_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.wa_conversations (id) on delete cascade,
  direction       text not null check (direction in ('in', 'out')),
  -- Meta's `wamid…`. UNIQUE, and nullable so a row without one is still legal:
  -- Postgres allows many NULLs under a unique constraint, which is exactly the
  -- "unique when present" the webhook needs for its idempotent upsert. Meta
  -- retries a webhook it did not get a 200 from, so the same message arrives
  -- more than once as a matter of course, not as an exception.
  wa_message_id   text unique,
  msg_type        text not null default 'text'
                    check (msg_type in ('text', 'template', 'media', 'unsupported')),
  body            text,
  -- Media is recorded by reference, never downloaded: a Cloud API media id is
  -- exchanged for a short-lived URL at view time, so we keep the id and the
  -- type and store no donor media at all (I-13).
  media_id        text,
  media_mime      text,
  media_url       text,
  template_name   text,
  status          text not null default 'received'
                    check (status in ('received', 'sent', 'delivered', 'read', 'failed')),
  error_detail    text,
  occurred_at     timestamptz not null default now(),
  -- Who pressed send. Null for everything inbound — and the column exists to
  -- make I-10 legible in the data: every outbound row names a human.
  sent_by         uuid references public.team_members (id) on delete set null,
  created_at      timestamptz not null default now()
);

comment on table public.wa_messages is
  'WhatsApp thread messages (10 §2). Idempotent on wa_message_id; status walks sent → delivered → read, or failed.';
comment on column public.wa_messages.sent_by is
  'The human who sent it (I-10 — automations create tasks and flags, humans send messages). Null inbound.';

create index if not exists wa_messages_conversation_time_idx
  on public.wa_messages (conversation_id, occurred_at desc);
create index if not exists wa_messages_status_idx
  on public.wa_messages (wa_message_id) where wa_message_id is not null;

-- The list reads unread first and then by recency; most threads are read, so
-- the attention index is partial.
create index if not exists wa_conversations_unread_idx
  on public.wa_conversations (unread_count desc, last_message_at desc) where unread_count > 0;
create index if not exists wa_conversations_recent_idx
  on public.wa_conversations (last_message_at desc nulls last);
create index if not exists wa_conversations_contact_idx
  on public.wa_conversations (contact_id) where contact_id is not null;

-- --------------------------------------------------------------------------
-- wa_templates — the approved catalogue, synced from Meta (read-only truth:
-- approval happens in Meta Business Manager, never here).
-- --------------------------------------------------------------------------

create table if not exists public.wa_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  language    text not null default 'en_GB',
  category    text,
  body        text,
  -- Meta's own status: APPROVED / PENDING / REJECTED / PAUSED / DISABLED.
  status      text not null default 'PENDING',
  synced_at   timestamptz not null default now(),
  unique (name, language)
);

comment on table public.wa_templates is
  'Approved message templates synced from Meta (10 §2). Approval is a Business Manager workflow; this table only mirrors it.';

create index if not exists wa_templates_status_idx on public.wa_templates (status, name);

-- --------------------------------------------------------------------------
-- The matcher. BEFORE INSERT on a conversation: normalise the wa_id, then try
-- the donor's WhatsApp number, then their phone. First match wins and records
-- *how* it matched, so an unmatched or wrongly matched thread is a visible
-- fact on screen rather than a guess buried in a join.
--
-- A human linking a conversation afterwards sets `matched_by = 'manual'` from
-- the app; this trigger never overwrites a contact_id that was supplied.
-- --------------------------------------------------------------------------

create or replace function public.wa_conversations_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_normalised text;
  v_contact    uuid;
begin
  v_normalised := public.crm_wa_normalise(new.wa_id);
  if v_normalised is not null then
    new.wa_id := v_normalised;
  end if;

  if new.contact_id is not null then
    new.matched_by := coalesce(new.matched_by, 'manual');
    return new;
  end if;

  select c.id into v_contact
  from public.contacts c
  where c.is_archived = false
    and c.whatsapp is not null
    and public.crm_wa_normalise(c.whatsapp) = new.wa_id
  order by c.created_at
  limit 1;

  if v_contact is not null then
    new.contact_id := v_contact;
    new.matched_by := 'whatsapp';
    return new;
  end if;

  select c.id into v_contact
  from public.contacts c
  where c.is_archived = false
    and c.phone is not null
    and public.crm_wa_normalise(c.phone) = new.wa_id
  order by c.created_at
  limit 1;

  if v_contact is not null then
    new.contact_id := v_contact;
    new.matched_by := 'phone';
  end if;

  return new;
end $$;

drop trigger if exists trg_wa_conversations_match on public.wa_conversations;
create trigger trg_wa_conversations_match
  before insert on public.wa_conversations
  for each row execute function public.wa_conversations_before_insert();

drop trigger if exists trg_wa_conversations_touch on public.wa_conversations;
create trigger trg_wa_conversations_touch
  before update on public.wa_conversations
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------------------
-- The window, as a view. Computed on every read from last_inbound_at; there is
-- no column anywhere that says "open" (I-9). `security_invoker = true` so the
-- caller's own RLS on wa_conversations applies — this view widens nothing.
-- --------------------------------------------------------------------------

create or replace view public.wa_conversation_window
  with (security_invoker = true) as
select
  c.id                                            as conversation_id,
  c.wa_id,
  c.contact_id,
  c.last_inbound_at,
  (c.last_inbound_at is not null
    and c.last_inbound_at > now() - interval '24 hours')  as window_open,
  case when c.last_inbound_at is null then null
       else c.last_inbound_at + interval '24 hours' end   as window_expires_at
from public.wa_conversations c;

comment on view public.wa_conversation_window is
  'The 24-hour customer-service window, derived from last_inbound_at on every read (10 §2, I-9). Free-form outside it is forbidden.';

-- --------------------------------------------------------------------------
-- RLS — the house matrix (11 §1 / 002_rls.sql):
--   select  any active team member
--   insert  admin + fundraiser
--   update  admin + fundraiser   (opening a thread clears unread_count)
--   delete  admin
-- The webhook writes with the service-role key, which bypasses RLS — it has no
-- user to be. `wa-send` writes with the *caller's* JWT and is therefore held to
-- exactly these policies, which is the point.
-- --------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['wa_conversations', 'wa_messages', 'wa_templates']
  loop
    execute format('alter table public.%I enable row level security', t);

    if not exists (select 1 from pg_policies
                   where schemaname = 'public' and tablename = t and policyname = t || '_sel') then
      execute format(
        'create policy %I on public.%I for select to authenticated using (public.crm_is_member())',
        t || '_sel', t);
    end if;

    if not exists (select 1 from pg_policies
                   where schemaname = 'public' and tablename = t and policyname = t || '_ins') then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (public.crm_role() in (''admin'',''fundraiser''))',
        t || '_ins', t);
    end if;

    if not exists (select 1 from pg_policies
                   where schemaname = 'public' and tablename = t and policyname = t || '_upd') then
      execute format(
        'create policy %I on public.%I for update to authenticated using (public.crm_role() in (''admin'',''fundraiser'')) with check (public.crm_role() in (''admin'',''fundraiser''))',
        t || '_upd', t);
    end if;

    if not exists (select 1 from pg_policies
                   where schemaname = 'public' and tablename = t and policyname = t || '_del') then
      execute format(
        'create policy %I on public.%I for delete to authenticated using (public.crm_role() = ''admin'')',
        t || '_del', t);
    end if;

    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

revoke all on public.wa_conversation_window from anon;
grant select on public.wa_conversation_window to authenticated, service_role;

-- --------------------------------------------------------------------------
-- Function hardening, the 005b / 007b rule: PostgREST publishes every function
-- in `public` as /rest/v1/rpc/<name> and Postgres grants EXECUTE to PUBLIC by
-- default. The trigger function is never called directly (a trigger's
-- privilege check happens when it is created), and the normaliser is a pure
-- text function a signed-in member may as well have — but never `anon`.
-- --------------------------------------------------------------------------

revoke all on function public.wa_conversations_before_insert() from public, anon, authenticated;

revoke all on function public.crm_wa_normalise(text, text) from public, anon;
grant execute on function public.crm_wa_normalise(text, text) to authenticated, service_role;
