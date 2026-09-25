-- ============================================================================
-- Yeshiva Donor CRM — schema v2 (executable form of spec/02-DATA-MODEL.md)
-- ============================================================================
-- Supersedes schema.sql (v1). Greenfield: replaces rather than migrates.
-- Target: dedicated Supabase project (eu-west-2), Postgres 17.
-- Field semantics, lookup seeds and computed-layer rules: spec/02-DATA-MODEL.md.
-- RLS policies: spec/11-PERMISSIONS-NFR.md (sketched at bottom).
-- ============================================================================

create extension if not exists pg_trgm;
create extension if not exists pg_cron;

-- --------------------------------------------------------------------------
-- Team & configuration
-- --------------------------------------------------------------------------

create table team_members (
  id               uuid primary key references auth.users (id) on delete cascade,
  full_name        text not null,
  email            text not null,
  role             text not null check (role in ('admin','fundraiser','viewer')),
  can_see_amounts  boolean not null default false,   -- viewer refinement (11 §2)
  digest_hour      smallint not null default 7,      -- morning digest local hour
  digest_channel   text not null default 'email' check (digest_channel in ('email','none')),
  drafting_examples text,                            -- tone samples for AI drafting (09 §4)
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create table lookup_options (                        -- every dropdown (02 §6)
  id          uuid primary key default gen_random_uuid(),
  list_name   text not null,
  value       text not null,
  label       text not null,
  sort_order  int  not null default 0,
  color       text,
  is_active   boolean not null default true,
  meta        jsonb not null default '{}',           -- e.g. {"meaningful":true,"weight":20}
  unique (list_name, value)
);

create table automation_rules (                      -- every rule switch + params (08 §7)
  rule_key    text primary key,
  is_enabled  boolean not null default true,
  params      jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

create table saved_views (                           -- smart views (D14; 06 §1)
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  entity     text not null check (entity in ('contacts','donations','tasks','opportunities')),
  layout     text not null default 'table' check (layout in ('table','kanban','calendar')),
  filters    jsonb not null default '{}',
  sort       jsonb not null default '{}',
  group_by   text,
  columns    text[] not null default '{}',
  icon       text,
  owner_id   uuid references team_members (id),
  is_shared  boolean not null default true,
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- Households & contacts
-- --------------------------------------------------------------------------

create table households (                            -- D1 (02 §3.13)
  id                 uuid primary key default gen_random_uuid(),
  name               text,                           -- auto unless overridden
  name_is_override   boolean not null default false,
  formal_greeting    text,
  informal_greeting  text,
  hebrew_greeting    text,
  greeting_is_override boolean not null default false,
  primary_contact_id uuid,                           -- fk added after contacts
  created_at         timestamptz not null default now()
);

create table contacts (                              -- 02 §3.1
  id                    uuid primary key default gen_random_uuid(),
  title                 text,
  first_name            text not null,
  last_name             text not null default '',
  hebrew_name           text,
  organization          text,
  position              text,
  industry              text,
  contact_kind          text not null default 'individual',
  is_organisation_self  boolean not null default false,
  photo_url             text,
  household_id          uuid references households (id),

  email                 text,
  phone                 text,                        -- E.164
  whatsapp              text,                        -- E.164
  preferred_language    text not null default 'en',
  preferred_channel     text,
  best_time_to_contact  text,
  assistant_name        text,
  assistant_contact     text,
  linkedin_url          text,
  website_url           text,

  address_line1         text,
  address_line2         text,
  city                  text,
  postcode              text,
  country               text default 'United Kingdom',
  ga_house_no           text,                        -- HMRC CSV override (02 §3.1)

  source                text,
  introduced_by_id      uuid references contacts (id),
  introduced_by_note    text,
  relationship_owner_id uuid references team_members (id),
  relationship_strength smallint check (relationship_strength between 1 and 10),
  known_since           date,
  mutual_connections    text,
  birthday              date,
  spouse_name           text,
  family_notes          text,
  things_to_remember    text,

  stage                 text not null default 'prospect',
  priority              text not null default 'medium',
  tier                  text,
  estimated_capacity    numeric(12,2),

  contact_frequency_days int,
  kit_paused_until      date,

  engagement_score      int,                         -- nightly recompute (02 §4.3)
  engagement_tier       text not null default 'unknown'
                          check (engagement_tier in ('unknown','cold','cool','warm','hot','on_fire')),
  engagement_computed_at timestamptz,
  pinned_note_id        uuid,                        -- fk added after notes

  is_archived           boolean not null default false,
  merged_into_id        uuid references contacts (id),
  created_by            uuid references team_members (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table households
  add constraint households_primary_contact_fk
  foreign key (primary_contact_id) references contacts (id);

create index contacts_name_trgm on contacts using gin ((first_name || ' ' || last_name) gin_trgm_ops);
create index contacts_org_trgm  on contacts using gin (coalesce(organization,'') gin_trgm_ops);
create index contacts_phone_idx on contacts (phone);
create index contacts_email_idx on contacts (lower(email));
create index contacts_stage_idx on contacts (stage) where not is_archived;
create index contacts_household_idx on contacts (household_id);

-- --------------------------------------------------------------------------
-- Tags (D11)
-- --------------------------------------------------------------------------

create table tags (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  category  text not null default 'custom'
              check (category in ('interest','community','cause','classification','rfm_auto','event','custom')),
  color     text,
  is_auto   boolean not null default false,
  auto_rule jsonb,                                   -- saved-view criteria, reapplied nightly
  unique (category, name)
);

create table taggings (
  id          uuid primary key default gen_random_uuid(),
  tag_id      uuid not null references tags (id) on delete cascade,
  contact_id  uuid not null references contacts (id) on delete cascade,
  note        text,
  since       date,
  until       date,
  is_excluded boolean not null default false,        -- suppression flag
  created_at  timestamptz not null default now(),
  unique (tag_id, contact_id)
);

-- --------------------------------------------------------------------------
-- Interactions (timeline) — 02 §3.2
-- --------------------------------------------------------------------------

create table ai_activity_log (                       -- D13 (02 §3.17); created early for fks
  id             uuid primary key default gen_random_uuid(),
  feature        text not null check (feature in
                   ('quick_capture','brief','draft','digest','nl_search','backfill')),
  model          text,
  raw_input      text,
  output         jsonb,
  resolution     text not null default 'pending'
                   check (resolution in ('pending','accepted','edited','rejected','expired')),
  edited_fields  text[],
  latency_ms     int,
  tokens_in      int,
  tokens_out     int,
  team_member_id uuid references team_members (id),
  created_at     timestamptz not null default now()
);

create table interactions (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid not null references contacts (id),
  occurred_at     timestamptz not null,
  kind            text not null,
  status          text not null default 'logged'
                    check (status in ('logged','scheduled','cancelled')),
  team_member_id  uuid references team_members (id),
  summary         text not null,
  outcome         text,
  is_meaningful   boolean not null default true,
  location        text,
  attendees       text,
  purpose         text,
  ask_amount      numeric(12,2),
  source          text not null default 'manual'
                    check (source in ('manual','quick_capture_ai','email_ingest','import')),
  ai_raw_input    text,
  ai_activity_id  uuid references ai_activity_log (id),
  created_by      uuid references team_members (id),
  created_at      timestamptz not null default now()
);

create index interactions_contact_time_idx on interactions (contact_id, occurred_at desc);
create index interactions_scheduled_idx on interactions (occurred_at) where status = 'scheduled';

-- --------------------------------------------------------------------------
-- Money: funds / campaigns / appeals / donations / pledges / recurring
-- --------------------------------------------------------------------------

create table funds (                                 -- D3
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  code          text,
  is_restricted boolean not null default false,
  is_active     boolean not null default true
);

create table campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  goal_amount numeric(12,2),
  starts_on   date,
  ends_on     date,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table appeals (                               -- D3
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  campaign_id uuid references campaigns (id),
  year        int,
  channel     text check (channel in ('dinner','letter','email','phone','event','other')),
  is_active   boolean not null default true
);

create table gift_aid_claims (                       -- D7 (02 §3.7)
  id              uuid primary key default gen_random_uuid(),
  status          text not null default 'draft-rolling'
                    check (status in ('draft-rolling','ready','submitted','paid')),
  submitted_on    date,
  hmrc_reference  text,
  total_donations numeric(12,2),
  total_claimed   numeric(12,2),
  gasds_total     numeric(12,2),
  created_at      timestamptz not null default now()
);

create table pledges (                               -- D4 (02 §3.5)
  id               uuid primary key default gen_random_uuid(),
  contact_id       uuid not null references contacts (id),
  total_amount     numeric(12,2) not null check (total_amount > 0),
  currency         text not null default 'GBP',
  amount_gbp       numeric(12,2) not null,
  fund_id          uuid references funds (id),
  campaign_id      uuid references campaigns (id),
  appeal_id        uuid references appeals (id),
  pledged_on       date not null,
  status           text not null default 'open'
                     check (status in ('open','fulfilled','written_off','cancelled')),
  write_off_amount numeric(12,2),
  notes            text,
  created_by       uuid references team_members (id),
  created_at       timestamptz not null default now()
);

create table pledge_installments (
  id        uuid primary key default gen_random_uuid(),
  pledge_id uuid not null references pledges (id) on delete cascade,
  due_on    date not null,
  amount    numeric(12,2) not null check (amount > 0),
  status    text not null default 'expected'
              check (status in ('expected','paid','partly_paid','written_off'))
              -- 'overdue' is computed in views, never stored (I-9)
);

create index pledge_installments_due_idx on pledge_installments (due_on) where status = 'expected';

create table recurring_agreements (                  -- D12 (02 §3.6)
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid not null references contacts (id),
  amount          numeric(12,2) not null,
  currency        text not null default 'GBP',
  frequency       text not null check (frequency in ('weekly','monthly','quarterly','annual')),
  payment_method  text,
  fund_id         uuid references funds (id),
  starts_on       date not null,
  ends_on         date,
  expected_day    smallint,
  status          text not null default 'active'
                    check (status in ('active','paused','cancelled','failing')),
  last_payment_on date,
  missed_count    int not null default 0,
  created_at      timestamptz not null default now()
);

create table donations (                             -- 02 §3.4 — money received
  id                     uuid primary key default gen_random_uuid(),
  contact_id             uuid not null references contacts (id),
  donated_on             date not null,
  amount                 numeric(12,2) not null check (amount > 0),
  currency               text not null default 'GBP',
  amount_gbp             numeric(12,2) not null,
  fund_id                uuid not null references funds (id),
  campaign_id            uuid references campaigns (id),
  appeal_id              uuid references appeals (id),
  payment_method         text,
  status                 text not null default 'received'
                           check (status in ('received','refunded','cancelled')),
  pledge_id              uuid references pledges (id),
  installment_id         uuid references pledge_installments (id),
  recurring_agreement_id uuid references recurring_agreements (id),
  receipt_status         text not null default 'not_sent'
                           check (receipt_status in ('not_sent','queued','sent','not_required')),
  receipt_pref           text check (receipt_pref in ('email','letter','both','none')),
  thank_you_status       text not null default 'not_done'
                           check (thank_you_status in ('not_done','task_open','done')),
  gift_aid_status        text not null default 'ineligible'
                           check (gift_aid_status in ('ineligible','pending_declaration','eligible','claimed')),
  gift_aid_claim_id      uuid references gift_aid_claims (id),
  is_gasds               boolean not null default false,
  notes                  text,
  created_by             uuid references team_members (id),
  created_at             timestamptz not null default now()
);

create index donations_contact_idx  on donations (contact_id, donated_on desc);
create index donations_campaign_idx on donations (campaign_id);
create index donations_appeal_idx   on donations (appeal_id);
create index donations_ga_idx       on donations (gift_aid_status) where gift_aid_status = 'eligible';

create table soft_credits (                          -- D2 (02 §3.14)
  id          uuid primary key default gen_random_uuid(),
  donation_id uuid not null references donations (id) on delete cascade,
  contact_id  uuid not null references contacts (id),
  role        text not null check (role in ('household','influencer','solicitor','matched_by','other')),
  amount      numeric(12,2),
  created_by  uuid references team_members (id),
  unique (donation_id, contact_id, role)
);

create table tributes (                              -- D5 (02 §3.15)
  id                     uuid primary key default gen_random_uuid(),
  donation_id            uuid not null references donations (id) on delete cascade unique,
  tribute_type           text not null check (tribute_type in ('in_honor','in_memory','yahrzeit','simcha')),
  honoree_name           text not null,
  honoree_contact_id     uuid references contacts (id),
  acknowledgee_name      text,
  acknowledgee_address   text,
  acknowledgee_contact_id uuid references contacts (id),
  notify                 boolean not null default false,
  notified_at            timestamptz
);

create table gift_aid_declarations (                 -- D7 (02 §3.7)
  id                        uuid primary key default gen_random_uuid(),
  contact_id                uuid not null references contacts (id),
  declared_on               date not null,
  method                    text not null check (method in ('written','oral','online')),
  wording_version           text,
  covers_past               boolean not null default true,
  covers_future             boolean not null default true,
  covers_from               date,
  oral_confirmation_sent_on date,
  cancelled_on              date,
  evidence_url              text,
  created_at                timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- Tasks, opportunities, notes, documents
-- --------------------------------------------------------------------------

create table opportunities (                         -- D10 (02 §3.9) [P2]
  id                   uuid primary key default gen_random_uuid(),
  contact_id           uuid not null references contacts (id),
  name                 text not null,
  campaign_id          uuid references campaigns (id),
  fund_id              uuid references funds (id),
  ask_amount           numeric(12,2),
  ask_date             date,
  projection_high      numeric(12,2),
  projection_low       numeric(12,2),
  probability_pct      smallint check (probability_pct between 0 and 100),
  expected_amount      numeric(12,2),
  stage                text not null default 'identified',
  stage_entered_at     timestamptz not null default now(),
  last_moved_forward_at timestamptz,
  expected_decision_on date,
  motivation           text,
  restrictions         text,
  status               text not null default 'open'
                         check (status in ('open','won','lost','on_hold')),
  opened_on            date not null default current_date,
  closed_on            date,
  notes                text,
  created_at           timestamptz not null default now()
);

create index opportunities_open_idx on opportunities (contact_id) where status = 'open';

create table tasks (                                 -- D8 (02 §3.3)
  id             uuid primary key default gen_random_uuid(),
  contact_id     uuid not null references contacts (id),   -- I-2: always a person
  opportunity_id uuid references opportunities (id),
  title          text not null,
  action_type    text,
  details        text,
  assigned_to    uuid references team_members (id),
  due_on         date,
  priority       text not null default 'medium',
  status         text not null default 'todo'
                   check (status in ('todo','in_progress','waiting','queued','done','cancelled')),
  waiting_for    text,
  queue_order    int,
  completed_at   timestamptz,
  origin         text not null default 'manual',
  created_by     uuid references team_members (id),
  created_at     timestamptz not null default now(),
  check (status = 'queued' or due_on is not null)    -- only queued tasks may be dateless
);

create index tasks_open_due_idx on tasks (due_on)
  where status in ('todo','in_progress','waiting');
create index tasks_contact_open_idx on tasks (contact_id)
  where status in ('todo','in_progress','waiting','queued');

create table notes (                                 -- 02 §3.11
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references contacts (id),
  category    text,
  body        text not null,
  is_private  boolean not null default false,
  is_pinned   boolean not null default false,        -- D9
  created_by  uuid not null references team_members (id),
  created_at  timestamptz not null default now()
);

create unique index notes_one_pinned_per_contact on notes (contact_id) where is_pinned;

alter table contacts
  add constraint contacts_pinned_note_fk
  foreign key (pinned_note_id) references notes (id);

create table documents (                             -- 02 §3.12
  id           uuid primary key default gen_random_uuid(),
  contact_id   uuid not null references contacts (id),
  title        text not null,
  kind         text,
  url          text,
  storage_path text,
  uploaded_by  uuid references team_members (id),
  created_at   timestamptz not null default now(),
  check (url is not null or storage_path is not null)
);

create table signals (                               -- nudge rail storage (02 §3.18; 08 §3)
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references contacts (id),
  rule_key      text not null,
  reason        text not null,                       -- "why am I seeing this"
  state         text not null default 'open'
                  check (state in ('open','snoozed','dismissed','acted')),
  snoozed_until date,
  dedupe_key    text not null,                       -- never re-fire a dismissed condition
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  unique (dedupe_key)
);

create index signals_open_idx on signals (contact_id) where state = 'open';

create table audit_log (                             -- 11 §4
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   uuid not null,
  action      text not null check (action in ('insert','update','delete')),
  changed_by  uuid,
  changed_at  timestamptz not null default now(),
  old_values  jsonb,
  new_values  jsonb
);

-- --------------------------------------------------------------------------
-- Derived layer (02 §4) — contact_stats view. Sketch: authoritative field
-- list in 02 §4.1; the implementation is tuned during Phase 0/1.
-- Includes: giving rollups (hard + parallel soft columns), LYBUNT/SYBUNT,
-- pledge balance, last meaningful contact, days_since_contact, kit_due_on,
-- next action, flag, donor_status. A pledge_balances view accompanies it.
-- Nightly recompute (engagement, statuses-as-tags, auto-tags, RFM):
--   select cron.schedule('crm-nightly','0 5 * * *', $$select run_nightly()$$);
-- Rule-by-rule contents of run_nightly(): spec/08-AUTOMATIONS.md §5.
-- --------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- RLS: enabled on every table; policy matrix in spec/11-PERMISSIONS-NFR.md.
-- Principles: active team_members only; viewers read-only with amount and
-- private-note restrictions enforced here, not in the UI.
-- --------------------------------------------------------------------------
