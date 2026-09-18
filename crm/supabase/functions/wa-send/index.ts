/**
 * `wa-send` — the one outbound door (spec 10 §2 Tier 2, I-10).
 *
 * **A human pressed a button.** `verify_jwt = true` and the Supabase client is
 * built from the *caller's* Authorization header, never the service-role key,
 * so every write here is attributable to a signed-in team member and is held to
 * the same RLS policies as the rest of the app (11 §2). There is no scheduler,
 * no trigger and no automation that can reach this function: I-10 says
 * automations create tasks and flags, humans send messages, and the absence of
 * a service-role path is how that is enforced rather than merely promised.
 *
 * **The 24-hour window is enforced here, not only in the composer.**
 * `validateSendRequest` re-reads `last_inbound_at` from the database inside
 * this request and refuses free-form outside the window with **409
 * `window_closed`**. The composer prevents the mistake; this prevents the
 * workaround — a stale tab, a replayed request or a hand-rolled curl gets the
 * same answer. Approved templates are always permitted: that is precisely what
 * Meta sells for reaching someone outside the window.
 *
 * **Unconfigured is a supported state.** Without `WA_ACCESS_TOKEN` and
 * `WA_PHONE_NUMBER_ID` this returns **503 `wa_unconfigured`** and the pane
 * shows the setup card. Tier 1 (wa.me + Quick Capture) covers ~90% of the need
 * and keeps working; Tier 2 is an upgrade, not a dependency.
 *
 * Cloud API only. Tier 3 — unofficial bridges, WhatsApp Web scraping — is
 * permanently rejected (10 §2): ToS violation and a realistic ban risk to the
 * fundraiser's own number, which is an existential risk to the relationships
 * themselves.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.58.0'
import { buildGraphPayload, validateSendRequest, waIdDigits } from './core.ts'

const GRAPH_VERSION = 'v21.0'
/** Only the template catalogue needs it, so its absence is not "unconfigured". */
const BUSINESS_ACCOUNT_ID = () => Deno.env.get('WA_BUSINESS_ACCOUNT_ID') ?? ''

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

interface ConversationRow {
  id: string
  wa_id: string
  last_inbound_at: string | null
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const accessToken = Deno.env.get('WA_ACCESS_TOKEN') ?? ''
  const phoneNumberId = Deno.env.get('WA_PHONE_NUMBER_ID') ?? ''
  if (accessToken === '' || phoneNumberId === '') {
    return json(503, {
      error: 'wa_unconfigured',
      message: 'WhatsApp Business is not connected. Set WA_ACCESS_TOKEN and WA_PHONE_NUMBER_ID.',
    })
  }

  const authorization = req.headers.get('Authorization') ?? ''
  if (authorization === '') return json(401, { error: 'unauthorized' })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json(400, { error: 'bad_request', message: 'Body must be JSON.' })
  }

  // The caller's own token: RLS shapes every read and write below exactly as it
  // shapes the UI (11 §2). Never the service key.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } },
  )

  const { data: userData } = await supabase.auth.getUser()
  const viewerId = userData?.user?.id ?? null
  if (!viewerId) return json(401, { error: 'unauthorized' })

  const member = await supabase.from('team_members').select('id, role, is_active').eq('id', viewerId).maybeSingle()
  if (!member.data) return json(403, { error: 'not_a_member' })
  const role = (member.data as { role?: string }).role ?? ''
  if (role !== 'admin' && role !== 'fundraiser') {
    // Defence in depth: RLS would refuse the insert anyway, but a viewer should
    // be told why rather than watching a write fail after the message is out.
    return json(403, { error: 'forbidden', message: 'Only admins and fundraisers send messages.' })
  }

  /* ------------------------------------------------------ the two other verbs */

  // `status` is the Settings card's probe. It sends nothing and reads nothing
  // about a donor; it answers only "are the secrets present?", and it answers
  // 503 above when they are not, which is the whole signal.
  if (body.action === 'status') {
    return json(200, {
      configured: true,
      phone_number_id_present: phoneNumberId !== '',
      templates_syncable: BUSINESS_ACCOUNT_ID() !== '',
      graph_version: GRAPH_VERSION,
    })
  }

  // `sync_templates` mirrors Meta's approved-template catalogue into
  // `wa_templates`. Approval is a Business Manager workflow — this never
  // creates, edits or approves a template, it only reads the list.
  if (body.action === 'sync_templates') {
    const wabaId = BUSINESS_ACCOUNT_ID()
    if (wabaId === '') {
      return json(503, {
        error: 'wa_unconfigured',
        message: 'Set WA_BUSINESS_ACCOUNT_ID (the WhatsApp Business Account id) to sync templates.',
      })
    }
    try {
      const response = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates?limit=200&fields=name,language,category,status,components`,
        { headers: { authorization: `Bearer ${accessToken}` } },
      )
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
      if (!response.ok) {
        const error = (payload.error ?? {}) as Record<string, unknown>
        const message = typeof error.message === 'string' ? error.message : 'Meta rejected the template read.'
        if (response.status === 401 || response.status === 403) return json(503, { error: 'wa_unconfigured', message })
        return json(502, { error: 'wa_failed', message })
      }

      const list = Array.isArray(payload.data) ? (payload.data as Array<Record<string, unknown>>) : []
      const syncedAt = new Date().toISOString()
      const rows = list.map((template) => {
        const components = Array.isArray(template.components)
          ? (template.components as Array<Record<string, unknown>>)
          : []
        const bodyComponent = components.find((component) => component.type === 'BODY')
        return {
          name: String(template.name ?? ''),
          language: String(template.language ?? 'en_GB'),
          category: typeof template.category === 'string' ? template.category : null,
          body: typeof bodyComponent?.text === 'string' ? (bodyComponent.text as string) : null,
          status: String(template.status ?? 'PENDING'),
          synced_at: syncedAt,
        }
      })

      if (rows.length > 0) {
        const written = await supabase.from('wa_templates').upsert(rows, { onConflict: 'name,language' })
        if (written.error) return json(403, { error: 'forbidden', message: written.error.message })
      }
      return json(200, { synced: rows.length, synced_at: syncedAt })
    } catch (caught) {
      console.error('[wa-send] template sync:', caught instanceof Error ? caught.message : String(caught))
      return json(502, { error: 'wa_failed', message: 'Meta could not be reached.' })
    }
  }

  /* ------------------------------------------------- resolve the conversation */

  const conversationId = typeof body.conversation_id === 'string' ? body.conversation_id : ''
  const toWaId = typeof body.to_wa_id === 'string' ? body.to_wa_id : ''

  let conversation: ConversationRow | null = null
  if (conversationId !== '') {
    const found = await supabase
      .from('wa_conversations')
      .select('id, wa_id, last_inbound_at')
      .eq('id', conversationId)
      .maybeSingle()
    conversation = (found.data as ConversationRow | null) ?? null
    if (!conversation) return json(404, { error: 'not_found', message: 'No such conversation.' })
  } else if (toWaId !== '') {
    const normalised = `+${waIdDigits(toWaId) ?? ''}`
    const found = await supabase
      .from('wa_conversations')
      .select('id, wa_id, last_inbound_at')
      .eq('wa_id', normalised)
      .maybeSingle()
    conversation = (found.data as ConversationRow | null) ?? null
  }

  /* --------------------------------------------------------- the rule itself */

  const validation = validateSendRequest(body, {
    lastInboundAt: conversation?.last_inbound_at ?? null,
    nowMs: Date.now(),
    conversationExists: conversation !== null,
  })
  if (!validation.ok) {
    return json(validation.status, { error: validation.error, message: validation.message })
  }

  const digits = waIdDigits(conversation?.wa_id ?? toWaId)
  if (!digits) return json(400, { error: 'bad_request', message: 'No usable WhatsApp number.' })

  /* ------------------------------------------------------------- Graph call */

  const endpoint = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`
  let graphBody: Record<string, unknown>
  let graphStatus = 0
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildGraphPayload(validation, digits)),
    })
    graphStatus = response.status
    graphBody = (await response.json().catch(() => ({}))) as Record<string, unknown>
  } catch (caught) {
    console.error('[wa-send] graph unreachable:', caught instanceof Error ? caught.message : String(caught))
    return json(502, { error: 'wa_failed', message: 'WhatsApp could not be reached.' })
  }

  if (graphStatus < 200 || graphStatus >= 300) {
    const error = (graphBody.error ?? {}) as Record<string, unknown>
    const message = typeof error.message === 'string' ? error.message : 'WhatsApp rejected the message.'
    // An expired token reads as unconfigured to the UI, which is the truthful
    // thing to show: the integration needs attention before it can send.
    if (graphStatus === 401 || graphStatus === 403) {
      return json(503, { error: 'wa_unconfigured', message })
    }
    console.error('[wa-send] graph', graphStatus, message)
    return json(502, { error: 'wa_failed', message })
  }

  const sentMessages = Array.isArray(graphBody.messages) ? (graphBody.messages as Array<Record<string, unknown>>) : []
  const waMessageId = typeof sentMessages[0]?.id === 'string' ? (sentMessages[0].id as string) : null

  /* ------------------------------------------------ the row, after the fact */

  // Created only after Meta accepted it, and only for a real conversation: a
  // brand-new number gets its row here so the thread the fundraiser just
  // started is the thread they see. The trigger in 012 matches the donor.
  if (!conversation) {
    const created = await supabase
      .from('wa_conversations')
      .insert({ wa_id: `+${digits}` })
      .select('id, wa_id, last_inbound_at')
      .maybeSingle()
    conversation = (created.data as ConversationRow | null) ?? null
    if (!conversation) {
      const raced = await supabase
        .from('wa_conversations')
        .select('id, wa_id, last_inbound_at')
        .eq('wa_id', `+${digits}`)
        .maybeSingle()
      conversation = (raced.data as ConversationRow | null) ?? null
    }
  }
  if (!conversation) {
    // The message went out; we simply could not file it. Say so rather than
    // reporting a failure the donor's phone disagrees with.
    return json(200, { sent: true, filed: false, wa_message_id: waMessageId })
  }

  const occurredAt = new Date().toISOString()
  const inserted = await supabase
    .from('wa_messages')
    .insert({
      conversation_id: conversation.id,
      direction: 'out',
      wa_message_id: waMessageId,
      msg_type: validation.kind === 'template' ? 'template' : 'text',
      body: validation.kind === 'template' ? null : validation.body,
      template_name: validation.kind === 'template' ? validation.templateName : null,
      status: 'sent',
      occurred_at: occurredAt,
      sent_by: viewerId,
    })
    .select('id')
    .maybeSingle()

  await supabase.from('wa_conversations').update({ last_message_at: occurredAt }).eq('id', conversation.id)

  return json(200, {
    sent: true,
    filed: Boolean(inserted.data),
    conversation_id: conversation.id,
    message_id: (inserted.data as { id?: string } | null)?.id ?? null,
    wa_message_id: waMessageId,
    kind: validation.kind,
  })
})
