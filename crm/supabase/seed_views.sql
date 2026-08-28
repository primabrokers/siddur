-- ---------------------------------------------------------------------------
-- M5 · Seeded smart views (spec 06 §1)
--
-- Each row is a queue to work to zero (▸ Close's smart lists). The `filters`
-- jsonb is the typed subset declared in
-- `src/features/views/filterModel.ts` — the client parses it defensively, so a
-- key this build does not know is dropped rather than breaking the screen.
--
-- IDEMPOTENT. Safe to re-run: seeded rows are matched by name, updated in
-- place, and only inserted when absent. Nothing is deleted, so a view someone
-- has renamed or retuned is never clobbered by a re-run.
--
-- `owner_id is null` + `is_shared` marks a seeded, team-wide view; a personal
-- view carries its owner. That is the "seeded marker" — no extra column.
--
--   psql "$DATABASE_URL" -f crm/supabase/seed_views.sql
-- ---------------------------------------------------------------------------

begin;

with seeded (name, entity, layout, filters, sort, columns, icon) as (
  values
    -- ---- the two task queues (kept deliberately simple; they route to /tasks)
    ('Follow-ups today', 'tasks', 'table',
     '{"due":"today"}',
     '{"field":"due_on","dir":"asc"}',
     array['contact','title','due_on','action_type'], 'clock'),

    ('Overdue follow-ups', 'tasks', 'table',
     '{"due":"overdue"}',
     '{"field":"due_on","dir":"asc"}',
     array['contact','title','due_on','action_type'], 'alert'),

    -- ---- the lapsing-donor lenses
    ('LYBUNT', 'contacts', 'table',
     '{"is_lybunt":true}',
     '{"field":"lifetime_giving","dir":"desc"}',
     array['name','last_gift_date','giving_last_year','lifetime_giving'], 'trend-down'),

    ('Pre-lapsed rescue list', 'contacts', 'table',
     '{"donor_status":["pre_lapsed"]}',
     '{"field":"lifetime_giving","dir":"desc"}',
     array['name','donor_status','days_since_contact','lifetime_giving'], 'alert'),

    -- ---- the neglect ladder (brief §20's 30/60/90)
    ('No contact 30+ days', 'contacts', 'table',
     '{"days_since_contact_gte":30}',
     '{"field":"days_since_contact","dir":"desc"}',
     array['name','days_since_contact','stage','lifetime_giving'], 'clock'),

    ('No contact 60+ days', 'contacts', 'table',
     '{"days_since_contact_gte":60}',
     '{"field":"days_since_contact","dir":"desc"}',
     array['name','days_since_contact','stage','lifetime_giving'], 'clock'),

    ('No contact 90+ days', 'contacts', 'table',
     '{"days_since_contact_gte":90}',
     '{"field":"days_since_contact","dir":"desc"}',
     array['name','days_since_contact','stage','lifetime_giving'], 'clock'),

    -- ---- the cultivation queue
    ('High-priority prospects', 'contacts', 'table',
     '{"stage":["prospect","initial_contact","contacted","cultivation","in_discussion"],"priority":["high"]}',
     '{"field":"days_since_contact","dir":"desc"}',
     array['name','stage','days_since_contact','next_action_due_on'], 'star'),

    -- ---- money promised, money to thank for
    ('Pledges outstanding', 'contacts', 'table',
     '{"pledge_balance_gt":0}',
     '{"field":"pledge_balance","dir":"desc"}',
     array['name','pledge_balance','next_action_due_on'], 'handshake'),

    ('Recent gifts needing stewardship', 'donations', 'table',
     '{"donated_within_days":30,"thank_you_status_not":["done"]}',
     '{"field":"donated_on","dir":"desc"}',
     array['contact','donated_on','amount','thank_you_status'], 'gift'),

    ('GA: missing declarations', 'donations', 'table',
     '{"gift_aid_status":["pending_declaration"]}',
     '{"field":"donated_on","dir":"desc"}',
     array['contact','donated_on','amount','gift_aid_status'], 'alert')
)

-- Update first, so a re-run retunes the seeded rows that already exist
-- (M0's 004_seeds.sql shipped four of them with older criteria).
, updated as (
  update saved_views sv
     set entity    = s.entity,
         layout    = s.layout,
         filters   = s.filters::jsonb,
         sort      = s.sort::jsonb,
         columns   = s.columns,
         icon      = s.icon,
         is_shared = true
    from seeded s
   where sv.name = s.name
     and sv.owner_id is null          -- never touch someone's personal view
  returning sv.name
)

insert into saved_views (name, entity, layout, filters, sort, columns, icon, owner_id, is_shared)
select s.name, s.entity, s.layout, s.filters::jsonb, s.sort::jsonb, s.columns, s.icon, null, true
  from seeded s
 where not exists (select 1 from saved_views sv where sv.name = s.name);

commit;

-- Sanity: what the sidebar will show.
--   select name, entity, filters from saved_views where owner_id is null order by name;
