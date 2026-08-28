#!/usr/bin/env node
/**
 * Offline fixture server for the Reports screens (M8) — a development harness,
 * never shipped.
 *
 * Speaks the slice of GoTrue + PostgREST that `/reports` and
 * `/reports/campaigns/:id` use: a fake session, and the three report RPCs
 * (`report_overview`, `report_drill`, `report_campaign_detail`). The payloads
 * come from `reports-fixtures.mjs`, which runs the same retention / quintile /
 * redaction algorithms the database runs — so the screenshots show numbers that
 * actually reconcile with one another.
 *
 *   node e2e/reports-fixture-server.mjs --port 5294
 *   VITE_SUPABASE_URL=http://127.0.0.1:5294 VITE_SUPABASE_ANON_KEY=fixture \
 *     npx vite --port 5194 --strictPort
 *   E2E_BASE_URL=http://localhost:5194 E2E_SHOT_SUFFIX=fixtures node e2e/m8-shots.mjs
 *
 * `--role viewer` serves the payload with amounts redacted, which is how the
 * restricted-viewer shot is taken (11 §2).
 */

import { createServer } from 'node:http'
import { buildCampaignDetail, buildDrill, buildLedger, buildOverview } from './reports-fixtures.mjs'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 ? process.argv[index + 1] : fallback
}

const PORT = Number(arg('port', 5294))
const ROLE = arg('role', 'admin')
const AMOUNTS_HIDDEN = ROLE === 'viewer'
const TODAY = new Date()

// One ledger for the life of the process: every RPC answers from the same
// world, so the drill list behind a number really is that number's people.
const LEDGER = buildLedger({ today: TODAY })

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-expose-headers': 'content-range',
}

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: ROLE === 'viewer' ? 'viewer@demo.test' : 'admin@demo.test',
  aud: 'authenticated',
  role: 'authenticated',
}

const SESSION = {
  access_token: 'fixture-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'fixture-refresh',
  user: USER,
}

const TEAM_MEMBER = {
  id: USER.id,
  full_name: ROLE === 'viewer' ? 'Shaindy Katz' : 'Avi Braun',
  email: USER.email,
  role: ROLE === 'viewer' ? 'viewer' : 'admin',
  can_see_amounts: !AMOUNTS_HIDDEN,
  digest_hour: 7,
  digest_channel: 'email',
  is_active: true,
}

/**
 * Tables the shell reads on every page (the nav counts, the session's team
 * member). Empty arrays are the honest answer for a Reports-only harness — the
 * sidebar shows zeros rather than failing.
 */
const TABLES = {
  team_members: [TEAM_MEMBER],
  contacts: [],
  contact_stats: [],
  tasks: [],
  interactions: [],
  donations: [],
  signals: [],
  saved_views: [],
  tags: [],
  taggings: [],
  lookup_options: [],
  automation_rules: [],
  notes: [],
  households: [],
  pledges: [],
  pledge_balances: [],
  recurring_agreements: [],
  campaigns: [],
  appeals: [],
  funds: [],
  gift_aid_declarations: [],
  gift_aid_claims: [],
  opportunities: [],
  documents: [],
  ai_activity_log: [],
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

const RPCS = {
  report_overview: (body) =>
    buildOverview({
      year: body.p_year ?? null,
      today: TODAY,
      amountsHidden: AMOUNTS_HIDDEN,
      ledger: LEDGER,
    }),
  report_drill: (body) =>
    buildDrill({
      key: body.p_key,
      year: body.p_year ?? null,
      arg: body.p_arg ?? null,
      today: TODAY,
      amountsHidden: AMOUNTS_HIDDEN,
      ledger: LEDGER,
    }),
  report_campaign_detail: (body) =>
    buildCampaignDetail(body.p_campaign_id, {
      today: TODAY,
      amountsHidden: AMOUNTS_HIDDEN,
      ledger: LEDGER,
    }),
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const send = (status, body, extra = {}) => {
    res.writeHead(status, { ...CORS, 'content-type': 'application/json', ...extra })
    res.end(body === undefined ? '' : JSON.stringify(body))
  }

  if (req.method === 'OPTIONS') return send(204)

  if (url.pathname.startsWith('/auth/v1/token')) return send(200, SESSION)
  if (url.pathname === '/auth/v1/user') return send(200, USER)
  if (url.pathname === '/auth/v1/logout') return send(204)
  if (url.pathname.startsWith('/auth/v1/')) return send(200, {})

  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    const name = url.pathname.slice('/rest/v1/rpc/'.length)
    const handler = RPCS[name]
    if (!handler) {
      return send(404, { code: 'PGRST202', message: `Could not find the function public.${name}` })
    }
    const body = await readJson(req)
    return send(200, handler(body))
  }

  if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.slice('/rest/v1/'.length)
    const rows = TABLES[table]
    if (!rows) {
      return send(404, { code: 'PGRST205', message: `Could not find the table 'public.${table}'` })
    }
    const single = (req.headers.accept ?? '').includes('vnd.pgrst.object')
    if (single) return send(200, rows[0] ?? null)
    return send(200, rows, { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` })
  }

  send(404, { message: 'not a fixture route' })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `[reports-fixtures] 127.0.0.1:${PORT} — role=${ROLE}` +
      `${AMOUNTS_HIDDEN ? ' (amounts redacted)' : ''}, ${LEDGER.gifts.length} gifts / ${LEDGER.contacts.length} contacts`,
  )
})
