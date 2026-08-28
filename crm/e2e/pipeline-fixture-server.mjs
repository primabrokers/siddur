#!/usr/bin/env node
/**
 * Pipeline fixture server — a **development harness**, never shipped.
 *
 * Same idea as `e2e/fixture-server.mjs` (a PostgREST/GoTrue stand-in over plain
 * arrays), carrying only what the Pipeline board (06 §2) reads: `opportunities`
 * with both clocks, the donors they belong to, the open tasks that name them
 * (`tasks.opportunity_id`), the `opportunity_stage` lookups **with their meta**
 * (exit criteria + rot days) and the `stale_prospects` rule.
 *
 * Its own file, its own port, so the milestones being built in parallel do not
 * collide.
 *
 *   node e2e/pipeline-fixture-server.mjs --port 5292
 *   VITE_SUPABASE_URL=http://127.0.0.1:5292 VITE_SUPABASE_ANON_KEY=fixture \
 *     npx vite --port 5192 --strictPort --host
 *   E2E_BASE_URL=http://localhost:5192 E2E_SHOT_SUFFIX=fixtures node e2e/m6-pipeline-shots.mjs
 *
 * The dataset is `wireframes/Pipeline.dc.html` made real: one card per flag
 * colour, one rotting card, one card with no next move, and two asks that have
 * not moved forward in a quarter — so the board, the sort, the pink wash and
 * the stale panel all have something true to show.
 */

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 ? process.argv[index + 1] : fallback
}
const PORT = Number(arg('port', 5292))

const BRAUN = '11111111-1111-1111-1111-111111111111'
const KLEIN = '22222222-2222-2222-2222-222222222222'

const DAY = 86_400_000
const now = new Date()
/** ISO timestamp N whole days ago — the clocks the board measures against. */
const ago = (days) => new Date(now.getTime() - days * DAY).toISOString()
const dateIn = (days) => new Date(now.getTime() + days * DAY).toISOString().slice(0, 10)
const dateAgo = (days) => dateIn(-days)

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
  city: 'Golders Green',
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
  stage: 'in_discussion',
  priority: 'medium',
  tier: 'B',
  estimated_capacity: null,
  contact_frequency_days: null,
  kit_paused_until: null,
  engagement_score: null,
  engagement_tier: 'warm',
  pinned_note_id: null,
  is_archived: false,
  merged_into_id: null,
  created_at: '2025-06-01T09:00:00.000Z',
}

const person = (id, over) => ({ ...contactBase, id, ...over })

const CONTACTS = [
  person('c-katz', { first_name: 'Naftoli', last_name: 'Katz', tier: 'A' }),
  person('c-feld', {
    first_name: 'Feld Brothers Ltd',
    last_name: '',
    organization: 'Feld Brothers Ltd',
    contact_kind: 'business',
  }),
  person('c-cohen', { first_name: 'Dovid', last_name: 'Cohen', tier: 'A' }),
  person('c-halberstam', {
    title: 'Mrs.',
    first_name: 'B.',
    last_name: 'Halberstam',
    // Owned by the other fundraiser — the Mine/Everyone toggle has to matter.
    relationship_owner_id: KLEIN,
  }),
  person('c-adler', { first_name: 'Reuven', last_name: 'Adler', organization: 'Adler Textiles' }),
  person('c-weinberger', {
    first_name: 'Weinberger Trust',
    last_name: '',
    organization: 'Weinberger Trust',
    contact_kind: 'trust',
  }),
  person('c-stern', { title: 'M.', first_name: 'Stern', last_name: '' }),
]

const opportunityBase = {
  campaign_id: 'cam-building',
  fund_id: 'fund-building',
  ask_date: null,
  projection_high: null,
  projection_low: null,
  expected_amount: null,
  motivation: null,
  restrictions: null,
  status: 'open',
  closed_on: null,
  lost_reason: null,
  notes: null,
  created_at: ago(200),
}

const OPPORTUNITIES = [
  {
    ...opportunityBase,
    id: 'op-stern',
    contact_id: 'c-stern',
    name: 'Sefer Torah dedication',
    stage: 'identified',
    ask_amount: 8000,
    probability_pct: 15,
    expected_decision_on: null,
    stage_entered_at: ago(20),
    last_moved_forward_at: ago(122),
    opened_on: dateAgo(160),
  },
  {
    ...opportunityBase,
    id: 'op-katz',
    contact_id: 'c-katz',
    name: 'Kollel wing naming',
    fund_id: 'fund-kollel',
    stage: 'qualified',
    ask_amount: 40000,
    probability_pct: 40,
    expected_decision_on: dateIn(75),
    stage_entered_at: ago(11),
    last_moved_forward_at: ago(11),
    opened_on: dateAgo(60),
  },
  {
    ...opportunityBase,
    id: 'op-feld',
    contact_id: 'c-feld',
    name: 'Dinner 2026 sponsorship',
    fund_id: 'fund-general',
    campaign_id: 'cam-dinner',
    stage: 'qualified',
    ask_amount: 12000,
    probability_pct: 20,
    expected_decision_on: null,
    // 38 days in a stage that rots at 30, 96 days without forward motion.
    stage_entered_at: ago(38),
    last_moved_forward_at: ago(96),
    opened_on: dateAgo(140),
  },
  {
    ...opportunityBase,
    id: 'op-cohen',
    contact_id: 'c-cohen',
    name: 'Building campaign',
    stage: 'cultivating',
    ask_amount: 20000,
    probability_pct: 70,
    expected_decision_on: dateIn(40),
    stage_entered_at: ago(26),
    last_moved_forward_at: ago(26),
    opened_on: dateAgo(90),
  },
  {
    ...opportunityBase,
    id: 'op-halberstam',
    contact_id: 'c-halberstam',
    name: 'Legacy discussion',
    fund_id: 'fund-general',
    stage: 'cultivating',
    ask_amount: 80000,
    probability_pct: 30,
    expected_decision_on: null,
    stage_entered_at: ago(12),
    last_moved_forward_at: ago(12),
    opened_on: dateAgo(70),
  },
  {
    ...opportunityBase,
    id: 'op-adler',
    contact_id: 'c-adler',
    name: 'Proposal sent 18 Aug',
    stage: 'solicited',
    ask_amount: 35000,
    probability_pct: 60,
    expected_decision_on: dateIn(21),
    stage_entered_at: ago(10),
    last_moved_forward_at: ago(10),
    opened_on: dateAgo(120),
  },
  {
    ...opportunityBase,
    id: 'op-weinberger',
    contact_id: 'c-weinberger',
    name: 'Beis medrash refurbishment',
    stage: 'pledged',
    ask_amount: 25000,
    probability_pct: 100,
    expected_decision_on: dateAgo(30),
    stage_entered_at: ago(30),
    last_moved_forward_at: ago(30),
    opened_on: dateAgo(210),
  },
  // Decided asks — the won/lost history behind the panel's toggle.
  {
    ...opportunityBase,
    id: 'op-won',
    contact_id: 'c-cohen',
    name: 'Yom tov appeal',
    stage: 'stewarding',
    ask_amount: 5000,
    probability_pct: 100,
    expected_decision_on: dateAgo(45),
    stage_entered_at: ago(45),
    last_moved_forward_at: ago(45),
    opened_on: dateAgo(120),
    status: 'won',
    closed_on: dateAgo(45),
  },
  {
    ...opportunityBase,
    id: 'op-lost',
    contact_id: 'c-stern',
    name: 'Scholarship sponsorship',
    stage: 'solicited',
    ask_amount: 15000,
    probability_pct: 0,
    expected_decision_on: dateAgo(60),
    stage_entered_at: ago(80),
    last_moved_forward_at: ago(80),
    opened_on: dateAgo(200),
    status: 'lost',
    closed_on: dateAgo(60),
    lost_reason: 'timing',
  },
]

const taskBase = {
  details: null,
  assigned_to: BRAUN,
  priority: 'medium',
  status: 'todo',
  waiting_for: null,
  queue_order: null,
  completed_at: null,
  origin: 'manual',
  created_by: BRAUN,
  created_at: ago(10),
}

const TASKS = [
  {
    ...taskBase,
    id: 'tk-katz',
    contact_id: 'c-katz',
    opportunity_id: 'op-katz',
    title: 'Lunch after yomim noraim',
    action_type: 'meeting',
    due_on: dateIn(0),
  },
  {
    ...taskBase,
    id: 'tk-cohen',
    contact_id: 'c-cohen',
    opportunity_id: 'op-cohen',
    title: 'Call re proposal',
    action_type: 'call',
    due_on: dateAgo(4),
    priority: 'high',
  },
  {
    ...taskBase,
    id: 'tk-halberstam',
    contact_id: 'c-halberstam',
    opportunity_id: 'op-halberstam',
    title: 'Home visit',
    action_type: 'meeting',
    due_on: dateIn(6),
    assigned_to: KLEIN,
  },
  {
    ...taskBase,
    id: 'tk-adler',
    contact_id: 'c-adler',
    opportunity_id: 'op-adler',
    title: 'Auto follow-up on the proposal',
    action_type: 'send_email',
    due_on: dateIn(2),
    status: 'waiting',
    waiting_for: 'Their trustees meet on the 14th',
  },
  {
    ...taskBase,
    id: 'tk-stern',
    contact_id: 'c-stern',
    opportunity_id: 'op-stern',
    title: 'Coffee to reopen the conversation',
    action_type: 'meeting',
    due_on: dateIn(9),
  },
  // Deliberately unlinked: proof the board reads `opportunity_id`, not contact.
  {
    ...taskBase,
    id: 'tk-unlinked',
    contact_id: 'c-feld',
    opportunity_id: null,
    title: 'Send the annual report',
    action_type: 'send_email',
    due_on: dateIn(3),
  },
]

const lookup = (list, rows) =>
  rows.map(([value, label, meta], index) => ({
    id: `${list}-${value}`,
    list_name: list,
    value,
    label,
    sort_order: (index + 1) * 10,
    color: null,
    meta: meta ?? {},
    is_active: true,
  }))

const DB = {
  team_members: [
    {
      id: BRAUN,
      full_name: 'Avi Braun',
      role: 'admin',
      email: 'admin@demo.test',
      can_see_amounts: true,
      is_active: true,
      digest_hour: 7,
      digest_channel: 'email',
    },
    {
      id: KLEIN,
      full_name: 'Rivka Klein',
      role: 'fundraiser',
      email: 'fundraiser@demo.test',
      can_see_amounts: true,
      is_active: true,
      digest_hour: 7,
      digest_channel: 'email',
    },
  ],
  contacts: CONTACTS,
  contact_stats: [],
  opportunities: OPPORTUNITIES,
  tasks: TASKS,
  lookup_options: [
    ...lookup('opportunity_stage', [
      ['identified', 'Identified', { exit_criteria: 'We know who they are and why they might care', rot_days: 45 }],
      ['qualified', 'Qualified', { exit_criteria: 'Capacity and interest confirmed', rot_days: 30 }],
      ['cultivating', 'Cultivating', { exit_criteria: 'They have seen the work', rot_days: 45 }],
      ['solicited', 'Solicited', { exit_criteria: 'An answer has been received', rot_days: 14 }],
      ['pledged', 'Pledged', { exit_criteria: 'Paid in full' }],
      ['stewarding', 'Stewarding', { exit_criteria: 'Thanked, reported to, ready to ask again' }],
    ]),
    ...lookup('opportunity_lost_reason', [
      ['no_capacity', 'No capacity right now'],
      ['timing', 'Wrong timing'],
      ['gave_elsewhere', 'Gave elsewhere'],
      ['no_response', 'Never got an answer'],
      ['other', 'Other'],
    ]),
    ...lookup('action_type', [
      ['call', 'Call'],
      ['meeting', 'Meeting'],
      ['send_email', 'Send email'],
      ['whatsapp', 'WhatsApp'],
    ]),
    ...lookup('stage', [
      ['prospect', 'Prospect'],
      ['in_discussion', 'In discussion'],
      ['active_donor', 'Active donor'],
    ]),
    ...lookup('priority', [
      ['high', 'High'],
      ['medium', 'Medium'],
      ['low', 'Low'],
    ]),
  ],
  automation_rules: [
    { rule_key: 'stale_prospects', is_enabled: true, params: { days: 90 }, updated_at: ago(30) },
  ],
  funds: [
    { id: 'fund-general', name: 'General', code: 'GEN', is_restricted: false, is_active: true },
    { id: 'fund-building', name: 'Building', code: 'BLD', is_restricted: true, is_active: true },
    { id: 'fund-kollel', name: 'Kollel', code: 'KOL', is_restricted: true, is_active: true },
  ],
  campaigns: [
    { id: 'cam-building', name: 'Building campaign', is_active: true },
    { id: 'cam-dinner', name: 'Dinner 2026', is_active: true },
  ],
  appeals: [],
  donations: [],
  interactions: [],
  notes: [],
  documents: [],
  pledges: [],
  pledge_installments: [],
  recurring_agreements: [],
  saved_views: [],
  signals: [],
  households: [],
  tags: [],
  taggings: [],
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

const asText = (value) => (value === null || value === undefined ? '' : String(value))

function applyFilters(rows, url) {
  let out = rows
  for (const [key, raw] of url.searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue
    const [op, ...rest] = raw.split('.')
    const value = rest.join('.')
    if (op === 'eq') out = out.filter((r) => asText(r[key]) === value)
    else if (op === 'neq') out = out.filter((r) => asText(r[key]) !== value)
    else if (op === 'in') {
      const list = value
        .replace(/^\(|\)$/g, '')
        .split(',')
        .map((v) => v.replace(/^"|"$/g, ''))
      out = out.filter((r) => list.includes(asText(r[key])))
    } else if (op === 'is') out = out.filter((r) => (value === 'null' ? r[key] == null : r[key] != null))
    else if (op === 'ilike') {
      const needle = value.replace(/[%*]/g, '').toLowerCase()
      out = out.filter((r) => asText(r[key]).toLowerCase().includes(needle))
    } else if (op === 'gte') out = out.filter((r) => r[key] != null && asText(r[key]) >= value)
    else if (op === 'lte') out = out.filter((r) => r[key] != null && asText(r[key]) <= value)
  }

  const order = url.searchParams.get('order')
  if (order) {
    for (const spec of order.split(',').reverse()) {
      const [column, direction] = spec.split('.')
      const ascending = direction !== 'desc'
      out = [...out].sort((a, b) => {
        const cmp = asText(a[column]).localeCompare(asText(b[column]))
        return ascending ? cmp : -cmp
      })
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
      console.log(`[pipeline-fixtures] insert ${table} ×${rows.length}`)
      return send(201, single ? rows[0] : rows)
    }

    if (req.method === 'PATCH') {
      const body = await readBody(req)
      const targets = applyFilters(DB[table], url)
      for (const row of targets) Object.assign(row, body)
      console.log(`[pipeline-fixtures] update ${table} ×${targets.length}`, JSON.stringify(body))
      return send(200, single ? (targets[0] ?? null) : targets)
    }

    if (req.method === 'DELETE') {
      const targets = new Set(applyFilters(DB[table], url))
      DB[table] = DB[table].filter((row) => !targets.has(row))
      console.log(`[pipeline-fixtures] delete ${table} ×${targets.size}`)
      return send(200, [...targets])
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
  const open = OPPORTUNITIES.filter((row) => row.status === 'open')
  console.log(
    `[pipeline-fixtures] 127.0.0.1:${PORT} — ${open.length} open asks, ${OPPORTUNITIES.length - open.length} decided`,
  )
})
