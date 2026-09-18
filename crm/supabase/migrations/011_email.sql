-- ==========================================================================
-- 011_email — the email inbox (spec 10 §3, upgraded from the dropbox tier on
--             the user's explicit request, 2026-09-18).
--
-- Two tables and one trigger, and the trigger is the whole design:
--
--   · `emails` is a *folder-based* store (inbox / sent / archive / trash), not
--     a shadow timeline. An email becomes a CRM record only when a human logs
--     it — that write goes to `interactions` like every other one (10 §1: "no
--     shadow inboxes").
--
--   · `emails_before_insert()` does the three things that must be decided the
--     same way whoever writes the row — the inbound webhook (service role), the
--     send function (the fundraiser's own token) or a hand-written fixture:
--       1. thread_key   — chain first (In-Reply-To → the parent's key),
--                         normalised subject + counterpart second;
--       2. contact_id   — the counterpart address matched against
--                         `contacts.email`, case- and plus-address-insensitive;
--       3. snippet      — the first 200 characters, so no list query has to
--                         pull message bodies.
--     `src/features/comms/core.ts` is the byte-identical JavaScript of the
--     same three rules, mirrored into both edge functions.
--
--   · Attachments are metadata rows pointing at a **private** storage bucket.
--     Anything over 10MB is recorded by name and not stored (10 §1:
--     integrations never become load-bearing).
--
-- RLS follows the 11 §1 matrix exactly: members read, admin+fundraiser write
-- (including folder moves, which are updates), hard DELETE is admin-only.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- Address helpers. Two of them, because the two jobs genuinely differ:
--   crm_email_addr() — the addr-spec, for storage and display
--   crm_email_key()  — the *comparison* key: plus-tag stripped, for matching
-- --------------------------------------------------------------------------

create or replace function public.crm_email_addr(p_raw text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select nullif(
    lower(btrim(coalesce(substring(p_raw from '<([^<>]*)>'), p_raw, ''))),
    ''
  )
$$;

comment on function public.crm_email_addr(text) is
  '"Dovid Cohen <D.Cohen@Example.com>" -> "d.cohen@example.com". Display name dropped, case folded.';

create or replace function public.crm_email_key(p_raw text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
           when a is null then null
           when position('@' in a) = 0 then a
           else regexp_replace(split_part(a, '@', 1), '\+.*$', '')
                || '@' || substring(a from position('@' in a) + 1)
         end
  from (select public.crm_email_addr(p_raw) as a) s
$$;

comment on function public.crm_email_key(text) is
  'Matching key: addr-spec, lowercased, plus-addressing removed. donor+crm@x.com = donor@x.com.';

-- --------------------------------------------------------------------------
-- Subject normalisation: strip every stacked Re:/Fwd: prefix. Mirrors
-- normaliseSubject() in src/features/comms/core.ts.
-- --------------------------------------------------------------------------

create or replace function public.crm_email_subject_key(p_subject text)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_value text;
  v_prev  text;
begin
  v_value := lower(btrim(regexp_replace(coalesce(p_subject, ''), '\s+', ' ', 'g')));
  for i in 1..12 loop
    v_prev := v_value;
    v_value := btrim(regexp_replace(v_value, '^(re|fw|fwd|aw|sv|antwort|tr)\s*(\[[0-9]+\])?\s*:\s*', '', 'i'));
    exit when v_value = v_prev;
  end loop;
  return v_value;
end
$$;

-- --------------------------------------------------------------------------
-- emails
-- --------------------------------------------------------------------------

create table if not exists public.emails (
  id                  uuid primary key default gen_random_uuid(),

  folder              text not null default 'inbox'
                      check (folder in ('inbox', 'sent', 'archive', 'trash')),
  direction           text not null
                      check (direction in ('in', 'out')),

  -- Raw header values: the display name is worth keeping for the list rows.
  -- Matching never reads these directly, only crm_email_key() of them.
  from_addr           text not null,
  to_addrs            text[] not null default '{}',
  cc_addrs            text[] not null default '{}',

  subject             text,
  body_text           text,
  body_html           text,
  snippet             text,

  -- The provider's own id. Unique *when present* (a hand-written row has
  -- none), which is what makes the inbound webhook safely retryable.
  provider_message_id text,
  -- RFC 5322 Message-ID / In-Reply-To — the chain the threader walks.
  rfc_message_id      text,
  in_reply_to         text,
  thread_key          text,

  contact_id          uuid references public.contacts (id) on delete set null,
  matched_by          text check (matched_by in ('from_addr', 'to_addr', 'manual')),

  read_at             timestamptz,
  sent_by             uuid references public.team_members (id) on delete set null,

  occurred_at         timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

comment on table public.emails is
  'Folder-based email store (10 §3). Logging one to the timeline writes an interactions row; this table is never a shadow timeline.';
comment on column public.emails.thread_key is
  'Conversation id: the parent''s key when In-Reply-To names a message on file, else subj:<normalised subject>|<counterpart>.';
comment on column public.emails.matched_by is
  'How contact_id was set: from_addr (inbound), to_addr (outbound), manual (a human linked it).';

create unique index if not exists emails_provider_message_id_key
  on public.emails (provider_message_id) where provider_message_id is not null;

create index if not exists emails_folder_occurred_idx
  on public.emails (folder, occurred_at desc);
create index if not exists emails_thread_key_idx
  on public.emails (thread_key);
create index if not exists emails_contact_idx
  on public.emails (contact_id) where contact_id is not null;
-- The rail's unread badge, and the only query that runs on every page load.
create index if not exists emails_unread_idx
  on public.emails (occurred_at desc)
  where read_at is null and direction = 'in' and folder = 'inbox';
-- The threader's chain lookup.
create index if not exists emails_rfc_message_id_idx
  on public.emails (rfc_message_id) where rfc_message_id is not null;

-- --------------------------------------------------------------------------
-- The thread key. Chain first, subject second (see the header).
-- --------------------------------------------------------------------------

create or replace function public.crm_email_thread_key(
  p_in_reply_to text,
  p_subject     text,
  p_counterpart text,
  p_id          uuid
)
returns text
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_parent      text;
  v_subject     text;
  v_counterpart text;
  v_chain       text;
begin
  v_chain := nullif(btrim(coalesce(p_in_reply_to, '')), '');

  -- A message that names its parent inherits the parent's key outright, so a
  -- conversation whose subject drifts stays one thread.
  if v_chain is not null then
    select e.thread_key
      into v_parent
      from public.emails e
     where e.rfc_message_id = v_chain
       and e.thread_key is not null
     order by e.occurred_at asc
     limit 1;
    if v_parent is not null then
      return v_parent;
    end if;
  end if;

  v_subject     := public.crm_email_subject_key(p_subject);
  v_counterpart := coalesce(public.crm_email_key(p_counterpart), '');

  if v_subject = '' and v_counterpart = '' then
    if v_chain is not null then
      return 'chain:' || v_chain;
    end if;
    return 'thread:' || coalesce(p_id::text, 'unknown');
  end if;

  return 'subj:' || v_subject || '|' || v_counterpart;
end
$$;

-- --------------------------------------------------------------------------
-- BEFORE INSERT: thread, match, snippet.
--
-- SECURITY DEFINER on purpose, for the same reason the 005b hardening note
-- gives: the helpers above are revoked from `authenticated`, and a privilege
-- check inside a DEFINER function is made against the definer. The contact
-- lookup it performs reads only `contacts.id/email`, which every team member
-- may already read (11 §1) — so this grants nobody anything new.
-- --------------------------------------------------------------------------

create or replace function public.emails_before_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_counterpart text;
  v_key         text;
  v_contact     uuid;
begin
  if new.direction = 'in' then
    v_counterpart := new.from_addr;
  else
    v_counterpart := (new.to_addrs)[1];
  end if;

  if new.thread_key is null or btrim(new.thread_key) = '' then
    new.thread_key := public.crm_email_thread_key(
      new.in_reply_to, new.subject, v_counterpart, new.id
    );
  end if;

  if new.contact_id is null then
    v_key := public.crm_email_key(v_counterpart);
    if v_key is not null then
      select c.id
        into v_contact
        from public.contacts c
       where c.email is not null
         and public.crm_email_key(c.email) = v_key
         and coalesce(c.is_archived, false) = false
         and c.merged_into_id is null
       order by c.created_at asc
       limit 1;

      if v_contact is not null then
        new.contact_id := v_contact;
        new.matched_by := case when new.direction = 'in' then 'from_addr' else 'to_addr' end;
      end if;
    end if;
  elsif new.matched_by is null then
    -- A caller that supplied the contact itself said so by doing it.
    new.matched_by := 'manual';
  end if;

  if new.snippet is null or btrim(new.snippet) = '' then
    new.snippet := left(btrim(regexp_replace(coalesce(new.body_text, ''), '\s+', ' ', 'g')), 200);
  end if;

  return new;
end
$$;

drop trigger if exists emails_before_insert on public.emails;
create trigger emails_before_insert
  before insert on public.emails
  for each row execute function public.emails_before_insert();

-- --------------------------------------------------------------------------
-- email_attachments
-- --------------------------------------------------------------------------

create table if not exists public.email_attachments (
  id           uuid primary key default gen_random_uuid(),
  email_id     uuid not null references public.emails (id) on delete cascade,
  filename     text not null,
  content_type text,
  size_bytes   bigint,
  -- One of these two, or neither: an oversized attachment is recorded by name
  -- so the reading pane can say it exists and where it is not.
  storage_path text,
  external_url text,
  created_at   timestamptz not null default now()
);

comment on table public.email_attachments is
  'Attachment metadata. Files live in the private `email-attachments` bucket; anything over 10MB is recorded by name only.';

create index if not exists email_attachments_email_idx
  on public.email_attachments (email_id);

-- --------------------------------------------------------------------------
-- RLS — the 11 §1 matrix rows for email.
--   select  any active team member
--   insert  admin + fundraiser (the send function runs as the caller)
--   update  admin + fundraiser (folder moves, read_at, contact links)
--   delete  admin only (Trash is a folder; DELETE is the irreversible one)
-- --------------------------------------------------------------------------

alter table public.emails            enable row level security;
alter table public.email_attachments enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'emails' and policyname = 'emails_sel') then
    create policy emails_sel on public.emails
      for select to authenticated using (public.crm_is_member());
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'emails' and policyname = 'emails_ins') then
    create policy emails_ins on public.emails
      for insert to authenticated
      with check (public.crm_role() in ('admin', 'fundraiser'));
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'emails' and policyname = 'emails_upd') then
    create policy emails_upd on public.emails
      for update to authenticated
      using (public.crm_role() in ('admin', 'fundraiser'))
      with check (public.crm_role() in ('admin', 'fundraiser'));
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'emails' and policyname = 'emails_del') then
    create policy emails_del on public.emails
      for delete to authenticated using (public.crm_role() = 'admin');
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'email_attachments'
                   and policyname = 'email_attachments_sel') then
    create policy email_attachments_sel on public.email_attachments
      for select to authenticated using (public.crm_is_member());
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'email_attachments'
                   and policyname = 'email_attachments_ins') then
    create policy email_attachments_ins on public.email_attachments
      for insert to authenticated
      with check (public.crm_role() in ('admin', 'fundraiser'));
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'email_attachments'
                   and policyname = 'email_attachments_upd') then
    create policy email_attachments_upd on public.email_attachments
      for update to authenticated
      using (public.crm_role() in ('admin', 'fundraiser'))
      with check (public.crm_role() in ('admin', 'fundraiser'));
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'email_attachments'
                   and policyname = 'email_attachments_del') then
    create policy email_attachments_del on public.email_attachments
      for delete to authenticated using (public.crm_role() = 'admin');
  end if;
end $$;

grant select, insert, update, delete on public.emails            to authenticated;
grant select, insert, update, delete on public.email_attachments to authenticated;
grant all on public.emails            to service_role;
grant all on public.email_attachments to service_role;

-- --------------------------------------------------------------------------
-- Function hardening (the 005b rule): PostgREST exposes every public function
-- as an RPC, so everything that is not a policy helper is revoked. The trigger
-- function needs no EXECUTE to fire, and the helpers it calls are checked
-- against its definer.
-- --------------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'emails_before_insert()',
    'crm_email_addr(text)',
    'crm_email_key(text)',
    'crm_email_subject_key(text)',
    'crm_email_thread_key(text, text, text, uuid)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- Storage: a private bucket for inbound attachments.
--
-- Wrapped, because a managed project may not let a migration touch
-- `storage.*`. If this block is skipped the bucket has to be created once from
-- the dashboard or the Storage API with the same name and `public = false`;
-- the Settings card says so.
-- --------------------------------------------------------------------------

do $$
begin
  insert into storage.buckets (id, name, public)
  values ('email-attachments', 'email-attachments', false)
  on conflict (id) do nothing;
exception
  when insufficient_privilege or undefined_table or undefined_column then
    raise notice '011_email: storage bucket email-attachments must be created via the Storage API';
end $$;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'email_attachments_read') then
    create policy email_attachments_read on storage.objects
      for select to authenticated
      using (bucket_id = 'email-attachments' and public.crm_is_member());
  end if;
exception
  when insufficient_privilege or undefined_table then
    raise notice '011_email: storage.objects policy must be added via the dashboard';
end $$;
