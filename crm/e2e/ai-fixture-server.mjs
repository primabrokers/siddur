#!/usr/bin/env node
/**
 * M9a fixture server — a **development harness**, never shipped.
 *
 * A PostgREST/GoTrue stand-in with three extra routes:
 * `/functions/v1/{donor-brief,draft-message,send-digest}`, answering with canned
 * payloads in exactly the shapes the real edge functions return. That lets the
 * brief card, the drafting sheet and the blank-page refusal be photographed in
 * a real browser with no Anthropic key and without touching the live project.
 *
 *   node e2e/ai-fixture-server.mjs --port 5295
 *   VITE_SUPABASE_URL=http://127.0.0.1:5295 VITE_SUPABASE_ANON_KEY=fixture \
 *     npx vite --port 5195 --strictPort
 *   node e2e/m9a-shots.mjs
 *
 * Its own file (not edits to `fixture-server.mjs` or `capture-fixture-server.mjs`)
 * so the milestones being built in parallel do not collide.
 *
 * **The exclusion here is canned, not computed.** The real rule lives in
 * `src/features/ai/core.ts` and is tested exhaustively in `tests/ai-core.test.ts`;
 * this harness only needs to *render* both outcomes, so it keys off the gift id.
 */

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 ? process.argv[index + 1] : fallback
}
const PORT = Number(arg('port', 5295))
/** `--mode unconfigured` makes both AI routes answer 503, for the quiet path. */
const MODE = arg('mode', 'ok')

const BRAUN = '11111111-1111-1111-1111-111111111111'
const DOVID = 'aaaaaaaa-0000-0000-0000-000000000001'
const WEISS = 'aaaaaaaa-0000-0000-0000-000000000003'
const GIFT_OK = 'dddddddd-0000-0000-0000-000000000001'
const GIFT_MEMORY = 'dddddddd-0000-0000-0000-000000000002'

const day = (offset) => {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return date.toISOString().slice(0, 10)
}
const stamp = (offset, hour = 10) => {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  date.setHours(hour, 0, 0, 0)
  return date.toISOString()
}

/* ------------------------------------------------------------------- rows */

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
  stage: 'active_donor',
  priority: 'medium',
  tier: null,
  estimated_capacity: null,
  contact_frequency_days: null,
  kit_paused_until: null,
  engagement_score: null,
  engagement_tier: 'warm',
  pinned_note_id: null,
  is_archived: false,
  merged_into_id: null,
  holding_line: null,
  holding_line_at: null,
  created_at: stamp(-400),
  updated_at: stamp(-1),
}

const statsBase = {
  household_id: null,
  lifetime_giving: null,
  giving_this_year: null,
  giving_last_year: null,
  soft_lifetime_giving: null,
  soft_giving_this_year: null,
  soft_giving_last_year: null,
  gift_count: null,
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
  flag: 'future',
  donor_status: 'active',
  has_ga_declaration: false,
  household_lifetime_giving: null,
  household_gift_count: null,
  // The client maps snake_case → its own names; both spellings are served so
  // whichever the mapper reads is present.
  this_year_giving: null,
  last_year_giving: null,
  soft_credit_lifetime: null,
  soft_credit_this_year: null,
  first_gift_on: null,
  last_gift_on: null,
  last_contact_at: null,
  last_contact_kind: null,
}

const giftBase = {
  currency: 'GBP',
  campaign_id: null,
  appeal_id: null,
  payment_method: 'bank_transfer',
  status: 'received',
  pledge_id: null,
  installment_id: null,
  recurring_agreement_id: null,
  receipt_status: 'queued',
  receipt_pref: null,
  thank_you_status: 'not_done',
  gift_aid_status: 'eligible',
  gift_aid_claim_id: null,
  is_gasds: false,
  notes: null,
  created_by: BRAUN,
  created_at: stamp(-3),
}

const DB = {
  team_members: [
    {
      id: BRAUN,
      full_name: "R' Braun",
      email: 'admin@demo.test',
      role: 'admin',
      can_see_amounts: true,
      digest_hour: 7,
      digest_channel: 'email',
      drafting_examples: null,
      is_active: true,
      ics_token: null,
    },
  ],

  contacts: [
    {
      ...contactBase,
      id: DOVID,
      first_name: 'Dovid',
      last_name: 'Cohen',
      title: 'R’',
      organization: 'Cohen & Partner',
      city: 'Golders Green',
      tier: 'A',
      email: 'dovid@example.test',
      phone: '+447700900123',
      spouse_name: 'Rivky',
      things_to_remember: 'Prefers a call before Mincha; never on a Friday.',
      contact_frequency_days: 60,
      engagement_tier: 'hot',
      holding_line:
        'Discussed £20,000 for the building at the June meeting; he asked to be called back after Sukkos.',
      holding_line_at: stamp(-2),
    },
    {
      ...contactBase,
      id: WEISS,
      first_name: 'Yaakov',
      last_name: 'Weiss',
      title: 'R’',
      city: 'Hendon',
      email: 'weiss@example.test',
    },
  ],

  contact_stats: [
    {
      ...statsBase,
      contact_id: DOVID,
      lifetime_giving: 42500,
      giving_this_year: 5000,
      this_year_giving: 5000,
      gift_count: 11,
      largest_gift: 20000,
      average_gift: 3863,
      last_gift_date: day(-3),
      last_gift_on: day(-3),
      last_gift_amount: 5000,
      days_since_contact: 34,
      last_meaningful_contact_kind: 'meeting',
      last_contact_kind: 'meeting',
      kit_due_on: day(-4),
      open_task_count: 2,
      next_action_title: 'Call re building project / £20k',
      next_action_due_on: day(1),
      next_action_type: 'call',
      flag: 'future',
      has_ga_declaration: true,
    },
    { ...statsBase, contact_id: WEISS, gift_count: 1, lifetime_giving: 1800, last_gift_date: day(-2) },
  ],

  interactions: [
    {
      id: 'ii-1',
      contact_id: DOVID,
      occurred_at: stamp(-34, 11),
      kind: 'meeting',
      status: 'logged',
      team_member_id: BRAUN,
      summary: 'Met in London. Very warm; strong interest in the building project.',
      outcome: 'Wants the naming pack; asked to be called after Sukkos.',
      is_meaningful: true,
      location: 'London',
      attendees: null,
      purpose: null,
      ask_amount: 20000,
      source: 'quick_capture_ai',
      ai_raw_input: null,
      ai_activity_id: null,
      created_by: BRAUN,
      created_at: stamp(-34),
    },
    {
      id: 'ii-2',
      contact_id: DOVID,
      occurred_at: stamp(-90, 9),
      kind: 'call',
      status: 'logged',
      team_member_id: BRAUN,
      summary: 'Quick call before Pesach; asked after the new shiur.',
      outcome: null,
      is_meaningful: true,
      location: null,
      attendees: null,
      purpose: null,
      ask_amount: null,
      source: 'manual',
      ai_raw_input: null,
      ai_activity_id: null,
      created_by: BRAUN,
      created_at: stamp(-90),
    },
  ],

  donations: [
    {
      ...giftBase,
      id: GIFT_OK,
      contact_id: DOVID,
      donated_on: day(-3),
      amount: 5000,
      amount_gbp: 5000,
      fund_id: 'f-building',
      campaign_id: 'c-building',
    },
    {
      ...giftBase,
      id: GIFT_MEMORY,
      contact_id: WEISS,
      donated_on: day(-2),
      amount: 1800,
      amount_gbp: 1800,
      fund_id: 'f-general',
    },
  ],

  tributes: [
    {
      id: 'tr-1',
      donation_id: GIFT_MEMORY,
      tribute_type: 'in_memory',
      honoree_name: 'his father',
      honoree_contact_id: null,
      acknowledgee_name: null,
      acknowledgee_address: null,
      acknowledgee_contact_id: null,
      notify: false,
      notified_at: null,
    },
  ],

  tasks: [
    {
      id: 'tt-1',
      contact_id: DOVID,
      opportunity_id: null,
      title: 'Call re building project / £20k',
      action_type: 'call',
      details: null,
      assigned_to: BRAUN,
      due_on: day(1),
      priority: 'high',
      status: 'todo',
      waiting_for: null,
      queue_order: null,
      completed_at: null,
      origin: 'quick_capture_ai',
      created_by: BRAUN,
      created_at: stamp(-34),
    },
  ],

  funds: [
    { id: 'f-building', name: 'Building', code: 'BLD', is_restricted: true, is_active: true },
    { id: 'f-general', name: 'General', code: 'GEN', is_restricted: false, is_active: true },
  ],
  campaigns: [{ id: 'c-building', name: 'Building campaign', is_active: true }],
  appeals: [],

  tags: [{ id: 'tag-1', name: 'Building Project', category: 'interest', color: null }],
  taggings: [{ tag_id: 'tag-1', contact_id: DOVID }],

  lookup_options: [
    ...['prospect|Prospect', 'cultivation|Cultivation', 'active_donor|Active donor', 'stewardship|Stewardship'].map(
      (pair, index) => {
        const [value, label] = pair.split('|')
        return { list_name: 'stage', value, label, sort_order: index, color: null, meta: {}, is_active: true }
      },
    ),
  ],

  automation_rules: [],
  ai_activity_log: [],
  ai_briefs: [],
  digest_log: [],
  notes: [],
  documents: [],
  households: [],
  pledges: [],
  pledge_installments: [],
  pledge_balances: [],
  recurring_agreements: [],
  gift_aid_declarations: [],
  opportunities: [],
  signals: [],
  saved_views: [],
  soft_credits: [],
}

/* -------------------------------------------------- the canned AI payloads */

const BRIEF = {
  bullets: {
    who: 'R’ Dovid Cohen of Cohen & Partner, Golders Green — a tier A relationship of eleven years, married to Rivky, introduced by R’ Weiss.',
    trajectory:
      'Warming. Engagement is hot and the last meeting moved the building conversation forward, though it is now 34 days since any meaningful contact.',
    giving:
      'Eleven gifts, £42,500 lifetime, largest £20,000, average £3,863; the most recent was £5,000. A consistent giver whose ceiling has not yet been tested.',
    last_time:
      'Met in London 34 days ago: very warm, strong interest in the building project, £20,000 discussed. He asked for the naming pack and to be called back after Sukkos.',
    talking_points:
      'The naming schedule, the new wing, and how the shiur has grown. The one thing not to forget: call before Mincha, and never on a Friday.',
  },
  holding_line:
    'Discussed £20,000 for the building at the June meeting; he asked to be called back after Sukkos.',
  thin_file: false,
  cached: false,
  model: 'claude-opus-5',
  ai_activity_id: 'act-brief-fixture',
  latency_ms: 2140,
  holding_line_persisted: true,
}

const DRAFT = {
  draft: [
    'Dear R’ Cohen,',
    '',
    'Thank you for your gift of £5,000 to the building fund. It goes straight into the work on the new wing, which is where we spent most of our time when we met in London.',
    '',
    'I have not forgotten the naming pack — I will bring it when I call after Sukkos.',
    '',
    'With warm regards,',
    "R' Braun",
  ].join('\n'),
  facts_used: [
    { label: 'Donor', value: 'R’ Dovid Cohen' },
    { label: 'Gift amount', value: '£5,000' },
    { label: 'Gift date', value: day(-3) },
    { label: 'Fund', value: 'Building' },
    { label: 'Campaign', value: 'Building campaign' },
    { label: 'Last meeting', value: `${day(-34)} — Met in London. Very warm; strong interest in the building project.` },
    { label: 'What was promised', value: 'Wants the naming pack; asked to be called after Sukkos.' },
    { label: 'Sender', value: "R' Braun" },
  ],
  purpose: 'thank_you',
  excluded: false,
  model: 'claude-opus-5',
  ai_activity_id: 'act-draft-fixture',
  latency_ms: 1680,
}

const EXCLUDED = {
  excluded: true,
  reason:
    'This gift is recorded in memory of someone. Messages touching a bereavement are written by a person, never drafted by AI (09 §1.6).',
  marker: 'tribute:in_memory',
  purpose: 'thank_you',
}

/* ------------------------------------------------------------- the plumbing */

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

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])

const listValues = (raw) =>
  raw
    .replace(/^\(|\)$/g, '')
    .split(',')
    .map((value) => value.replace(/^"|"$/g, ''))

/** Enough PostgREST to run the app: eq · in · is · not.is · ilike · gte/lte/gt/lt · neq. */
function applyFilters(rows, url) {
  let out = rows
  for (const [key, raw] of url.searchParams.entries()) {
    if (RESERVED.has(key)) continue
    let [op, ...rest] = raw.split('.')
    let negate = false
    if (op === 'not') {
      negate = true
      op = rest.shift()
    }
    const value = rest.join('.')
    const keep = (predicate) =>
      out.filter((row) => (negate ? !predicate(row) : predicate(row)))

    if (op === 'eq') out = keep((r) => String(r[key]) === value)
    else if (op === 'neq') out = keep((r) => String(r[key]) !== value)
    else if (op === 'in') {
      const list = listValues(value)
      out = keep((r) => list.includes(String(r[key])))
    } else if (op === 'is') out = keep((r) => (value === 'null' ? r[key] == null : r[key] != null))
    else if (op === 'ilike') {
      const needle = value.replace(/[%*]/g, '').toLowerCase()
      out = keep((r) => String(r[key] ?? '').toLowerCase().includes(needle))
    } else if (op === 'gte') out = keep((r) => r[key] != null && String(r[key]) >= value)
    else if (op === 'lte') out = keep((r) => r[key] != null && String(r[key]) <= value)
    else if (op === 'gt') out = keep((r) => r[key] != null && String(r[key]) > value)
    else if (op === 'lt') out = keep((r) => r[key] != null && String(r[key]) < value)
  }

  const order = url.searchParams.get('order')
  if (order) {
    for (const clause of [...order.split(',')].reverse()) {
      const [column, direction] = clause.split('.')
      const descending = direction === 'desc'
      out = [...out].sort((a, b) => {
        const left = a[column] ?? ''
        const right = b[column] ?? ''
        if (left === right) return 0
        return (left < right ? -1 : 1) * (descending ? -1 : 1)
      })
    }
  }

  const offset = Number(url.searchParams.get('offset') ?? 0)
  const limit = url.searchParams.get('limit')
  if (offset > 0) out = out.slice(offset)
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

  /* ------------------------------------------------ the three AI functions */

  if (url.pathname === '/functions/v1/donor-brief') {
    const body = await readBody(req)
    console.log('[m9a-fixtures] donor-brief:', body?.contact_id, body?.force ? '(force)' : '')
    if (MODE === 'unconfigured') return send(503, { error: 'ai_unconfigured' })
    return send(200, { ...BRIEF, cached: body?.force !== true, generated_at: new Date().toISOString() })
  }

  if (url.pathname === '/functions/v1/draft-message') {
    const body = await readBody(req)
    console.log('[m9a-fixtures] draft-message:', body?.purpose, body?.gift_id)
    if (MODE === 'unconfigured') return send(503, { error: 'ai_unconfigured' })
    // The real rule is `detectExclusion` in src/features/ai/core.ts; here the
    // in-memory gift simply has a canned refusal so both outcomes render.
    if (body?.gift_id === GIFT_MEMORY) return send(200, EXCLUDED)
    return send(200, DRAFT)
  }

  if (url.pathname === '/functions/v1/send-digest') {
    return send(200, {
      preview: true,
      delivery: 'preview',
      narrative: null,
      narrative_available: false,
      subject: 'Your day — 1 due (fixtures)',
      body_text: 'DUE TODAY (1)\nCalls (1)\n· Call re building project / £20k — Dovid Cohen',
      payload: { quiet: false },
    })
  }

  /* --------------------------------------------------------------- the REST */

  if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.slice('/rest/v1/'.length)
    if (!DB[table]) DB[table] = []
    const single = (req.headers.accept ?? '').includes('vnd.pgrst.object')

    if (req.method === 'POST') {
      const body = await readBody(req)
      const rows = (Array.isArray(body) ? body : [body]).map((row) => ({ id: randomUUID(), ...row }))
      DB[table].push(...rows)
      console.log(`[m9a-fixtures] insert ${table}:`, JSON.stringify(rows[0]).slice(0, 160))
      return send(201, single ? rows[0] : rows)
    }

    if (req.method === 'PATCH') {
      const body = await readBody(req)
      const targets = applyFilters(DB[table], url)
      for (const row of targets) Object.assign(row, body)
      console.log(`[m9a-fixtures] patch ${table}:`, JSON.stringify(body).slice(0, 160))
      return send(200, single ? (targets[0] ?? null) : targets)
    }

    const filtered = applyFilters(DB[table], url)
    if (single) return send(200, filtered[0] ?? null)
    return send(200, filtered, {
      'content-range': `0-${Math.max(filtered.length - 1, 0)}/${filtered.length}`,
    })
  }

  send(404, { message: 'not a fixture route' })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[m9a-fixtures] 127.0.0.1:${PORT} — mode=${MODE}`)
  console.log(`[m9a-fixtures] contact ${DOVID} · gift ${GIFT_OK} · in-memory gift ${GIFT_MEMORY}`)
})
