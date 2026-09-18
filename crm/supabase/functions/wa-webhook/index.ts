/**
 * `wa-webhook` — Meta's WhatsApp Cloud API webhook (spec 10 §2 Tier 2).
 *
 * Two verbs on one URL, because that is what Meta's app configuration expects:
 *
 *   GET   the subscription handshake. Meta calls it once when you press
 *         "Verify and save" with `hub.mode`, `hub.verify_token` and
 *         `hub.challenge`; echoing the challenge back as plain text is what
 *         proves we own the endpoint.
 *   POST  every inbound message and every delivery receipt thereafter.
 *
 * ## Why `verify_jwt = false`
 *
 * Meta's servers cannot present a Supabase JWT — they do not have one and never
 * will. So the gateway's check is off and this function implements its **own**
 * authentication, which is the stronger of the two available:
 *
 *   - GET  is guarded by `WA_VERIFY_TOKEN`, a shared secret we choose and paste
 *          into the Meta app config. Wrong token → 403, no body detail.
 *   - POST is guarded by `X-Hub-Signature-256`: HMAC-SHA256 of the **raw**
 *          request body under `WA_APP_SECRET` (the Meta app secret), compared
 *          in constant time. No signature, a malformed one, or a mismatch →
 *          401, and nothing is read out of the body before that check passes.
 *
 * The raw body matters: `JSON.parse` then `JSON.stringify` reorders keys and
 * drops whitespace, and the digest would never match again. So the body is read
 * once as text, verified, and only then parsed.
 *
 * ## The unconfigured state is a supported state
 *
 * With no `WA_VERIFY_TOKEN` / `WA_APP_SECRET` set this returns **503
 * `wa_unconfigured`** rather than pretending. That is the honest answer for a
 * yeshiva that has not yet finished Meta business verification, and it is what
 * the Settings card probes for. Tier 1 (the wa.me deep link + Quick Capture)
 * keeps working throughout — it is the product's normal state, not a fallback.
 *
 * ## Why the service role, and what stops it over-sharing
 *
 * There is no user JWT to forward, so writes run with the service-role key and
 * bypass RLS. The blast radius is scoped by hand: this function only ever
 * touches `wa_conversations` and `wa_messages`, only ever inserts or advances a
 * delivery status, and reads no donor field beyond the conversation it is
 * writing to. It never reads `contacts` (the BEFORE INSERT trigger in migration
 * 012 does the matching inside the database) and never touches money.
 *
 * ## It never sends anything (I-10)
 *
 * There is no code path here that posts to Meta. An inbound message creates
 * rows and a badge; a human answers it from the Comms pane, or does not.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.58.0'
import { advanceStatus, handshakeDecision, parseWebhook, verifyWebhookSignature, type WaStatus } from './core.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-hub-signature-256',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

const text = (status: number, body: string): Response =>
  new Response(body, {
    status,
    headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })

interface ConversationRow {
  id: string
  unread_count: number | null
  profile_name: string | null
}

const client = () =>
  createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

/* --------------------------------------------------------- the handshake */

function handshake(url: URL): Response {
  // The decision itself is in core.ts, so it is unit-tested rather than only
  // ever exercised by pressing "Verify and save" in Meta's dashboard.
  const decision = handshakeDecision({
    verifyToken: Deno.env.get('WA_VERIFY_TOKEN') ?? '',
    mode: url.searchParams.get('hub.mode'),
    token: url.searchParams.get('hub.verify_token'),
    challenge: url.searchParams.get('hub.challenge'),
  })
  // Unconfigured, and honest about it: Meta's "Verify and save" fails with a
  // 503 an admin can read, rather than a silent 403 they lose an afternoon to.
  if (decision.status === 503) {
    return json(503, { error: 'wa_unconfigured', message: 'WA_VERIFY_TOKEN is not set.' })
  }
  // Plain text, verbatim, nothing else: Meta compares the body byte for byte.
  return text(decision.status, decision.body)
}

/* ------------------------------------------------------------ processing */

/**
 * The conversation for one `wa_id`, created if new. The BEFORE INSERT trigger
 * (012) normalises the number and matches it against `contacts.whatsapp` then
 * `contacts.phone`, so the matching rule lives in exactly one place.
 */
async function conversationFor(
  db: ReturnType<typeof client>,
  waId: string,
  profileName: string | null,
): Promise<ConversationRow | null> {
  const existing = await db
    .from('wa_conversations')
    .select('id, unread_count, profile_name')
    .eq('wa_id', waId)
    .maybeSingle()

  if (existing.data) {
    const row = existing.data as ConversationRow
    // Meta's profile name is the donor's own display name; keep it fresh, but
    // never let it overwrite something with a blank.
    if (profileName && profileName !== row.profile_name) {
      await db.from('wa_conversations').update({ profile_name: profileName }).eq('id', row.id)
    }
    return row
  }

  const created = await db
    .from('wa_conversations')
    .insert({ wa_id: waId, profile_name: profileName })
    .select('id, unread_count, profile_name')
    .maybeSingle()

  if (created.data) return created.data as ConversationRow

  // Lost an insert race with a concurrent delivery of the same message: the
  // unique constraint on wa_id did its job, so read the winner.
  const raced = await db
    .from('wa_conversations')
    .select('id, unread_count, profile_name')
    .eq('wa_id', waId)
    .maybeSingle()
  return (raced.data as ConversationRow | null) ?? null
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const url = new URL(req.url)
  if (req.method === 'GET') return handshake(url)
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const appSecret = Deno.env.get('WA_APP_SECRET') ?? ''
  if (appSecret === '') return json(503, { error: 'wa_unconfigured', message: 'WA_APP_SECRET is not set.' })

  // Read once, as text. Everything below works from `raw`.
  const raw = await req.text()
  const signed = await verifyWebhookSignature(appSecret, raw, req.headers.get('x-hub-signature-256'))
  if (!signed) return json(401, { error: 'bad_signature' })

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    // Signed but unreadable: 200 so Meta stops retrying a body that will never
    // parse, and a log line for us.
    console.warn('[wa-webhook] signed payload was not JSON')
    return json(200, { received: true, processed: 0, ignored: 1 })
  }

  const parsed = parseWebhook(payload, Date.now())
  const db = client()

  let inserted = 0
  let duplicates = 0
  let advanced = 0

  try {
    for (const message of parsed.messages) {
      const conversation = await conversationFor(db, message.wa_id, message.profile_name)
      if (!conversation) {
        console.error('[wa-webhook] no conversation for', message.wa_id)
        continue
      }

      // Idempotent by construction: `wa_message_id` is UNIQUE, so a retried
      // delivery of the same message collides and is ignored. `select()` comes
      // back empty on a collision, which is how we know not to bump the
      // conversation a second time — a double-counted unread badge is exactly
      // the kind of small lie that costs trust.
      const write = await db
        .from('wa_messages')
        .upsert(
          {
            conversation_id: conversation.id,
            direction: 'in',
            wa_message_id: message.wa_message_id,
            msg_type: message.msg_type,
            body: message.body,
            media_id: message.media_id,
            media_mime: message.media_mime,
            status: 'received',
            occurred_at: message.occurred_at,
          },
          { onConflict: 'wa_message_id', ignoreDuplicates: true },
        )
        .select('id')

      const rows = Array.isArray(write.data) ? write.data : []
      if (rows.length === 0) {
        duplicates += 1
        continue
      }
      inserted += 1

      // The compliance fact, and the only place it is written: an inbound
      // message opens (or reopens) the 24-hour customer-service window.
      await db
        .from('wa_conversations')
        .update({
          last_inbound_at: message.occurred_at,
          last_message_at: message.occurred_at,
          unread_count: (conversation.unread_count ?? 0) + 1,
        })
        .eq('id', conversation.id)
      conversation.unread_count = (conversation.unread_count ?? 0) + 1
    }

    for (const receipt of parsed.statuses) {
      const current = await db
        .from('wa_messages')
        .select('id, status')
        .eq('wa_message_id', receipt.wa_message_id)
        .maybeSingle()
      if (!current.data) continue

      const row = current.data as { id: string; status: WaStatus | null }
      const next = advanceStatus(row.status, receipt.status)
      // Receipts arrive out of order; `advanceStatus` keeps the ticks
      // monotonic, so `read` landing before `delivered` cannot walk backwards.
      if (next === row.status && !(receipt.status === 'failed' && receipt.error_detail)) continue

      await db
        .from('wa_messages')
        .update({
          status: next,
          error_detail: receipt.status === 'failed' ? receipt.error_detail : null,
        })
        .eq('id', row.id)
      advanced += 1
    }
  } catch (caught) {
    // A 500 earns an infinite retry from Meta. Log loudly, answer 200, and let
    // the next delivery (or the next message) catch up.
    console.error('[wa-webhook]', caught instanceof Error ? caught.message : String(caught))
    return json(200, { received: true, processed: inserted, error: 'partial' })
  }

  return json(200, {
    received: true,
    processed: inserted,
    duplicates,
    statuses: advanced,
    ignored: parsed.ignored,
  })
})
