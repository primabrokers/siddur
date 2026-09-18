#!/usr/bin/env node
/**
 * Offline fixture server for C1 (the email inbox) — a **development harness**,
 * never shipped.
 *
 * Speaks enough PostgREST + GoTrue + Edge Functions for `/comms` to render
 * without a database: a signed-in admin, three donors, two email threads (one
 * matched, one not), a sent reply, and the two edge functions answering their
 * *status* shapes so the compose sheet can be photographed in both states.
 *
 *   node e2e/comms-fixture-server.mjs --port 5297
 *   VITE_SUPABASE_URL=http://127.0.0.1:5297 VITE_SUPABASE_ANON_KEY=fixture \
 *     npx vite --port 5197 --strictPort
 *   E2E_BASE_URL=http://localhost:5197 E2E_SHOT_SUFFIX=fixtures node e2e/c1-shots.mjs
 *
 * `--unconfigured` flips the two functions to the state a fresh project is in
 * (no provider keys), which is what the Send-disabled notice is drawn from.
 *
 * Unlike `fixture-server.mjs` this one honours `order` and `limit`, because the
 * inbox list is defined by them: newest conversation first, oldest message
 * first inside a thread.
 */

import { createServer } from 'node:http'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 ? process.argv[index + 1] : fallback
}
const PORT = Number(arg('port', 5297))
const CONFIGURED = !process.argv.includes('--unconfigured')

const BRAUN = '11111111-1111-1111-1111-111111111111'
const DOVID = 'aaaaaaaa-0000-0000-0000-000000000001'
const RIVKY = 'aaaaaaaa-0000-0000-0000-000000000002'
const WEISS = 'aaaaaaaa-0000-0000-0000-000000000003'

const OFFICE = 'office@yeshiva.org'
const DOVID_ADDR = 'dovid.cohen@example.com'
const RIVKY_ADDR = 'rivky.cohen@example.com'
const CATERER = 'accounts@feldbrothers.example'

const now = new Date()
const hoursAgo = (n) => new Date(now.getTime() - n * 3_600_000).toISOString()

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
  priority: 'high',
  tier: null,
  estimated_capacity: null,
  contact_frequency_days: null,
  kit_paused_until: null,
  engagement_score: null,
  engagement_tier: 'hot',
  pinned_note_id: null,
  is_archived: false,
  merged_into_id: null,
  created_at: '2024-01-01T00:00:00Z',
}

const emailBase = {
  body_html: null,
  cc_addrs: [],
  sent_by: null,
  matched_by: null,
  contact_id: null,
  in_reply_to: null,
  read_at: null,
}

const DOVID_THREAD = `subj:the building appeal|${DOVID_ADDR}`
const CATERER_THREAD = `subj:invoice for the dinner catering|${CATERER}`
const RIVKY_THREAD = `subj:shabbos hospitality list|${RIVKY_ADDR}`

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
      hebrew_name: 'דוד הכהן',
      email: DOVID_ADDR,
      organization: 'Cohen & Partner',
    },
    { ...contactBase, id: RIVKY, first_name: 'Rivky', last_name: 'Cohen', email: RIVKY_ADDR, stage: 'stewardship' },
    { ...contactBase, id: WEISS, first_name: 'Yaakov', last_name: 'Weiss', title: "R'", email: 'weiss@example.com' },
  ],

  emails: [
    /* Thread 1 — matched to Dovid Cohen, three messages across two folders. */
    {
      ...emailBase,
      id: 'em-1',
      folder: 'inbox',
      direction: 'in',
      from_addr: `Dovid Cohen <${DOVID_ADDR}>`,
      to_addrs: [OFFICE],
      subject: 'The building appeal',
      body_text:
        'Thank you for sending the brochure. The naming opportunities look well thought through — I would like to talk properly after Sukkos, once the accounts for the year are closed.',
      snippet:
        'Thank you for sending the brochure. The naming opportunities look well thought through — I would like to talk properly after Sukkos, once the accounts for the year are closed.',
      provider_message_id: 'prov-1',
      rfc_message_id: '<msg-1@example.com>',
      thread_key: DOVID_THREAD,
      contact_id: DOVID,
      matched_by: 'from_addr',
      read_at: hoursAgo(70),
      occurred_at: hoursAgo(72),
      created_at: hoursAgo(72),
    },
    {
      ...emailBase,
      id: 'em-2',
      folder: 'sent',
      direction: 'out',
      from_addr: OFFICE,
      to_addrs: [DOVID_ADDR],
      subject: 'Re: The building appeal',
      body_text:
        'Thank you — after Sukkos suits us well. I will call you the week after and we can go through the two options you marked.',
      snippet:
        'Thank you — after Sukkos suits us well. I will call you the week after and we can go through the two options you marked.',
      provider_message_id: 'prov-2',
      rfc_message_id: '<msg-2@yeshiva.org>',
      in_reply_to: '<msg-1@example.com>',
      thread_key: DOVID_THREAD,
      contact_id: DOVID,
      matched_by: 'to_addr',
      read_at: hoursAgo(48),
      sent_by: BRAUN,
      occurred_at: hoursAgo(48),
      created_at: hoursAgo(48),
    },
    {
      ...emailBase,
      id: 'em-3',
      folder: 'inbox',
      direction: 'in',
      from_addr: `Dovid Cohen <${DOVID_ADDR}>`,
      to_addrs: [OFFICE],
      subject: 'Re: The building appeal',
      body_text:
        'That works. One more thing — my brother-in-law asked whether the same naming scheme applies to the beis medrash floor. Could you send whatever you have on that?',
      snippet:
        'That works. One more thing — my brother-in-law asked whether the same naming scheme applies to the beis medrash floor.',
      provider_message_id: 'prov-3',
      rfc_message_id: '<msg-3@example.com>',
      in_reply_to: '<msg-2@yeshiva.org>',
      thread_key: DOVID_THREAD,
      contact_id: DOVID,
      matched_by: 'from_addr',
      occurred_at: hoursAgo(5),
      created_at: hoursAgo(5),
    },

    /* Thread 2 — nobody on file: the "Not linked" state. */
    {
      ...emailBase,
      id: 'em-4',
      folder: 'inbox',
      direction: 'in',
      from_addr: `Feld Brothers Accounts <${CATERER}>`,
      to_addrs: [OFFICE],
      cc_addrs: ['dinner@yeshiva.org'],
      subject: 'Invoice for the dinner catering',
      body_text:
        'Please find our invoice for the dinner on the 14th. Payment terms are 30 days. Let us know if you need it split across two cost centres.',
      snippet:
        'Please find our invoice for the dinner on the 14th. Payment terms are 30 days.',
      provider_message_id: 'prov-4',
      rfc_message_id: '<msg-4@feld.example>',
      thread_key: CATERER_THREAD,
      occurred_at: hoursAgo(20),
      created_at: hoursAgo(20),
    },

    /* Thread 3 — matched, already read, so the list shows both weights. */
    {
      ...emailBase,
      id: 'em-5',
      folder: 'inbox',
      direction: 'in',
      from_addr: `Rivky Cohen <${RIVKY_ADDR}>`,
      to_addrs: [OFFICE],
      subject: 'Shabbos hospitality list',
      body_text: 'We can take four bochurim this Shabbos, and two the week after. Rivky',
      snippet: 'We can take four bochurim this Shabbos, and two the week after. Rivky',
      provider_message_id: 'prov-5',
      rfc_message_id: '<msg-5@example.com>',
      thread_key: RIVKY_THREAD,
      contact_id: RIVKY,
      matched_by: 'from_addr',
      read_at: hoursAgo(30),
      occurred_at: hoursAgo(32),
      created_at: hoursAgo(32),
    },

    /* Archive and Trash are not empty, so those folders photograph honestly. */
    {
      ...emailBase,
      id: 'em-6',
      folder: 'archive',
      direction: 'in',
      from_addr: `Yaakov Weiss <weiss@example.com>`,
      to_addrs: [OFFICE],
      subject: 'Shiur times for the winter zman',
      body_text: 'Attached are the winter zman times. No reply needed.',
      snippet: 'Attached are the winter zman times. No reply needed.',
      provider_message_id: 'prov-6',
      rfc_message_id: '<msg-6@example.com>',
      thread_key: `subj:shiur times for the winter zman|weiss@example.com`,
      contact_id: WEISS,
      matched_by: 'from_addr',
      read_at: hoursAgo(100),
      occurred_at: hoursAgo(101),
      created_at: hoursAgo(101),
    },
    {
      ...emailBase,
      id: 'em-7',
      folder: 'trash',
      direction: 'in',
      from_addr: 'newsletter@charitysupplies.example',
      to_addrs: [OFFICE],
      subject: 'Your Q4 fundraising toolkit is here',
      body_text: 'Ten tips for year-end giving…',
      snippet: 'Ten tips for year-end giving…',
      provider_message_id: 'prov-7',
      rfc_message_id: '<msg-7@supplies.example>',
      thread_key: 'subj:your q4 fundraising toolkit is here|newsletter@charitysupplies.example',
      read_at: hoursAgo(90),
      occurred_at: hoursAgo(92),
      created_at: hoursAgo(92),
    },
  ],

  email_attachments: [
    {
      id: 'att-1',
      email_id: 'em-4',
      filename: 'dinner-invoice-4417.pdf',
      content_type: 'application/pdf',
      size_bytes: 184_320,
      storage_path: 'em-4/0-dinner-invoice-4417.pdf',
      external_url: null,
      created_at: hoursAgo(20),
    },
  ],

  // Enough of the rest of the schema that the shell renders without 404 noise,
  // including the tables the registered WhatsApp channel reads for its rail
  // badge — the shell renders that pane through slots.ts and must not 404 when
  // the other channel has nothing to show.
  wa_conversations: [],
  wa_messages: [],
  wa_templates: [],
  interactions: [],
  contact_stats: [],
  tasks: [],
  signals: [],
  saved_views: [],
  lookup_options: [],
  automation_rules: [],
  tags: [],
  taggings: [],
  notes: [],
  documents: [],
  donations: [],
  pledges: [],
  households: [],
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

function likeRe(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

function parseOrTerm(term) {
  const [column, op, ...rest] = term.split('.')
  const value = rest.join('.')
  if (!column || !op) return () => false
  if (op === 'eq') return (row) => String(row[column] ?? '') === value
  if (op === 'ilike') {
    const re = likeRe(value)
    return (row) => row[column] != null && re.test(String(row[column]))
  }
  if (op === 'is') return (row) => (value === 'null' ? row[column] == null : row[column] != null)
  return () => false
}

/** eq / neq / in / is / gt(e) / lt(e) / ilike, plus `or=(…)`. */
function applyFilters(rows, url) {
  let out = rows
  for (const [key, raw] of url.searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset', 'or'].includes(key)) continue
    const [op, ...rest] = raw.split('.')
    const value = rest.join('.')
    const cmp = (row) => String(row[key] ?? '')
    if (op === 'eq') out = out.filter((r) => String(r[key]) === value)
    else if (op === 'neq') out = out.filter((r) => String(r[key]) !== value)
    else if (op === 'in') {
      const list = value.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, ''))
      out = out.filter((r) => list.includes(String(r[key])))
    } else if (op === 'is') out = out.filter((r) => (value === 'null' ? r[key] == null : r[key] != null))
    else if (op === 'not') {
      // `not.is.null` — the only negation the app sends.
      const [innerOp, innerValue] = rest
      if (innerOp === 'is' && innerValue === 'null') out = out.filter((r) => r[key] != null)
    } else if (op === 'gte') out = out.filter((r) => r[key] != null && cmp(r) >= value)
    else if (op === 'gt') out = out.filter((r) => r[key] != null && cmp(r) > value)
    else if (op === 'lte') out = out.filter((r) => r[key] != null && cmp(r) <= value)
    else if (op === 'lt') out = out.filter((r) => r[key] != null && cmp(r) < value)
    else if (op === 'ilike') out = out.filter((r) => r[key] != null && likeRe(value).test(String(r[key])))
  }

  const orClause = url.searchParams.get('or')
  if (orClause) {
    const terms = orClause.replace(/^\(|\)$/g, '').split(',').map(parseOrTerm)
    out = out.filter((row) => terms.some((term) => term(row)))
  }
  return out
}

/**
 * `order` and `limit` are honoured here, unlike the M1 fixture server: the
 * inbox *is* an ordering (newest thread first, oldest message first), so a
 * stand-in that ignored them would photograph a screen the app never shows.
 */
function applyOrder(rows, url) {
  const order = url.searchParams.get('order')
  let out = rows
  if (order) {
    for (const clause of order.split(',').reverse()) {
      const [column, ...flags] = clause.split('.')
      const ascending = !flags.includes('desc')
      out = [...out].sort((a, b) => {
        const left = a[column] ?? ''
        const right = b[column] ?? ''
        if (left === right) return 0
        return (left < right ? -1 : 1) * (ascending ? 1 : -1)
      })
    }
  }
  const limit = Number(url.searchParams.get('limit') ?? 0)
  return limit > 0 ? out.slice(0, limit) : out
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

  /* ---------------------------------------------------- the edge functions */

  if (url.pathname === '/functions/v1/email-send') {
    const body = (await readJson(req)) ?? {}
    if (body.status === true) {
      return send(200, {
        configured: CONFIGURED,
        from: CONFIGURED ? OFFICE : null,
        has_api_key: CONFIGURED,
        has_from: CONFIGURED,
      })
    }
    if (!CONFIGURED) return send(503, { error: 'email_unconfigured' })

    // A send in the harness files the Sent row, so the shot after it is honest.
    const id = `fixture-sent-${++inserted}`
    const occurredAt = new Date().toISOString()
    DB.emails.push({
      ...emailBase,
      id,
      folder: 'sent',
      direction: 'out',
      from_addr: OFFICE,
      to_addrs: body.to ?? [],
      cc_addrs: body.cc ?? [],
      subject: body.subject ?? null,
      body_text: body.body_text ?? '',
      snippet: String(body.body_text ?? '').slice(0, 200),
      provider_message_id: id,
      rfc_message_id: `<${id}@yeshiva.org>`,
      thread_key: DOVID_THREAD,
      contact_id: DOVID,
      matched_by: 'to_addr',
      read_at: occurredAt,
      sent_by: BRAUN,
      occurred_at: occurredAt,
      created_at: occurredAt,
    })
    return send(200, { sent: true, recorded: true, id, thread_key: DOVID_THREAD, contact_id: DOVID })
  }

  if (url.pathname === '/functions/v1/email-inbound') {
    // Exactly the live contract: 503 with no secret configured, 404 to a caller
    // that has not got the one that is.
    return CONFIGURED ? send(404, { error: 'not_found' }) : send(503, { error: 'email_unconfigured' })
  }

  if (url.pathname.startsWith('/functions/v1/')) return send(503, { error: 'not_configured' })

  /* ------------------------------------------------------------- PostgREST */

  if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.slice('/rest/v1/'.length)
    const rows = DB[table]
    if (!rows) {
      return send(404, { code: 'PGRST205', message: `Could not find the table 'public.${table}'` })
    }
    const single = (req.headers.accept ?? '').includes('vnd.pgrst.object')

    if (req.method === 'POST') {
      const body = await readJson(req)
      const list = Array.isArray(body) ? body : [body ?? {}]
      const created = list.map((row) => ({
        id: `fixture-${++inserted}`,
        created_at: new Date().toISOString(),
        ...row,
      }))
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

    const filtered = applyOrder(applyFilters(rows, url), url)
    if (single) return send(200, filtered[0] ?? null)
    return send(200, filtered, {
      'content-range': `0-${Math.max(filtered.length - 1, 0)}/${filtered.length}`,
    })
  }

  send(404, { message: 'not a fixture route' })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `[comms-fixtures] 127.0.0.1:${PORT} — offline PostgREST/GoTrue/functions stand-in (email ${
      CONFIGURED ? 'configured' : 'UNCONFIGURED'
    })`,
  )
})
