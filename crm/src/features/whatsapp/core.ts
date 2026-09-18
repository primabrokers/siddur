/**
 * The pure core of the WhatsApp Business (Cloud API) integration — spec
 * 10 §2 Tier 2, activated on the user's request (18 Sep 2026).
 *
 * Everything here is decided rather than fetched: the 24-hour customer-service
 * window, the webhook signature, the shape of Meta's payloads, the status
 * ladder, and what the composer is allowed to offer. That makes the rules
 * testable without a browser, a database or Meta — and it lets the two edge
 * functions run *the same* rules the UI shows, which is the whole compliance
 * story (the client may not be the only guard; see `validateSendRequest`).
 *
 * **This file imports nothing.** `supabase/functions/wa-webhook/core.ts` and
 * `supabase/functions/wa-send/core.ts` are byte-identical mirrors of it under a
 * generated header, because the Deno edge runtime cannot reach into `src/`.
 * `tests/wa-mirror.test.ts` fails the moment one drifts.
 */

/* ------------------------------------------------------------------ types */

export type WaDirection = 'in' | 'out'
export type WaMessageType = 'text' | 'template' | 'media' | 'unsupported'
export type WaStatus = 'received' | 'sent' | 'delivered' | 'read' | 'failed'
/** How a conversation found its donor (or did not). */
export type WaMatchedBy = 'whatsapp' | 'phone' | 'manual'

/* ---------------------------------------------------------- phone numbers */

/** UK default, as everywhere else in this book of donors (02 §6). */
export const WA_DEFAULT_DIALLING_CODE = '44'

/**
 * `wa_id` → E.164, by exactly the rule `features/contacts/normalise.ts`
 * applies to `phone`/`whatsapp` — Meta sends bare digits (`447700900123`),
 * the contact record holds `+44 7700 900123`, and the two have to meet.
 *
 * Duplicated rather than imported so this file stays mirrorable;
 * `tests/wa-phone-match.test.ts` asserts the two agree on a table of inputs.
 */
export function normaliseWaId(
  input: string | null | undefined,
  diallingCode: string = WA_DEFAULT_DIALLING_CODE,
): string | null {
  if (input === null || input === undefined) return null
  const trimmed = String(input).trim()
  if (trimmed === '') return null

  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (digits === '') return trimmed

  if (hasPlus) return `+${digits}`
  if (digits.startsWith('00')) return `+${digits.slice(2).replace(/^0+/, '') || digits.slice(2)}`
  if (digits.startsWith('0')) return `+${diallingCode}${digits.replace(/^0+/, '')}`
  if (digits.startsWith(diallingCode)) return `+${digits}`
  return `+${diallingCode}${digits}`
}

/** `+447700900123` → `447700900123` — what the Graph API wants in `to`. */
export function waIdDigits(input: string | null | undefined): string | null {
  const normalised = normaliseWaId(input)
  if (!normalised) return null
  const digits = normalised.replace(/\D/g, '')
  return digits === '' ? null : digits
}

/* --------------------------------------------- the 24-hour service window */

/**
 * Meta's customer-service window: **free-form messages only within 24 hours of
 * the last inbound message**; outside it, approved templates only. This is not
 * a nicety — sending free-form outside the window is rejected by the Graph API
 * and, done repeatedly, is a policy violation.
 *
 * Computed from `last_inbound_at`, never stored (I-9): a stored boolean would
 * be wrong 24 hours after it was written.
 */
export const WA_WINDOW_MS = 24 * 60 * 60 * 1000

export interface WaWindowState {
  /** True while free-form is permitted. */
  open: boolean
  /** Never had an inbound message: a conversation can only start on a template. */
  neverInbound: boolean
  lastInboundAt: string | null
  /** ISO instant the window shuts, or null when there is nothing to shut. */
  expiresAt: string | null
  /** Milliseconds left; 0 once closed. */
  msRemaining: number
}

/**
 * The window, as of `nowMs`.
 *
 * Boundary rule: the window is open for *strictly less than* 24 hours after
 * the inbound message. At exactly 24h it is closed — erring toward the
 * template is a free mistake; erring toward free-form is a policy breach.
 */
export function windowState(lastInboundAt: string | null | undefined, nowMs: number): WaWindowState {
  if (lastInboundAt === null || lastInboundAt === undefined || lastInboundAt === '') {
    return { open: false, neverInbound: true, lastInboundAt: null, expiresAt: null, msRemaining: 0 }
  }
  const at = Date.parse(lastInboundAt)
  if (Number.isNaN(at)) {
    return { open: false, neverInbound: true, lastInboundAt: null, expiresAt: null, msRemaining: 0 }
  }
  const expires = at + WA_WINDOW_MS
  const remaining = expires - nowMs
  return {
    open: remaining > 0,
    neverInbound: false,
    lastInboundAt: new Date(at).toISOString(),
    expiresAt: new Date(expires).toISOString(),
    msRemaining: remaining > 0 ? remaining : 0,
  }
}

export function windowOpen(lastInboundAt: string | null | undefined, nowMs: number): boolean {
  return windowState(lastInboundAt, nowMs).open
}

/** "6h left" / "48m left" — the composer's countdown, deliberately coarse. */
export function windowRemainingLabel(state: WaWindowState): string {
  if (!state.open) return 'closed'
  const minutes = Math.floor(state.msRemaining / 60_000)
  if (minutes >= 120) return `${Math.floor(minutes / 60)}h left`
  if (minutes >= 1) return `${minutes}m left`
  return 'under a minute left'
}

/* ------------------------------------------------- webhook authentication */

/**
 * `X-Hub-Signature-256: sha256=<hex>` → the hex digest, lowercased.
 * Anything else (missing header, wrong prefix, odd length, non-hex) is null,
 * which the caller treats exactly like a mismatch.
 */
export function parseSignatureHeader(header: string | null | undefined): string | null {
  if (!header) return null
  const value = String(header).trim()
  if (!value.toLowerCase().startsWith('sha256=')) return null
  const hex = value.slice('sha256='.length).trim().toLowerCase()
  if (hex.length !== 64 || !/^[0-9a-f]+$/.test(hex)) return null
  return hex
}

/**
 * Constant-time hex compare. Length is compared first and non-secretly (both
 * sides are fixed-width digests), then every byte is mixed in regardless of an
 * early difference, so the loop cannot leak the position of the mismatch.
 */
export function timingSafeEqualHex(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const toHex = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer)
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, '0')
  return out
}

/**
 * HMAC-SHA256 of the **raw request body** with the app secret. Raw, not
 * re-serialised JSON: `JSON.parse` then `JSON.stringify` changes key order and
 * whitespace, and the digest would never match again.
 */
export async function hmacSha256Hex(secret: string, raw: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(raw)))
}

/** The whole check: parse the header, recompute, compare in constant time. */
export async function verifyWebhookSignature(
  secret: string,
  raw: string,
  header: string | null | undefined,
): Promise<boolean> {
  const claimed = parseSignatureHeader(header)
  if (claimed === null) return false
  return timingSafeEqualHex(await hmacSha256Hex(secret, raw), claimed)
}

/* ------------------------------------------------------- webhook payloads */

export interface WaInboundMessage {
  wa_id: string
  profile_name: string | null
  wa_message_id: string
  msg_type: WaMessageType
  /** Text body, or a media caption, or a one-line description of the unsupported thing. */
  body: string | null
  media_id: string | null
  media_mime: string | null
  occurred_at: string
}

export interface WaStatusReceipt {
  wa_message_id: string
  status: WaStatus
  occurred_at: string
  error_detail: string | null
  recipient_wa_id: string | null
}

export interface WaParsedWebhook {
  messages: WaInboundMessage[]
  statuses: WaStatusReceipt[]
  /** Entries we understood the shape of but deliberately do nothing with. */
  ignored: number
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const asString = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim() !== '') return value
  if (typeof value === 'number') return String(value)
  return null
}

/** Meta sends unix **seconds** as a string. Anything unreadable falls back to now. */
export function waTimestampToIso(value: unknown, nowMs: number): string {
  const raw = asString(value)
  const seconds = raw === null ? Number.NaN : Number(raw)
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date(nowMs).toISOString()
  return new Date(Math.round(seconds * 1000)).toISOString()
}

/** The media-bearing message types of the Cloud API. */
const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker', 'voice'] as const

const STATUS_VALUES: WaStatus[] = ['received', 'sent', 'delivered', 'read', 'failed']

function readMessage(raw: unknown, profileNames: Map<string, string>, nowMs: number): WaInboundMessage | null {
  const message = asRecord(raw)
  const id = asString(message.id)
  const from = asString(message.from)
  if (id === null || from === null) return null

  const waId = normaliseWaId(from) ?? from
  const type = asString(message.type) ?? 'unknown'
  const occurred = waTimestampToIso(message.timestamp, nowMs)
  const base = {
    wa_id: waId,
    profile_name: profileNames.get(from) ?? profileNames.get(waId) ?? null,
    wa_message_id: id,
    occurred_at: occurred,
  }

  if (type === 'text') {
    return { ...base, msg_type: 'text', body: asString(asRecord(message.text).body), media_id: null, media_mime: null }
  }

  if ((MEDIA_TYPES as readonly string[]).includes(type)) {
    const media = asRecord(message[type])
    const caption = asString(media.caption)
    return {
      ...base,
      msg_type: 'media',
      // The caption if there is one, otherwise a human-readable placeholder —
      // the list snippet must never be blank.
      body: caption ?? `[${type}]`,
      media_id: asString(media.id),
      media_mime: asString(media.mime_type),
    }
  }

  // Buttons, interactive replies, reactions, locations, contacts, orders,
  // system notices: recorded so the thread is honest about what arrived, never
  // silently dropped. `button`/`interactive` carry usable text, so take it.
  const buttonText = asString(asRecord(message.button).text)
  const listReply = asString(asRecord(asRecord(message.interactive).list_reply).title)
  const buttonReply = asString(asRecord(asRecord(message.interactive).button_reply).title)
  const text = buttonText ?? listReply ?? buttonReply
  return {
    ...base,
    msg_type: 'unsupported',
    body: text ?? `[${type} message — open WhatsApp to see it]`,
    media_id: null,
    media_mime: null,
  }
}

function readStatus(raw: unknown, nowMs: number): WaStatusReceipt | null {
  const receipt = asRecord(raw)
  const id = asString(receipt.id)
  const status = asString(receipt.status)
  if (id === null || status === null) return null
  const normalised = status.toLowerCase() as WaStatus
  if (!STATUS_VALUES.includes(normalised)) return null

  const errors = asArray(receipt.errors).map(asRecord)
  const first = errors[0]
  const detail =
    first === undefined
      ? null
      : [asString(first.code), asString(first.title) ?? asString(first.message), asString(asRecord(first.error_data).details)]
          .filter((part): part is string => part !== null)
          .join(' · ') || null

  return {
    wa_message_id: id,
    status: normalised,
    occurred_at: waTimestampToIso(receipt.timestamp, nowMs),
    error_detail: detail,
    recipient_wa_id: normaliseWaId(asString(receipt.recipient_id)),
  }
}

/**
 * `entry[].changes[].value` → the messages and the delivery receipts.
 *
 * Tolerant by design: Meta retries a webhook it does not get a 200 from, so a
 * payload we cannot read must still be a 200 with `ignored`, never a 500 that
 * earns an infinite retry loop.
 */
export function parseWebhook(payload: unknown, nowMs: number = Date.now()): WaParsedWebhook {
  const messages: WaInboundMessage[] = []
  const statuses: WaStatusReceipt[] = []
  let ignored = 0

  for (const entry of asArray(asRecord(payload).entry)) {
    for (const change of asArray(asRecord(entry).changes)) {
      const changeRecord = asRecord(change)
      const field = asString(changeRecord.field)
      const value = asRecord(changeRecord.value)
      if (field !== null && field !== 'messages') {
        ignored += 1
        continue
      }

      const profileNames = new Map<string, string>()
      for (const contact of asArray(value.contacts)) {
        const record = asRecord(contact)
        const waId = asString(record.wa_id)
        const name = asString(asRecord(record.profile).name)
        if (waId !== null && name !== null) {
          profileNames.set(waId, name)
          const normalised = normaliseWaId(waId)
          if (normalised !== null) profileNames.set(normalised, name)
        }
      }

      for (const raw of asArray(value.messages)) {
        const message = readMessage(raw, profileNames, nowMs)
        if (message) messages.push(message)
        else ignored += 1
      }
      for (const raw of asArray(value.statuses)) {
        const receipt = readStatus(raw, nowMs)
        if (receipt) statuses.push(receipt)
        else ignored += 1
      }
      if (!Array.isArray(value.messages) && !Array.isArray(value.statuses)) ignored += 1
    }
  }

  return { messages, statuses, ignored }
}

/* ---------------------------------------------------------- status ladder */

/** Delivery only ever moves forward; a failure outranks everything. */
export const WA_STATUS_RANK: Record<WaStatus, number> = {
  received: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
}

/**
 * Meta does not guarantee receipt order — `read` can land before `delivered`.
 * Taking the max keeps the ticks monotonic.
 */
export function advanceStatus(current: WaStatus | null | undefined, next: WaStatus): WaStatus {
  if (!current || !(current in WA_STATUS_RANK)) return next
  return WA_STATUS_RANK[next] > WA_STATUS_RANK[current] ? next : current
}

export const WA_STATUS_LABEL: Record<WaStatus, string> = {
  received: 'Received',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed',
}

/* --------------------------------------------------------- send contracts */

export interface WaTemplateParam {
  value: string
}

export interface WaSendRequest {
  conversation_id?: unknown
  to_wa_id?: unknown
  body?: unknown
  template_name?: unknown
  language?: unknown
  params?: unknown
}

export type WaSendKind = 'free_form' | 'template'

export interface WaSendAccepted {
  ok: true
  kind: WaSendKind
  conversationId: string | null
  toWaId: string | null
  body: string
  templateName: string
  language: string
  params: string[]
}

export interface WaSendRejected {
  ok: false
  status: number
  error: 'bad_request' | 'window_closed'
  message: string
}

export type WaSendValidation = WaSendAccepted | WaSendRejected

export const WA_DEFAULT_TEMPLATE_LANGUAGE = 'en_GB'

/**
 * The server-side gate — the one that actually counts.
 *
 * The composer refuses to offer free text outside the window, but a composer
 * is a suggestion; this function is the rule. `wa-send` calls it with the
 * conversation's real `last_inbound_at`, read from the database inside the
 * request, so a stale browser tab, a replayed request or a hand-rolled curl
 * gets the same **409 `window_closed`** the UI would have prevented.
 *
 * Templates are always allowed: an approved template is precisely what Meta
 * sells for reaching someone outside the window.
 */
export function validateSendRequest(
  request: WaSendRequest,
  context: { lastInboundAt: string | null; nowMs: number; conversationExists: boolean },
): WaSendValidation {
  const conversationId = typeof request.conversation_id === 'string' && request.conversation_id !== ''
    ? request.conversation_id
    : null
  const toWaId = normaliseWaId(typeof request.to_wa_id === 'string' ? request.to_wa_id : null)
  const body = typeof request.body === 'string' ? request.body.trim() : ''
  const templateName = typeof request.template_name === 'string' ? request.template_name.trim() : ''
  const language =
    typeof request.language === 'string' && request.language.trim() !== ''
      ? request.language.trim()
      : WA_DEFAULT_TEMPLATE_LANGUAGE
  const params = Array.isArray(request.params)
    ? request.params.map((p) => (typeof p === 'string' ? p : p === null || p === undefined ? '' : String(p)))
    : []

  if (conversationId === null && toWaId === null) {
    return { ok: false, status: 400, error: 'bad_request', message: 'Give `conversation_id` or `to_wa_id`.' }
  }
  if (body === '' && templateName === '') {
    return { ok: false, status: 400, error: 'bad_request', message: 'Give `body` or `template_name`.' }
  }
  if (body !== '' && templateName !== '') {
    return {
      ok: false,
      status: 400,
      error: 'bad_request',
      message: 'A message is free-form or a template, never both.',
    }
  }

  if (templateName !== '') {
    return { ok: true, kind: 'template', conversationId, toWaId, body: '', templateName, language, params }
  }

  if (!context.conversationExists) {
    return {
      ok: false,
      status: 409,
      error: 'window_closed',
      message: 'A new WhatsApp conversation can only be opened with an approved template.',
    }
  }

  const state = windowState(context.lastInboundAt, context.nowMs)
  if (!state.open) {
    return {
      ok: false,
      status: 409,
      error: 'window_closed',
      message: state.neverInbound
        ? 'This contact has never messaged us, so only an approved template may be sent.'
        : 'The 24-hour customer-service window has closed. Send an approved template instead.',
    }
  }

  return { ok: true, kind: 'free_form', conversationId, toWaId, body, templateName: '', language, params }
}

/** `{{1}}`, `{{2}}`… in order — the only parameter form a body component takes. */
export function templateComponents(params: string[]): Array<Record<string, unknown>> {
  const filled = params.filter((value) => value !== undefined && value !== null)
  if (filled.length === 0) return []
  return [
    {
      type: 'body',
      parameters: filled.map((value) => ({ type: 'text', text: String(value) })),
    },
  ]
}

/** How many `{{n}}` placeholders a template body wants. */
export function templatePlaceholderCount(body: string | null | undefined): number {
  if (!body) return 0
  const seen = new Set<number>()
  for (const match of String(body).matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const index = Number(match[1])
    if (Number.isFinite(index)) seen.add(index)
  }
  return seen.size === 0 ? 0 : Math.max(...seen)
}

/** Fill `{{1}}`… for the preview line under the template picker. */
export function renderTemplatePreview(body: string | null | undefined, params: string[]): string {
  if (!body) return ''
  return String(body).replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, index: string) => {
    const value = params[Number(index) - 1]
    return value !== undefined && value !== '' ? value : whole
  })
}

/** The Graph API request body for one outbound message. */
export function buildGraphPayload(accepted: WaSendAccepted, toDigits: string): Record<string, unknown> {
  if (accepted.kind === 'template') {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toDigits,
      type: 'template',
      template: {
        name: accepted.templateName,
        language: { code: accepted.language },
        components: templateComponents(accepted.params),
      },
    }
  }
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toDigits,
    type: 'text',
    text: { preview_url: false, body: accepted.body },
  }
}

/* --------------------------------------------------- the composer's states */

export type WaComposerMode =
  /** Free text is permitted — the window is open. */
  | 'free_form'
  /** Closed window, approved templates available. */
  | 'template_required'
  /** Closed window and nothing approved yet: explain Meta Business Manager. */
  | 'template_unavailable'
  /** Nothing is selected. */
  | 'idle'

export interface WaComposerInput {
  hasConversation: boolean
  lastInboundAt: string | null
  templateCount: number
  nowMs: number
}

export interface WaComposerState {
  mode: WaComposerMode
  window: WaWindowState
  /** The banner above a closed composer. */
  notice: string | null
  canSendFreeForm: boolean
  canSendTemplate: boolean
}

export const WA_WINDOW_CLOSED_BANNER = '24-hour window closed — send an approved template'

/**
 * The composer state machine (10 §2 Tier 2 · I-10: the human sends, always).
 *
 * There is no "send anyway": outside the window the free-text box is not
 * disabled-but-present, it is *replaced* by the template picker, because a
 * disabled box invites the workaround and the workaround is the violation.
 */
export function composerState(input: WaComposerInput): WaComposerState {
  const state = windowState(input.lastInboundAt, input.nowMs)
  if (!input.hasConversation) {
    return {
      mode: 'idle',
      window: state,
      notice: null,
      canSendFreeForm: false,
      canSendTemplate: false,
    }
  }
  if (state.open) {
    return { mode: 'free_form', window: state, notice: null, canSendFreeForm: true, canSendTemplate: true }
  }
  if (input.templateCount > 0) {
    return {
      mode: 'template_required',
      window: state,
      notice: WA_WINDOW_CLOSED_BANNER,
      canSendFreeForm: false,
      canSendTemplate: true,
    }
  }
  return {
    mode: 'template_unavailable',
    window: state,
    notice: WA_WINDOW_CLOSED_BANNER,
    canSendFreeForm: false,
    canSendTemplate: false,
  }
}

/* ------------------------------------------------------------- timeline log */

/**
 * The prefill for "Log to timeline" — the durable value of a WhatsApp thread is
 * the summary and the next action, not the transcript (10 §2). So the sheet
 * opens with the last few messages joined into one editable paragraph, which
 * the fundraiser rewrites into a sentence a colleague can read in a year.
 */
export function timelinePrefill(
  messages: Array<{ direction: WaDirection; body: string | null; occurred_at: string }>,
  limit = 4,
): string {
  const recent = messages.slice(-limit)
  return recent
    .map((message) => {
      const who = message.direction === 'in' ? 'Them' : 'Us'
      const text = (message.body ?? '').replace(/\s+/g, ' ').trim()
      return text === '' ? null : `${who}: ${text}`
    })
    .filter((line): line is string => line !== null)
    .join('\n')
}
