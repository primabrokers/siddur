/**
 * `email-inbound` — the provider webhook that files a received message into the
 * Inbox (10 §3, the full-inbox upgrade).
 *
 * **Deployment: `verify_jwt = false`.** A mail provider cannot hold a Supabase
 * session, so this function authenticates itself:
 *
 *   · `EMAIL_INBOUND_SECRET` unset → **503 `email_unconfigured`**. Not an
 *     outage: the inbox simply has no inbound half yet, and the Settings card
 *     probes exactly this path to say so.
 *   · secret set, request's `?secret=` missing or wrong → **404**, compared in
 *     constant time. 404 rather than 401/403 on purpose: an unauthenticated
 *     caller learns nothing about whether this URL exists.
 *   · secret set and matching → parse and file.
 *
 * **Never lose a message.** Every failure after authentication answers 200 and
 * logs, because a provider that receives a 5xx will retry the same message for
 * hours. Malformed body, no sender, a storage hiccup: all 200, all logged. The
 * one thing that is genuinely idempotent — the same `provider_message_id`
 * arriving twice — is answered from the existing row.
 *
 * **Service role here, and only here.** There is no caller to inherit rights
 * from, and the row this writes is a *received email*, not a CRM record. The
 * moment a human turns it into one ("Log to timeline") that write goes through
 * their own token, under RLS, like everything else.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.58.0'
import { MAX_ATTACHMENT_BYTES, parseInboundPayload, type InboundAttachment } from './core.ts'

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })

const BUCKET = 'email-attachments'

/**
 * Constant-time string comparison. The length is compared first and the loop
 * always runs over the expected secret, so a wrong guess costs the same
 * whatever prefix it shares.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = new TextEncoder().encode(provided)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < b.length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return diff === 0
}

/** Base64 (possibly line-wrapped) → bytes. Returns null on anything invalid. */
function decodeBase64(content: string): Uint8Array | null {
  try {
    const clean = content.replace(/\s+/g, '')
    const binary = atob(clean)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/** A filename safe to use as a storage key, and never empty. */
function safeName(filename: string): string {
  const cleaned = filename
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120)
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? 'attachment' : cleaned
}

interface AttachmentRow {
  email_id: string
  filename: string
  content_type: string
  size_bytes: number
  storage_path: string | null
  external_url: string | null
}

/**
 * Put one attachment where it belongs.
 *
 * Over 10MB it is recorded by name and nothing is stored — the reading pane
 * says "too large to store" and names it, which is honest and costs nothing.
 * An attachment the provider hosts itself is recorded as a URL.
 */
async function fileAttachment(
  storage: { upload: (path: string, body: Uint8Array, options: Record<string, unknown>) => Promise<{ error: unknown }> },
  emailId: string,
  index: number,
  attachment: InboundAttachment,
): Promise<AttachmentRow> {
  const row: AttachmentRow = {
    email_id: emailId,
    filename: attachment.filename,
    content_type: attachment.content_type,
    size_bytes: attachment.size_bytes,
    storage_path: null,
    external_url: attachment.url ?? null,
  }

  if (!attachment.content || attachment.size_bytes > MAX_ATTACHMENT_BYTES) return row

  const bytes = decodeBase64(attachment.content)
  if (!bytes || bytes.byteLength > MAX_ATTACHMENT_BYTES) return row

  const path = `${emailId}/${index}-${safeName(attachment.filename)}`
  const { error } = await storage.upload(path, bytes, {
    contentType: attachment.content_type,
    upsert: true,
  })
  // A storage failure must not lose the email: the row still records the name.
  if (error) {
    console.error('[email-inbound] attachment upload failed', attachment.filename, error)
    return row
  }

  row.storage_path = path
  row.size_bytes = bytes.byteLength
  return row
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  // 1. Configured?
  const expected = Deno.env.get('EMAIL_INBOUND_SECRET') ?? ''
  if (expected === '') return json(503, { error: 'email_unconfigured' })

  // 2. Authenticated? (404 on a miss — this URL does not exist to strangers.)
  const url = new URL(req.url)
  const provided = url.searchParams.get('secret') ?? req.headers.get('x-webhook-secret') ?? ''
  if (!secretMatches(provided, expected)) return json(404, { error: 'not_found' })

  // A GET with the right secret is the Settings card's reachability check.
  if (req.method === 'GET') return json(200, { ok: true, configured: true })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  if (serviceKey === '' || supabaseUrl === '') return json(503, { error: 'email_unconfigured' })

  // 3. Parse. From here on every answer is 200 — a retry storm helps nobody.
  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    console.error('[email-inbound] body was not JSON')
    return json(200, { ok: true, ignored: 'unparseable_body' })
  }

  const email = parseInboundPayload(payload)
  if (!email) {
    console.error('[email-inbound] no sender in payload; ignored')
    return json(200, { ok: true, ignored: 'no_sender' })
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  try {
    // 4. Idempotency. The provider retries; the inbox must not grow a twin.
    if (email.provider_message_id) {
      const existing = await supabase
        .from('emails')
        .select('id')
        .eq('provider_message_id', email.provider_message_id)
        .maybeSingle()
      const found = (existing.data as { id?: string } | null)?.id
      if (found) return json(200, { ok: true, duplicate: true, id: found })
    }

    // 5. File it. thread_key, contact_id and snippet are the trigger's job
    //    (011_email) — the same three rules as core.ts, decided once, in SQL.
    const inserted = await supabase
      .from('emails')
      .insert({
        folder: 'inbox',
        direction: 'in',
        from_addr: email.from_addr,
        to_addrs: email.to_addrs,
        cc_addrs: email.cc_addrs,
        subject: email.subject === '' ? null : email.subject,
        body_text: email.body_text === '' ? null : email.body_text,
        body_html: email.body_html,
        provider_message_id: email.provider_message_id,
        rfc_message_id: email.rfc_message_id,
        in_reply_to: email.in_reply_to,
        occurred_at: email.occurred_at ?? new Date().toISOString(),
      })
      .select('id, contact_id, thread_key')
      .maybeSingle()

    if (inserted.error) {
      // 23505 = the unique index on provider_message_id: two deliveries raced.
      const code = (inserted.error as { code?: string }).code
      if (code === '23505') return json(200, { ok: true, duplicate: true })
      console.error('[email-inbound] insert failed', inserted.error)
      return json(200, { ok: true, ignored: 'insert_failed' })
    }

    const row = inserted.data as { id: string; contact_id: string | null; thread_key: string | null } | null
    if (!row) return json(200, { ok: true, ignored: 'insert_returned_nothing' })

    // 6. Attachments, best effort.
    if (email.attachments.length > 0) {
      const storage = supabase.storage.from(BUCKET)
      const rows: AttachmentRow[] = []
      for (let index = 0; index < email.attachments.length; index += 1) {
        const attachment = email.attachments[index] as InboundAttachment
        rows.push(
          await fileAttachment(
            storage as unknown as Parameters<typeof fileAttachment>[0],
            row.id,
            index,
            attachment,
          ),
        )
      }
      const written = await supabase.from('email_attachments').insert(rows)
      if (written.error) console.error('[email-inbound] attachment rows failed', written.error)
    }

    return json(200, {
      ok: true,
      id: row.id,
      shape: email.shape,
      matched: row.contact_id !== null,
      thread_key: row.thread_key,
      attachments: email.attachments.length,
    })
  } catch (caught) {
    console.error('[email-inbound]', caught instanceof Error ? caught.message : caught)
    return json(200, { ok: true, ignored: 'unexpected_error' })
  }
})
