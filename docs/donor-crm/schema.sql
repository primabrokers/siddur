-- ============================================================================
-- Yeshiva Donor & Fundraising CRM — DRAFT Postgres schema (for review)
-- ============================================================================
-- Status: proposal accompanying BUILD_PLAN.md. Not applied anywhere.
-- Target: a NEW dedicated Supabase project (eu-west-2 / London), Postgres 17.
-- Phase 2 tables are marked; everything else is Phase 0/1.
--
-- Conventions:
--   * All dropdown values live in lookup_options (configurable, never enums).
--   * Derived numbers (lifetime giving, days since contact, KIT due) are
--     views — never stored columns.
--   * RLS on every table; policies sketched at the bottom.
-- ============================================================================

create extension if not exists pg_trgm;      -- fuzzy search on names/phones
create extension if not exists pg_cron;      -- nightly automation run

-- ---------------------------------------------------------------------------
-- Team & configuration
-- ---------------------------------------------------------------------------

create table team_members (
  id           uuid primary key references auth.users (id) on delete cascade,
  full_name    text not null,
  email        text not null,
  role         text not null check (role in ('admin', 'fundraiser', 'viewer')),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- One table for every configurable dropdown (brief §5, §25):
--   list_name ∈ stage | priority | tier | classification | interaction_kind |
--               action_type | task_status | payment_method | contact_kind |
--               engagement_level | note_category | document_kind | ...
-- meta examples: {"meaningful": true} on interaction kinds;
--                {"active_pipeline": true} on stages that count as "active".
create table lookup_options (
  id          uuid primary key default gen_random_uuid(),
  list_name   text not null,
  value       text not null,
  label       text not null,
  sort_order  int  not null default 0,
  color       text,
  is_active   boolean not null default true,
  meta        jsonb not null default '{}',
  unique (list_name, value)
);

-- Every automation's switch + timing (brief §22), e.g.:
--   ('thank_you_on_donation',   {"enabled":true})
--   ('pledge_chase',            {"enabled":true,"after_days":[14,30],"then_every_days":30})
--   ('proposal_follow_up',      {"enabled":true,"after_days":7})
--   ('neglect_thresholds',      {"high_priority":30,"active_donor":60,"vip":90})
--   ('meeting_reminder',        {"enabled":true,"days_before":1})
create table automation_rules (
  rule_key    text primary key,
  is_enabled  boolean not null default true,
  params      jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Contacts — the central profile (brief §3, §4, §6, §7, §12, §14)
-- ---------------------------------------------------------------------------

create table contacts (
  id                      uuid primary key default gen_random_uuid(),

  -- identity (§3)
  first_name              text not null,
  last_name               text not null default '',
  organization            text,
  position                text,
  industry                text,
  contact_kind            text not null default 'individual',  -- individual/business/foundation/trust
  photo_url               text,

  -- communication (§3)
  email                   text,
  phone                   text,          -- stored E.164-normalised
  whatsapp                text,          -- E.164; defaults to phone in the UI
  preferred_language      text,
  preferred_channel       text,          -- lookup: action_type-ish (call/whatsapp/email/...)
  best_time_to_contact    text,
  assistant_name          text,
  assistant_contact       text,
  linkedin_url            text,
  website_url             text,

  -- address (§3; house no. + postcode also serve Gift Aid claims)
  address_line1           text,
  address_line2           text,
  city                    text,
  postcode                text,
  country                 text default 'United Kingdom',

  -- relationship intelligence (§4, §14)
  source                  text,
  introduced_by_id        uuid references contacts (id),
  introduced_by_note      text,          -- for introducers who aren't contacts
  relationship_owner_id   uuid references team_members (id),
  relationship_strength   smallint check (relationship_strength between 1 and 10),
  engagement_level        text,
  known_since             date,
  communities             text[] not null default '{}',
  interests               text[] not null default '{}',
  preferred_causes        text[] not null default '{}',
  mutual_connections      text,
  birthday                date,
  spouse_name             text,
  family_notes            text,
  things_to_remember      text,
  general_notes           text,

  -- classification (§5, §6)
  stage                   text not null default 'prospect',
  priority                text not null default 'medium',
  tier                    text,                                -- A/B/C/D
  classifications         text[] not null default '{}',        -- VIP, Major Donor, ...

  -- potential (§7; per-ask detail lives in opportunities)
  estimated_capacity      numeric(12,2),

  -- keep in touch (§12)
  contact_frequency_days  int,           -- null = no KIT schedule
  kit_paused_until        date,          -- snooze without losing the frequency

  -- lifecycle & data quality (§25)
  is_archived             boolean not null default false,
  merged_into_id          uuid references contacts (id),  -- duplicate-merge tombstone
  created_by              uuid references team_members (id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index contacts_name_trgm  on contacts using gin ((first_name || ' ' || last_name) gin_trgm_ops);
create index contacts_org_trgm   on contacts using gin (coalesce(organization, '') gin_trgm_ops);
create index contacts_phone_idx  on contacts (phone);
create index contacts_email_idx  on contacts (lower(email));
create index contacts_stage_idx  on contacts (stage) where not is_archived;

-- ---------------------------------------------------------------------------
-- Interactions — the timeline (brief §9), meetings included (§17)
-- ---------------------------------------------------------------------------
-- A scheduled meeting is an interaction with status='scheduled' and a future
-- occurred_at; completing it is an UPDATE, so the timeline never duplicates.

create table interactions (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid not null references contacts (id),
  occurred_at     timestamptz not null,
  kind            text not null,                    -- lookup interaction_kind
  status          text not null default 'logged'
                    check (status in ('logged', 'scheduled', 'cancelled')),
  team_member_id  uuid references team_members (id),
  summary         text not null,
  outcome         text,
  is_meaningful   boolean not null default true,    -- feeds the KIT clock (§12, §13)

  -- meeting-specific, nullable (§17)
  location        text,
  attendees       text,
  purpose         text,
  ask_amount      numeric(12,2),

  -- provenance (§7 of the plan: AI guardrails)
  source          text not null default 'manual',   -- manual | quick_capture_ai | email_ingest
  ai_raw_input    text,                             -- original dictation, kept verbatim

  created_by      uuid references team_members (id),
  created_at      timestamptz not null default now()
);

create index interactions_contact_time_idx on interactions (contact_id, occurred_at desc);
create index interactions_scheduled_idx    on interactions (occurred_at) where status = 'scheduled';

-- ---------------------------------------------------------------------------
-- Donations & pledges (brief §8, §11)
-- ---------------------------------------------------------------------------
-- A pledge is a donation with status='pledged'. Payments against it are their
-- own 'received' rows linking back via pledge_id, so partial payment works.

create table campaigns (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  kind         text not null default 'project' check (kind in ('campaign', 'project')),
  description  text,
  goal_amount  numeric(12,2),
  starts_on    date,
  ends_on      date,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table donations (
  id               uuid primary key default gen_random_uuid(),
  contact_id       uuid not null references contacts (id),
  donated_on       date not null,
  amount           numeric(12,2) not null check (amount > 0),
  currency         text not null default 'GBP',
  amount_gbp       numeric(12,2) not null,          -- converted at entry; = amount when GBP
  campaign_id      uuid references campaigns (id),
  purpose          text,
  payment_method   text,                            -- lookup payment_method
  status           text not null default 'received'
                     check (status in ('pledged', 'received', 'cancelled')),
  pledge_id        uuid references donations (id),  -- payment fulfilling a pledge
  expected_on      date,                            -- for pledges
  receipt_status   text not null default 'not_sent',
  thank_you_status text not null default 'not_done',
  gift_aid_eligible boolean not null default false,
  gift_aid_claim_id uuid,                           -- fk added after gift_aid_claims
  notes            text,
  created_by       uuid references team_members (id),
  created_at       timestamptz not null default now()
);

create index donations_contact_idx  on donations (contact_id, donated_on desc);
create index donations_pledge_idx   on donations (pledge_id) where pledge_id is not null;
create index donations_campaign_idx on donations (campaign_id);

-- ---------------------------------------------------------------------------
-- Gift Aid (UK — recommended addition, plan §9)
-- ---------------------------------------------------------------------------

create table gift_aid_declarations (
  id             uuid primary key default gen_random_uuid(),
  contact_id     uuid not null references contacts (id),
  declared_on    date not null,
  method         text not null check (method in ('written', 'oral', 'online')),
  covers_past    boolean not null default true,     -- HMRC: may cover 4 prior years
  covers_future  boolean not null default true,
  cancelled_on   date,
  evidence_url   text,                              -- scan / recording reference
  created_at     timestamptz not null default now()
);

create table gift_aid_claims (
  id             uuid primary key default gen_random_uuid(),
  submitted_on   date,
  hmrc_reference text,
  status         text not null default 'draft' check (status in ('draft', 'submitted', 'paid')),
  total_donations numeric(12,2),
  total_claimed   numeric(12,2),
  created_at     timestamptz not null default now()
);

alter table donations
  add constraint donations_gift_aid_claim_fk
  foreign key (gift_aid_claim_id) references gift_aid_claims (id);

-- ---------------------------------------------------------------------------
-- Tasks & next actions (brief §10, §16)
-- ---------------------------------------------------------------------------
-- "Overdue" is never stored — it's due_on < current_date on an open task.

create table tasks (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid references contacts (id),      -- nullable: general tasks
  title         text not null,
  action_type   text,                               -- lookup action_type (§10)
  details       text,
  assigned_to   uuid references team_members (id),
  due_on        date,
  priority      text not null default 'medium',
  status        text not null default 'todo'
                  check (status in ('todo', 'in_progress', 'waiting', 'done', 'cancelled')),
  completed_at  timestamptz,
  origin        text not null default 'manual',
                  -- manual | quick_capture_ai | auto:kit | auto:thank_you |
                  -- auto:pledge_chase | auto:proposal_follow_up | auto:meeting_reminder
  created_by    uuid references team_members (id),
  created_at    timestamptz not null default now()
);

create index tasks_open_due_idx     on tasks (due_on) where status in ('todo', 'in_progress', 'waiting');
create index tasks_contact_open_idx on tasks (contact_id) where status in ('todo', 'in_progress', 'waiting');

-- ---------------------------------------------------------------------------
-- Opportunities / asks — the pipeline (brief §7)                    [PHASE 2]
-- ---------------------------------------------------------------------------

create table opportunities (
  id                    uuid primary key default gen_random_uuid(),
  contact_id            uuid not null references contacts (id),
  name                  text not null,
  campaign_id           uuid references campaigns (id),
  ask_amount            numeric(12,2),
  probability_pct       smallint check (probability_pct between 0 and 100),
  expected_amount       numeric(12,2),               -- defaults to ask × probability in UI
  stage                 text not null default 'identified',  -- lookup opportunity_stage
  expected_decision_on  date,
  motivation            text,
  restrictions          text,
  status                text not null default 'open'
                          check (status in ('open', 'won', 'lost', 'on_hold')),
  opened_on             date not null default current_date,
  closed_on             date,
  notes                 text,
  created_at            timestamptz not null default now()
);

create index opportunities_open_idx on opportunities (contact_id) where status = 'open';

-- ---------------------------------------------------------------------------
-- Notes & documents (brief §15, §18)
-- ---------------------------------------------------------------------------

create table notes (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references contacts (id),
  category    text,                                  -- lookup note_category
  body        text not null,
  is_private  boolean not null default false,        -- RLS-enforced (§26)
  created_by  uuid not null references team_members (id),
  created_at  timestamptz not null default now()
);

create table documents (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references contacts (id),
  title         text not null,
  kind          text,                                -- lookup document_kind
  url           text,                                -- external (Google Drive) ...
  storage_path  text,                                -- ... or Supabase Storage upload
  uploaded_by   uuid references team_members (id),
  created_at    timestamptz not null default now(),
  check (url is not null or storage_path is not null)
);

-- ---------------------------------------------------------------------------
-- Audit trail (brief §25, §26)
-- ---------------------------------------------------------------------------

create table audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   uuid not null,
  action      text not null check (action in ('insert', 'update', 'delete')),
  changed_by  uuid,
  changed_at  timestamptz not null default now(),
  old_values  jsonb,
  new_values  jsonb
);
-- Populated by a shared trigger on contacts / interactions / donations /
-- tasks / notes / opportunities (trigger function omitted in this draft).

-- ---------------------------------------------------------------------------
-- Derived data — the views the whole app reads (plan §4.2, §5)
-- ---------------------------------------------------------------------------

-- Per-contact rollups: giving stats (§8), recency (§13), KIT due (§12),
-- and the current next action (§10). Sketch — the real thing will be tuned.
create view contact_stats as
select
  c.id as contact_id,

  -- giving (§8)
  g.lifetime_giving,
  g.giving_this_year,
  g.giving_last_year,
  g.donation_count,
  g.largest_donation,
  g.average_donation,
  g.first_donation_on,
  g.last_donation_on,
  g.last_donation_amount,
  (g.giving_last_year > 0 and coalesce(g.giving_this_year, 0) = 0) as is_lybunt,

  -- recency (§13) — meaningful, logged interactions only
  i.last_contact_at,
  i.last_contact_kind,
  (current_date - i.last_contact_at::date) as days_since_contact,

  -- keep in touch (§12)
  case
    when c.contact_frequency_days is null then null
    else greatest(
      coalesce(i.last_contact_at::date, c.created_at::date) + c.contact_frequency_days,
      coalesce(c.kit_paused_until, '-infinity'::date)
    )
  end as kit_due_on,

  -- next action (§10): the earliest open task
  t.next_task_id,
  t.next_task_title,
  t.next_task_due_on

from contacts c
left join lateral (
  select
    sum(amount_gbp) filter (where status = 'received')                                   as lifetime_giving,
    sum(amount_gbp) filter (where status = 'received'
      and date_trunc('year', donated_on) = date_trunc('year', current_date))             as giving_this_year,
    sum(amount_gbp) filter (where status = 'received'
      and date_trunc('year', donated_on) = date_trunc('year', current_date) - interval '1 year') as giving_last_year,
    count(*)        filter (where status = 'received')                                   as donation_count,
    max(amount_gbp) filter (where status = 'received')                                   as largest_donation,
    avg(amount_gbp) filter (where status = 'received')                                   as average_donation,
    min(donated_on) filter (where status = 'received')                                   as first_donation_on,
    max(donated_on) filter (where status = 'received')                                   as last_donation_on,
    (array_agg(amount_gbp order by donated_on desc) filter (where status = 'received'))[1] as last_donation_amount
  from donations d where d.contact_id = c.id
) g on true
left join lateral (
  select occurred_at as last_contact_at, kind as last_contact_kind
  from interactions
  where contact_id = c.id and status = 'logged' and is_meaningful
  order by occurred_at desc limit 1
) i on true
left join lateral (
  select id as next_task_id, title as next_task_title, due_on as next_task_due_on
  from tasks
  where contact_id = c.id and status in ('todo', 'in_progress', 'waiting')
  order by due_on nulls last, priority limit 1
) t on true
where c.merged_into_id is null;

-- ---------------------------------------------------------------------------
-- Row Level Security — sketch (full policies written in Phase 0)
-- ---------------------------------------------------------------------------
-- Principles (plan §10):
--   * Every table: RLS ENABLED; access only for active team_members.
--   * viewer  : SELECT only; donations via a view without amounts (or column
--               privileges), notes only where is_private = false.
--   * fundraiser: full read; INSERT/UPDATE on contacts, interactions,
--               donations, tasks, notes, documents; no DELETE, no exports.
--   * admin   : everything, including lookup_options, automation_rules,
--               team_members, merges and deletes.
--   * notes.is_private = true visible only to author and admins — enforced
--     here, not in the UI.
--
-- Example shape:
--   alter table notes enable row level security;
--   create policy notes_read on notes for select using (
--     not is_private
--     or created_by = auth.uid()
--     or exists (select 1 from team_members m
--                where m.id = auth.uid() and m.role = 'admin' and m.is_active)
--   );

-- ---------------------------------------------------------------------------
-- Nightly automation (plan §6) — pg_cron at 05:00 UTC
-- ---------------------------------------------------------------------------
-- select cron.schedule('crm-nightly', '0 5 * * *', $$ select run_nightly_automations() $$);
-- run_nightly_automations() reads automation_rules and:
--   1. creates KIT tasks where contact_stats.kit_due_on < current_date
--      and no open auto:kit task exists;
--   2. creates proposal follow-up tasks (stage = proposal_sent, quiet > N days);
--   3. creates pledge-chase tasks per the configured intervals;
--   4. refreshes the neglect-flag list for the dashboard;
--   5. creates meeting-reminder tasks for tomorrow's scheduled interactions.
-- It never sends external messages and never updates "overdue" flags —
-- overdue is computed in queries.
