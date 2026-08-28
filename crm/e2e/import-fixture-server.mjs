#!/usr/bin/env node
/**
 * Import & data-quality fixture server — a **development harness**, never shipped.
 *
 * Same idea as `e2e/fixture-server.mjs` (a PostgREST/GoTrue stand-in over
 * plain arrays), carrying the tables this milestone needs and nothing else:
 * `import_batches`, `duplicates_queue`, `funds`, plus enough contacts,
 * `contact_stats` and lookups for the contacts list to render its magic
 * columns and bulk sheet.
 *
 * Kept as its own file rather than as edits to `fixture-server.mjs` so the
 * milestones being built in parallel do not collide.
 *
 *   node e2e/import-fixture-server.mjs --port 5291
 *   VITE_SUPABASE_URL=http://127.0.0.1:5291 VITE_SUPABASE_ANON_KEY=fixture \
 *     npx vite --port 5191 --strictPort --host
 *   node e2e/p1x-shots.mjs
 *
 * The dataset deliberately contains one obvious duplicate pair (Dovid Cohen /
 * David Cohen, same phone) so the merge tool has something real to show.
 */

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 ? process.argv[index + 1] : fallback
}
const PORT = Number(arg('port', 5291))

const BRAUN = '11111111-1111-1111-1111-111111111111'
const id = (n) => `aaaaaaaa-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`

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
  stage: 'keep_in_touch',
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
  created_at: '2026-01-05T09:00:00.000Z',
  updated_at: '2026-01-05T09:00:00.000Z',
}

const statsBase = {
  lifetime_giving: null,
  this_year_giving: null,
  last_year_giving: null,
  soft_credit_lifetime: null,
  soft_credit_this_year: null,
  gift_count: null,
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
  donor_status: 'active',
  has_ga_declaration: false,
  household_id: null,
  household_lifetime_giving: null,
  household_gift_count: null,
}

const lookup = (list, pairs) =>
  pairs.map((pair, i) => {
    const [value, label] = pair.split('|')
    return { id: `${list}-${i}`, list_name: list, value, label, sort_order: i, color: null, meta: {}, is_active: true }
  })

const PEOPLE = [
  { n: 1, first_name: 'Dovid', last_name: 'Cohen', city: 'Golders Green', phone: '+447700900123', email: 'dovid.cohen@example.com', organization: 'Cohen & Partner', tier: 'A', stage: 'in_discussion', priority: 'high', postcode: null },
  { n: 2, first_name: 'David', last_name: 'Cohen', city: null, phone: '+447700900123', email: null, postcode: 'NW11 8AA' },
  { n: 3, first_name: 'Reuven', last_name: 'Adler', city: 'Golders Green', stage: 'active_donor', priority: 'high' },
  { n: 4, first_name: 'Devorah', last_name: 'Frankel', title: 'Mrs', city: 'Golders Green', stage: 'stewardship' },
  { n: 5, first_name: 'Yaakov', last_name: 'Weiss', title: "R'", city: 'Hendon', stage: 'active_donor' },
  { n: 6, first_name: 'Yanky', last_name: 'Katz', city: 'Golders Green', stage: 'stewardship', tier: 'A' },
  { n: 7, first_name: 'Shmuel', last_name: 'Feld', city: 'London', stage: 'active_donor' },
  { n: 8, first_name: 'Chaim', last_name: 'Levy', city: 'Manchester', stage: 'active_donor' },
]

const STATS = {
  1: { lifetime_giving: 42500, this_year_giving: 12000, last_year_giving: 18000, gift_count: 14, largest_gift: 10000, pledge_balance: 5000, days_since_contact: 12, donor_status: 'active', flag: 'today' },
  3: { lifetime_giving: 18250, this_year_giving: 5000, last_year_giving: 4000, gift_count: 9, largest_gift: 2500, days_since_contact: 45, donor_status: 'active', flag: 'overdue' },
  4: { lifetime_giving: 6300, this_year_giving: 0, last_year_giving: 3600, gift_count: 6, largest_gift: 1800, days_since_contact: 96, donor_status: 'pre_lapsed', flag: 'none' },
  5: { lifetime_giving: 31000, this_year_giving: 9000, last_year_giving: 9000, gift_count: 11, largest_gift: 5000, days_since_contact: 21, donor_status: 'active', flag: 'future' },
  6: { lifetime_giving: 74000, this_year_giving: 25000, last_year_giving: 20000, gift_count: 19, largest_gift: 18000, pledge_balance: 12000, days_since_contact: 5, donor_status: 'active', flag: 'waiting' },
  7: { lifetime_giving: 2400, this_year_giving: 600, last_year_giving: 600, gift_count: 4, largest_gift: 600, days_since_contact: 130, donor_status: 'lapsed', flag: 'none' },
  8: { lifetime_giving: 9800, this_year_giving: 3200, last_year_giving: 2600, gift_count: 7, largest_gift: 1200, days_since_contact: 33, donor_status: 'active', flag: 'future' },
}

const DB = {
  team_members: [
    { id: BRAUN, full_name: "R' Braun", role: 'admin', email: 'admin@demo.test', can_see_amounts: true, is_active: true, digest_hour: 7, digest_channel: 'email' },
  ],
  contacts: PEOPLE.map(({ n, ...rest }) => ({ ...contactBase, id: id(n), ...rest })),
  contact_stats: PEOPLE.filter(({ n }) => STATS[n]).map(({ n }) => ({
    ...statsBase,
    ...STATS[n],
    contact_id: id(n),
  })),
  lookup_options: [
    ...lookup('stage', ['prospect|Prospect', 'cultivation|Cultivation', 'in_discussion|In discussion', 'active_donor|Active donor', 'stewardship|Stewardship', 'keep_in_touch|Keep in touch']),
    ...lookup('priority', ['high|High', 'medium|Medium', 'low|Low']),
    ...lookup('action_type', ['call|Call', 'whatsapp|WhatsApp', 'send_email|Send email', 'thank_you|Thank you']),
    ...lookup('interaction_kind', ['call|Call', 'whatsapp|WhatsApp', 'email|Email', 'meeting|Meeting']),
  ],
  funds: [
    { id: 'fund-general', name: 'General', code: 'GEN', is_restricted: false, is_active: true },
    { id: 'fund-building', name: 'Building Fund', code: 'BLD', is_restricted: true, is_active: true },
  ],
  campaigns: [],
  appeals: [],
  tags: [
    { id: 'tag-vip', name: 'VIP', category: 'relationship', color: null },
    { id: 'tag-building', name: 'Building project', category: 'interest', color: null },
  ],
  taggings: [{ id: 'tagging-1', tag_id: 'tag-vip', contact_id: id(1) }],
  import_batches: [],
  duplicates_queue: [
    {
      id: 'dupe-1',
      contact_a_id: id(1) < id(2) ? id(1) : id(2),
      contact_b_id: id(1) < id(2) ? id(2) : id(1),
      score: 0.857,
      reason: 'same phone',
      state: 'open',
      created_at: '2026-08-27T02:00:00.000Z',
      resolved_at: null,
      resolved_by: null,
    },
  ],
  donations: [],
  interactions: [],
  tasks: [],
  notes: [],
  documents: [],
  pledges: [],
  pledge_installments: [],
  recurring_agreements: [],
  soft_credits: [],
  gift_aid_declarations: [],
  gift_aid_claims: [],
  opportunities: [],
  households: [],
  saved_views: [],
  signals: [],
  automation_rules: [],
  ai_activity_log: [],
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
      const list = value.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, ''))
      out = out.filter((r) => list.includes(asText(r[key])))
    } else if (op === 'is') out = out.filter((r) => (value === 'null' ? r[key] == null : r[key] != null))
    else if (op === 'ilike') {
      const needle = value.replace(/[%*]/g, '').toLowerCase()
      out = out.filter((r) => asText(r[key]).toLowerCase() === needle)
    } else if (op === 'gte') out = out.filter((r) => r[key] != null && asText(r[key]) >= value)
    else if (op === 'lte') out = out.filter((r) => r[key] != null && asText(r[key]) <= value)
  }

  const order = url.searchParams.get('order')
  if (order) {
    for (const spec of order.split(',').reverse()) {
      const [column, direction] = spec.split('.')
      const ascending = direction !== 'desc'
      out = [...out].sort((a, b) => {
        const left = asText(a[column])
        const right = asText(b[column])
        const cmp = left.localeCompare(right)
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
        updated_at: new Date().toISOString(),
        ...row,
      }))
      DB[table].push(...rows)
      console.log(`[import-fixtures] insert ${table} ×${rows.length}`)
      return send(201, single ? rows[0] : rows)
    }

    if (req.method === 'PATCH') {
      const body = await readBody(req)
      const targets = applyFilters(DB[table], url)
      for (const row of targets) Object.assign(row, body)
      console.log(`[import-fixtures] update ${table} ×${targets.length}`)
      return send(200, single ? (targets[0] ?? null) : targets)
    }

    if (req.method === 'DELETE') {
      const targets = new Set(applyFilters(DB[table], url))
      DB[table] = DB[table].filter((row) => !targets.has(row))
      console.log(`[import-fixtures] delete ${table} ×${targets.size}`)
      return send(200, [...targets])
    }

    const filtered = applyFilters(DB[table], url)
    if (single) return send(200, filtered[0] ?? null)
    return send(200, filtered, { 'content-range': `0-${Math.max(filtered.length - 1, 0)}/${filtered.length}` })
  }

  send(404, { message: 'not a fixture route' })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[import-fixtures] 127.0.0.1:${PORT} — ${DB.contacts.length} contacts, 1 duplicate pair`)
})
