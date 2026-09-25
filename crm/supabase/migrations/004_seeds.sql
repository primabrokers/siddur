-- ============================================================================
-- 004_seeds — lookup lists (02 §6), automation rules (08 §2/§3/§7),
--             funds/campaign/appeals (02 §3.8) and the organisation-self row.
-- ============================================================================
-- Everything here is configuration, not demo data: it ships with the product.
-- All inserts are idempotent so the migration can be replayed safely.
-- ============================================================================

-- --------------------------------------------------------------------------
-- Lookup lists (02 §6). meta carries per-value semantics: interaction kinds
-- carry {meaningful, weight} which the engagement score reads (02 §4.3), and
-- opportunity stages carry the exit criteria shown in the pipeline header.
-- --------------------------------------------------------------------------

insert into lookup_options (list_name, value, label, sort_order, meta) values
  ('stage','prospect','Prospect',10,'{}'),
  ('stage','initial_contact','Initial contact',20,'{}'),
  ('stage','contacted','Contacted',30,'{}'),
  ('stage','awaiting_response','Awaiting response',40,'{}'),
  ('stage','meeting_scheduled','Meeting scheduled',50,'{}'),
  ('stage','meeting_completed','Meeting completed',60,'{}'),
  ('stage','follow_up','Follow up',70,'{}'),
  ('stage','cultivation','Cultivation',80,'{}'),
  ('stage','proposal_sent','Proposal sent',90,'{}'),
  ('stage','in_discussion','In discussion',100,'{}'),
  ('stage','pledged','Pledged',110,'{}'),
  ('stage','active_donor','Active donor',120,'{}'),
  ('stage','recurring_donor','Recurring donor',130,'{}'),
  ('stage','stewardship','Stewardship',140,'{}'),
  ('stage','keep_in_touch','Keep in touch',150,'{}'),
  ('stage','unable_to_reach','Unable to reach',160,'{}'),
  ('stage','inactive','Inactive',170,'{}'),
  ('stage','not_interested','Not interested',180,'{}'),
  ('stage','archived','Archived',190,'{}'),

  ('opportunity_stage','identified','Identified',10,
     '{"exit_criteria":"We know who they are and why they might care"}'),
  ('opportunity_stage','qualified','Qualified',20,
     '{"exit_criteria":"Capacity and interest confirmed by a human conversation"}'),
  ('opportunity_stage','cultivating','Cultivating',30,
     '{"exit_criteria":"They have visited, met the Rosh Yeshiva, or seen the work"}'),
  ('opportunity_stage','solicited','Solicited',40,
     '{"exit_criteria":"A specific amount has been asked for, in person or in writing"}'),
  ('opportunity_stage','pledged','Pledged',50,
     '{"exit_criteria":"Commitment made and a payment schedule agreed"}'),
  ('opportunity_stage','stewarding','Stewarding',60,
     '{"exit_criteria":"Thanked, reported to, and ready to be asked again"}'),

  ('priority','high','High',10,'{}'),
  ('priority','medium','Medium',20,'{}'),
  ('priority','low','Low',30,'{}'),

  ('tier','A','Tier A',10,'{}'),
  ('tier','B','Tier B',20,'{}'),
  ('tier','C','Tier C',30,'{}'),
  ('tier','D','Tier D',40,'{}'),

  ('title','Mr','Mr',10,'{}'),
  ('title','Mrs','Mrs',20,'{}'),
  ('title','Ms','Ms',30,'{}'),
  ('title','Rabbi','Rabbi',40,'{}'),
  ('title','Rebbetzin','Rebbetzin',50,'{}'),
  ('title','Dr','Dr',60,'{}'),
  ('title','Dayan','Dayan',70,'{}'),
  ('title','Prof','Prof',80,'{}'),

  ('interaction_kind','call','Call',10,'{"meaningful":true,"weight":20}'),
  ('interaction_kind','whatsapp','WhatsApp',20,'{"meaningful":true,"weight":10}'),
  ('interaction_kind','sms','SMS',30,'{"meaningful":true,"weight":8}'),
  ('interaction_kind','email','Email',40,'{"meaningful":true,"weight":10}'),
  ('interaction_kind','meeting','Meeting',50,'{"meaningful":true,"weight":30}'),
  ('interaction_kind','event','Event',60,'{"meaningful":true,"weight":15}'),
  ('interaction_kind','letter','Letter',70,'{"meaningful":true,"weight":5}'),
  ('interaction_kind','video_call','Video call',80,'{"meaningful":true,"weight":25}'),
  ('interaction_kind','receipt_sent','Receipt sent',90,'{"meaningful":false,"weight":0}'),
  ('interaction_kind','other','Other',100,'{"meaningful":true,"weight":5}'),

  ('action_type','call','Call',10,'{}'),
  ('action_type','whatsapp','WhatsApp',20,'{}'),
  ('action_type','send_email','Send email',30,'{}'),
  ('action_type','arrange_meeting','Arrange meeting',40,'{}'),
  ('action_type','send_proposal','Send proposal',50,'{}'),
  ('action_type','ask','Ask',60,'{}'),
  ('action_type','follow_up_proposal','Follow up proposal',70,'{}'),
  ('action_type','send_update','Send update',80,'{}'),
  ('action_type','invite_event','Invite to event',90,'{}'),
  ('action_type','thank_you','Thank you',100,'{}'),
  ('action_type','send_receipt','Send receipt',110,'{}'),
  ('action_type','speak_to_introducer','Speak to introducer',120,'{}'),
  ('action_type','keep_in_touch','Keep in touch',130,'{}'),
  ('action_type','other','Other',140,'{}'),

  ('payment_method','bank_transfer','Bank transfer',10,'{}'),
  ('payment_method','standing_order','Standing order',20,'{}'),
  ('payment_method','card','Card',30,'{}'),
  ('payment_method','cash','Cash',40,'{}'),
  ('payment_method','cheque','Cheque',50,'{}'),
  ('payment_method','voucher_agency','Voucher agency',60,
     '{"note":"e.g. Achisomoch, Kol Yom"}'),
  ('payment_method','other','Other',70,'{}'),

  ('note_category','general','General',10,'{}'),
  ('note_category','personal','Personal',20,'{}'),
  ('note_category','family','Family',30,'{}'),
  ('note_category','giving','Giving',40,'{}'),
  ('note_category','sensitive','Sensitive',50,
     '{"guidance":"Record what helps the relationship, nothing else (I-13)."}'),

  ('document_kind','proposal','Proposal',10,'{}'),
  ('document_kind','agreement','Agreement',20,'{}'),
  ('document_kind','letter','Letter',30,'{}'),
  ('document_kind','receipt','Receipt',40,'{}'),
  ('document_kind','photo','Photo',50,'{}'),
  ('document_kind','other','Other',60,'{}'),

  ('contact_kind','individual','Individual',10,'{}'),
  ('contact_kind','business','Business',20,'{}'),
  ('contact_kind','foundation','Foundation',30,'{}'),
  ('contact_kind','trust','Trust',40,'{}'),

  ('language','en','English',10,'{}'),
  ('language','he','Hebrew',20,'{}'),
  ('language','yi','Yiddish',30,'{}'),
  ('language','fr','French',40,'{}'),

  ('tribute_type','in_honor','In honour of',10,'{}'),
  ('tribute_type','in_memory','In memory of',20,'{}'),
  ('tribute_type','yahrzeit','Yahrzeit',30,'{}'),
  ('tribute_type','simcha','Simcha',40,'{}')
on conflict (list_name, value) do update
  set label = excluded.label,
      sort_order = excluded.sort_order,
      meta = excluded.meta;

-- --------------------------------------------------------------------------
-- Automation rules (08 §7): every rule's switch + params. Tuning a rule is a
-- data change; adding one is a code change.
-- --------------------------------------------------------------------------

insert into automation_rules (rule_key, is_enabled, params) values
  -- §2 trigger library ---------------------------------------------------
  ('thank_you_on_gift', true,
   '{"big_gift_threshold":500,"major_gift_threshold":5000,"skip_if_open":true,"due_in_days":2}'),
  ('receipt_on_gift', true,
   '{"system_default":"email"}'),
  ('first_gift_call', true,
   '{"within_hours":48}'),
  ('gift_aid_evaluate', true,
   '{"back_years":4,"require_oral_confirmation":true}'),
  ('ga_declaration_chase', true,
   '{"min_amount":0}'),
  ('household_soft_credit', true, '{}'),
  ('influencer_prompt', true, '{}'),
  ('tribute_acknowledgee', true, '{"due_in_days":3}'),
  ('stage_change_prompts', true, '{}'),
  ('pledge_schedule', true, '{}'),

  -- §3 nightly rules -----------------------------------------------------
  ('kit_due', true, '{}'),
  ('proposal_follow_up', true, '{"days":7}'),
  ('pledge_chase', true, '{"first_after_days":14,"second_after_days":30,"repeat_days":30}'),
  ('recurring_failing', true, '{"late_days":7}'),
  ('neglect_flags', true,
   '{"high_priority_days":30,"active_donor_days":60,"vip_days":90,"vip_tag":"VIP"}'),
  ('engagement_recompute', true,
   '{"lookback_days":365,"halflife_days":120,"gift_points":25,"gift_points_cap":50,
     "recency_bonus":15,"recency_days":30,"unknown_days":30,
     "weights":{"meeting":30,"video_call":25,"call":20,"event":15,"whatsapp":10,"email":10,
                "sms":8,"letter":5,"other":5,"receipt_sent":0},
     "tiers":{"cold":0,"cool":15,"warm":35,"hot":70,"on_fire":120}}'),
  -- 02 §4.4 names this params bag `donor_status`; contact_stats reads it.
  ('donor_status', true,
   '{"new_months":6,"active_months":12,"pre_lapsed_months":18}'),
  -- 08 §3 names the nightly signal rule `donor_status_recompute`; it reads the
  -- thresholds above and only decides whether to raise pre-lapse signals.
  ('donor_status_recompute', true, '{}'),
  ('meeting_reminder', true, '{"days_before":1}'),
  ('stale_prospects', true, '{"days":90}'),
  ('auto_tags', true, '{}'),
  ('rfm_recompute', false, '{}'),
  ('no_next_action_audit', true, '{}'),
  ('duplicate_scan', true, '{"name_similarity":0.6}')
on conflict (rule_key) do update
  set params = excluded.params,
      updated_at = now();

-- --------------------------------------------------------------------------
-- Funds / campaign / appeals (02 §3.8)
-- --------------------------------------------------------------------------

insert into funds (name, code, is_restricted) values
  ('General',      'GEN', false),
  ('Scholarships', 'SCH', true),
  ('Building',     'BLD', true),
  ('Kollel',       'KOL', true)
on conflict (name) do nothing;

insert into campaigns (name, description, goal_amount, starts_on, ends_on)
select 'Building Campaign',
       'New beis medrash and dormitory wing.',
       2000000, date '2025-09-01', date '2027-08-31'
where not exists (select 1 from campaigns where name = 'Building Campaign');

insert into appeals (name, campaign_id, year, channel)
select 'Dinner 2026', (select id from campaigns where name = 'Building Campaign'), 2026, 'dinner'
where not exists (select 1 from appeals where name = 'Dinner 2026');

insert into appeals (name, campaign_id, year, channel)
select 'Purim Appeal 2026', null, 2026, 'letter'
where not exists (select 1 from appeals where name = 'Purim Appeal 2026');

-- --------------------------------------------------------------------------
-- The organisation-self contact (02 §3.1): exactly one row, the anchor for
-- org-level tasks so invariant I-2 (every task has a contact) always holds.
-- Parked in an inactive stage so the anchor never earns the yellow
-- "no next action" flag on the Action Stream.
-- --------------------------------------------------------------------------

insert into contacts (first_name, last_name, organization, contact_kind,
                      is_organisation_self, stage, priority, country)
select 'Yeshiva', '', 'The Yeshiva', 'business', true, 'inactive', 'low', 'United Kingdom'
where not exists (select 1 from contacts where is_organisation_self);

create unique index if not exists contacts_one_organisation_self
  on contacts ((true)) where is_organisation_self;

-- --------------------------------------------------------------------------
-- Pinned saved views (06 §1) — the four the Action Stream sidebar shows.
-- --------------------------------------------------------------------------

insert into saved_views (name, entity, layout, filters, sort, columns, icon, is_shared)
select v.name, v.entity, 'table', v.filters::jsonb, v.sort::jsonb, v.columns, v.icon, true
from (values
  ('Overdue follow-ups','tasks','{"flag":"overdue"}','{"field":"due_on","dir":"asc"}',
     array['contact','title','due_on','action_type'],'alert'),
  ('LYBUNT','contacts','{"is_lybunt":true}','{"field":"lifetime_giving","dir":"desc"}',
     array['name','last_gift_date','giving_last_year','lifetime_giving'],'trend-down'),
  ('No contact 60+ days','contacts','{"days_since_contact_gte":60}','{"field":"days_since_contact","dir":"desc"}',
     array['name','days_since_contact','stage','lifetime_giving'],'clock'),
  ('Pledges outstanding','contacts','{"pledge_balance_gt":0}','{"field":"pledge_balance","dir":"desc"}',
     array['name','pledge_balance','next_action_due_on'],'handshake')
) as v(name, entity, filters, sort, columns, icon)
where not exists (select 1 from saved_views sv where sv.name = v.name);

-- --------------------------------------------------------------------------
-- One seeded auto-tag so the nightly auto_tags rule has real work to do.
-- --------------------------------------------------------------------------

insert into tags (name, category, color, is_auto, auto_rule)
select 'LYBUNT', 'rfm_auto', '#D9A800', true, '{"type":"lybunt"}'::jsonb
where not exists (select 1 from tags where category = 'rfm_auto' and name = 'LYBUNT');
