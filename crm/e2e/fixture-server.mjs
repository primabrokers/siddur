#!/usr/bin/env node
/**
 * Offline fixture server — a **development harness**, never shipped.
 *
 * Speaks just enough PostgREST + GoTrue for the app to render the M1 surfaces
 * without a database: it answers `/auth/v1/token` with a fake session and
 * `/rest/v1/<table>` with the A2 wireframe's data (Dovid Cohen and the
 * SmartList rows). Used to check the real-browser layout while the live
 * project is still being provisioned; the live check uses
 * `e2e/supabase-relay.mjs` against Supabase instead.
 *
 *   node e2e/fixture-server.mjs --port 5434
 *   VITE_SUPABASE_URL=http://127.0.0.1:5434 npm run dev
 */

import { createServer } from 'node:http'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 ? process.argv[index + 1] : fallback
}
const PORT = Number(arg('port', 5434))

const today = new Date()
const iso = (d) => d.toISOString().slice(0, 10)
const daysFromNow = (n) => iso(new Date(today.getTime() + n * 86_400_000))

const BRAUN = '11111111-1111-1111-1111-111111111111'
const DOVID = 'aaaaaaaa-0000-0000-0000-000000000001'
const RIVKY = 'aaaaaaaa-0000-0000-0000-000000000002'
const WEISS = 'aaaaaaaa-0000-0000-0000-000000000003'
const HOUSE = 'bbbbbbbb-0000-0000-0000-000000000001'

// M2 (Action Stream) cast — the people in Main.dc.html / MobileToday.dc.html.
const ADLER = 'aaaaaaaa-0000-0000-0000-000000000008'
const KLEIN = 'aaaaaaaa-0000-0000-0000-000000000009'
const REICH = 'aaaaaaaa-0000-0000-0000-000000000010'
const KATZ = 'aaaaaaaa-0000-0000-0000-000000000011'
const GOLDSTEIN = 'aaaaaaaa-0000-0000-0000-000000000012'
const SFELD = 'aaaaaaaa-0000-0000-0000-000000000013'
const nowAt = (hour, minute = 0) =>
  new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, minute, 0).toISOString()

const contactBase = {
  title: null,
  hebrew_name: null,
  organization: null,
  position: null,
  industry: null,
  contact_kind: 'individual',
  is_organisation_self: false,
  photo_url: null,
  household_id: null,
  email: null,
  phone: null,
  whatsapp: null,
  preferred_language: 'en',
  preferred_channel: null,
  best_time_to_contact: null,
  assistant_name: null,
  assistant_contact: null,
  linkedin_url: null,
  website_url: null,
  address_line1: null,
  address_line2: null,
  city: null,
  postcode: null,
  country: 'United Kingdom',
  source: null,
  introduced_by_id: null,
  introduced_by_note: null,
  relationship_owner_id: BRAUN,
  relationship_strength: null,
  known_since: null,
  mutual_connections: null,
  birthday: null,
  spouse_name: null,
  family_notes: null,
  things_to_remember: null,
  stage: 'keep_in_touch',
  priority: 'medium',
  tier: null,
  estimated_capacity: null,
  contact_frequency_days: null,
  kit_paused_until: null,
  engagement_score: null,
  engagement_tier: 'unknown',
  pinned_note_id: null,
  is_archived: false,
  merged_into_id: null,
}

const statsBase = {
  lifetime_giving: null,
  this_year_giving: null,
  last_year_giving: null,
  soft_credit_lifetime: null,
  soft_credit_this_year: null,
  gift_count: 0,
  largest_gift: null,
  average_gift: null,
  first_gift_on: null,
  first_gift_amount: null,
  last_gift_on: null,
  last_gift_amount: null,
  is_lybunt: false,
  is_sybunt: false,
  pledge_balance: null,
  last_contact_at: null,
  last_contact_kind: null,
  days_since_contact: null,
  kit_due_on: null,
  open_task_count: 0,
  next_action_id: null,
  next_action_title: null,
  next_action_due_on: null,
  next_action_type: null,
  flag: 'none',
  donor_status: 'prospect',
  has_ga_declaration: false,
}

const DB = {
  team_members: [{ id: BRAUN, full_name: "R' Braun", role: 'admin', email: 'admin@demo.test' }],

  lookup_options: [
    ...['prospect|Prospect', 'cultivation|Cultivation', 'in_discussion|In discussion', 'active_donor|Active donor', 'stewardship|Stewardship', 'keep_in_touch|Keep in touch'].map(
      (v, i) => ({ list_name: 'stage', value: v.split('|')[0], label: v.split('|')[1], sort_order: i, color: null, meta: {}, is_active: true }),
    ),
    ...['call|Call', 'whatsapp|WhatsApp', 'email|Email', 'meeting|Meeting', 'event|Event', 'letter|Letter'].map((v, i) => ({
      list_name: 'interaction_kind', value: v.split('|')[0], label: v.split('|')[1], sort_order: i, color: null, meta: {}, is_active: true,
    })),
    ...['call|Call', 'whatsapp|WhatsApp', 'send_email|Send email', 'arrange_meeting|Arrange meeting', 'thank_you|Thank you', 'keep_in_touch|Keep in touch'].map((v, i) => ({
      list_name: 'action_type', value: v.split('|')[0], label: v.split('|')[1], sort_order: i, color: null, meta: {}, is_active: true,
    })),
    ...['high|High', 'medium|Medium', 'low|Low'].map((v, i) => ({ list_name: 'priority', value: v.split('|')[0], label: v.split('|')[1], sort_order: i, color: null, meta: {}, is_active: true })),
    ...['general|General', 'personal|Personal', 'family|Family', 'giving|Giving'].map((v, i) => ({ list_name: 'note_category', value: v.split('|')[0], label: v.split('|')[1], sort_order: i, color: null, meta: {}, is_active: true })),
    ...['proposal|Proposal', 'letter|Letter', 'photo|Photo'].map((v, i) => ({ list_name: 'document_kind', value: v.split('|')[0], label: v.split('|')[1], sort_order: i, color: null, meta: {}, is_active: true })),
    // M4 (Giving): the two lists gift entry reads (02 §6, §3.15).
    ...['bank_transfer|Bank transfer', 'standing_order|Standing order', 'card|Card', 'cash|Cash', 'contactless|Contactless', 'cheque|Cheque', 'voucher_agency|Voucher agency', 'other|Other'].map((v, i) => ({
      list_name: 'payment_method', value: v.split('|')[0], label: v.split('|')[1], sort_order: i, color: null, meta: {}, is_active: true,
    })),
    ...['in_honor|In honour of', 'in_memory|In memory of', 'yahrzeit|Yahrzeit', 'simcha|Simcha'].map((v, i) => ({
      list_name: 'tribute_type', value: v.split('|')[0], label: v.split('|')[1], sort_order: i, color: null, meta: {}, is_active: true,
    })),
  ],

  households: [
    {
      id: HOUSE,
      name: 'Cohen Family',
      name_is_override: false,
      formal_greeting: 'Rabbi & Mrs. Cohen',
      informal_greeting: 'Dovid & Rivky',
      hebrew_greeting: null,
      greeting_is_override: false,
      primary_contact_id: DOVID,
    },
  ],

  contacts: [
    {
      ...contactBase,
      id: DOVID,
      first_name: 'Dovid',
      last_name: 'Cohen',
      hebrew_name: 'דוד הכהן',
      household_id: HOUSE,
      email: 'dovid.cohen@example.com',
      phone: '+447700900123',
      whatsapp: '+447700900123',
      preferred_channel: 'call',
      best_time_to_contact: 'after 8pm',
      position: 'Director',
      organization: 'Cohen & Partner',
      industry: 'Property',
      city: 'Golders Green',
      postcode: 'NW11 8AA',
      address_line1: '12 The Drive',
      introduced_by_id: WEISS,
      relationship_strength: 9,
      mutual_connections: "R' Weiss, the Feld brothers",
      birthday: '1975-11-14',
      spouse_name: 'Rivky',
      family_notes: '5 children, eldest in Gateshead yeshiva',
      things_to_remember: 'Never solicit at shul',
      stage: 'in_discussion',
      priority: 'high',
      tier: 'A',
      contact_frequency_days: 60,
      engagement_score: 92,
      engagement_tier: 'hot',
      pinned_note_id: 'note-1',
    },
    { ...contactBase, id: RIVKY, first_name: 'Rivky', last_name: 'Cohen', household_id: HOUSE, city: 'Golders Green' },
    { ...contactBase, id: WEISS, first_name: 'Yaakov', last_name: 'Weiss', title: "R'", city: 'Hendon' },
    { ...contactBase, id: 'aaaaaaaa-0000-0000-0000-000000000004', first_name: 'Aron', last_name: 'Berger', city: 'Hendon', stage: 'keep_in_touch' },
    { ...contactBase, id: 'aaaaaaaa-0000-0000-0000-000000000005', first_name: 'Chaim', last_name: 'Lax', city: 'Manchester', stage: 'active_donor' },
    { ...contactBase, id: 'aaaaaaaa-0000-0000-0000-000000000006', first_name: 'Devorah', last_name: 'Frankel', title: 'Mrs', city: 'Golders Green', stage: 'stewardship' },
    {
      ...contactBase,
      id: 'aaaaaaaa-0000-0000-0000-000000000007',
      first_name: 'Feld Brothers',
      last_name: 'Ltd',
      organization: 'Feld Brothers Ltd',
      contact_kind: 'business',
      city: 'London',
      stage: 'cultivation',
    },
    { ...contactBase, id: ADLER, first_name: 'Reuven', last_name: 'Adler', city: 'Golders Green', stage: 'active_donor', phone: '+447700900201', whatsapp: '+447700900201', priority: 'high', things_to_remember: 'Prefers a call to an email — always.' },
    { ...contactBase, id: KLEIN, first_name: 'Klein', last_name: 'Family', city: 'Edgware', stage: 'cultivation', phone: '+447700900202', whatsapp: '+447700900202' },
    { ...contactBase, id: REICH, first_name: 'Baruch', last_name: 'Reich', city: 'Hendon', stage: 'in_discussion', phone: '+447700900203' },
    { ...contactBase, id: KATZ, first_name: 'Yanky', last_name: 'Katz', city: 'Golders Green', stage: 'stewardship', phone: '+447700900204', whatsapp: '+447700900204', tier: 'A' },
    { ...contactBase, id: GOLDSTEIN, first_name: 'Goldstein', last_name: 'Family', city: 'Manchester', stage: 'keep_in_touch', contact_frequency_days: 60, phone: '+447700900205' },
    { ...contactBase, id: SFELD, first_name: 'Shmuel', last_name: 'Feld', city: 'London', stage: 'active_donor', phone: '+447700900206', whatsapp: '+447700900206' },
  ],

  contact_stats: [
    {
      ...statsBase,
      contact_id: DOVID,
      lifetime_giving: 65000,
      this_year_giving: 15000,
      last_year_giving: 20000,
      soft_credit_lifetime: 6500,
      soft_credit_this_year: 0,
      gift_count: 7,
      largest_gift: 20000,
      average_gift: 9286,
      first_gift_on: '2019-05-02',
      first_gift_amount: 1000,
      last_gift_on: '2026-03-12',
      last_gift_amount: 15000,
      pledge_balance: 15000,
      last_contact_at: `${daysFromNow(-12)}T10:00:00Z`,
      last_contact_kind: 'meeting',
      days_since_contact: 12,
      kit_due_on: daysFromNow(48),
      open_task_count: 1,
      next_action_id: 'task-1',
      next_action_title: 'Call re proposal',
      next_action_due_on: daysFromNow(-4),
      next_action_type: 'call',
      flag: 'overdue',
      donor_status: 'active',
      has_ga_declaration: true,
    },
    { ...statsBase, contact_id: RIVKY, lifetime_giving: 6500, this_year_giving: 0, gift_count: 2, days_since_contact: 40, flag: 'future', donor_status: 'lapsed', next_action_title: 'Send the newsletter', next_action_due_on: daysFromNow(12), next_action_type: 'send_email' },
    { ...statsBase, contact_id: WEISS, lifetime_giving: 3000, days_since_contact: 20, flag: 'waiting', donor_status: 'active', next_action_title: 'Awaiting his introduction', next_action_due_on: daysFromNow(3) },
    { ...statsBase, contact_id: 'aaaaaaaa-0000-0000-0000-000000000004', lifetime_giving: 1800, last_year_giving: 1800, is_lybunt: true, days_since_contact: 104, flag: 'none', donor_status: 'pre_lapsed' },
    { ...statsBase, contact_id: 'aaaaaaaa-0000-0000-0000-000000000005', lifetime_giving: 3600, this_year_giving: 3600, days_since_contact: 71, flag: 'future', donor_status: 'active', next_action_title: 'Dinner invite', next_action_due_on: daysFromNow(6), next_action_type: 'invite_event' },
    { ...statsBase, contact_id: 'aaaaaaaa-0000-0000-0000-000000000006', lifetime_giving: 950, this_year_giving: 950, days_since_contact: 58, flag: 'today', donor_status: 'active', next_action_title: 'Call', next_action_due_on: daysFromNow(0), next_action_type: 'call' },
    { ...statsBase, contact_id: 'aaaaaaaa-0000-0000-0000-000000000007', lifetime_giving: 5000, last_year_giving: 5000, is_lybunt: true, days_since_contact: 96, flag: 'none', donor_status: 'pre_lapsed' },
    { ...statsBase, contact_id: ADLER, lifetime_giving: 18400, this_year_giving: 1800, gift_count: 14, days_since_contact: 9, flag: 'future', donor_status: 'active' },
    { ...statsBase, contact_id: KLEIN, lifetime_giving: 180, this_year_giving: 180, gift_count: 1, first_gift_on: daysFromNow(-3), first_gift_amount: 180, last_gift_on: daysFromNow(-3), last_gift_amount: 180, days_since_contact: 3, flag: 'today', donor_status: 'new' },
    { ...statsBase, contact_id: REICH, lifetime_giving: 2600, last_year_giving: 2600, is_lybunt: true, days_since_contact: 34, flag: 'none', donor_status: 'pre_lapsed' },
    { ...statsBase, contact_id: KATZ, lifetime_giving: 42000, this_year_giving: 0, gift_count: 9, days_since_contact: 92, flag: 'waiting', donor_status: 'pre_lapsed' },
    { ...statsBase, contact_id: GOLDSTEIN, lifetime_giving: 7400, this_year_giving: 400, gift_count: 11, days_since_contact: 63, kit_due_on: daysFromNow(0), flag: 'today', donor_status: 'active' },
    { ...statsBase, contact_id: SFELD, lifetime_giving: 9200, this_year_giving: 2000, gift_count: 6, days_since_contact: 21, flag: 'overdue', donor_status: 'active' },
  ],

  // The three coding axes (02 §3.8). `is_active` drives the M4 entry selects.
  funds: [
    { id: 'f0', name: 'General', code: 'GEN', is_restricted: false, is_active: true },
    { id: 'f1', name: 'Scholarships', code: 'SCH', is_restricted: true, is_active: true },
    { id: 'f2', name: 'Building', code: 'BLD', is_restricted: true, is_active: true },
  ],
  campaigns: [
    { id: 'c1', name: 'Building campaign', goal_amount: 500000, starts_on: '2025-09-01', ends_on: null, is_active: true },
  ],
  appeals: [
    { id: 'a1', name: 'Purim appeal', campaign_id: null, year: 2026, channel: 'letter', is_active: true },
    { id: 'a2', name: 'Dinner 2026 letter', campaign_id: 'c1', year: 2026, channel: 'dinner', is_active: true },
  ],

  interactions: [
    {
      id: 'int-1', contact_id: DOVID, occurred_at: `${daysFromNow(-12)}T10:00:00Z`, kind: 'meeting', status: 'logged',
      team_member_id: BRAUN, summary: 'Met in London. Very warm. Strong interest in the building project.',
      outcome: 'wants to see the naming opportunities → next: call after Sukkos', is_meaningful: true,
      location: null, attendees: null, purpose: null, ask_amount: 20000, source: 'quick_capture_ai',
    },
    {
      id: 'int-2', contact_id: DOVID, occurred_at: '2026-06-15T09:00:00Z', kind: 'whatsapp', status: 'logged',
      team_member_id: BRAUN, summary: 'Sent Shavuos wishes; he replied warmly, mentioned a business trip to Antwerp.',
      outcome: null, is_meaningful: true, location: null, attendees: null, purpose: null, ask_amount: null, source: 'manual',
    },
    {
      id: 'int-3', contact_id: DOVID, occurred_at: `${daysFromNow(21)}T14:00:00Z`, kind: 'meeting', status: 'scheduled',
      team_member_id: BRAUN, summary: 'Naming opportunities walkthrough', outcome: null, is_meaningful: false,
      location: 'His office', purpose: 'Naming opportunities', attendees: null, ask_amount: null, source: 'manual',
    },
    {
      id: 'int-4', contact_id: ADLER, occurred_at: nowAt(14), kind: 'meeting', status: 'scheduled',
      team_member_id: BRAUN, summary: 'Office visit — building campaign proposal', outcome: null,
      is_meaningful: false, location: 'office', purpose: 'Building campaign proposal', attendees: null,
      ask_amount: null, source: 'manual',
    },
  ],

  donations: [
    {
      id: 'don-1', contact_id: DOVID, donated_on: '2026-03-12', amount: 15000, currency: 'GBP', amount_gbp: 15000,
      fund_id: 'f1', campaign_id: null, appeal_id: 'a1', payment_method: 'bank_transfer', status: 'received',
      pledge_id: null, installment_id: null, recurring_agreement_id: null, receipt_status: 'sent',
      receipt_pref: null, thank_you_status: 'done', gift_aid_status: 'claimed', gift_aid_claim_id: null, is_gasds: false, notes: null,
    },
    {
      id: 'don-2', contact_id: DOVID, donated_on: '2025-11-20', amount: 10000, currency: 'GBP', amount_gbp: 10000,
      fund_id: 'f2', campaign_id: 'c1', appeal_id: null, payment_method: 'bank_transfer', status: 'received',
      pledge_id: 'pl-1', installment_id: null, recurring_agreement_id: null, receipt_status: 'sent',
      receipt_pref: null, thank_you_status: 'done', gift_aid_status: 'claimed', gift_aid_claim_id: null, is_gasds: false, notes: null,
    },
    {
      id: 'don-3', contact_id: SFELD, donated_on: daysFromNow(-5), amount: 5000, currency: 'GBP', amount_gbp: 5000,
      fund_id: 'f1', campaign_id: null, appeal_id: null, payment_method: 'bank_transfer', status: 'received',
      pledge_id: null, installment_id: null, recurring_agreement_id: null, receipt_status: 'sent',
      receipt_pref: null, thank_you_status: 'done', gift_aid_status: 'eligible', gift_aid_claim_id: null, is_gasds: false, notes: null,
    },
    {
      id: 'don-4', contact_id: ADLER, donated_on: daysFromNow(-2), amount: 3220, currency: 'GBP', amount_gbp: 3220,
      fund_id: 'f2', campaign_id: 'c1', appeal_id: null, payment_method: 'standing_order', status: 'received',
      pledge_id: null, installment_id: null, recurring_agreement_id: null, receipt_status: 'sent',
      receipt_pref: null, thank_you_status: 'done', gift_aid_status: 'eligible', gift_aid_claim_id: null, is_gasds: false, notes: null,
    },
    {
      id: 'don-5', contact_id: KLEIN, donated_on: daysFromNow(-3), amount: 180, currency: 'GBP', amount_gbp: 180,
      fund_id: 'f1', campaign_id: null, appeal_id: null, payment_method: 'card', status: 'received',
      pledge_id: null, installment_id: null, recurring_agreement_id: null, receipt_status: 'queued',
      receipt_pref: null, thank_you_status: 'task_open', gift_aid_status: 'pending_declaration', gift_aid_claim_id: null, is_gasds: false, notes: null,
    },
    // M4 (Giving): the thanks/receipt queues and the metric windows (05 §3–§4).
    {
      id: 'don-6', contact_id: KATZ, donated_on: daysFromNow(-9), amount: 7500, currency: 'GBP', amount_gbp: 7500,
      fund_id: 'f2', campaign_id: 'c1', appeal_id: 'a2', payment_method: 'cheque', status: 'received',
      pledge_id: null, installment_id: null, recurring_agreement_id: null, receipt_status: 'not_sent',
      receipt_pref: null, thank_you_status: 'not_done', gift_aid_status: 'eligible', gift_aid_claim_id: null, is_gasds: false, notes: null,
    },
    {
      id: 'don-7', contact_id: REICH, donated_on: daysFromNow(-1), amount: 250, currency: 'GBP', amount_gbp: 250,
      fund_id: 'f0', campaign_id: null, appeal_id: 'a2', payment_method: 'bank_transfer', status: 'received',
      pledge_id: null, installment_id: null, recurring_agreement_id: null, receipt_status: 'not_sent',
      receipt_pref: null, thank_you_status: 'not_done', gift_aid_status: 'pending_declaration', gift_aid_claim_id: null, is_gasds: false, notes: null,
    },
    {
      id: 'don-8', contact_id: GOLDSTEIN, donated_on: daysFromNow(0), amount: 36, currency: 'GBP', amount_gbp: 36,
      fund_id: 'f0', campaign_id: null, appeal_id: null, payment_method: 'cash', status: 'received',
      pledge_id: null, installment_id: null, recurring_agreement_id: null, receipt_status: 'not_required',
      receipt_pref: null, thank_you_status: 'not_done', gift_aid_status: 'ineligible', gift_aid_claim_id: null, is_gasds: true, notes: 'Kiddush collection',
    },
    {
      id: 'don-9', contact_id: 'aaaaaaaa-0000-0000-0000-000000000006', donated_on: daysFromNow(-14),
      amount: 1000, currency: 'USD', amount_gbp: 790,
      fund_id: 'f1', campaign_id: null, appeal_id: null, payment_method: 'bank_transfer', status: 'received',
      pledge_id: null, installment_id: null, recurring_agreement_id: null, receipt_status: 'queued',
      receipt_pref: 'letter', thank_you_status: 'not_done', gift_aid_status: 'ineligible', gift_aid_claim_id: null, is_gasds: false, notes: null,
    },
    {
      id: 'don-10', contact_id: KATZ, donated_on: daysFromNow(-100), amount: 800, currency: 'GBP', amount_gbp: 800,
      fund_id: 'f1', campaign_id: null, appeal_id: null, payment_method: 'bank_transfer', status: 'received',
      pledge_id: 'pl-2', installment_id: 'ins-7', recurring_agreement_id: null, receipt_status: 'sent',
      receipt_pref: null, thank_you_status: 'done', gift_aid_status: 'claimed', gift_aid_claim_id: null, is_gasds: false, notes: null,
    },
  ],

  pledges: [
    {
      id: 'pl-1', contact_id: DOVID, total_amount: 25000, currency: 'GBP', amount_gbp: 25000, fund_id: 'f2',
      campaign_id: 'c1', appeal_id: null, pledged_on: '2025-10-01', status: 'open', write_off_amount: null, notes: null,
    },
    {
      id: 'pl-2', contact_id: KATZ, total_amount: 4000, currency: 'GBP', amount_gbp: 4000, fund_id: 'f1',
      campaign_id: null, appeal_id: null, pledged_on: '2025-06-01', status: 'open', write_off_amount: null, notes: null,
    },
  ],
  pledge_installments: [
    { id: 'ins-1', pledge_id: 'pl-1', due_on: '2025-11-15', amount: 5000, status: 'paid' },
    { id: 'ins-2', pledge_id: 'pl-1', due_on: '2025-12-15', amount: 5000, status: 'paid' },
    { id: 'ins-3', pledge_id: 'pl-1', due_on: daysFromNow(19), amount: 5000, status: 'expected' },
    { id: 'ins-4', pledge_id: 'pl-2', due_on: daysFromNow(-20), amount: 800, status: 'expected' },
    { id: 'ins-5', pledge_id: 'pl-2', due_on: daysFromNow(-50), amount: 800, status: 'expected' },
    { id: 'ins-6', pledge_id: 'pl-2', due_on: daysFromNow(-80), amount: 800, status: 'expected' },
    { id: 'ins-7', pledge_id: 'pl-2', due_on: daysFromNow(-100), amount: 800, status: 'paid' },
  ],

  /**
   * The `pledge_balances` view (02 §3.5/§4) — the authoritative paid/balance
   * figures the cards read (I-8/I-9). Static here, recomputed by the real view.
   */
  pledge_balances: [
    {
      pledge_id: 'pl-1', contact_id: DOVID, status: 'open', pledged_on: '2025-10-01', currency: 'GBP',
      total_amount: 25000, amount_gbp: 25000, fund_id: 'f2', campaign_id: 'c1', appeal_id: null,
      paid_amount: 10000, payment_count: 1, write_off_amount: 0, balance: 15000,
      installment_count: 3, paid_installment_count: 2, overdue_installment_count: 0, overdue_amount: 0,
      next_installment_id: 'ins-3', next_installment_due_on: daysFromNow(19), next_installment_amount: 5000,
    },
    {
      pledge_id: 'pl-2', contact_id: KATZ, status: 'open', pledged_on: '2025-06-01', currency: 'GBP',
      total_amount: 4000, amount_gbp: 4000, fund_id: 'f1', campaign_id: null, appeal_id: null,
      paid_amount: 800, payment_count: 1, write_off_amount: 0, balance: 3200,
      installment_count: 4, paid_installment_count: 1, overdue_installment_count: 3, overdue_amount: 2400,
      next_installment_id: 'ins-6', next_installment_due_on: daysFromNow(-80), next_installment_amount: 800,
    },
  ],

  // M4: standing orders, including the failing one behind the nudge (08 §3).
  recurring_agreements: [
    {
      id: 'rec-1', contact_id: ADLER, amount: 150, currency: 'GBP', frequency: 'monthly',
      payment_method: 'standing_order', fund_id: 'f0', starts_on: '2024-04-01', ends_on: null,
      expected_day: 1, status: 'failing', last_payment_on: daysFromNow(-39), missed_count: 1,
    },
    {
      id: 'rec-2', contact_id: GOLDSTEIN, amount: 36, currency: 'GBP', frequency: 'monthly',
      payment_method: 'standing_order', fund_id: 'f1', starts_on: '2023-01-01', ends_on: null,
      expected_day: 15, status: 'active', last_payment_on: daysFromNow(-13), missed_count: 0,
    },
    {
      id: 'rec-3', contact_id: SFELD, amount: 500, currency: 'GBP', frequency: 'quarterly',
      payment_method: 'bank_transfer', fund_id: 'f2', starts_on: '2025-01-01', ends_on: null,
      expected_day: 1, status: 'paused', last_payment_on: daysFromNow(-95), missed_count: 0,
    },
  ],

  // Written by gift entry (02 §3.14/§3.15); the trigger-owned rows stay empty.
  soft_credits: [],
  tributes: [],
  gift_aid_claims: [],

  gift_aid_declarations: [
    {
      id: 'ga-1', contact_id: DOVID, declared_on: '2026-03-12', method: 'online', wording_version: 'v2',
      covers_past: true, covers_future: true, covers_from: null, oral_confirmation_sent_on: null,
      cancelled_on: null, evidence_url: null,
    },
  ],

  notes: [
    {
      id: 'note-1', contact_id: DOVID, category: 'personal',
      body: "prefers calls after 8pm · ask about his son's chabura in Gateshead · never solicit at shul",
      is_private: false, is_pinned: true, created_by: BRAUN, created_at: '2026-05-02T09:00:00Z',
    },
    {
      id: 'note-2', contact_id: DOVID, category: 'giving',
      body: 'Gives around Purim and before the dinner; dislikes being asked twice in a season.',
      is_private: false, is_pinned: false, created_by: BRAUN, created_at: '2026-04-11T09:00:00Z',
    },
  ],

  tasks: [
    {
      id: 'task-0', contact_id: DOVID, title: 'Send the building proposal', action_type: 'send_proposal', details: null,
      assigned_to: BRAUN, due_on: daysFromNow(-30), priority: 'high', status: 'done', waiting_for: null,
      completed_at: `${daysFromNow(-28)}T12:00:00Z`, origin: 'manual',
    },
    {
      id: 'task-1', contact_id: DOVID, title: 'Call re proposal', action_type: 'call', details: null,
      assigned_to: BRAUN, due_on: daysFromNow(-4), priority: 'high', status: 'todo', waiting_for: null,
      completed_at: null, origin: 'manual', queue_order: null, opportunity_id: null,
    },
    {
      id: 'task-2', contact_id: SFELD, title: 'WhatsApp — dinner journal ad', action_type: 'whatsapp',
      details: null, assigned_to: BRAUN, due_on: daysFromNow(-1), priority: 'medium', status: 'todo',
      waiting_for: null, completed_at: null, origin: 'manual', queue_order: null, opportunity_id: null,
    },
    {
      id: 'task-3', contact_id: 'aaaaaaaa-0000-0000-0000-000000000006', title: 'Call about the dinner journal',
      action_type: 'call', details: null, assigned_to: BRAUN, due_on: daysFromNow(0), priority: 'medium',
      status: 'todo', waiting_for: null, completed_at: null, origin: 'manual', queue_order: null, opportunity_id: null,
    },
    {
      id: 'task-4', contact_id: 'aaaaaaaa-0000-0000-0000-000000000005', title: 'Call re the standing order',
      action_type: 'call', details: null, assigned_to: BRAUN, due_on: daysFromNow(0), priority: 'high',
      status: 'todo', waiting_for: null, completed_at: null, origin: 'manual', queue_order: null, opportunity_id: null,
    },
    {
      id: 'task-5', contact_id: KLEIN, title: 'Thank-you call — first gift', action_type: 'call', details: null,
      assigned_to: BRAUN, due_on: daysFromNow(0), priority: 'high', status: 'todo', waiting_for: null,
      completed_at: null, origin: 'auto:thank_you', queue_order: null, opportunity_id: null,
    },
    {
      id: 'task-6', contact_id: WEISS, title: 'WhatsApp the shiur times', action_type: 'whatsapp', details: null,
      assigned_to: BRAUN, due_on: daysFromNow(0), priority: 'low', status: 'todo', waiting_for: null,
      completed_at: null, origin: 'manual', queue_order: null, opportunity_id: null,
    },
    {
      id: 'task-7', contact_id: KATZ, title: 'Gift Aid declaration', action_type: 'call', details: null,
      assigned_to: BRAUN, due_on: daysFromNow(0), priority: 'medium', status: 'waiting',
      waiting_for: 'Gift Aid form sent 12 Aug — awaiting return', completed_at: null, origin: 'auto:signal',
      queue_order: null, opportunity_id: null,
    },
    {
      id: 'task-8', contact_id: GOLDSTEIN, title: 'Keep in touch — every 2 months', action_type: 'keep_in_touch',
      details: null, assigned_to: BRAUN, due_on: daysFromNow(0), priority: 'medium', status: 'todo',
      waiting_for: null, completed_at: null, origin: 'auto:kit', queue_order: null, opportunity_id: null,
    },
    {
      id: 'task-9', contact_id: DOVID, title: 'Send the naming brochure', action_type: 'send_proposal',
      details: null, assigned_to: BRAUN, due_on: null, priority: 'medium', status: 'queued', waiting_for: null,
      completed_at: null, origin: 'manual', queue_order: 1, opportunity_id: null,
    },
    {
      id: 'task-10', contact_id: DOVID, title: 'Invite to the siyum', action_type: 'invite_event', details: null,
      assigned_to: BRAUN, due_on: null, priority: 'low', status: 'queued', waiting_for: null,
      completed_at: null, origin: 'manual', queue_order: 2, opportunity_id: null,
    },
    {
      id: 'task-11', contact_id: 'aaaaaaaa-0000-0000-0000-000000000005', title: 'Dinner invite',
      action_type: 'invite_event', details: null, assigned_to: BRAUN, due_on: daysFromNow(3), priority: 'medium',
      status: 'todo', waiting_for: null, completed_at: null, origin: 'manual', queue_order: null, opportunity_id: null,
    },
    {
      id: 'task-12', contact_id: RIVKY, title: 'Send the newsletter', action_type: 'send_email', details: null,
      assigned_to: BRAUN, due_on: daysFromNow(6), priority: 'low', status: 'todo', waiting_for: null,
      completed_at: null, origin: 'manual', queue_order: null, opportunity_id: null,
    },
    {
      id: 'task-13', contact_id: ADLER, title: 'Confirm the meeting time', action_type: 'call', details: null,
      assigned_to: BRAUN, due_on: daysFromNow(0), priority: 'medium', status: 'done', waiting_for: null,
      completed_at: nowAt(8, 40), origin: 'auto:meeting_reminder', queue_order: null, opportunity_id: null,
    },
    {
      id: 'task-14', contact_id: WEISS, title: 'Thank-you call', action_type: 'call', details: null,
      assigned_to: BRAUN, due_on: daysFromNow(0), priority: 'medium', status: 'done', waiting_for: null,
      completed_at: nowAt(9, 15), origin: 'manual', queue_order: null, opportunity_id: null,
    },
  ],

  signals: [
    {
      id: 'sig-1', contact_id: KLEIN, rule_key: 'first_gift_call',
      reason: 'gave £180 on Sunday — a thank-you call within 48h is the strongest retention move',
      state: 'open', snoozed_until: null, dedupe_key: 'first_gift_call:klein', created_at: nowAt(5), resolved_at: null,
    },
    {
      id: 'sig-2', contact_id: ADLER, rule_key: 'recurring_failing',
      reason: "£150/month standing order is 9 days late. Call — don't email",
      state: 'open', snoozed_until: null, dedupe_key: 'recurring_failing:adler', created_at: nowAt(5), resolved_at: null,
    },
    {
      id: 'sig-3', contact_id: KATZ, rule_key: 'neglect_flags',
      reason: 'no meaningful contact in 92 days (threshold: 90 for VIPs)',
      state: 'open', snoozed_until: null, dedupe_key: 'neglect_flags:katz', created_at: nowAt(5), resolved_at: null,
    },
  ],

  tags: [
    { id: 'tag-1', name: 'Building project', category: 'interest', color: null },
    { id: 'tag-2', name: 'Education', category: 'cause', color: null },
    { id: 'tag-3', name: 'Golders Green', category: 'community', color: null },
  ],
  taggings: [
    { id: 'tg-1', tag_id: 'tag-1', contact_id: DOVID, is_excluded: false, note: null },
    { id: 'tg-2', tag_id: 'tag-2', contact_id: DOVID, is_excluded: false, note: null },
    { id: 'tg-3', tag_id: 'tag-3', contact_id: DOVID, is_excluded: false, note: null },
  ],

  documents: [
    { id: 'doc-1', contact_id: DOVID, title: 'Building proposal (June 2026)', kind: 'proposal', url: 'https://example.com/proposal', storage_path: null, created_at: '2026-06-02T09:00:00Z' },
  ],
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': 'content-range',
}

const SESSION = {
  access_token: 'fixture-access-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'fixture-refresh-token',
  user: {
    id: BRAUN,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'admin@demo.test',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  },
}

/** Apply the filters the app sends: eq / in / is / gt / gte / lt / lte. */
function applyFilters(rows, url) {
  let out = rows
  for (const [key, raw] of url.searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue
    const [op, ...rest] = raw.split('.')
    const value = rest.join('.')
    const cmp = (row) => String(row[key] ?? '')
    if (op === 'eq') out = out.filter((r) => String(r[key]) === value)
    else if (op === 'neq') out = out.filter((r) => String(r[key]) !== value)
    else if (op === 'in') {
      const list = value.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, ''))
      out = out.filter((r) => list.includes(String(r[key])))
    } else if (op === 'is') out = out.filter((r) => (value === 'null' ? r[key] == null : r[key] != null))
    // Dates and timestamps compare lexicographically in ISO form, which is all
    // the stream queries need (due_on, completed_at, occurred_at, donated_on).
    else if (op === 'gte') out = out.filter((r) => r[key] != null && cmp(r) >= value)
    else if (op === 'gt') out = out.filter((r) => r[key] != null && cmp(r) > value)
    else if (op === 'lte') out = out.filter((r) => r[key] != null && cmp(r) <= value)
    else if (op === 'lt') out = out.filter((r) => r[key] != null && cmp(r) < value)
  }
  return out
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (chunks.length === 0) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

let inserted = 0

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const send = (status, body, extra = {}) => {
    res.writeHead(status, { ...CORS, 'content-type': 'application/json', ...extra })
    res.end(body === undefined ? '' : JSON.stringify(body))
  }

  if (req.method === 'OPTIONS') return send(204)

  if (url.pathname.startsWith('/auth/v1/token')) return send(200, SESSION)
  if (url.pathname === '/auth/v1/user') return send(200, SESSION.user)
  if (url.pathname === '/auth/v1/logout') return send(204)
  if (url.pathname.startsWith('/auth/v1/')) return send(200, {})

  if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.slice('/rest/v1/'.length)
    const rows = DB[table]
    if (!rows) {
      return send(404, { code: 'PGRST205', message: `Could not find the table 'public.${table}'` })
    }
    const single = (req.headers.accept ?? '').includes('vnd.pgrst.object')

    // Writes mutate the in-memory tables so the harness can exercise complete /
    // snooze / reschedule end to end, exactly as the live project would.
    if (req.method === 'POST') {
      const body = await readJson(req)
      const list = Array.isArray(body) ? body : [body ?? {}]
      const created = list.map((row) => ({ id: `fixture-${++inserted}`, created_at: new Date().toISOString(), ...row }))
      rows.push(...created)
      return send(201, single ? created[0] : created)
    }
    if (req.method === 'PATCH') {
      const patch = (await readJson(req)) ?? {}
      const targets = applyFilters(rows, url)
      for (const row of targets) Object.assign(row, patch)
      return send(200, single ? (targets[0] ?? null) : targets)
    }
    if (req.method === 'DELETE') {
      const targets = new Set(applyFilters(rows, url))
      DB[table] = rows.filter((row) => !targets.has(row))
      return send(200, [])
    }

    const filtered = applyFilters(rows, url)
    if (single) return send(200, filtered[0] ?? null)
    return send(200, filtered, { 'content-range': `0-${Math.max(filtered.length - 1, 0)}/${filtered.length}` })
  }

  send(404, { message: 'not a fixture route' })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[fixtures] 127.0.0.1:${PORT} — offline PostgREST/GoTrue stand-in`)
})
