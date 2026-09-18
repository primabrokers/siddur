#!/usr/bin/env node
/**
 * Quick Capture fixture server — a **development harness**, never shipped.
 *
 * Same idea as `e2e/fixture-server.mjs` (a PostgREST/GoTrue stand-in), plus the
 * one thing capture needs that the other harness has no reason to carry: a
 * `/functions/v1/ai-quick-capture` route that answers with a canned 09 §2
 * extraction. That lets the three panes be photographed in a real browser
 * without an Anthropic key and without touching the live project.
 *
 * Kept as its own file rather than as edits to `fixture-server.mjs` so the
 * milestones being built in parallel do not collide.
 *
 *   node e2e/capture-fixture-server.mjs --port 5435
 *   VITE_SUPABASE_URL=http://127.0.0.1:5435 VITE_SUPABASE_ANON_KEY=fixture npm run dev
 *   node e2e/m3-capture-shots.mjs
 *
 * `--mode unconfigured` makes the function answer 503 `ai_unconfigured`, which
 * is how the manual-fallback pane is photographed.
 */

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 ? process.argv[index + 1] : fallback
}
const PORT = Number(arg('port', 5435))
const MODE = arg('mode', 'ok')

const BRAUN = '11111111-1111-1111-1111-111111111111'
const DOVID = 'aaaaaaaa-0000-0000-0000-000000000001'

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
  updated_at: new Date().toISOString(),
}

const lookup = (list, pairs) =>
  pairs.map((pair, i) => {
    const [value, label] = pair.split('|')
    return { list_name: list, value, label, sort_order: i, color: null, meta: {}, is_active: true }
  })

const DB = {
  team_members: [{ id: BRAUN, full_name: "R' Braun", role: 'admin', email: 'admin@demo.test' }],
  contacts: [
    {
      ...contactBase,
      id: DOVID,
      first_name: 'Dovid',
      last_name: 'Cohen',
      city: 'Golders Green',
      tier: 'A',
      organization: 'Cohen & Partner',
      phone: '+447700900123',
    },
    { ...contactBase, id: 'aaaaaaaa-0000-0000-0000-000000000002', first_name: 'Rivky', last_name: 'Cohen', city: 'Golders Green' },
    { ...contactBase, id: 'aaaaaaaa-0000-0000-0000-000000000003', first_name: 'Yaakov', last_name: 'Weiss', title: "R'", city: 'Hendon' },
    { ...contactBase, id: 'aaaaaaaa-0000-0000-0000-000000000005', first_name: 'Chaim', last_name: 'Lax', city: 'Manchester' },
  ],
  lookup_options: [
    ...lookup('interaction_kind', ['call|Call', 'whatsapp|WhatsApp', 'email|Email', 'meeting|Meeting', 'event|Event', 'letter|Letter']),
    ...lookup('action_type', ['call|Call', 'whatsapp|WhatsApp', 'send_email|Send email', 'arrange_meeting|Arrange meeting', 'thank_you|Thank you', 'keep_in_touch|Keep in touch']),
    ...lookup('stage', ['prospect|Prospect', 'cultivation|Cultivation', 'in_discussion|In discussion', 'active_donor|Active donor', 'stewardship|Stewardship', 'keep_in_touch|Keep in touch']),
    ...lookup('priority', ['high|High', 'medium|Medium', 'low|Low']),
  ],
  tags: [{ id: 'tag-1', name: 'Education', category: 'cause', color: null }],
  taggings: [],
  interactions: [],
  tasks: [],
  ai_activity_log: [],
  contact_stats: [],
  funds: [],
  campaigns: [],
  appeals: [],
  saved_views: [],
  nudges: [],
}

/** The 09 §2 extraction for the wireframe's dictation. */
const EXTRACTION = {
  contact_query: 'dovid cohen',
  confidence: 0.93,
  interaction: {
    kind: 'meeting',
    occurred_at: null,
    location: 'London',
    summary: 'Met in London. Very warm. Strong interest in the building project; discussed £20,000.',
    outcome: 'Wants to see the naming opportunities',
    ask_amount: 20000,
    is_scheduled: false,
  },
  next_action: {
    type: 'call',
    title: 'Call re building project / £20k',
    date_expression: 'after sukkos',
    resolved_due_on: null,
  },
  suggested_updates: [{ kind: 'add_tag', value: 'Building project' }],
  unparsed_remainder: null,
  model: 'claude-opus-5',
  latency_ms: 1420,
  usage: { input_tokens: 1490, output_tokens: 280 },
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

function applyFilters(rows, url) {
  let out = rows
  for (const [key, raw] of url.searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue
    const [op, ...rest] = raw.split('.')
    const value = rest.join('.')
    if (op === 'eq') out = out.filter((r) => String(r[key]) === value)
    else if (op === 'in') {
      const list = value.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, ''))
      out = out.filter((r) => list.includes(String(r[key])))
    } else if (op === 'is') out = out.filter((r) => (value === 'null' ? r[key] == null : r[key] != null))
    else if (op === 'ilike') {
      const needle = value.replace(/[%*]/g, '').toLowerCase()
      out = out.filter((r) => String(r[key] ?? '').toLowerCase() === needle)
    }
  }
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

  // The edge function stand-in — the only thing this harness adds.
  if (url.pathname === '/functions/v1/ai-quick-capture') {
    const body = await readBody(req)
    console.log('[capture-fixtures] parse:', JSON.stringify(body?.text ?? '').slice(0, 90))
    if (MODE === 'unconfigured') return send(503, { error: 'ai_unconfigured' })
    if (MODE === 'slow') await new Promise((r) => setTimeout(r, 2500))
    return send(200, EXTRACTION)
  }

  if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.slice('/rest/v1/'.length)
    if (!DB[table]) DB[table] = []
    const single = (req.headers.accept ?? '').includes('vnd.pgrst.object')

    if (req.method === 'POST') {
      const body = await readBody(req)
      const rows = (Array.isArray(body) ? body : [body]).map((row) => ({ id: randomUUID(), ...row }))
      DB[table].push(...rows)
      console.log(`[capture-fixtures] insert ${table}:`, JSON.stringify(rows[0]).slice(0, 140))
      return send(201, single ? rows[0] : rows)
    }

    const filtered = applyFilters(DB[table], url)
    if (single) return send(200, filtered[0] ?? null)
    return send(200, filtered, { 'content-range': `0-${Math.max(filtered.length - 1, 0)}/${filtered.length}` })
  }

  send(404, { message: 'not a fixture route' })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[capture-fixtures] 127.0.0.1:${PORT} — mode=${MODE}`)
})
