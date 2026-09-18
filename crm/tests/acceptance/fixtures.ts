/**
 * The seeded Monday (11 §8, 12 §2).
 *
 * One deterministic world, described once, used by all four acceptance tests.
 * Every date is relative to `MONDAY`, so the suite is stable whatever day it
 * runs; the tests freeze the clock to that instant.
 *
 * The **manifest** is the contract: it names every item that a fundraiser
 * opening the app on this Monday must be shown without searching or
 * remembering. Test 1 asserts the manifest against the rendered stream, and
 * then re-derives the same set from the raw tables — so the test cannot pass
 * because the manifest and the code drifted together.
 */

import type { Tables } from '../support/fakeSupabase'

/** 07 September 2026 is a Monday. 08:30 local — the start of the day. */
export const MONDAY = new Date(2026, 8, 7, 8, 30, 0)

export const USER = { id: 'braun-0000-0000-0000-000000000001', email: 'admin@demo.test' }

export const IDS = {
  braun: USER.id,
  dovid: 'aaaa0000-0000-0000-0000-000000000001',
  adler: 'aaaa0000-0000-0000-0000-000000000002',
  frankel: 'aaaa0000-0000-0000-0000-000000000003',
  klein: 'aaaa0000-0000-0000-0000-000000000004',
  weiss: 'aaaa0000-0000-0000-0000-000000000005',
  goldstein: 'aaaa0000-0000-0000-0000-000000000006',
  katz: 'aaaa0000-0000-0000-0000-000000000007',
  sfeld: 'aaaa0000-0000-0000-0000-000000000008',
  berger: 'aaaa0000-0000-0000-0000-000000000009',
  levy: 'aaaa0000-0000-0000-0000-000000000010',
} as const

/* ------------------------------------------------------------------ dates */

const day = (offset: number): Date => {
  const date = new Date(MONDAY)
  date.setDate(date.getDate() + offset)
  return date
}

/** `2026-09-07` — a Postgres `date`. */
export const iso = (offset: number): string => {
  const date = day(offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** A timestamptz on the offset day at the given local hour. */
export const at = (offset: number, hour: number, minute = 0): string => {
  const date = day(offset)
  date.setHours(hour, minute, 0, 0)
  return date.toISOString()
}

/* ------------------------------------------------------------- row shapes */

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
  relationship_owner_id: IDS.braun,
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
  updated_at: at(-1, 12),
}

const statsBase = {
  lifetime_giving: null,
  giving_this_year: null,
  giving_last_year: null,
  soft_lifetime_giving: null,
  soft_giving_this_year: null,
  gift_count: 0,
  largest_gift: null,
  average_gift: null,
  first_gift_date: null,
  first_gift_amount: null,
  last_gift_date: null,
  last_gift_amount: null,
  is_lybunt: false,
  is_sybunt: false,
  pledge_balance: null,
  last_meaningful_contact_at: null,
  last_meaningful_contact_kind: null,
  days_since_contact: null,
  kit_due_on: null,
  open_task_count: 0,
  next_action_id: null,
  next_action_title: null,
  next_action_due_on: null,
  next_action_type: null,
  flag: 'none',
  donor_status: 'prospect',
  household_id: null,
  household_lifetime_giving: null,
  household_gift_count: null,
}

const taskBase = {
  details: null,
  assigned_to: IDS.braun,
  created_by: IDS.braun,
  waiting_for: null,
  completed_at: null,
  origin: 'manual',
  queue_order: null,
  opportunity_id: null,
}

/* --------------------------------------------------------------- manifest */

export type ManifestKind = 'meeting' | 'overdue' | 'due-today' | 'keep-in-touch' | 'neglected'

export interface ManifestEntry {
  /** The task or interaction row this entry stands for. */
  id: string
  kind: ManifestKind
  /** The contact's name as the stream renders it. */
  who: string
  /** A fragment of the row's one-line summary, as rendered. */
  line: string
  /** Why the day is incomplete without it — read this when a test fails. */
  because: string
}

/**
 * Everything Monday morning owes the fundraiser. If any of these is missing
 * from the stream, the person is relying on memory — which is the failure
 * mode brief §34.1 exists to prevent.
 */
export const MONDAY_MANIFEST: ManifestEntry[] = [
  {
    id: 'int-adler-meeting',
    kind: 'meeting',
    who: 'Reuven Adler',
    line: 'Building campaign proposal',
    because: 'A meeting today that is not on the stream is a meeting that gets missed.',
  },
  {
    id: 'task-dovid-call',
    kind: 'overdue',
    who: 'Dovid Cohen',
    line: 'Call re proposal',
    because: 'Four days overdue on the largest live ask in the pipeline.',
  },
  {
    id: 'task-sfeld-whatsapp',
    kind: 'overdue',
    who: 'Shmuel Feld',
    line: 'WhatsApp — dinner journal ad',
    because: 'Overdue since Friday; nobody re-reads Friday.',
  },
  {
    id: 'task-frankel-call',
    kind: 'due-today',
    who: 'Devorah Frankel',
    line: 'Call about the dinner journal',
    because: 'Due today — the ordinary case the stream exists for.',
  },
  {
    id: 'task-klein-thanks',
    kind: 'due-today',
    who: 'Klein Family',
    line: 'Thank-you call — first gift',
    because: 'An automation raised it; nobody typed it, so nobody remembers it.',
  },
  {
    id: 'task-weiss-waiting',
    kind: 'due-today',
    who: 'Yaakov Weiss',
    line: 'Gift Aid form sent',
    because: 'Waiting on them still has to be visible, or it waits forever.',
  },
  {
    id: 'task-goldstein-kit',
    kind: 'keep-in-touch',
    who: 'Goldstein Family',
    line: 'Keep in touch',
    because: 'The cadence came due; only the CRM knows that.',
  },
  {
    id: 'needs-katz',
    kind: 'neglected',
    who: 'Yanky Katz',
    line: 'no open action',
    because: 'An active VIP with no next action at all — the yellow flag (I-3).',
  },
]

/** Rows that must NOT crowd today: a future task and a finished one. */
export const NOT_TODAY = [
  { id: 'task-berger-future', who: 'Aron Berger', why: 'due in six days' },
  { id: 'task-levy-done', who: 'Chaim Levy', why: 'already completed this morning' },
]

/* ------------------------------------------------------------------ world */

export function seededMondayTables(): Tables {
  return {
    team_members: [
      {
        id: IDS.braun,
        full_name: "R' Braun",
        email: USER.email,
        role: 'admin',
        can_see_amounts: true,
        digest_hour: 7,
        digest_channel: 'email',
        is_active: true,
      },
    ],

    lookup_options: [
      ...['prospect|Prospect', 'cultivation|Cultivation', 'in_discussion|In discussion', 'active_donor|Active donor', 'stewardship|Stewardship', 'keep_in_touch|Keep in touch'].map(
        (entry, index) => ({
          id: `stage-${index}`,
          list_name: 'stage',
          value: entry.split('|')[0],
          label: entry.split('|')[1],
          sort_order: index,
          color: null,
          is_active: true,
          meta: {},
        }),
      ),
      ...['call|Call', 'whatsapp|WhatsApp', 'send_email|Send email', 'keep_in_touch|Keep in touch', 'thank_you|Thank you'].map(
        (entry, index) => ({
          id: `action-${index}`,
          list_name: 'action_type',
          value: entry.split('|')[0],
          label: entry.split('|')[1],
          sort_order: index,
          color: null,
          is_active: true,
          meta: {},
        }),
      ),
      ...['call|Call', 'whatsapp|WhatsApp', 'meeting|Meeting', 'email|Email'].map((entry, index) => ({
        id: `kind-${index}`,
        list_name: 'interaction_kind',
        value: entry.split('|')[0],
        label: entry.split('|')[1],
        sort_order: index,
        color: null,
        is_active: true,
        meta: {},
      })),
      ...['high|High', 'medium|Medium', 'low|Low'].map((entry, index) => ({
        id: `prio-${index}`,
        list_name: 'priority',
        value: entry.split('|')[0],
        label: entry.split('|')[1],
        sort_order: index,
        color: null,
        is_active: true,
        meta: {},
      })),
    ],

    automation_rules: [
      { rule_key: 'kit_due', is_enabled: true, params: {}, updated_at: at(-30, 5) },
      {
        rule_key: 'thank_you_on_gift',
        is_enabled: true,
        params: { due_in_days: 2, big_gift_threshold: 500, major_gift_threshold: 5000, skip_if_open: true },
        updated_at: at(-30, 5),
      },
      { rule_key: 'neglect_flags', is_enabled: true, params: { vip_days: 90 }, updated_at: at(-30, 5) },
    ],

    saved_views: [
      {
        id: 'view-lybunt',
        name: 'LYBUNT',
        entity: 'contacts',
        layout: 'table',
        filters: { is_lybunt: true },
        sort: {},
        group_by: null,
        columns: [],
        icon: 'trend-down',
        owner_id: null,
        is_shared: true,
        created_at: at(-90, 5),
      },
      {
        id: 'view-quiet-90',
        name: 'No contact 90+ days',
        entity: 'contacts',
        layout: 'table',
        filters: { days_since_contact_gte: 90 },
        sort: {},
        group_by: null,
        columns: [],
        icon: 'clock',
        owner_id: null,
        is_shared: true,
        created_at: at(-90, 5),
      },
      {
        id: 'view-overdue',
        name: 'Overdue follow-ups',
        entity: 'tasks',
        layout: 'table',
        filters: { due: 'overdue' },
        sort: {},
        group_by: null,
        columns: [],
        icon: 'alert',
        owner_id: null,
        is_shared: true,
        created_at: at(-90, 5),
      },
    ],

    contacts: [
      {
        ...contactBase,
        id: IDS.dovid,
        first_name: 'Dovid',
        last_name: 'Cohen',
        hebrew_name: 'דוד הכהן',
        organization: 'Cohen & Partner',
        position: 'Director',
        email: 'dovid.cohen@example.com',
        phone: '+447700900123',
        whatsapp: '+447700900123',
        preferred_channel: 'call',
        best_time_to_contact: 'after 8pm',
        city: 'Golders Green',
        stage: 'in_discussion',
        priority: 'high',
        tier: 'A',
        contact_frequency_days: 60,
        spouse_name: 'Rivky',
        family_notes: '5 children, eldest in Gateshead yeshiva',
        things_to_remember: 'Never solicit at shul',
        mutual_connections: "R' Weiss, the Feld brothers",
        known_since: '2019-05-02',
        introduced_by_id: IDS.weiss,
        engagement_score: 62,
        engagement_tier: 'warm',
        pinned_note_id: 'note-dovid',
      },
      { ...contactBase, id: IDS.adler, first_name: 'Reuven', last_name: 'Adler', city: 'Golders Green', stage: 'active_donor', priority: 'high' },
      { ...contactBase, id: IDS.frankel, first_name: 'Devorah', last_name: 'Frankel', title: 'Mrs', city: 'Golders Green', stage: 'stewardship' },
      { ...contactBase, id: IDS.klein, first_name: 'Klein', last_name: 'Family', city: 'Edgware', stage: 'cultivation' },
      { ...contactBase, id: IDS.weiss, first_name: 'Yaakov', last_name: 'Weiss', title: "R'", city: 'Hendon', stage: 'active_donor' },
      { ...contactBase, id: IDS.goldstein, first_name: 'Goldstein', last_name: 'Family', city: 'Manchester', contact_frequency_days: 60 },
      { ...contactBase, id: IDS.katz, first_name: 'Yanky', last_name: 'Katz', city: 'Golders Green', stage: 'stewardship', tier: 'A' },
      { ...contactBase, id: IDS.sfeld, first_name: 'Shmuel', last_name: 'Feld', city: 'London', stage: 'active_donor' },
      { ...contactBase, id: IDS.berger, first_name: 'Aron', last_name: 'Berger', city: 'Hendon' },
      { ...contactBase, id: IDS.levy, first_name: 'Chaim', last_name: 'Levy', city: 'Manchester', stage: 'active_donor' },
    ],

    contact_stats: [
      {
        ...statsBase,
        contact_id: IDS.dovid,
        lifetime_giving: 65000,
        giving_this_year: 0,
        giving_last_year: 20000,
        gift_count: 7,
        largest_gift: 20000,
        average_gift: 9285,
        first_gift_date: '2019-05-02',
        first_gift_amount: 1000,
        last_gift_date: iso(-300),
        last_gift_amount: 15000,
        is_lybunt: true,
        pledge_balance: 15000,
        last_meaningful_contact_at: at(-184, 10),
        last_meaningful_contact_kind: 'meeting',
        days_since_contact: 184,
        kit_due_on: iso(-124),
        open_task_count: 1,
        next_action_id: 'task-dovid-call',
        next_action_title: 'Call re proposal',
        next_action_due_on: iso(-4),
        next_action_type: 'call',
        flag: 'overdue',
        donor_status: 'pre_lapsed',
      },
      {
        ...statsBase,
        contact_id: IDS.adler,
        lifetime_giving: 18400,
        giving_this_year: 1800,
        gift_count: 14,
        days_since_contact: 9,
        flag: 'future',
        donor_status: 'active',
      },
      {
        ...statsBase,
        contact_id: IDS.frankel,
        lifetime_giving: 950,
        giving_this_year: 950,
        gift_count: 3,
        days_since_contact: 58,
        open_task_count: 1,
        next_action_id: 'task-frankel-call',
        next_action_title: 'Call about the dinner journal',
        next_action_due_on: iso(0),
        next_action_type: 'call',
        flag: 'today',
        donor_status: 'active',
      },
      {
        ...statsBase,
        contact_id: IDS.klein,
        lifetime_giving: 180,
        giving_this_year: 180,
        gift_count: 1,
        first_gift_date: iso(-3),
        last_gift_date: iso(-3),
        last_gift_amount: 180,
        days_since_contact: 3,
        open_task_count: 1,
        next_action_id: 'task-klein-thanks',
        next_action_title: 'Thank-you call — first gift',
        next_action_due_on: iso(0),
        next_action_type: 'call',
        flag: 'today',
        donor_status: 'new',
      },
      {
        ...statsBase,
        contact_id: IDS.weiss,
        lifetime_giving: 3000,
        giving_this_year: 500,
        gift_count: 4,
        days_since_contact: 20,
        open_task_count: 1,
        next_action_id: 'task-weiss-waiting',
        next_action_title: 'Gift Aid declaration',
        next_action_due_on: iso(0),
        flag: 'waiting',
        donor_status: 'active',
      },
      {
        ...statsBase,
        contact_id: IDS.goldstein,
        lifetime_giving: 7400,
        giving_this_year: 400,
        gift_count: 11,
        days_since_contact: 63,
        kit_due_on: iso(0),
        open_task_count: 1,
        next_action_id: 'task-goldstein-kit',
        next_action_title: 'Keep in touch — every 2 months',
        next_action_due_on: iso(0),
        next_action_type: 'keep_in_touch',
        flag: 'today',
        donor_status: 'active',
      },
      {
        // The yellow case (I-3): active stage, real history, no next action.
        ...statsBase,
        contact_id: IDS.katz,
        lifetime_giving: 42000,
        giving_this_year: 0,
        giving_last_year: 12000,
        gift_count: 9,
        is_lybunt: true,
        days_since_contact: 92,
        flag: 'none',
        donor_status: 'pre_lapsed',
      },
      {
        ...statsBase,
        contact_id: IDS.sfeld,
        lifetime_giving: 9200,
        giving_this_year: 2000,
        gift_count: 6,
        days_since_contact: 21,
        open_task_count: 1,
        next_action_id: 'task-sfeld-whatsapp',
        next_action_title: 'WhatsApp — dinner journal ad',
        next_action_due_on: iso(-1),
        next_action_type: 'whatsapp',
        flag: 'overdue',
        donor_status: 'active',
      },
      {
        ...statsBase,
        contact_id: IDS.berger,
        lifetime_giving: 1800,
        giving_last_year: 1800,
        is_lybunt: true,
        days_since_contact: 40,
        open_task_count: 1,
        next_action_id: 'task-berger-future',
        next_action_title: 'Dinner invite',
        next_action_due_on: iso(6),
        next_action_type: 'send_email',
        flag: 'future',
        donor_status: 'pre_lapsed',
      },
      {
        ...statsBase,
        contact_id: IDS.levy,
        lifetime_giving: 3600,
        giving_this_year: 3600,
        gift_count: 4,
        days_since_contact: 0,
        flag: 'future',
        donor_status: 'active',
      },
    ],

    tasks: [
      { ...taskBase, id: 'task-dovid-call', contact_id: IDS.dovid, title: 'Call re proposal', action_type: 'call', due_on: iso(-4), priority: 'high', status: 'todo' },
      { ...taskBase, id: 'task-sfeld-whatsapp', contact_id: IDS.sfeld, title: 'WhatsApp — dinner journal ad', action_type: 'whatsapp', due_on: iso(-1), priority: 'medium', status: 'todo' },
      { ...taskBase, id: 'task-frankel-call', contact_id: IDS.frankel, title: 'Call about the dinner journal', action_type: 'call', due_on: iso(0), priority: 'medium', status: 'todo' },
      { ...taskBase, id: 'task-klein-thanks', contact_id: IDS.klein, title: 'Thank-you call — first gift', action_type: 'call', due_on: iso(0), priority: 'high', status: 'todo', origin: 'auto:thank_you' },
      { ...taskBase, id: 'task-weiss-waiting', contact_id: IDS.weiss, title: 'Gift Aid declaration', action_type: 'call', due_on: iso(0), priority: 'medium', status: 'waiting', waiting_for: 'Gift Aid form sent 12 Aug — awaiting return', origin: 'auto:signal' },
      { ...taskBase, id: 'task-goldstein-kit', contact_id: IDS.goldstein, title: 'Keep in touch — every 2 months', action_type: 'keep_in_touch', due_on: iso(0), priority: 'medium', status: 'todo', origin: 'auto:kit' },
      { ...taskBase, id: 'task-berger-future', contact_id: IDS.berger, title: 'Dinner invite', action_type: 'send_email', due_on: iso(6), priority: 'low', status: 'todo' },
      { ...taskBase, id: 'task-levy-done', contact_id: IDS.levy, title: 'Thank-you call', action_type: 'call', due_on: iso(0), priority: 'medium', status: 'done', completed_at: at(0, 8, 5) },
      { ...taskBase, id: 'task-dovid-queued', contact_id: IDS.dovid, title: 'Send the naming brochure', action_type: 'send_email', due_on: null, priority: 'medium', status: 'queued', queue_order: 1 },
    ],

    interactions: [
      {
        id: 'int-adler-meeting',
        contact_id: IDS.adler,
        occurred_at: at(0, 14),
        kind: 'meeting',
        status: 'scheduled',
        team_member_id: IDS.braun,
        summary: 'Office visit',
        outcome: null,
        is_meaningful: false,
        location: 'his office',
        attendees: null,
        purpose: 'Building campaign proposal',
        ask_amount: null,
        source: 'manual',
      },
      {
        id: 'int-dovid-last',
        contact_id: IDS.dovid,
        occurred_at: at(-184, 10),
        kind: 'meeting',
        status: 'logged',
        team_member_id: IDS.braun,
        summary: 'Met in London. Very warm. Strong interest in the building project.',
        outcome: 'wants to see the naming opportunities → next: call after Sukkos',
        is_meaningful: true,
        location: 'London',
        attendees: null,
        purpose: null,
        ask_amount: 20000,
        source: 'manual',
      },
    ],

    notes: [
      {
        id: 'note-dovid',
        contact_id: IDS.dovid,
        category: 'personal',
        body: "prefers calls after 8pm · ask about his son's chabura in Gateshead · never solicit at shul",
        is_private: false,
        is_pinned: true,
        created_by: IDS.braun,
        created_at: at(-200, 9),
      },
    ],

    donations: [
      {
        id: 'don-dovid-1',
        contact_id: IDS.dovid,
        donated_on: iso(-300),
        amount: 15000,
        currency: 'GBP',
        amount_gbp: 15000,
        fund_id: 'fund-general',
        campaign_id: null,
        appeal_id: null,
        payment_method: 'bank_transfer',
        status: 'received',
        pledge_id: null,
        installment_id: null,
        recurring_agreement_id: null,
        receipt_status: 'sent',
        receipt_pref: null,
        thank_you_status: 'done',
        gift_aid_status: 'claimed',
        gift_aid_claim_id: null,
        is_gasds: false,
        notes: null,
      },
      {
        id: 'don-klein-1',
        contact_id: IDS.klein,
        donated_on: iso(-3),
        amount: 180,
        currency: 'GBP',
        amount_gbp: 180,
        fund_id: 'fund-general',
        campaign_id: null,
        appeal_id: null,
        payment_method: 'card',
        status: 'received',
        pledge_id: null,
        installment_id: null,
        recurring_agreement_id: null,
        receipt_status: 'queued',
        receipt_pref: null,
        thank_you_status: 'task_open',
        gift_aid_status: 'pending_declaration',
        gift_aid_claim_id: null,
        is_gasds: false,
        notes: null,
      },
    ],

    pledges: [
      {
        id: 'pledge-dovid',
        contact_id: IDS.dovid,
        total_amount: 25000,
        amount_gbp: 25000,
        currency: 'GBP',
        fund_id: 'fund-building',
        campaign_id: null,
        appeal_id: null,
        pledged_on: iso(-330),
        status: 'open',
        write_off_amount: null,
        notes: null,
      },
    ],
    pledge_installments: [
      { id: 'ins-dovid-1', pledge_id: 'pledge-dovid', due_on: iso(-30), amount: 5000, status: 'paid' },
      { id: 'ins-dovid-2', pledge_id: 'pledge-dovid', due_on: iso(21), amount: 5000, status: 'expected' },
    ],

    funds: [{ id: 'fund-general', name: 'General', code: 'GEN', is_restricted: false, is_active: true }],
    campaigns: [],
    appeals: [],
    recurring_agreements: [],
    gift_aid_declarations: [
      {
        id: 'ga-dovid',
        contact_id: IDS.dovid,
        declared_on: iso(-300),
        method: 'online',
        covers_past: true,
        covers_future: true,
        covers_from: null,
        cancelled_on: null,
        evidence_url: null,
      },
    ],
    documents: [],
    tags: [
      { id: 'tag-building', name: 'Building project', category: 'interest', color: null },
      { id: 'tag-vip', name: 'VIP', category: 'segment', color: null },
    ],
    taggings: [
      { id: 'tg-1', tag_id: 'tag-building', contact_id: IDS.dovid, is_excluded: false, note: null },
      { id: 'tg-2', tag_id: 'tag-vip', contact_id: IDS.dovid, is_excluded: false, note: null },
      { id: 'tg-3', tag_id: 'tag-vip', contact_id: IDS.katz, is_excluded: false, note: null },
    ],
    signals: [
      {
        id: 'sig-katz',
        contact_id: IDS.katz,
        rule_key: 'neglect_flags',
        reason: 'no meaningful contact in 92 days (threshold: 90 for VIPs)',
        state: 'open',
        snoozed_until: null,
        dedupe_key: 'neglect_flags:katz',
        created_at: at(0, 5),
        resolved_at: null,
      },
    ],
    households: [],
    ai_activity_log: [],
    soft_credits: [],
    opportunities: [],
  }
}
