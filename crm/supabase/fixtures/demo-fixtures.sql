-- ============================================================================
-- demo-fixtures.sql — the deterministic demo/test data set (spec 11 §8)
-- ============================================================================
-- NOT a migration. This is applied with execute_sql against a database that
-- already has migrations 001–005, and it assumes the two demo team members
-- exist (see the header of §0 below). It is the source of record for the demo
-- instance so the cast can be rebuilt from scratch.
--
-- Shape: ~15 hand-crafted cast contacts matching the wireframes, plus ~100
-- generated contacts with three years of giving (410 gifts in total). Names
-- are invented; the UI shows a "DEMO" banner over this data.
--
-- Two conventions worth knowing before you edit it:
--
--  1. Dates are RELATIVE (current_date - N) wherever the demo depends on
--     "overdue", "92 days quiet", "meeting tomorrow". The demo therefore stays
--     fresh as it ages instead of rotting into a wall of overdue rows.
--
--  2. Historical gifts are loaded with `thank_you_on_gift` and
--     `first_gift_call` switched OFF, exactly as a real import would. Three
--     years of backfill must not manufacture 100 thank-you tasks and 100
--     first-gift nudges. Both rules are switched back on before the Klein
--     family's £180 gift, which is the one gift that SHOULD fire them — that
--     nudge is the "FIRST GIFT THIS WEEK" card in the Main wireframe.
--
-- Run order: §0 → §1 → §2 → §3 → §4, then `select run_nightly();`.
-- ============================================================================


-- ============================================================================
-- §0. Team members (idempotent). The auth.users rows they reference are made
--     separately — see the "Test users" step in the build notes; team_members
--     .id is a FK to auth.users(id).
-- ============================================================================
--   admin@demo.test       11111111-1111-4111-8111-111111111111  Avi Braun    (admin)
--   fundraiser@demo.test  22222222-2222-4222-8222-222222222222  Rivka Klein  (fundraiser)


-- ============================================================================
-- §1. Households, cast contacts, tags
-- ============================================================================

update automation_rules set is_enabled = false
 where rule_key in ('thank_you_on_gift','first_gift_call');

insert into households (id, name, formal_greeting, informal_greeting, hebrew_greeting) values
 ('d0000000-0000-4000-8000-000000000001','Cohen Family','Rabbi & Mrs. Cohen','Dovid & Rivky','הרב ומרת כהן'),
 ('d0000000-0000-4000-8000-000000000002','Goldstein Family','Rabbi & Mrs. Goldstein','Mendel & Leah','הרב ומרת גולדשטיין'),
 ('d0000000-0000-4000-8000-000000000003','Klein Family','Mr & Mrs Klein','Shloimy & Chani',null);

insert into contacts (id, title, first_name, last_name, hebrew_name, organization, position, industry,
  contact_kind, household_id, email, phone, whatsapp, preferred_language, preferred_channel,
  best_time_to_contact, address_line1, city, postcode, source, introduced_by_note,
  relationship_owner_id, relationship_strength, known_since, birthday, spouse_name, family_notes,
  things_to_remember, stage, priority, tier, estimated_capacity, contact_frequency_days,
  mutual_connections) values

 ('c0000000-0000-4000-8000-000000000001','Mr','Dovid','Cohen','דוד הכהן','Cohen & Partner','Director','Property',
  'individual','d0000000-0000-4000-8000-000000000001','dovid.cohen@example.test','+447700900101','+447700900101','en','call',
  'after 8pm','14 Highfield Gardens','London','NW11 9HP','Introduction','R'' Weiss',
  '11111111-1111-4111-8111-111111111111',9,date '2019-06-01',date '1972-11-14','Rivky','5 children, eldest in Gateshead yeshiva',
  'Prefers calls after 8pm. Ask about his son''s chabura in Gateshead.','in_discussion','high','A',150000,60,
  'R'' Weiss, the Feld brothers'),

 ('c0000000-0000-4000-8000-000000000002','Mrs','Rivky','Cohen',null,null,null,null,
  'individual','d0000000-0000-4000-8000-000000000001','rivky.cohen@example.test','+447700900102','+447700900102','en','whatsapp',
  null,'14 Highfield Gardens','London','NW11 9HP','Household',null,
  '11111111-1111-4111-8111-111111111111',7,date '2019-06-01',date '1975-03-02','Dovid',null,
  'Runs the ladies'' shiur; organises the annual bake sale.','stewardship','medium','B',20000,null,null),

 ('c0000000-0000-4000-8000-000000000003','Mr','Reuven','Adler',null,'Adler Textiles','Owner','Textiles',
  'individual',null,'reuven.adler@example.test','+447700900103','+447700900103','en','call',
  'mornings','8 Bridge Lane','London','NW11 0EE','Dinner 2024',null,
  '11111111-1111-4111-8111-111111111111',8,date '2021-02-10',date '1968-07-19','Miriam',null,
  'Standing order since 2023. Visit the building site with him.','proposal_sent','high','A',80000,45,null),

 ('c0000000-0000-4000-8000-000000000004','Rabbi','Mendel','Goldstein',null,null,'Maggid shiur','Chinuch',
  'individual','d0000000-0000-4000-8000-000000000002','m.goldstein@example.test','+447700900104','+447700900104','en','call',
  'evenings','22 Sunningfields Road','London','NW4 4QR','Alumnus',null,
  '11111111-1111-4111-8111-111111111111',8,date '2016-09-01',date '1965-01-30','Leah',null,
  'Learned in the yeshiva 1985-89. Loves hearing about the shiur schedule.','keep_in_touch','medium','B',25000,60,null),

 ('c0000000-0000-4000-8000-000000000005','Mrs','Leah','Goldstein',null,null,null,null,
  'individual','d0000000-0000-4000-8000-000000000002','l.goldstein@example.test','+447700900105','+447700900105','en',null,
  null,'22 Sunningfields Road','London','NW4 4QR','Household',null,
  '11111111-1111-4111-8111-111111111111',6,date '2016-09-01',null,'Mendel',null,
  null,'keep_in_touch','low','C',null,null,null),

 ('c0000000-0000-4000-8000-000000000006','Mr','Shloimy','Klein',null,null,'Accountant','Finance',
  'individual','d0000000-0000-4000-8000-000000000003','s.klein@example.test','+447700900106','+447700900106','en','whatsapp',
  null,'3 Elmcroft Crescent','London','NW11 9SY','Purim mailing',null,
  '11111111-1111-4111-8111-111111111111',4,date '2026-08-01',date '1988-05-11','Chani','Young family, first-time givers',
  'Brand new to the yeshiva — treat gently.','initial_contact','high','C',5000,null,null),

 ('c0000000-0000-4000-8000-000000000007','Mrs','Chani','Klein',null,null,null,null,
  'individual','d0000000-0000-4000-8000-000000000003','c.klein@example.test','+447700900107','+447700900107','en',null,
  null,'3 Elmcroft Crescent','London','NW11 9SY','Household',null,
  '11111111-1111-4111-8111-111111111111',3,date '2026-08-01',null,'Shloimy',null,
  null,'initial_contact','low','D',null,null,null),

 ('c0000000-0000-4000-8000-000000000008','Mr','Naftoli','Katz',null,'Katz Holdings','Chairman','Investments',
  'individual',null,'n.katz@example.test','+447700900108','+447700900108','en','call',
  'Sunday mornings','40 The Ridgeway','London','NW11 8QP','Board introduction',null,
  '11111111-1111-4111-8111-111111111111',9,date '2014-03-15',date '1959-09-08','Sarah',null,
  'Never call during Elul — he is away. Gives after the dinner, not at it.','cultivation','medium','A',500000,90,null),

 ('c0000000-0000-4000-8000-000000000009','Mr','Shmuel','Feld',null,'Feld Brothers Ltd','Partner','Wholesale',
  'individual',null,'s.feld@example.test','+447700900109','+447700900109','en','whatsapp',
  null,'71 Golders Green Road','London','NW11 8EL','Dinner 2023',null,
  '11111111-1111-4111-8111-111111111111',7,date '2020-11-01',date '1979-02-22','Devorah',null,
  'Takes a journal ad every year — ask early.','active_donor','high','B',40000,null,null),

 ('c0000000-0000-4000-8000-00000000000a','Mr','Yanky','Katz',null,null,'Sofer','Stam',
  'individual',null,'y.katz@example.test','+447700900110','+447700900110','en','whatsapp',
  null,'9 Woodstock Avenue','London','NW11 9RG','Shul',null,
  '11111111-1111-4111-8111-111111111111',6,date '2022-05-20',null,null,null,
  'Gift Aid form sent — chase gently, he is shy about paperwork.','active_donor','medium','C',8000,null,null),

 ('c0000000-0000-4000-8000-00000000000b','Mr','Baruch','Reich',null,null,'Solicitor','Legal',
  'individual',null,'b.reich@example.test','+447700900111','+447700900111','en','send_email',
  null,'16 Hodford Road','London','NW11 8NP','Referral',null,
  '11111111-1111-4111-8111-111111111111',5,date '2023-01-12',null,'Esther',null,
  null,'cultivation','medium','B',30000,null,null),

 ('c0000000-0000-4000-8000-00000000000c','Mr','Aron','Berger',null,null,'Retired','',
  'individual',null,'a.berger@example.test','+447700900112','+447700900112','en','call',
  null,'5 Wessex Gardens','London','NW11 9RT','Dinner 2024',null,
  '11111111-1111-4111-8111-111111111111',5,date '2018-04-04',date '1951-12-03','Bracha',null,
  'No Gift Aid declaration on file — worth one conversation.','follow_up','medium','C',12000,null,null),

 ('c0000000-0000-4000-8000-00000000000d','Mrs','D.','Frankel',null,null,null,null,
  'individual',null,'d.frankel@example.test','+447700900113','+447700900113','en','call',
  null,'27 Princes Park Avenue','London','NW11 0JS','Purim mailing',null,
  '11111111-1111-4111-8111-111111111111',5,date '2021-09-09',null,null,null,
  'Declared Gift Aid on the phone — written confirmation still owed to HMRC.','active_donor','medium','C',9000,null,null),

 ('c0000000-0000-4000-8000-00000000000e',null,'Feld Brothers Ltd','','','Feld Brothers Ltd','','Wholesale',
  'business',null,'office@feldbrothers.example.test','+442080000114',null,'en','send_email',
  null,'Unit 4 Brent Cross Trade Park','London','NW2 1LT','Corporate approach',null,
  '11111111-1111-4111-8111-111111111111',4,date '2024-02-01',null,null,null,
  'Corporate sponsorship of the dinner — decision sits with both brothers.','proposal_sent','medium','B',60000,null,null),

 ('c0000000-0000-4000-8000-00000000000f','Rabbi','Yisroel','Weiss',null,null,'Rov','Rabbonus',
  'individual',null,'r.weiss@example.test','+447700900115','+447700900115','en','call',
  null,'2 Beechcroft Avenue','London','NW11 8BL','Communal',null,
  '11111111-1111-4111-8111-111111111111',10,date '2012-01-01',null,'Rochel',null,
  'Opens doors. Never ask him for money — ask him for introductions.','stewardship','high','B',null,180,null);

update contacts set introduced_by_id = 'c0000000-0000-4000-8000-00000000000f'
 where id in ('c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-00000000000b');

update households set primary_contact_id = 'c0000000-0000-4000-8000-000000000001' where id = 'd0000000-0000-4000-8000-000000000001';
update households set primary_contact_id = 'c0000000-0000-4000-8000-000000000004' where id = 'd0000000-0000-4000-8000-000000000002';
update households set primary_contact_id = 'c0000000-0000-4000-8000-000000000006' where id = 'd0000000-0000-4000-8000-000000000003';

insert into tags (id, name, category, color) values
 ('e0000000-0000-4000-8000-000000000001','VIP','classification','#A97F24'),
 ('e0000000-0000-4000-8000-000000000002','Board prospect','classification','#0E6E6B'),
 ('e0000000-0000-4000-8000-000000000003','Building Project','interest','#3E7CB1'),
 ('e0000000-0000-4000-8000-000000000004','Education','interest','#2E7D46'),
 ('e0000000-0000-4000-8000-000000000005','Kollel','interest','#6B7686'),
 ('e0000000-0000-4000-8000-000000000006','Golders Green','community','#9AA3AD'),
 ('e0000000-0000-4000-8000-000000000007','Hendon','community','#9AA3AD'),
 ('e0000000-0000-4000-8000-000000000008','Alumni','community','#0E6E6B'),
 ('e0000000-0000-4000-8000-000000000009','Do not solicit at shul','custom','#D64545');

insert into taggings (tag_id, contact_id, since) values
 ('e0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000008',date '2015-01-01'),
 ('e0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',date '2020-01-01'),
 ('e0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000001',null),
 ('e0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000001',null),
 ('e0000000-0000-4000-8000-000000000006','c0000000-0000-4000-8000-000000000001',null),
 ('e0000000-0000-4000-8000-000000000006','c0000000-0000-4000-8000-000000000002',null),
 ('e0000000-0000-4000-8000-000000000006','c0000000-0000-4000-8000-000000000009',null),
 ('e0000000-0000-4000-8000-000000000006','c0000000-0000-4000-8000-00000000000a',null),
 ('e0000000-0000-4000-8000-000000000007','c0000000-0000-4000-8000-000000000004',null),
 ('e0000000-0000-4000-8000-000000000008','c0000000-0000-4000-8000-000000000004',null),
 ('e0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000003',null),
 ('e0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-00000000000e',null),
 ('e0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000008',null),
 ('e0000000-0000-4000-8000-000000000005','c0000000-0000-4000-8000-00000000000f',null),
 ('e0000000-0000-4000-8000-000000000009','c0000000-0000-4000-8000-000000000001',null);


-- ============================================================================
-- §2. Declarations, the Cohen pledge, Adler's standing order, the gift ledger,
--     the pipeline, and one tribute.
-- ============================================================================
-- Declarations go in BEFORE the gifts, so gift_aid_status resolves correctly
-- at insert and eligible gifts attach to the rolling claim immediately.

insert into gift_aid_declarations (contact_id, declared_on, method, wording_version, covers_past, covers_future, oral_confirmation_sent_on) values
 ('c0000000-0000-4000-8000-000000000001', date '2026-03-12','online','HMRC-2016',true,true,null),
 ('c0000000-0000-4000-8000-000000000002', date '2025-06-01','written','HMRC-2016',true,true,null),
 ('c0000000-0000-4000-8000-000000000003', date '2023-04-01','written','HMRC-2016',true,true,null),
 ('c0000000-0000-4000-8000-000000000004', date '2024-03-01','online','HMRC-2016',true,true,null),
 ('c0000000-0000-4000-8000-000000000008', date '2018-05-01','written','HMRC-2016',true,true,null),
 ('c0000000-0000-4000-8000-000000000009', date '2024-02-10','online','HMRC-2016',true,true,null),
 ('c0000000-0000-4000-8000-00000000000b', date '2026-05-01','written','HMRC-2016',true,true,null),
 -- Mrs Frankel: declared orally, written confirmation still owed -> her gifts
 -- stay at pending_declaration until oral_confirmation_sent_on is filled in
 ('c0000000-0000-4000-8000-00000000000d', date '2026-05-20','oral','HMRC-2016',true,true,null);

insert into pledges (id, contact_id, total_amount, currency, amount_gbp, fund_id, campaign_id, pledged_on, status, notes, created_by)
select 'f0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',25000,'GBP',25000,
       (select id from funds where name='Building'), (select id from campaigns where name='Building Campaign'),
       date '2026-02-01','open','£25,000 over five quarterly installments; naming opportunity discussed.',
       '11111111-1111-4111-8111-111111111111';

insert into pledge_installments (id, pledge_id, due_on, amount) values
 ('f1000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001',date '2026-03-15',5000),
 ('f1000000-0000-4000-8000-000000000002','f0000000-0000-4000-8000-000000000001',date '2026-06-15',5000),
 ('f1000000-0000-4000-8000-000000000003','f0000000-0000-4000-8000-000000000001',date '2026-09-15',5000),
 ('f1000000-0000-4000-8000-000000000004','f0000000-0000-4000-8000-000000000001',date '2026-12-15',5000),
 ('f1000000-0000-4000-8000-000000000005','f0000000-0000-4000-8000-000000000001',date '2027-03-15',5000);

-- Left ACTIVE on purpose with a payment 39 days old. The nightly
-- recurring_failing rule is what flips it to 'failing' and raises the
-- "call, don't email" signal — that is the STANDING ORDER FAILED nudge card.
insert into recurring_agreements (id, contact_id, amount, currency, frequency, payment_method, fund_id,
                                  starts_on, expected_day, status, last_payment_on, missed_count)
select 'f2000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000003',150,'GBP','monthly','standing_order',
       (select id from funds where name='General'), date '2023-04-01', 1, 'active', current_date - 39, 0;

insert into donations (contact_id, donated_on, amount, currency, amount_gbp, fund_id, campaign_id, appeal_id,
                       payment_method, pledge_id, installment_id, recurring_agreement_id, created_by)
select v.contact_id::uuid, v.donated_on, v.amt, 'GBP', v.amt,
       (select id from funds where name = v.fund),
       case when v.campaign is null then null else (select id from campaigns where name = v.campaign) end,
       case when v.appeal is null then null else (select id from appeals where name = v.appeal) end,
       v.method, v.pledge_id::uuid, v.installment_id::uuid, v.recurring_id::uuid,
       '11111111-1111-4111-8111-111111111111'
from (values
 -- Dovid Cohen — £65,000 lifetime, £71,500 with Rivky (household rollup)
 ('c0000000-0000-4000-8000-000000000001', date '2023-12-01',  8000::numeric,'Kollel',       null::text,          null::text,         'bank_transfer', null::text, null::text, null::text),
 ('c0000000-0000-4000-8000-000000000001', date '2024-11-15', 12000,        'General',      null,                null,               'bank_transfer', null, null, null),
 ('c0000000-0000-4000-8000-000000000001', date '2025-11-20', 20000,        'Building',     'Building Campaign', null,               'bank_transfer', null, null, null),
 ('c0000000-0000-4000-8000-000000000001', date '2026-03-12', 15000,        'Scholarships', null,                'Purim Appeal 2026','bank_transfer', null, null, null),
 ('c0000000-0000-4000-8000-000000000001', date '2026-03-15',  5000,        'Building',     'Building Campaign', null,               'bank_transfer',
    'f0000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001', null),
 ('c0000000-0000-4000-8000-000000000001', date '2026-06-15',  5000,        'Building',     'Building Campaign', null,               'bank_transfer',
    'f0000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000002', null),
 ('c0000000-0000-4000-8000-000000000002', date '2025-06-10',  4000,        'General',      null,                null,               'card', null, null, null),
 ('c0000000-0000-4000-8000-000000000002', date '2026-02-01',  2500,        'Scholarships', null,                'Purim Appeal 2026','card', null, null, null),
 ('c0000000-0000-4000-8000-000000000003', date '2025-11-10',  2000,        'Building',     'Building Campaign', null,               'bank_transfer', null, null, null),
 ('c0000000-0000-4000-8000-000000000003', current_date - 39,   150,        'General',      null,                null,               'standing_order', null, null, 'f2000000-0000-4000-8000-000000000001'),
 ('c0000000-0000-4000-8000-000000000003', current_date - 70,   150,        'General',      null,                null,               'standing_order', null, null, 'f2000000-0000-4000-8000-000000000001'),
 ('c0000000-0000-4000-8000-000000000003', current_date - 100,  150,        'General',      null,                null,               'standing_order', null, null, 'f2000000-0000-4000-8000-000000000001'),
 ('c0000000-0000-4000-8000-000000000003', current_date - 131,  150,        'General',      null,                null,               'standing_order', null, null, 'f2000000-0000-4000-8000-000000000001'),
 ('c0000000-0000-4000-8000-000000000004', date '2024-03-02',   360,        'Kollel',       null,                null,               'cheque', null, null, null),
 ('c0000000-0000-4000-8000-000000000004', date '2025-01-20',   500,        'General',      null,                null,               'bank_transfer', null, null, null),
 ('c0000000-0000-4000-8000-000000000004', date '2026-01-15',   500,        'General',      null,                null,               'bank_transfer', null, null, null),
 ('c0000000-0000-4000-8000-000000000008', date '2024-11-18', 18000,        'Building',     'Building Campaign', null,               'bank_transfer', null, null, null),
 ('c0000000-0000-4000-8000-000000000008', date '2025-11-20', 25000,        'Building',     'Building Campaign', null,               'bank_transfer', null, null, null),
 ('c0000000-0000-4000-8000-000000000009', date '2024-02-14',  1200,        'General',      null,                null,               'card', null, null, null),
 ('c0000000-0000-4000-8000-000000000009', date '2025-02-10',  1500,        'General',      null,                null,               'card', null, null, null),
 ('c0000000-0000-4000-8000-000000000009', date '2026-02-20',  1800,        'General',      null,                'Purim Appeal 2026','card', null, null, null),
 -- Yanky Katz: no declaration yet, so his gifts sit at pending_declaration
 ('c0000000-0000-4000-8000-00000000000a', date '2025-04-01',   180,        'General',      null,                null,               'cash', null, null, null),
 ('c0000000-0000-4000-8000-00000000000a', date '2026-04-10',   360,        'General',      null,                null,               'bank_transfer', null, null, null),
 ('c0000000-0000-4000-8000-00000000000b', date '2026-05-05',  1000,        'Scholarships', null,                null,               'bank_transfer', null, null, null),
 -- Aron Berger: gave last year, nothing this year -> LYBUNT
 ('c0000000-0000-4000-8000-00000000000c', date '2024-07-20',   750,        'General',      null,                null,               'cheque', null, null, null),
 ('c0000000-0000-4000-8000-00000000000c', date '2025-07-15',   750,        'General',      null,                null,               'cheque', null, null, null),
 ('c0000000-0000-4000-8000-00000000000d', date '2025-06-05',   500,        'General',      null,                null,               'card', null, null, null),
 ('c0000000-0000-4000-8000-00000000000d', date '2026-06-01',   500,        'General',      null,                null,               'card', null, null, null),
 -- Feld Brothers Ltd is a company, so Gift Aid is ineligible by construction
 ('c0000000-0000-4000-8000-00000000000e', date '2025-12-01',  5000,        'Building',     'Building Campaign', 'Dinner 2026',      'bank_transfer', null, null, null)
) as v(contact_id, donated_on, amt, fund, campaign, appeal, method, pledge_id, installment_id, recurring_id);

insert into opportunities (id, contact_id, name, campaign_id, fund_id, ask_amount, ask_date,
   projection_high, projection_low, probability_pct, expected_amount, stage, stage_entered_at,
   last_moved_forward_at, expected_decision_on, motivation, status, opened_on, notes)
select 'a0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000003','Building proposal',
   (select id from campaigns where name='Building Campaign'), (select id from funds where name='Building'),
   35000, current_date - 14, 50000, 25000, 60, 35000, 'solicited', now() - interval '14 days',
   now() - interval '14 days', current_date + 21,
   'Wants his father''s name on the beis medrash.', 'open', current_date - 90,
   'Asked for £35k at the office visit; wants to see the naming schedule first.';

-- deliberately stale: last_moved_forward_at is 130 days back, past the
-- stale_prospects threshold of 90 (08 §3)
insert into opportunities (id, contact_id, name, campaign_id, fund_id, ask_amount,
   projection_high, projection_low, probability_pct, expected_amount, stage, stage_entered_at,
   last_moved_forward_at, status, opened_on, notes)
select 'a0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-00000000000e','Dinner 2026 corporate sponsorship',
   (select id from campaigns where name='Building Campaign'), (select id from funds where name='General'),
   15000, 20000, 10000, 30, 12000, 'cultivating', now() - interval '130 days',
   now() - interval '130 days', 'open', current_date - 150,
   'Both brothers must agree; nothing has moved since the site visit.';

-- notify = true, so the tribute trigger opens the acknowledgee-letter task
insert into tributes (donation_id, tribute_type, honoree_name, acknowledgee_name, acknowledgee_address, notify)
select d.id, 'in_memory', 'Reb Yaakov Katz z"l', 'Mrs S. Katz', '40 The Ridgeway, London NW11 8QP', true
from donations d
where d.contact_id = 'c0000000-0000-4000-8000-000000000008' and d.donated_on = date '2025-11-20';


-- ============================================================================
-- §3. Timeline, tasks (one of every status), notes — then the live first gift
-- ============================================================================

insert into interactions (contact_id, occurred_at, kind, status, team_member_id, summary, outcome,
                          is_meaningful, location, attendees, purpose, ask_amount, source, created_by)
select v.cid::uuid, v.at, v.kind, v.status, '11111111-1111-4111-8111-111111111111',
       v.summary, v.outcome, v.meaningful, v.location, v.attendees, v.purpose, v.ask,
       v.source, '11111111-1111-4111-8111-111111111111'
from (values
 ('c0000000-0000-4000-8000-000000000001', now() - interval '12 days','meeting','logged',
   'Met in London. Very warm. Strong interest in the building project; discussed £20,000.',
   'Wants to see the naming opportunities → next: call after Sukkos', true,
   'Cohen & Partner, Hatton Garden','Dovid Cohen, R'' Braun','Building campaign — naming', 20000::numeric,'quick_capture_ai'),
 ('c0000000-0000-4000-8000-000000000001', now() - interval '74 days','whatsapp','logged',
   'Sent Shavuos wishes; he replied warmly, mentioned a business trip to Antwerp.',
   null, true, null,null,null,null,'manual'),
 ('c0000000-0000-4000-8000-000000000002', now() - interval '40 days','whatsapp','logged',
   'Thanked her for organising the bake sale; she asked for 50 more raffle books.',
   null, true, null,null,null,null,'manual'),
 ('c0000000-0000-4000-8000-000000000003', now() - interval '20 days','meeting','logged',
   'Office visit. Walked through the building plans and asked for £35,000.',
   'Asked for the naming schedule before deciding', true,
   'Adler Textiles','Reuven Adler, R'' Braun','Building proposal', 35000,'manual'),
 -- tomorrow 14:00: the nightly meeting_reminder rule picks this up today
 ('c0000000-0000-4000-8000-000000000003', current_date + 1 + time '14:00','meeting','scheduled',
   'Office visit — building campaign proposal', null, true,
   'Adler Textiles, Brent Cross','Reuven Adler, R'' Braun','Walk through the naming schedule', null,'manual'),
 ('c0000000-0000-4000-8000-000000000004', now() - interval '120 days','call','logged',
   'Long call about the new zman; asked after the shiur schedule.', null, true, null,null,null,null,'manual'),
 ('c0000000-0000-4000-8000-000000000006', now() - interval '4 days','call','logged',
   'Introduced the yeshiva after the Purim mailing; he asked how to give.',
   'Said he would send something small to start', true, null,null,null,null,'manual'),
 ('c0000000-0000-4000-8000-000000000008', now() - interval '92 days','meeting','logged',
   'Breakfast in the City. Spoke about the kollel expansion; no ask made.',
   'Wants to see audited accounts before the next conversation', true,
   'Ivy City Garden','Naftoli Katz, R'' Braun','Cultivation', null,'manual'),
 ('c0000000-0000-4000-8000-000000000009', now() - interval '25 days','whatsapp','logged',
   'Asked about the dinner journal ad; he said to send the rate card.', null, true, null,null,null,null,'manual'),
 ('c0000000-0000-4000-8000-00000000000a', now() - interval '16 days','email','logged',
   'Sent the Gift Aid declaration form for signature.', 'Awaiting the signed form', true, null,null,null,null,'manual'),
 ('c0000000-0000-4000-8000-00000000000b', now() - interval '35 days','call','logged',
   'Caught up after the scholarship gift; discussed a possible visit.', null, true, null,null,null,null,'manual'),
 ('c0000000-0000-4000-8000-00000000000c', now() - interval '200 days','letter','logged',
   'Sent the annual report with a handwritten note.', null, true, null,null,null,null,'manual'),
 ('c0000000-0000-4000-8000-00000000000d', now() - interval '45 days','call','logged',
   'Took her Gift Aid declaration over the phone.', 'Written confirmation still to send', true, null,null,null,null,'manual'),
 ('c0000000-0000-4000-8000-00000000000e', now() - interval '130 days','meeting','logged',
   'Site visit with both brothers; sponsorship pack left with them.', null, true,
   'The yeshiva','Shmuel Feld, Yidel Feld','Corporate sponsorship', 15000,'manual'),
 ('c0000000-0000-4000-8000-00000000000f', now() - interval '10 days','call','logged',
   'Asked him to open a door to the Frankels; he agreed to speak to them.', null, true, null,null,null,null,'manual'),
 -- not meaningful (weight 0), so it must NOT reset days_since_contact
 ('c0000000-0000-4000-8000-000000000001', now() - interval '169 days','receipt_sent','logged',
   'Receipt for the £15,000 Purim gift emailed.', null, false, null,null,null,null,'manual')
) as v(cid, at, kind, status, summary, outcome, meaningful, location, attendees, purpose, ask, source);

insert into tasks (contact_id, opportunity_id, title, action_type, details, assigned_to, due_on,
                   priority, status, waiting_for, queue_order, completed_at, origin, created_by)
select v.cid::uuid, v.opp::uuid, v.title, v.atype, v.details,
       '11111111-1111-4111-8111-111111111111', v.due, v.prio, v.status, v.waiting, v.qorder,
       v.completed, 'manual', '11111111-1111-4111-8111-111111111111'
from (values
 -- overdue: this is what makes Dovid Cohen's flag red
 ('c0000000-0000-4000-8000-000000000001', null::text,'Call re proposal','call',
   'He asked to talk after Sukkos about the £20k for the building.', current_date - 3,'high','todo',null::text,null::int,null::timestamptz),
 -- dateless, queued behind the active next action (D8)
 ('c0000000-0000-4000-8000-000000000001', null,'Send naming opportunities pack','send_proposal',
   'Queued behind the call — send once he has said yes in principle.', null,'medium','queued',null,1,null),
 ('c0000000-0000-4000-8000-000000000009', null,'WhatsApp — dinner journal ad','whatsapp',
   'Send the rate card and last year''s artwork.', current_date - 1,'high','todo',null,null,null),
 -- blue flag: the ball is in his court
 ('c0000000-0000-4000-8000-00000000000a', null,'Gift Aid form','other',
   'Declaration form sent by email; waiting on the signed copy.', current_date + 5,'medium','waiting',
   'Yanky — Gift Aid form sent 12 Aug',null,null),
 ('c0000000-0000-4000-8000-000000000002', null,'Draft the bake-sale thank-you list','send_email',
   'Names from Rivky; one letter each.', current_date + 2,'medium','in_progress',null,null,null),
 ('c0000000-0000-4000-8000-000000000008', null,'Send Yom Tov letter','send_update',
   'Personal letter with the kollel expansion update.', current_date - 12,'medium','done',null,null, now() - interval '10 days'),
 ('c0000000-0000-4000-8000-00000000000c', null,'Invite to the dinner','invite_event',
   'Decided against — he has not given since last summer; a call first.', current_date - 30,'low','cancelled',null,null,null),
 ('c0000000-0000-4000-8000-00000000000f', null,'Ask about an introduction to the Frankels','speak_to_introducer',
   'He offered — follow up while it is fresh.', current_date + 7,'high','todo',null,null,null),
 ('c0000000-0000-4000-8000-00000000000e','a0000000-0000-4000-8000-000000000002','Chase the sponsorship decision','follow_up_proposal',
   'Nothing has moved since the site visit.', current_date + 3,'medium','todo',null,null,null),
 ('c0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001','Bring the naming schedule to the meeting','send_proposal',
   'Print the naming schedule and the projected budget.', current_date + 1,'high','todo',null,null,null)
) as v(cid, opp, title, atype, details, due, prio, status, waiting, qorder, completed);
-- NOTE: Baruch Reich deliberately gets NO task and has no KIT cadence — he is
-- the yellow "needs a next action" row on the Action Stream (I-3).

-- org-level work anchored on the organisation-self contact (I-2)
insert into tasks (contact_id, title, action_type, details, assigned_to, due_on, priority, status, origin, created_by)
select id,'File the rolling Gift Aid claim','other','Rolling draft claim is ready to review and submit to HMRC.',
       '11111111-1111-4111-8111-111111111111', current_date + 10,'medium','todo','manual',
       '11111111-1111-4111-8111-111111111111'
from contacts where is_organisation_self;

insert into notes (id, contact_id, category, body, is_private, is_pinned, created_by) values
 ('b0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','personal',
  'Prefers calls after 8pm; ask about his son''s chabura in Gateshead; never solicit at shul.',
  false, true, '11111111-1111-4111-8111-111111111111'),
 ('b0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000001','giving',
  'Where we''re holding: discussed £20k for the building in June; he asked to talk after Sukkos.',
  false, false, '11111111-1111-4111-8111-111111111111'),
 -- private: invisible to the fundraiser account, proving the 11 §2 rule
 ('b0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000008','sensitive',
  'Family matter this year — do not press for a decision before Pesach.',
  true, false, '11111111-1111-4111-8111-111111111111'),
 ('b0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000003','giving',
  'Standing order has been reliable since 2023 — a failure is a signal, not an accident.',
  false, false, '11111111-1111-4111-8111-111111111111');

update contacts set pinned_note_id = 'b0000000-0000-4000-8000-000000000001'
 where id = 'c0000000-0000-4000-8000-000000000001';

-- ---- back to live: re-arm the two gift triggers before the Klein gift ------
update automation_rules set is_enabled = true
 where rule_key in ('thank_you_on_gift','first_gift_call');

insert into gift_aid_declarations (contact_id, declared_on, method, wording_version, covers_past, covers_future)
values ('c0000000-0000-4000-8000-000000000006', current_date - 3, 'online','HMRC-2016', true, true);

-- The one gift that fires the live triggers: thank-you task + first-gift signal.
insert into donations (contact_id, donated_on, amount, currency, amount_gbp, fund_id, appeal_id,
                       payment_method, created_by)
select 'c0000000-0000-4000-8000-000000000006', current_date - 3, 180, 'GBP', 180,
       (select id from funds where name='General'),
       (select id from appeals where name='Purim Appeal 2026'),
       'card', '11111111-1111-4111-8111-111111111111';


-- ============================================================================
-- §4. The generated base: ~100 contacts, three years of giving (~380 gifts)
-- ============================================================================
-- setseed makes this reproducible: the same seed rebuilds the same demo set.

update automation_rules set is_enabled = false
 where rule_key in ('thank_you_on_gift','first_gift_call');

do $$
declare
  firsts text[] := array['Avrohom','Yaakov','Moshe','Shimon','Yehuda','Shloime','Menachem','Eliyahu',
                         'Nochum','Zev','Binyomin','Yisroel','Chaim','Ephraim','Meir','Yosef',
                         'Aryeh','Boruch','Mordechai','Sruli'];
  lasts  text[] := array['Rosenberg','Schwartz','Friedman','Brodie','Gluck','Lieberman','Halpern',
                         'Sternbuch','Ehrlich','Margulies','Zilberman','Ostreicher','Kaufman','Pollak',
                         'Rothstein','Berkovits','Neuwirth','Deutsch','Grunwald','Salzman'];
  stages text[] := array['active_donor','recurring_donor','stewardship','keep_in_touch','cultivation',
                         'prospect','follow_up','contacted','in_discussion','inactive'];
  kinds  text[] := array['call','whatsapp','email','meeting','event','letter'];
  cities text[] := array['London','Manchester','Gateshead','Stamford Hill','Golders Green','Hendon'];
  amounts numeric[] := array[36,54,100,180,250,360,500,1000,1800,5000];
  i int; j int; n int;
  v_id uuid; v_first text; v_last text; v_date date; v_amt numeric;
  v_lybunt boolean; v_fund uuid; v_freq int;
  fund_ids uuid[];
  camp_building uuid; ap_dinner uuid; ap_purim uuid;
  admin_id uuid := '11111111-1111-4111-8111-111111111111';
begin
  perform setseed(0.4242);
  select array_agg(id order by name) into fund_ids from funds;
  select id into camp_building from campaigns where name = 'Building Campaign';
  select id into ap_dinner from appeals where name = 'Dinner 2026';
  select id into ap_purim  from appeals where name = 'Purim Appeal 2026';

  for i in 0..99 loop
    v_first := firsts[(i % 20) + 1];
    v_last  := lasts[(i / 5) + 1];
    v_lybunt := (i % 5 = 0);
    v_freq := case when i % 8 = 0 then 90 when i % 8 = 1 then 180 else null end;
    v_id := gen_random_uuid();

    insert into contacts (id, title, first_name, last_name, contact_kind, email, phone, whatsapp,
      city, country, source, relationship_owner_id, relationship_strength, known_since,
      stage, priority, tier, estimated_capacity, contact_frequency_days, preferred_channel)
    values (v_id,
      case when i % 9 = 0 then 'Rabbi' else 'Mr' end,
      v_first, v_last, 'individual',
      lower(v_first) || '.' || lower(v_last) || i || '@example.test',
      '+44770090' || lpad(i::text, 4, '0'),
      '+44770090' || lpad(i::text, 4, '0'),
      cities[(i % 6) + 1], 'United Kingdom',
      case when i % 3 = 0 then 'Dinner 2024' when i % 3 = 1 then 'Purim mailing' else 'Referral' end,
      admin_id,
      1 + (i % 10),
      (current_date - ((400 + i * 11) || ' days')::interval)::date,
      stages[(i % 10) + 1],
      case when i % 11 = 0 then 'high' when i % 3 = 0 then 'low' else 'medium' end,
      case when i % 17 = 0 then 'A' when i % 5 = 0 then 'B' when i % 2 = 0 then 'C' else 'D' end,
      (1 + (i % 20)) * 2500,
      v_freq,
      case when i % 4 = 0 then 'call' when i % 4 = 1 then 'whatsapp' else 'send_email' end);

    -- one logged interaction each, so days_since_contact / KIT / neglect are real
    insert into interactions (contact_id, occurred_at, kind, status, team_member_id, summary,
                              is_meaningful, source, created_by)
    values (v_id,
      now() - ((floor(random() * 400))::int || ' days')::interval,
      kinds[(i % 6) + 1], 'logged', admin_id,
      'Logged during the ' || (2024 + (i % 3))::text || ' appeal round.',
      true, 'import', admin_id);

    -- Gift Aid declarations on ~60% of the base
    if (i % 10) < 6 then
      insert into gift_aid_declarations (contact_id, declared_on, method, wording_version,
                                         covers_past, covers_future)
      values (v_id, (current_date - ((300 + i * 3) || ' days')::interval)::date,
              case when i % 3 = 0 then 'written' when i % 3 = 1 then 'online' else 'oral' end,
              'HMRC-2016', true, true);
      -- oral declarations only count once the written confirmation has gone out
      update gift_aid_declarations
         set oral_confirmation_sent_on = declared_on + 7
       where contact_id = v_id and method = 'oral' and (i % 6) <> 5;
    end if;

    n := 2 + (i % 4) + case when i % 7 = 0 then 2 else 0 end;
    for j in 1..n loop
      if v_lybunt then
        -- gave last year, nothing this year: the LYBUNT cohort
        v_date := (date_trunc('year', current_date) - interval '1 year')::date
                    + (floor(random() * 330))::int;
      else
        v_date := current_date - (floor(random() * 1080))::int;
      end if;
      v_amt := amounts[1 + (((i * 7) + (j * 3)) % 10)];
      v_fund := fund_ids[1 + ((i + j) % array_length(fund_ids, 1))];

      insert into donations (contact_id, donated_on, amount, currency, amount_gbp, fund_id,
                             campaign_id, appeal_id, payment_method, created_by)
      values (v_id, v_date, v_amt, 'GBP', v_amt, v_fund,
              case when v_fund = fund_ids[1] then camp_building else null end,
              case when extract(year from v_date) = extract(year from current_date)
                   then case when (i + j) % 2 = 0 then ap_dinner else ap_purim end
                   else null end,
              (array['bank_transfer','standing_order','card','cash','cheque','voucher_agency'])[1 + ((i + j) % 6)],
              admin_id);
    end loop;
  end loop;

  -- one deliberate duplicate pair, so the merge queue (06 §5) has real input
  insert into contacts (first_name, last_name, contact_kind, email, phone, city, country,
                        source, relationship_owner_id, stage, priority, tier)
  values (firsts[1], lasts[1], 'individual', 'a.rosenberg.dup@example.test', '+447700900000',
          'London', 'United Kingdom', 'Dinner 2024', admin_id, 'prospect', 'low', 'D');
end $$;

update automation_rules set is_enabled = true
 where rule_key in ('thank_you_on_gift','first_gift_call');

update contacts set relationship_owner_id = '11111111-1111-4111-8111-111111111111'
 where relationship_owner_id is null;


-- ============================================================================
-- §5. Two shaping passes that make the demo read like a real portfolio
-- ============================================================================

-- Without this every contact is "created today", which the engagement rule
-- correctly reads as insufficient data — so every pill would say "unknown"
-- (02 §4.3). Backdate creation to when the relationship actually began.
update contacts c
   set created_at = coalesce(
         c.known_since::timestamptz,
         (select min(d.donated_on)::timestamptz from donations d where d.contact_id = c.id),
         (select min(i.occurred_at) from interactions i where i.contact_id = c.id),
         now() - interval '400 days')
 where not c.is_organisation_self;

-- Long-lapsed donors are parked in an inactive stage (they never earn the
-- yellow flag, 03 §2); live donors without a cadence get one. Without this the
-- generated base produces ~73 yellow rows, which is not a portfolio, it is a
-- rendering of "nobody has ever worked this list".
update contacts c
   set stage = 'inactive'
from contact_stats cs
where cs.contact_id = c.id
  and c.id not in (select id from contacts where id::text like 'c0000000-%')
  and not c.is_organisation_self
  and cs.donor_status = 'lapsed'
  and c.contact_frequency_days is null
  and c.stage not in ('inactive','not_interested','archived');

update contacts c
   set contact_frequency_days = 120
from contact_stats cs
where cs.contact_id = c.id
  and c.id not in (select id from contacts where id::text like 'c0000000-%')
  and not c.is_organisation_self
  and c.contact_frequency_days is null
  and cs.donor_status in ('active','new','pre_lapsed');


-- ============================================================================
-- §6. Finally: let the nightly run populate KIT tasks, signals and scores.
--     Running it twice is the idempotency check — the second run must report
--     zero of everything it creates.
-- ============================================================================
-- select run_nightly();
-- select run_nightly();
