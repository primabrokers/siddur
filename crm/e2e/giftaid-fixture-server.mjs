#!/usr/bin/env node
/**
 * Gift Aid fixture server — a **development harness**, never shipped.
 *
 * Same idea as `e2e/fixture-server.mjs` (a PostgREST/GoTrue stand-in over plain
 * arrays), carrying only what the M7 workspace reads: the `gift_aid_claim_totals`
 * and `ga_missing_declarations` views from migration 007, the declarations, the
 * claim's donation lines, and the `ga_claim_validation` RPC — implemented here
 * with the same rule the SQL function uses, so the offline screenshots show the
 * behaviour the database will show.
 *
 * Kept as its own file rather than as edits to `fixture-server.mjs` so the
 * milestones being built in parallel do not collide.
 *
 *   node e2e/giftaid-fixture-server.mjs --port 5293
 *   VITE_SUPABASE_URL=http://127.0.0.1:5293 VITE_SUPABASE_ANON_KEY=fixture \
 *     npx vite --port 5193 --strictPort --host
 *   E2E_BASE_URL=http://localhost:5193 E2E_SHOT_SUFFIX=fixtures node e2e/m7-shots.mjs
 *
 * The dataset reproduces artboard A7: a rolling claim of 142 gifts worth
 * £48,200 (£12,050 claimable, £310 GASDS), eight donors owing declarations
 * worth £1,240, three filed claims, and exactly two gifts blocked on a missing
 * postcode so the validation pass has something real to fix.
 */

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 ? process.argv[index + 1] : fallback
}
const PORT = Number(arg('port', 5293))

const BRAUN = '11111111-1111-1111-1111-111111111111'
const CLAIM_ROLLING = 'claim-0000-0000-0000-000000000001'
const id = (prefix, n) => `${prefix}-${String(n).padStart(4, '0')}`

/* ------------------------------------------------------------- contacts */

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
  address_line1: '12 The Drive',
  address_line2: null,
  city: 'Golders Green',
  postcode: 'NW11 8AA',
  country: 'United Kingdom',
  ga_house_no: null,
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
  stage: 'active_donor',
  priority: 'medium',
  tier: null,
  estimated_capacity: null,
  contact_frequency_days: null,
  kit_paused_until: null,
  engagement_score: null,
  engagement_tier: 'warm',
  engagement_computed_at: null,
  pinned_note_id: null,
  is_archived: false,
  merged_into_id: null,
  import_batch: null,
  created_by: BRAUN,
  created_at: '2024-01-05T09:00:00.000Z',
  updated_at: '2026-08-01T09:00:00.000Z',
}

/** The donors on the claim; the last two are the ones the validation catches. */
const PEOPLE = [
  { key: 'cohen', title: 'Mr', first_name: 'Dovid', last_name: 'Cohen', address_line1: '12 The Drive', postcode: 'NW11 8AA', email: 'dovid.cohen@example.com' },
  { key: 'klein', title: 'Mr', first_name: 'Yehuda', last_name: 'Klein', address_line1: 'Elm House, Sentinel Square', postcode: 'NW4 2EL', email: 'y.klein@example.com' },
  { key: 'frankel', title: 'Mrs', first_name: 'Devorah', last_name: 'Frankel', address_line1: '44 Bridge Lane', postcode: 'NW11 0EG', email: 'd.frankel@example.com' },
  { key: 'adler', title: "R'", first_name: 'Reuven', last_name: 'Adler', address_line1: '7 Highfield Gardens', postcode: 'NW11 9HD', email: 'r.adler@example.com' },
  { key: 'katz', title: 'Mr', first_name: 'Yanky', last_name: 'Katz', address_line1: '103 Golders Green Road', postcode: 'NW11 8HR', email: 'y.katz@example.com' },
  { key: 'weiss', title: "R'", first_name: 'Yaakov', last_name: 'Weiss', address_line1: '18 Sunningfields Crescent', postcode: 'NW4 4RB', email: 'y.weiss@example.com' },
  { key: 'levy', title: 'Mr', first_name: 'Chaim', last_name: 'Levy', address_line1: '2 Woodstock Avenue', postcode: 'NW11 9RG', email: 'c.levy@example.com' },
  { key: 'feld', title: 'Mr', first_name: 'Shmuel', last_name: 'Feld', address_line1: '31 Hodford Road', postcode: 'NW11 8NP', email: 's.feld@example.com' },
  // Blocked: no postcode at all, and no address line to take a house number from.
  { key: 'hoffman', title: 'Mr', first_name: 'Shimon', last_name: 'Hoffman', address_line1: null, postcode: null, email: 's.hoffman@example.com' },
  // Blocked: house number is fine, postcode is missing.
  { key: 'rosen', title: 'Mr', first_name: 'Naftoli', last_name: 'Rosen', address_line1: '9 Ravenscroft Avenue', postcode: null, email: 'n.rosen@example.com' },
  // The chase queue's donors (no declaration on file).
  { key: 'berger', title: 'Mr', first_name: 'Aron', last_name: 'Berger', address_line1: '5 Wentworth Road', postcode: 'NW11 0RP', email: 'a.berger@example.com', whatsapp: '+447700900311' },
  { key: 'gross', title: 'Mr', first_name: 'Yisroel', last_name: 'Gross', address_line1: '22 Princes Park Avenue', postcode: 'NW11 0JS', email: 'y.gross@example.com' },
  { key: 'stern', title: 'Mrs', first_name: 'Rochel', last_name: 'Stern', address_line1: '61 Woodlands', postcode: 'NW11 9QR', email: 'r.stern@example.com' },
  { key: 'mandel', title: 'Mr', first_name: 'Berel', last_name: 'Mandel', address_line1: '14 Bell Lane', postcode: 'NW4 2AD', email: 'b.mandel@example.com' },
  { key: 'schwartz', title: 'Mr', first_name: 'Moshe', last_name: 'Schwartz', address_line1: '77 Brent Street', postcode: 'NW4 2EA', email: 'm.schwartz@example.com' },
  { key: 'roth', title: 'Mrs', first_name: 'Miriam', last_name: 'Roth', address_line1: '3 Alba Gardens', postcode: 'NW11 9NS', email: 'm.roth@example.com' },
  { key: 'jacobs', title: 'Mr', first_name: 'Ezra', last_name: 'Jacobs', address_line1: '40 Wessex Gardens', postcode: 'NW11 9RT', email: 'e.jacobs@example.com' },
  { key: 'baum', title: 'Mr', first_name: 'Zev', last_name: 'Baum', address_line1: '8 Rotherwick Road', postcode: 'NW11 7DE', email: 'z.baum@example.com' },
]

const CONTACT_ID = {}
PEOPLE.forEach((person, index) => {
  CONTACT_ID[person.key] = id('c0000000-0000-0000-0000-0000000', index + 1)
})

const contacts = PEOPLE.map(({ key, ...rest }) => ({ ...contactBase, id: CONTACT_ID[key], ...rest }))

/* ------------------------------------------------------------- donations */

/**
 * 142 eligible gifts totalling exactly £48,200 — the artboard's numbers.
 */
// Klein declared only for future gifts and Frankel's oral declaration is still
// unconfirmed, so neither has gifts on this claim — they show in the
// declarations panel instead, which is exactly where the wireframe puts them.
const CLAIM_DONORS = ['cohen', 'adler', 'katz', 'weiss', 'levy', 'feld']
/** Exactly two gifts are blocked, from the two donors with no postcode on file. */
const BLOCKED_DONORS = ['hoffman', 'rosen']
const AMOUNTS = [120, 200, 300, 450, 160, 560, 240, 340]
const GIFT_COUNT = 142
const TARGET_TOTAL = 48200

const giftRow = (index, donorKey, amount) => {
  const month = (index % 3) + 6 // Jul–Sep 2026, inside the rolling window
  const day = ((index * 7) % 27) + 1
  return {
    id: id('d0000000-0000-0000-0000-0000000', index + 1),
    contact_id: CONTACT_ID[donorKey],
    donated_on: `2026-0${month}-${String(day).padStart(2, '0')}`,
    amount,
    currency: 'GBP',
    amount_gbp: amount,
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
    gift_aid_status: 'eligible',
    gift_aid_claim_id: CLAIM_ROLLING,
    is_gasds: false,
    ga_excluded_at: null,
    ga_exclude_reason: null,
    notes: null,
    created_at: '2026-07-01T09:00:00.000Z',
  }
}

const donations = []
for (let i = 0; i < GIFT_COUNT - BLOCKED_DONORS.length; i += 1) {
  donations.push(giftRow(i, CLAIM_DONORS[i % CLAIM_DONORS.length], AMOUNTS[i % AMOUNTS.length]))
}
BLOCKED_DONORS.forEach((donor, offset) => {
  donations.push(giftRow(GIFT_COUNT - BLOCKED_DONORS.length + offset, donor, [500, 750][offset] ?? 500))
})

// One major gift absorbs the difference, so the hero's £48,200 and the
// schedule's rows add up to the same number.
const generated = donations.reduce((sum, gift) => sum + gift.amount, 0)
donations[0].amount = Number((donations[0].amount + (TARGET_TOTAL - generated)).toFixed(2))
donations[0].amount_gbp = donations[0].amount

// One gift held back by hand, so the review shows the "put it back" path.
donations.push({
  ...donations[0],
  id: 'd0000000-0000-0000-0000-000000009999',
  contact_id: CONTACT_ID.levy,
  donated_on: '2026-07-19',
  amount: 95,
  amount_gbp: 95,
  currency: 'USD',
  gift_aid_claim_id: null,
  ga_excluded_at: '2026-08-20T10:00:00.000Z',
  ga_exclude_reason: 'not_gbp',
})

/* ---------------------------------------------------------- declarations */

const declarations = [
  {
    id: 'ga-dec-0001',
    contact_id: CONTACT_ID.klein,
    declared_on: '2026-08-17',
    method: 'written',
    wording_version: 'HMRC 2024-04',
    covers_past: false,
    covers_future: true,
    covers_from: null,
    oral_confirmation_sent_on: null,
    cancelled_on: null,
    evidence_url: null,
    created_at: '2026-08-17T09:00:00.000Z',
  },
  {
    id: 'ga-dec-0002',
    contact_id: CONTACT_ID.frankel,
    declared_on: '2026-08-02',
    method: 'oral',
    wording_version: 'HMRC 2024-04',
    covers_past: true,
    covers_future: true,
    covers_from: null,
    oral_confirmation_sent_on: null,
    cancelled_on: null,
    evidence_url: null,
    created_at: '2026-08-02T09:00:00.000Z',
  },
  {
    id: 'ga-dec-0003',
    contact_id: CONTACT_ID.cohen,
    declared_on: '2026-03-12',
    method: 'online',
    wording_version: 'HMRC 2024-04',
    covers_past: true,
    covers_future: true,
    covers_from: null,
    oral_confirmation_sent_on: null,
    cancelled_on: null,
    evidence_url: 'https://example.org/declarations/cohen.pdf',
    created_at: '2026-03-12T09:00:00.000Z',
  },
  {
    id: 'ga-dec-0004',
    contact_id: CONTACT_ID.adler,
    declared_on: '2025-11-04',
    method: 'written',
    wording_version: 'HMRC 2024-04',
    covers_past: true,
    covers_future: true,
    covers_from: '2024-04-06',
    oral_confirmation_sent_on: null,
    cancelled_on: null,
    evidence_url: null,
    created_at: '2025-11-04T09:00:00.000Z',
  },
  {
    id: 'ga-dec-0005',
    contact_id: CONTACT_ID.katz,
    declared_on: '2024-06-20',
    method: 'oral',
    wording_version: 'HMRC 2021-11',
    covers_past: true,
    covers_future: true,
    covers_from: null,
    oral_confirmation_sent_on: '2024-06-24',
    cancelled_on: null,
    evidence_url: null,
    created_at: '2024-06-20T09:00:00.000Z',
  },
]
// Everyone else on the claim declared long ago; the panel only shows recents.
for (const key of ['weiss', 'levy', 'feld', 'hoffman', 'rosen']) {
  declarations.push({
    id: `ga-dec-old-${key}`,
    contact_id: CONTACT_ID[key],
    declared_on: '2023-05-01',
    method: 'written',
    wording_version: 'HMRC 2021-11',
    covers_past: true,
    covers_future: true,
    covers_from: null,
    oral_confirmation_sent_on: null,
    cancelled_on: null,
    evidence_url: null,
    created_at: '2023-05-01T09:00:00.000Z',
  })
}

/* -------------------------------------------- views from migration 007 */

/** £1,240 recoverable from 8 donors — the wireframe's header line. */
const MISSING = [
  { key: 'berger', gifts: 6, eligible: 1800, recoverable: 450 },
  { key: 'gross', gifts: 3, eligible: 1200, recoverable: 300 },
  { key: 'stern', gifts: 4, eligible: 600, recoverable: 150 },
  { key: 'mandel', gifts: 2, eligible: 360, recoverable: 90 },
  { key: 'schwartz', gifts: 2, eligible: 320, recoverable: 80 },
  { key: 'roth', gifts: 3, eligible: 280, recoverable: 70 },
  { key: 'jacobs', gifts: 1, eligible: 240, recoverable: 60 },
  { key: 'baum', gifts: 1, eligible: 160, recoverable: 40 },
]

const ga_missing_declarations = MISSING.map((row) => ({
  contact_id: CONTACT_ID[row.key],
  gift_count: row.gifts,
  eligible_total: row.eligible,
  recoverable: row.recoverable,
  // Everything except Berger's oldest two gifts is inside the four-year window.
  eligible_total_4y: row.key === 'berger' ? 1400 : row.eligible,
  recoverable_4y: row.key === 'berger' ? 350 : row.recoverable,
  first_gift_on: '2023-09-14',
  last_gift_on: '2026-05-02',
}))

const gift_aid_claims = [
  {
    id: CLAIM_ROLLING,
    status: 'draft-rolling',
    submitted_on: null,
    paid_on: null,
    hmrc_reference: null,
    total_donations: null,
    total_claimed: null,
    gasds_total: null,
    created_at: '2026-07-01T00:00:00.000Z',
  },
  { id: 'claim-0000-0000-0000-000000000002', status: 'paid', submitted_on: '2026-06-30', paid_on: '2026-07-21', hmrc_reference: 'CO-88214', total_donations: 55616, total_claimed: 13904, gasds_total: 0, created_at: '2026-04-01T00:00:00.000Z' },
  { id: 'claim-0000-0000-0000-000000000003', status: 'paid', submitted_on: '2026-03-31', paid_on: '2026-04-24', hmrc_reference: 'CO-79552', total_donations: 70204, total_claimed: 17551, gasds_total: 0, created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'claim-0000-0000-0000-000000000004', status: 'submitted', submitted_on: '2025-12-31', paid_on: null, hmrc_reference: 'CO-71308', total_donations: 60840, total_claimed: 15210, gasds_total: 0, created_at: '2025-10-01T00:00:00.000Z' },
]

const CLAIM_GIFT_COUNT = { 'claim-0000-0000-0000-000000000002': 168, 'claim-0000-0000-0000-000000000003': 203, 'claim-0000-0000-0000-000000000004': 187 }

const gift_aid_claim_totals = gift_aid_claims.map((claim) => {
  const rolling = claim.status === 'draft-rolling'
  return {
    claim_id: claim.id,
    status: claim.status,
    building_since: claim.created_at.slice(0, 10),
    submitted_on: claim.submitted_on,
    paid_on: claim.paid_on,
    hmrc_reference: claim.hmrc_reference,
    donations_total: rolling ? TARGET_TOTAL : claim.total_donations,
    claimable_total: rolling ? TARGET_TOTAL * 0.25 : claim.total_claimed,
    gasds_total: rolling ? 310 : claim.gasds_total,
    gift_count: rolling ? GIFT_COUNT : CLAIM_GIFT_COUNT[claim.id],
    donor_count: rolling ? CLAIM_DONORS.length + BLOCKED_DONORS.length : 71,
  }
})

/* -------------------------------------------------- ga_claim_validation */

const houseNumber = (contact) => {
  const explicit = (contact?.ga_house_no ?? '').trim()
  if (explicit !== '') return explicit
  const line = (contact?.address_line1 ?? '').trim()
  return line === '' ? '' : (line.split(/[\s,]+/)[0] ?? '')
}

const covers = (contactId, date) =>
  declarations.some((d) => {
    if (d.contact_id !== contactId) return false
    if (d.cancelled_on && date >= d.cancelled_on) return false
    if (d.method === 'oral' && !d.oral_confirmation_sent_on) return false
    const anchor = d.covers_from ?? d.declared_on
    if (date >= anchor) return d.covers_future === true
    if (!d.covers_past) return false
    const back = new Date(`${anchor}T00:00:00Z`)
    back.setUTCFullYear(back.getUTCFullYear() - 4)
    return date >= back.toISOString().slice(0, 10)
  })

/** The same five checks `public.ga_claim_validation` runs (migration 007). */
function validateClaim(claimId) {
  const out = []
  for (const gift of donations) {
    if (gift.gift_aid_claim_id !== claimId) continue
    if (gift.is_gasds || gift.status !== 'received') continue
    const contact = contacts.find((c) => c.id === gift.contact_id) ?? null
    const donorName = [contact?.title, contact?.first_name, contact?.last_name].filter(Boolean).join(' ')
    const base = {
      donation_id: gift.id,
      contact_id: gift.contact_id,
      donor_name: donorName || null,
      donated_on: gift.donated_on,
      amount_gbp: gift.amount_gbp,
    }
    const checks = [
      ['missing_postcode', 'Postcode missing — HMRC needs it to match the donor', !contact?.postcode || contact.postcode.trim() === ''],
      ['missing_house_no', 'House name or number missing', houseNumber(contact) === ''],
      ['not_gbp', 'Only sterling gifts can be claimed', (gift.currency ?? 'GBP').toUpperCase() !== 'GBP'],
      ['not_individual', 'Only an individual can Gift Aid a donation', (contact?.contact_kind ?? 'individual') !== 'individual'],
      ['no_declaration', 'No declaration covering this gift date', !covers(gift.contact_id, gift.donated_on)],
    ]
    for (const [code, message, failed] of checks) if (failed) out.push({ ...base, code, message })
  }
  return out.sort((a, b) => a.donated_on.localeCompare(b.donated_on) || a.code.localeCompare(b.code))
}

/* -------------------------------------------------------------- the DB */

const lookup = (list, pairs) =>
  pairs.map((pair, i) => {
    const [value, label] = pair.split('|')
    return { id: `${list}-${i}`, list_name: list, value, label, sort_order: i, color: null, meta: {}, is_active: true }
  })

const DB = {
  team_members: [
    { id: BRAUN, full_name: "R' Braun", role: 'admin', email: 'admin@demo.test', can_see_amounts: true, is_active: true, digest_hour: 7, digest_channel: 'email' },
  ],
  contacts,
  contact_stats: contacts.map((contact) => ({
    contact_id: contact.id,
    lifetime_giving: 4200,
    this_year_giving: 1200,
    last_year_giving: 1600,
    soft_credit_lifetime: null,
    soft_credit_this_year: null,
    gift_count: 8,
    largest_gift: 720,
    average_gift: 340,
    first_gift_on: '2023-09-14',
    first_gift_amount: 180,
    last_gift_on: '2026-08-02',
    last_gift_amount: 340,
    is_lybunt: false,
    is_sybunt: false,
    pledge_balance: null,
    last_contact_at: '2026-08-10T10:00:00.000Z',
    last_contact_kind: 'call',
    days_since_contact: 18,
    kit_due_on: null,
    open_task_count: 0,
    next_action_id: null,
    next_action_title: null,
    next_action_due_on: null,
    next_action_type: null,
    flag: 'future',
    donor_status: 'active',
    has_ga_declaration: declarations.some((d) => d.contact_id === contact.id),
    household_id: null,
    household_lifetime_giving: null,
    household_gift_count: null,
  })),
  donations,
  gift_aid_declarations: declarations,
  gift_aid_claims,
  gift_aid_claim_totals,
  ga_missing_declarations,
  funds: [{ id: 'fund-general', name: 'General', code: 'GEN', is_restricted: false, is_active: true }],
  campaigns: [],
  appeals: [],
  saved_views: [
    {
      id: 'view-ga-missing',
      name: 'GA: missing declarations',
      entity: 'donations',
      layout: 'table',
      filters: { gift_aid_status: ['pending_declaration'] },
      sort: { field: 'donated_on', dir: 'desc' },
      group_by: null,
      columns: ['contact', 'donated_on', 'amount', 'gift_aid_status'],
      icon: 'alert',
      owner_id: null,
      is_shared: true,
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ],
  automation_rules: [
    { id: 'rule-org', rule_key: 'org_details', is_enabled: true, params: { name: 'Yeshivas Ohr Simcha', charity_number: '1123456', hmrc_reference: 'XR12345', contact_email: 'office@example.org' } },
    { id: 'rule-ga', rule_key: 'gift_aid_evaluate', is_enabled: true, params: { back_years: 4, require_oral_confirmation: true } },
  ],
  lookup_options: [
    ...lookup('stage', ['prospect|Prospect', 'cultivation|Cultivation', 'active_donor|Active donor', 'stewardship|Stewardship', 'keep_in_touch|Keep in touch']),
    ...lookup('priority', ['high|High', 'medium|Medium', 'low|Low']),
    ...lookup('action_type', ['call|Call', 'whatsapp|WhatsApp', 'send_email|Send email', 'send_update|Send update', 'thank_you|Thank you']),
  ],
  tasks: [],
  interactions: [],
  notes: [],
  documents: [],
  pledges: [],
  pledge_installments: [],
  recurring_agreements: [],
  soft_credits: [],
  tributes: [],
  opportunities: [],
  households: [],
  signals: [],
  tags: [],
  taggings: [],
  ai_activity_log: [],
  import_batches: [],
  duplicates_queue: [],
}

/* ---------------------------------------------------------- the server */

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

const asText = (value) => (value === null || value === undefined ? '' : String(value))

/** Numbers compare as numbers — the found-money queue sorts on money. */
function compare(a, b) {
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb) && asText(a) !== '' && asText(b) !== '') return na - nb
  return asText(a).localeCompare(asText(b))
}

function applyFilters(rows, url) {
  let out = rows
  for (const [key, raw] of url.searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue
    let [op, ...rest] = raw.split('.')
    let negate = false
    if (op === 'not') {
      negate = true
      op = rest.shift()
    }
    const value = rest.join('.')
    const keep = (predicate) => {
      out = out.filter((row) => (negate ? !predicate(row) : predicate(row)))
    }
    if (op === 'eq') keep((r) => asText(r[key]) === value)
    else if (op === 'neq') keep((r) => asText(r[key]) !== value)
    else if (op === 'in') {
      const list = value.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, ''))
      keep((r) => list.includes(asText(r[key])))
    } else if (op === 'is') keep((r) => (value === 'null' ? r[key] == null : r[key] != null))
    else if (op === 'ilike') {
      const needle = value.replace(/[%*]/g, '').toLowerCase()
      keep((r) => asText(r[key]).toLowerCase().includes(needle))
    } else if (op === 'gte') keep((r) => r[key] != null && compare(r[key], value) >= 0)
    else if (op === 'gt') keep((r) => r[key] != null && compare(r[key], value) > 0)
    else if (op === 'lte') keep((r) => r[key] != null && compare(r[key], value) <= 0)
    else if (op === 'lt') keep((r) => r[key] != null && compare(r[key], value) < 0)
  }

  const order = url.searchParams.get('order')
  if (order) {
    for (const spec of order.split(',').reverse()) {
      const [column, direction] = spec.split('.')
      const ascending = direction !== 'desc'
      out = [...out].sort((a, b) => (ascending ? compare(a[column], b[column]) : -compare(a[column], b[column])))
    }
  }

  const limit = url.searchParams.get('limit')
  if (limit) out = out.slice(0, Number(limit))
  return out
}

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      try {
        resolve(raw === '' ? null : JSON.parse(raw))
      } catch {
        resolve(null)
      }
    })
  })

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

  // RPCs from migration 007.
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    const fn = url.pathname.slice('/rest/v1/rpc/'.length)
    const body = (await readBody(req)) ?? {}
    if (fn === 'ga_claim_validation') {
      const rows = validateClaim(body.p_claim_id)
      console.log(`[ga-fixtures] ga_claim_validation(${body.p_claim_id}) -> ${rows.length} failures`)
      return send(200, rows)
    }
    if (fn === 'ga_submit_claim') {
      const claim = gift_aid_claims.find((c) => c.id === body.p_claim_id)
      if (!claim) return send(400, { message: 'Gift Aid claim does not exist' })
      claim.status = 'submitted'
      claim.submitted_on = new Date().toISOString().slice(0, 10)
      claim.hmrc_reference = body.p_reference
      for (const gift of donations) {
        if (gift.gift_aid_claim_id === claim.id) gift.gift_aid_status = 'claimed'
      }
      const totals = gift_aid_claim_totals.find((t) => t.claim_id === claim.id)
      if (totals) {
        totals.status = 'submitted'
        totals.submitted_on = claim.submitted_on
        totals.hmrc_reference = claim.hmrc_reference
      }
      // A fresh rolling claim opens with the filing (02 §3.7).
      const next = {
        id: randomUUID(),
        status: 'draft-rolling',
        submitted_on: null,
        paid_on: null,
        hmrc_reference: null,
        total_donations: null,
        total_claimed: null,
        gasds_total: null,
        created_at: new Date().toISOString(),
      }
      gift_aid_claims.push(next)
      gift_aid_claim_totals.push({
        claim_id: next.id,
        status: 'draft-rolling',
        building_since: next.created_at.slice(0, 10),
        submitted_on: null,
        paid_on: null,
        hmrc_reference: null,
        donations_total: 0,
        claimable_total: 0,
        gasds_total: 0,
        gift_count: 0,
        donor_count: 0,
      })
      console.log(`[ga-fixtures] ga_submit_claim -> ${body.p_reference}; fresh rolling claim ${next.id}`)
      return send(200, null)
    }
    return send(404, { message: `no fixture for rpc ${fn}` })
  }

  if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.slice('/rest/v1/'.length)
    if (!DB[table]) DB[table] = []
    const single = (req.headers.accept ?? '').includes('vnd.pgrst.object')

    if (req.method === 'POST') {
      const body = await readBody(req)
      const rows = (Array.isArray(body) ? body : [body]).map((row) => ({
        id: randomUUID(),
        created_at: new Date().toISOString(),
        ...row,
      }))
      DB[table].push(...rows)
      console.log(`[ga-fixtures] insert ${table} ×${rows.length}`)
      return send(201, single ? rows[0] : rows)
    }

    if (req.method === 'PATCH') {
      const body = await readBody(req)
      const targets = applyFilters(DB[table], url)
      for (const row of targets) Object.assign(row, body)
      console.log(`[ga-fixtures] update ${table} ×${targets.length}`)
      return send(200, single ? (targets[0] ?? null) : targets)
    }

    if (req.method === 'DELETE') {
      const targets = new Set(applyFilters(DB[table], url))
      DB[table] = DB[table].filter((row) => !targets.has(row))
      return send(200, [...targets])
    }

    const filtered = applyFilters(DB[table], url)
    if (single) return send(200, filtered[0] ?? null)
    return send(200, filtered, { 'content-range': `0-${Math.max(filtered.length - 1, 0)}/${filtered.length}` })
  }

  send(404, { message: 'not a fixture route' })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `[ga-fixtures] 127.0.0.1:${PORT} — ${GIFT_COUNT} gifts on the rolling claim, ` +
      `${MISSING.length} donors owing declarations, ${validateClaim(CLAIM_ROLLING).length} validation failures`,
  )
})
