#!/usr/bin/env node
/**
 * M9b (journeys + calendar feed) fixture server — a **development harness**,
 * never shipped.
 *
 * Same idea as `e2e/fixture-server.mjs` (a PostgREST/GoTrue stand-in over plain
 * arrays), carrying the tables this milestone needs and nothing else: the five
 * seeded `journey_templates` with their `journey_steps`, one live enrolment
 * part-way through, the `tasks` its steps produced, and a `team_members` row
 * with an `ics_token` so the Settings calendar-feed line has an address to
 * show.
 *
 * Kept as its own file rather than as edits to `fixture-server.mjs` so the
 * milestones being built in parallel do not collide.
 *
 *   node e2e/journeys-fixture-server.mjs --port 5296
 *   VITE_SUPABASE_URL=http://127.0.0.1:5296 VITE_SUPABASE_ANON_KEY=fixture \
 *     npx vite --port 5196 --strictPort --host
 *   node e2e/m9b-shots.mjs
 *
 * The enrolment is deliberately mid-flight — step 1 done, step 2 open, step 3
 * still to come — so the profile card has a real "step 2 of 3" to render and
 * the detach affordance has something to cancel.
 *
 * One thing this harness does NOT model: the AFTER INSERT trigger on
 * `journey_enrollments` (005c). Against Postgres, attaching materialises the
 * steps already due inside the same transaction; here the enrolment is simply
 * inserted, which is exactly what the browser sends either way.
 */

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 ? process.argv[index + 1] : fallback
}
const PORT = Number(arg('port', 5296))

const BRAUN = '11111111-1111-1111-1111-111111111111'
const ICS_TOKEN = '8484414b-bd98-4f81-a645-8d00c004ee87'
const id = (n) => `aaaaaaaa-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`

const today = new Date()
const iso = (offset) => new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10)
const at = (offset) => new Date(today.getTime() + offset * 86_400_000).toISOString()

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
  stage: 'active_donor',
  priority: 'high',
  tier: null,
  estimated_capacity: null,
  contact_frequency_days: 60,
  kit_paused_until: null,
  engagement_score: 62,
  engagement_tier: 'warm',
  engagement_computed_at: null,
  pinned_note_id: null,
  is_archived: false,
  merged_into_id: null,
  import_batch: null,
  created_by: BRAUN,
  created_at: at(-400),
  updated_at: at(-3),
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
  flag: 'future',
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

/* ------------------------------------------------------- journey catalogue */
// The five templates of 08 §4, with the offsets seeded in migration 005.

const TEMPLATES = [
  ['tpl-welcome', 'new_donor_welcome', 'New donor welcome',
   'The first ninety days after a first gift: thank, show the impact, invite them in.', false],
  ['tpl-recurring', 'recurring_donor_onboarding', 'Recurring donor onboarding',
   'Settle a new standing order: confirm it, welcome them properly, check the payments land.', false],
  ['tpl-lapsed', 'lapsed_reactivation', 'Lapsed reactivation',
   'Reconnect without asking first. Exits the moment a gift arrives.', true],
  ['tpl-major', 'major_gift_stewardship', 'Major-gift stewardship',
   'After a major gift is won: thank, report at three months, visit at six.', false],
  ['tpl-parent', 'new_parent', 'New parent at the yeshiva',
   'A first year of relationship-building with a family new to the yeshiva.', false],
]

const STEPS = [
  ['tpl-welcome', 1, 1, 'Thank-you call for the first gift', 'call', 'Two minutes, no ask. Say what the gift does.', false],
  ['tpl-welcome', 2, 30, 'Send the impact note', 'send_update', 'One specific thing their gift paid for.', false],
  ['tpl-welcome', 3, 90, 'Invite to the next event', 'invite_event', 'First invitation in person or by phone.', false],

  ['tpl-recurring', 1, 2, 'Welcome call — confirm the standing order', 'call', 'Confirm amount, date and fund.', false],
  ['tpl-recurring', 2, 14, 'Send the welcome pack', 'send_update', 'Goes out once you have actually spoken to them.', true],
  ['tpl-recurring', 3, 95, 'Check the first three payments landed', 'other', 'A missed payment ends relationships quietly.', false],
  ['tpl-recurring', 4, 190, 'Six-month thank-you call', 'call', 'Report on the year so far; no ask.', false],

  ['tpl-lapsed', 1, 0, 'Reconnect call — no ask', 'call', 'Ask after them. Do not mention giving.', false],
  ['tpl-lapsed', 2, 21, 'Send a personal note with a recent update', 'send_update', 'Only after the call happened.', true],
  ['tpl-lapsed', 3, 60, 'Invite back — event or a visit', 'invite_event', 'Bring them in before asking.', false],
  ['tpl-lapsed', 4, 120, 'Make the re-engagement ask', 'ask', 'Modest, specific, only if the earlier steps went well.', false],

  ['tpl-major', 1, 1, 'Thank the donor personally', 'thank_you', 'Handwritten or in person. Not a receipt.', false],
  ['tpl-major', 2, 90, 'Send the three-month impact update', 'send_update', 'Numbers and a name.', false],
  ['tpl-major', 3, 180, 'Arrange the six-month visit', 'arrange_meeting', 'Show them the work in person.', true],

  ['tpl-parent', 1, 7, 'Welcome call to the new parent', 'call', 'How is the boy settling in? Nothing else.', false],
  ['tpl-parent', 2, 30, 'Coffee or a visit at the yeshiva', 'arrange_meeting', 'Meet the family in the first month.', false],
  ['tpl-parent', 3, 120, "Invite to the parents' event", 'invite_event', 'The first communal moment of the year.', false],
  ['tpl-parent', 4, 240, 'First conversation about supporting the yeshiva', 'ask', 'Only once the relationship is real.', true],
]

const PEOPLE = [
  { n: 1, first_name: 'Reuven', last_name: 'Adler', city: 'Golders Green', phone: '+447700900123',
    email: 'reuven.adler@example.com', organization: 'Adler Textiles', position: 'Director', tier: 'A' },
  { n: 2, first_name: 'Devorah', last_name: 'Frankel', title: 'Mrs', city: 'Hendon', stage: 'stewardship' },
]

const DB = {
  team_members: [
    {
      id: BRAUN, full_name: "R' Braun", role: 'admin', email: 'admin@demo.test',
      can_see_amounts: true, digest_hour: 7, digest_channel: 'email', is_active: true,
      ics_token: ICS_TOKEN,
    },
    {
      id: '11111111-1111-1111-1111-111111111112', full_name: 'Rivka Klein', role: 'fundraiser',
      email: 'fundraiser@demo.test', can_see_amounts: true, digest_hour: 8, digest_channel: 'email',
      is_active: true, ics_token: '4935a990-321a-40cc-9e82-fca02636350e',
    },
  ],

  contacts: PEOPLE.map(({ n, ...rest }) => ({ ...contactBase, id: id(n), ...rest })),

  contact_stats: [
    { ...statsBase, contact_id: id(1), lifetime_giving: 42500, this_year_giving: 12000,
      last_year_giving: 18000, gift_count: 14, largest_gift: 10000, average_gift: 3035,
      first_gift_on: iso(-1200), last_gift_on: iso(-40), last_gift_amount: 2500,
      days_since_contact: 12, kit_due_on: iso(18), open_task_count: 2, flag: 'future' },
    { ...statsBase, contact_id: id(2), lifetime_giving: 6300, gift_count: 6, days_since_contact: 96,
      donor_status: 'pre_lapsed', flag: 'none' },
  ],

  journey_templates: TEMPLATES.map(([tid, key, name, description, exit_on_gift]) => ({
    id: tid, key, name, description, exit_on_gift, is_active: true, created_at: at(-500),
  })),

  journey_steps: STEPS.map(([template_id, step_no, offset_days, title, action_type, details, depends_on_previous]) => ({
    id: `${template_id}-s${step_no}`,
    template_id, step_no, offset_days, title, action_type, details, depends_on_previous,
    created_at: at(-500),
  })),

  // Mid-flight: started 30 days ago, step 1 done, step 2 open, step 3 to come.
  journey_enrollments: [
    {
      id: 'enr-1',
      contact_id: id(1),
      template_id: 'tpl-welcome',
      started_on: iso(-30),
      status: 'active',
      exited_reason: null,
      ended_at: null,
      assigned_to: BRAUN,
      created_by: BRAUN,
      created_at: at(-30),
    },
  ],

  journey_tasks: [
    { id: 'jt-1', enrollment_id: 'enr-1', step_id: 'tpl-welcome-s1', task_id: 'task-j1', created_at: at(-30) },
    { id: 'jt-2', enrollment_id: 'enr-1', step_id: 'tpl-welcome-s2', task_id: 'task-j2', created_at: at(0) },
  ],

  tasks: [
    {
      id: 'task-j1', contact_id: id(1), opportunity_id: null,
      title: 'Thank-you call for the first gift', action_type: 'call',
      details: 'Two minutes, no ask. Say what the gift does.',
      assigned_to: BRAUN, due_on: iso(-29), priority: 'medium', status: 'done',
      waiting_for: null, queue_order: null, completed_at: at(-29),
      origin: 'journey:new_donor_welcome', created_by: BRAUN, created_at: at(-30),
    },
    {
      id: 'task-j2', contact_id: id(1), opportunity_id: null,
      title: 'Send the impact note', action_type: 'send_update',
      details: 'One specific thing their gift paid for.',
      assigned_to: BRAUN, due_on: iso(0), priority: 'medium', status: 'todo',
      waiting_for: null, queue_order: null, completed_at: null,
      origin: 'journey:new_donor_welcome', created_by: BRAUN, created_at: at(0),
    },
  ],

  lookup_options: [
    ...lookup('stage', ['prospect|Prospect', 'cultivation|Cultivation', 'in_discussion|In discussion', 'active_donor|Active donor', 'stewardship|Stewardship', 'keep_in_touch|Keep in touch']),
    ...lookup('priority', ['high|High', 'medium|Medium', 'low|Low']),
    ...lookup('action_type', ['call|Call', 'send_update|Send update', 'invite_event|Invite to event', 'arrange_meeting|Arrange meeting', 'thank_you|Thank you', 'ask|Ask', 'other|Other']),
    ...lookup('interaction_kind', ['call|Call', 'whatsapp|WhatsApp', 'email|Email', 'meeting|Meeting']),
  ],

  interactions: [
    {
      id: 'int-1', contact_id: id(1), occurred_at: at(1), kind: 'meeting', status: 'scheduled',
      team_member_id: BRAUN, summary: 'Office visit — building campaign proposal',
      outcome: null, is_meaningful: true, location: 'Adler Textiles, Brent Cross',
      attendees: null, purpose: 'Walk through the naming schedule', ask_amount: null,
      source: 'manual', created_by: BRAUN, created_at: at(-2),
    },
  ],

  automation_rules: [
    { rule_key: 'kit_due', is_enabled: true, params: {}, updated_at: at(-30) },
  ],

  funds: [{ id: 'fund-general', name: 'General', code: 'GEN', is_restricted: false, is_active: true }],
  campaigns: [],
  appeals: [],
  tags: [],
  taggings: [],
  households: [],
  donations: [],
  notes: [],
  documents: [],
  pledges: [],
  pledge_installments: [],
  recurring_agreements: [],
  soft_credits: [],
  gift_aid_declarations: [],
  gift_aid_claims: [],
  opportunities: [],
  saved_views: [],
  signals: [],
  duplicates_queue: [],
  import_batches: [],
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
      out = out.filter((r) => asText(r[key]).toLowerCase().includes(needle))
    } else if (op === 'gte') out = out.filter((r) => r[key] != null && asText(r[key]) >= value)
    else if (op === 'gt') out = out.filter((r) => r[key] != null && asText(r[key]) > value)
    else if (op === 'lte') out = out.filter((r) => r[key] != null && asText(r[key]) <= value)
    else if (op === 'lt') out = out.filter((r) => r[key] != null && asText(r[key]) < value)
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
      console.log(`[journeys-fixtures] insert ${table} ×${rows.length}`)
      return send(201, single ? rows[0] : rows)
    }

    if (req.method === 'PATCH') {
      const body = await readBody(req)
      const targets = applyFilters(DB[table], url)
      for (const row of targets) Object.assign(row, body)
      console.log(`[journeys-fixtures] update ${table} ×${targets.length}`)
      return send(200, single ? (targets[0] ?? null) : targets)
    }

    if (req.method === 'DELETE') {
      const targets = new Set(applyFilters(DB[table], url))
      DB[table] = DB[table].filter((row) => !targets.has(row))
      console.log(`[journeys-fixtures] delete ${table} ×${targets.size}`)
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
    `[journeys-fixtures] 127.0.0.1:${PORT} — ${DB.journey_templates.length} templates, ` +
      `${DB.journey_steps.length} steps, 1 live enrolment`,
  )
})
