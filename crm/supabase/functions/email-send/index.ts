/**
 * `email-send` — outbound mail through Resend's REST API, and the Sent row
 * that records it (10 §3, the full-inbox upgrade).
 *
 * **Deployment: `verify_jwt = true`.** Nothing here runs unattended. I-10 says
 * nothing sends without a human, so every send carries the signed-in
 * fundraiser's own token and the row it writes is inserted *as them*, under
 * RLS: a viewer cannot send, because `emails_ins` will not let them write the
 * record of it. That is the enforcement — this function only reflects it.
 *
 * **Unconfigured is a supported state.** Without `RESEND_API_KEY` and
 * `EMAIL_FROM` this answers **503 `email_unconfigured`** and the compose sheet
 * shows a plain setup notice with Send disabled. Reading the inbox keeps
 * working; only the outbound half is missing.
 *
 * **Threading.** A reply is sent with `In-Reply-To`/`References` pointing at
 * the parent's `Message-ID`, and the stored row inherits the parent's
 * `thread_key` directly — no guessing, because we have the parent in hand.
 * We also mint our own `Message-ID` so the donor's reply can chain back onto
 * this message; if the provider replaces it, threading degrades to the
 * subject+counterpart rule in 011_email, which is the same answer the inbound
 * side would reach anyway.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.58.0'
import { storedAddress, validateCompose } from './core.ts'

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

interface Body {
  to?: unknown
  cc?: unknown
  subject?: unknown
  body_text?: unknown
  in_reply_to_email_id?: unknown
  /** Status probe: answer what is configured and send nothing. */
  status?: unknown
}

const asStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((entry) => String(entry ?? '')).filter((entry) => entry.trim() !== '')
  if (typeof value === 'string') return value.split(/[,;\n]/).map((part) => part.trim()).filter((part) => part !== '')
  return []
}

/** `<uuid@domain-of-EMAIL_FROM>` — our side of the chain. */
function mintMessageId(from: string): string {
  const at = from.lastIndexOf('@')
  const domain = at > 0 ? from.slice(at + 1).replace(/[>\s]+$/, '') : 'localhost'
  return `<${crypto.randomUUID()}@${domain}>`
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const authorization = req.headers.get('Authorization') ?? ''
  if (authorization === '') return json(401, { error: 'unauthorized' })

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return json(400, { error: 'bad_request', message: 'Body must be JSON.' })
  }

  const apiKey = Deno.env.get('RESEND_API_KEY') ?? ''
  const from = (Deno.env.get('EMAIL_FROM') ?? '').trim()
  const configured = apiKey !== '' && from !== ''

  // The Settings card's probe: a signed-in member may ask what is set up
  // without attempting a send. It answers 200 either way — "not configured" is
  // information, not a failure.
  if (body.status === true) {
    return json(200, {
      configured,
      from: from === '' ? null : from,
      has_api_key: apiKey !== '',
      has_from: from !== '',
    })
  }

  if (!configured) return json(503, { error: 'email_unconfigured' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

  // The caller's own token: the insert below is subject to exactly the rules
  // the UI is subject to. Never the service key.
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })

  const { data: userData } = await supabase.auth.getUser()
  const viewerId = userData?.user?.id ?? null
  if (!viewerId) return json(401, { error: 'unauthorized' })

  /* ------------------------------------------------------------ validate */

  const to = asStringArray(body.to)
  const cc = asStringArray(body.cc)
  const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
  const bodyText = typeof body.body_text === 'string' ? body.body_text : ''

  // The same rules the Send button obeys, from the same file (core.ts), so the
  // two halves can never disagree about what is sendable.
  const check = validateCompose({ to: to.join(', '), cc: cc.join(', '), subject, body: bodyText })
  if (!check.ok) {
    return json(400, { error: 'invalid_draft', errors: check.errors })
  }

  /* --------------------------------------------------------------- reply */

  let inReplyTo: string | null = null
  let references: string | null = null
  let threadKey: string | null = null
  const parentId = typeof body.in_reply_to_email_id === 'string' ? body.in_reply_to_email_id : ''

  if (parentId !== '') {
    const parent = await supabase
      .from('emails')
      .select('id, rfc_message_id, thread_key')
      .eq('id', parentId)
      .maybeSingle()
    const row = parent.data as { rfc_message_id: string | null; thread_key: string | null } | null
    // Not found is not fatal: RLS may hide it, or it may have been deleted.
    // The message still goes; it simply starts a thread of its own.
    if (row) {
      inReplyTo = row.rfc_message_id
      references = row.rfc_message_id
      threadKey = row.thread_key
    }
  }

  /* ---------------------------------------------------------------- send */

  const messageId = mintMessageId(from)
  const headers: Record<string, string> = { 'Message-ID': messageId }
  if (inReplyTo) headers['In-Reply-To'] = inReplyTo
  if (references) headers['References'] = references

  let providerId: string | null = null
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: check.to,
        ...(check.cc.length > 0 ? { cc: check.cc } : {}),
        subject: subject === '' ? '(no subject)' : subject,
        text: bodyText,
        headers,
      }),
    })

    const result = (await response.json().catch(() => null)) as { id?: string; message?: string; name?: string } | null

    if (!response.ok) {
      // A key the provider rejects is an unconfigured integration, not an
      // outage of the CRM — the compose sheet says so in the same words.
      if (response.status === 401 || response.status === 403) {
        return json(503, { error: 'email_unconfigured' })
      }
      return json(502, {
        error: 'email_send_failed',
        message: result?.message ?? `Resend answered ${response.status}`,
      })
    }

    providerId = result?.id ?? null
  } catch (caught) {
    return json(502, {
      error: 'email_send_failed',
      message: caught instanceof Error ? caught.message : 'Could not reach the mail provider.',
    })
  }

  /* --------------------------------------------------------------- record */

  const now = new Date().toISOString()
  const inserted = await supabase
    .from('emails')
    .insert({
      folder: 'sent',
      direction: 'out',
      from_addr: storedAddress(from) || from,
      to_addrs: check.to,
      cc_addrs: check.cc,
      subject: subject === '' ? null : subject,
      body_text: bodyText,
      provider_message_id: providerId,
      rfc_message_id: messageId,
      in_reply_to: inReplyTo,
      // Known parent → known thread. Null lets the trigger derive one.
      thread_key: threadKey,
      sent_by: viewerId,
      // Your own sent mail is not unread.
      read_at: now,
      occurred_at: now,
    })
    .select('id, thread_key, contact_id, occurred_at')
    .maybeSingle()

  if (inserted.error) {
    // The message is gone; only the record failed. Say so plainly rather than
    // implying the send did not happen.
    return json(207, {
      sent: true,
      recorded: false,
      provider_message_id: providerId,
      message: inserted.error.message,
    })
  }

  const row = inserted.data as {
    id: string
    thread_key: string | null
    contact_id: string | null
    occurred_at: string
  } | null

  return json(200, {
    sent: true,
    recorded: row !== null,
    id: row?.id ?? null,
    thread_key: row?.thread_key ?? null,
    contact_id: row?.contact_id ?? null,
    occurred_at: row?.occurred_at ?? now,
    provider_message_id: providerId,
  })
})
