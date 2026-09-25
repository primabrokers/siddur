#!/usr/bin/env node
/**
 * WhatsApp fixture server — a **development harness**, never shipped.
 *
 * Same idea as `e2e/fixture-server.mjs` (a PostgREST/GoTrue stand-in over plain
 * arrays), carrying only what the C2 pane reads: `wa_conversations`,
 * `wa_messages` and `wa_templates` from migration 012, the contacts they match
 * to, and stubs for the two edge functions so the Settings card's probes and
 * the composer's send path have something honest to talk to.
 *
 * Kept as its own file rather than as edits to `fixture-server.mjs` so the
 * milestones being built in parallel do not collide.
 *
 *   node e2e/wa-fixture-server.mjs --port 5298
 *   VITE_SUPABASE_URL=http://127.0.0.1:5298 VITE_SUPABASE_ANON_KEY=fixture \
 *     npx vite --port 5198 --strictPort --host
 *   E2E_BASE_URL=http://localhost:5198 E2E_SHOT_SUFFIX=fixtures node e2e/c2-shots.mjs
 *
 * The dataset is deliberately built around the one rule that matters: three
 * conversations, one **inside** the 24-hour customer-service window (free text
 * allowed), one **outside** it (approved template only), and one from a number
 * that matched no donor at all.
 *
 * `--unconfigured` (the default) makes the two function stubs answer 503
 * `wa_unconfigured`, which is the real project's state until the Meta secrets
 * are set. `--configured` flips them, for shooting the connected Settings card.
 */

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 ? process.argv[index + 1] : fallback
}
const PORT = Number(arg('port', 5298))
const CONFIGURED = process.argv.includes('--configured')

const BRAUN = '11111111-1111-1111-1111-111111111111'
const HOUR = 60 * 60 * 1000
const now = Date.now()
const at = (msAgo) => new Date(now - msAgo).toISOString()

/* ------------------------------------------------------------- contacts */

const contactBase = {
  title: 'Mr',
  hebrew_name: null,
  organization: null,
  position: null,
  industry: null,
  contact_kind: 'individual',
  is_organisation_self: false,
  photo_url: null,
  household_id: null,
  email: null,
  preferred_language: 'en',
  preferred_channel: 'whatsapp',
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
  updated_at: at(24 * HOUR),
}

const CONTACTS = [
  {
    ...contactBase,
    id: 'c-cohen',
    first_name: 'Dovid',
    last_name: 'Cohen',
    phone: '+447700900123',
    whatsapp: '+447700900123',
    email: 'dovid.cohen@example.com',
  },
  {
    ...contactBase,
    id: 'c-klein',
    title: "R'",
    first_name: 'Yehuda',
    last_name: 'Klein',
    phone: '+447700900456',
    whatsapp: null,
    city: 'Hendon',
    email: 'y.klein@example.com',
  },
]

/* -------------------------------------------------------- conversations */

const CONVERSATIONS = [
  {
    id: 'wac-open',
    wa_id: '+447700900123',
    profile_name: 'Dovid',
    contact_id: 'c-cohen',
    matched_by: 'whatsapp',
    // 2 hours ago: the window is wide open and the composer takes free text.
    last_inbound_at: at(2 * HOUR),
    last_message_at: at(1.5 * HOUR),
    unread_count: 2,
    created_at: at(30 * 24 * HOUR),
    updated_at: at(1.5 * HOUR),
  },
  {
    id: 'wac-closed',
    wa_id: '+447700900456',
    profile_name: 'Yehuda K',
    contact_id: 'c-klein',
    // Matched on the phone field: this donor's WhatsApp column is empty.
    matched_by: 'phone',
    // 40 hours ago: closed. Approved templates only.
    last_inbound_at: at(40 * HOUR),
    last_message_at: at(39 * HOUR),
    unread_count: 0,
    created_at: at(90 * 24 * HOUR),
    updated_at: at(39 * HOUR),
  },
  {
    id: 'wac-unmatched',
    wa_id: '+447700900999',
    profile_name: 'Shimon',
    contact_id: null,
    matched_by: null,
    last_inbound_at: at(5 * HOUR),
    last_message_at: at(5 * HOUR),
    unread_count: 1,
    created_at: at(5 * HOUR),
    updated_at: at(5 * HOUR),
  },
]

const message = (over) => ({
  id: randomUUID(),
  wa_message_id: `wamid.${randomUUID().slice(0, 8)}`,
  msg_type: 'text',
  body: null,
  media_id: null,
  media_mime: null,
  media_url: null,
  template_name: null,
  status: 'received',
  error_detail: null,
  sent_by: null,
  created_at: at(0),
  ...over,
})

const MESSAGES = [
  // The open thread — two days of back and forth, ending with the donor.
  message({
    conversation_id: 'wac-open',
    direction: 'out',
    body: 'Good morning R’ Dovid — are you around this week? I wanted to show you the new beis medrash plans.',
    status: 'read',
    sent_by: BRAUN,
    occurred_at: at(28 * HOUR),
  }),
  message({
    conversation_id: 'wac-open',
    direction: 'in',
    body: 'Thursday works. What time?',
    occurred_at: at(27 * HOUR),
  }),
  message({
    conversation_id: 'wac-open',
    direction: 'out',
    body: '11am at the yeshiva? I’ll have the drawings out.',
    status: 'delivered',
    sent_by: BRAUN,
    occurred_at: at(26 * HOUR),
  }),
  message({
    conversation_id: 'wac-open',
    direction: 'in',
    msg_type: 'media',
    body: 'Here’s the plot plan my architect drew up',
    media_id: '1521321321',
    media_mime: 'image/jpeg',
    occurred_at: at(2.4 * HOUR),
  }),
  message({
    conversation_id: 'wac-open',
    direction: 'in',
    body: 'And I’ll transfer the £5,000 for the sefer Torah on Sunday bez"H',
    occurred_at: at(2 * HOUR),
  }),
  message({
    conversation_id: 'wac-open',
    direction: 'out',
    body: 'Thank you — that means a great deal. See you Thursday.',
    status: 'read',
    sent_by: BRAUN,
    occurred_at: at(1.5 * HOUR),
  }),

  // The closed thread — the last word was ours, 39 hours ago.
  message({
    conversation_id: 'wac-closed',
    direction: 'in',
    body: 'Can you send me the dinner details again?',
    occurred_at: at(40 * HOUR),
  }),
  message({
    conversation_id: 'wac-closed',
    direction: 'out',
    msg_type: 'template',
    template_name: 'dinner_invite_2026',
    body: null,
    status: 'read',
    sent_by: BRAUN,
    occurred_at: at(39.5 * HOUR),
  }),
  message({
    conversation_id: 'wac-closed',
    direction: 'out',
    body: '18 November, 8pm, at the hall on Bell Lane. You’re on table 3 with the Rosh Yeshiva.',
    status: 'delivered',
    sent_by: BRAUN,
    occurred_at: at(39 * HOUR),
  }),

  // The unmatched thread.
  message({
    conversation_id: 'wac-unmatched',
    direction: 'in',
    body: 'Shalom — I was at the dinner last year and wanted to set up a standing order. Who do I speak to?',
    occurred_at: at(5 * HOUR),
  }),
]

const TEMPLATES = [
  {
    id: 'wat-1',
    name: 'dinner_invite_2026',
    language: 'en_GB',
    category: 'MARKETING',
    body: 'Dear {{1}}, the yeshiva’s annual dinner is on {{2}}. We would be honoured if you could join us.',
    status: 'APPROVED',
    synced_at: at(48 * HOUR),
  },
  {
    id: 'wat-2',
    name: 'receipt_ready',
    language: 'en_GB',
    category: 'UTILITY',
    body: 'Dear {{1}}, your receipt for {{2}} is ready. Reply here and we will send it across.',
    status: 'APPROVED',
    synced_at: at(48 * HOUR),
  },
  {
    id: 'wat-3',
    name: 'yahrzeit_reminder',
    language: 'en_GB',
    category: 'UTILITY',
    body: 'The yahrzeit of {{1}} falls this week. The bochurim will be learning l’ilui nishmaso.',
    status: 'PENDING',
    synced_at: at(48 * HOUR),
  },
]

const DB = {
  contacts: CONTACTS,
  wa_conversations: CONVERSATIONS,
  wa_messages: MESSAGES,
  wa_templates: TEMPLATES,
  team_members: [
    {
      id: BRAUN,
      full_name: 'R’ Yisroel Braun',
      email: 'admin@demo.test',
      role: 'admin',
      is_active: true,
      can_see_amounts: true,
    },
  ],
  interactions: [],
  contact_stats: [],
  automation_rules: [],
  saved_views: [],
  tasks: [],
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

  /* ------------------------------------------------- the two edge functions */

  // The webhook, exactly as the deployed one behaves with its secrets unset:
  // 503 on the GET handshake, 503 on an unsigned POST. `--configured` gives the
  // 403 / 401 an endpoint with secrets answers instead.
  if (url.pathname === '/functions/v1/wa-webhook') {
    if (!CONFIGURED) {
      return send(503, { error: 'wa_unconfigured', message: 'WA_VERIFY_TOKEN is not set.' })
    }
    if (req.method === 'GET') {
      res.writeHead(403, { ...CORS, 'content-type': 'text/plain' })
      return res.end('Forbidden')
    }
    return send(401, { error: 'bad_signature' })
  }

  if (url.pathname === '/functions/v1/wa-send') {
    const body = (await readBody(req)) ?? {}
    if (!CONFIGURED) {
      return send(503, {
        error: 'wa_unconfigured',
        message: 'WhatsApp Business is not connected. Set WA_ACCESS_TOKEN and WA_PHONE_NUMBER_ID.',
      })
    }
    if (body.action === 'status') {
      return send(200, { configured: true, phone_number_id_present: true, templates_syncable: true })
    }
    if (body.action === 'sync_templates') return send(200, { synced: TEMPLATES.length })

    // The rule, mirrored: free-form only inside the window. The pane should
    // never reach this branch, and that is exactly what makes it worth having.
    const conversation = DB.wa_conversations.find((row) => row.id === body.conversation_id) ?? null
    const free = typeof body.body === 'string' && body.body.trim() !== ''
    if (free) {
      const lastInbound = conversation?.last_inbound_at ? Date.parse(conversation.last_inbound_at) : null
      if (lastInbound === null || Date.now() - lastInbound >= 24 * HOUR) {
        console.log('[wa-fixtures] refused free-form outside the window')
        return send(409, {
          error: 'window_closed',
          message: 'The 24-hour customer-service window has closed. Send an approved template instead.',
        })
      }
    }

    const occurredAt = new Date().toISOString()
    const row = message({
      conversation_id: conversation?.id ?? 'wac-open',
      direction: 'out',
      msg_type: free ? 'text' : 'template',
      body: free ? body.body : null,
      template_name: free ? null : (body.template_name ?? null),
      status: 'sent',
      sent_by: BRAUN,
      occurred_at: occurredAt,
    })
    DB.wa_messages.push(row)
    if (conversation) conversation.last_message_at = occurredAt
    console.log(`[wa-fixtures] sent ${free ? 'free-form' : `template ${body.template_name}`}`)
    return send(200, { sent: true, filed: true, conversation_id: row.conversation_id, wa_message_id: row.wa_message_id })
  }

  if (url.pathname.startsWith('/functions/v1/')) return send(503, { error: 'ai_unconfigured' })

  /* --------------------------------------------------------------- PostgREST */

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
      console.log(`[wa-fixtures] insert ${table} ×${rows.length}`)
      return send(201, single ? rows[0] : rows)
    }

    if (req.method === 'PATCH') {
      const body = await readBody(req)
      const targets = applyFilters(DB[table], url)
      for (const row of targets) Object.assign(row, body)
      console.log(`[wa-fixtures] update ${table} ×${targets.length}`)
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
    `[wa-fixtures] 127.0.0.1:${PORT} — ${CONVERSATIONS.length} conversations ` +
      `(1 inside the 24h window, 1 outside, 1 unmatched), ${MESSAGES.length} messages, ` +
      `${TEMPLATES.filter((t) => t.status === 'APPROVED').length} approved templates; ` +
      `functions answer ${CONFIGURED ? '403/401/200 (configured)' : '503 wa_unconfigured'}`,
  )
})
