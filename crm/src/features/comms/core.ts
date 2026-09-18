/**
 * The pure core of C1 (the email inbox) — everything that must be *decided* the
 * same way in the browser, in the two edge functions and in the tests.
 *
 * This file imports nothing. That is what makes it mirrorable: the Deno edge
 * runtime cannot reach into `src/`, so `email-inbound` and `email-send` each
 * carry a byte-identical copy under a generated header, and
 * `tests/comms-core-mirror.test.ts` fails the build the moment one drifts
 * (the same arrangement M9a uses for `src/features/ai/core.ts`).
 *
 * The three rules that live here:
 *
 *   1. **Addresses are compared normalised, never raw.** `Dovid Cohen
 *      <Dovid.Cohen+crm@Example.com>` and `dovid.cohen@example.com` are the
 *      same donor; `contacts.email` is already lowercased at the door
 *      (features/contacts/normalise.ts), so the extra work here is stripping
 *      the display name and the plus-tag.
 *   2. **A thread is a chain first and a subject second.** If a message names
 *      its parent (`In-Reply-To`), it inherits that parent's `thread_key`
 *      outright. Only when there is no chain do we fall back to normalised
 *      subject + counterpart, which is the best guess available and is
 *      deliberately scoped to one counterpart so two donors asking "Dinner?"
 *      never merge.
 *   3. **Nothing sends without a human** (I-10). Compose validation lives here
 *      so the Send button and the edge function refuse the same drafts.
 */

/* --------------------------------------------------------------- addresses */

export interface ParsedAddress {
  /** The display name, or '' when the address was bare. */
  name: string
  /** The addr-spec exactly as written (case preserved). */
  address: string
}

/**
 * `"Dovid Cohen" <dovid@example.com>` → `{ name, address }`.
 *
 * Deliberately forgiving: a value that carries no angle brackets is treated as
 * a bare address, and a value that carries nothing usable comes back with an
 * empty address rather than throwing. An inbound webhook is not a place to be
 * strict — a malformed header must never lose the message (see
 * `parseInboundPayload`).
 */
export function parseAddress(raw: string | null | undefined): ParsedAddress {
  const value = (raw ?? '').trim()
  if (value === '') return { name: '', address: '' }

  const angled = value.match(/^(.*?)<([^<>]*)>\s*$/)
  if (angled) {
    const name = (angled[1] ?? '').trim().replace(/^["']|["']$/g, '').trim()
    return { name, address: (angled[2] ?? '').trim() }
  }
  return { name: '', address: value }
}

/**
 * The comparison key for an address: addr-spec only, lowercased, plus-tag
 * removed. This is what matching and thread counterparts use — never the raw
 * header.
 */
export function normaliseAddress(raw: string | null | undefined): string {
  const { address } = parseAddress(raw)
  const value = address.toLowerCase()
  const at = value.lastIndexOf('@')
  if (at <= 0) return value
  const local = value.slice(0, at)
  const domain = value.slice(at + 1)
  const plus = local.indexOf('+')
  const bare = plus > 0 ? local.slice(0, plus) : local
  return `${bare}@${domain}`
}

/** Storage form: addr-spec, lowercased, plus-tag **kept** (it is real routing). */
export function storedAddress(raw: string | null | undefined): string {
  return parseAddress(raw).address.trim().toLowerCase()
}

/** Good enough to send to: one `@`, something either side, no whitespace. */
export function isValidAddress(raw: string | null | undefined): boolean {
  const address = parseAddress(raw).address
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(address)
}

/** Display: the name when we have one, otherwise the address. */
export function addressLabel(raw: string | null | undefined): string {
  const { name, address } = parseAddress(raw)
  return name || address || '(no address)'
}

/* ----------------------------------------------------------------- threads */

const SUBJECT_PREFIX = /^\s*(re|fw|fwd|aw|sv|antwort|tr)\s*(\[\d+\])?\s*:\s*/i

/**
 * Strip every reply/forward prefix, collapse whitespace, lowercase.
 * `Re: FW: Re[2]: Dinner  invite` → `dinner invite`.
 */
export function normaliseSubject(subject: string | null | undefined): string {
  let value = (subject ?? '').replace(/\s+/g, ' ').trim()
  // Loop: mail clients stack prefixes ("Re: Fwd: Re:"), and each pass peels one.
  for (let guard = 0; guard < 12; guard += 1) {
    const next = value.replace(SUBJECT_PREFIX, '')
    if (next === value) break
    value = next.trim()
  }
  return value.toLowerCase()
}

export interface ThreadKeyInput {
  /** The `In-Reply-To` header of the message being filed, if any. */
  inReplyTo?: string | null
  /** The thread_key of the message `inReplyTo` names, when it is on file. */
  parentThreadKey?: string | null
  subject?: string | null
  /** The other party: sender for inbound, first recipient for outbound. */
  counterpart?: string | null
}

/**
 * The thread a message belongs to.
 *
 * Chain first (rule 2): a known parent hands over its key verbatim, so a
 * thirty-message conversation whose subject drifts stays one thread. With no
 * parent on file we fall back to `subject|counterpart`; with neither subject
 * nor counterpart the message is its own thread and the caller supplies the
 * id (`thread:<id>`), because silently merging every blank-subject message
 * would be worse than a thread of one.
 */
export function deriveThreadKey(input: ThreadKeyInput, fallbackId?: string | null): string {
  const parent = (input.parentThreadKey ?? '').trim()
  if (parent !== '') return parent

  const subject = normaliseSubject(input.subject)
  const counterpart = normaliseAddress(input.counterpart)

  if (subject === '' && counterpart === '') {
    const chain = (input.inReplyTo ?? '').trim()
    if (chain !== '') return `chain:${chain}`
    return `thread:${fallbackId ?? 'unknown'}`
  }
  return `subj:${subject}|${counterpart}`
}

/** Sender for inbound, first recipient for outbound (normalised). */
export function counterpartOf(
  direction: 'in' | 'out',
  fromAddr: string | null | undefined,
  toAddrs: ReadonlyArray<string | null | undefined> | null | undefined,
): string {
  if (direction === 'in') return normaliseAddress(fromAddr)
  const first = (toAddrs ?? []).find((value) => normaliseAddress(value) !== '')
  return normaliseAddress(first ?? '')
}

/* ----------------------------------------------------------------- folders */

export const EMAIL_FOLDERS = ['inbox', 'sent', 'archive', 'trash'] as const
export type EmailFolder = (typeof EMAIL_FOLDERS)[number]

export const FOLDER_LABEL: Record<EmailFolder, string> = {
  inbox: 'Inbox',
  sent: 'Sent',
  archive: 'Archive',
  trash: 'Trash',
}

export type FolderAction = 'archive' | 'trash' | 'restore'

/**
 * Where a message lands after a folder action, and what an undo puts back.
 *
 * Restore is the only one that has to think: a sent message restored from
 * Trash belongs in Sent, not in Inbox. Every transition is reversible by
 * writing the previous folder back, which is exactly what the 6-second undo
 * does (I-12).
 */
export function folderAfter(
  action: FolderAction,
  current: EmailFolder,
  direction: 'in' | 'out',
): EmailFolder {
  if (action === 'trash') return 'trash'
  if (action === 'archive') return 'archive'
  return direction === 'out' ? 'sent' : 'inbox'
}

/** The actions worth offering on a message sitting in `folder`. */
export function actionsFor(folder: EmailFolder): FolderAction[] {
  if (folder === 'trash') return ['restore']
  if (folder === 'archive') return ['restore', 'trash']
  return ['archive', 'trash']
}

export const FOLDER_ACTION_LABEL: Record<FolderAction, string> = {
  archive: 'Archive',
  trash: 'Trash',
  restore: 'Restore',
}

/* ---------------------------------------------------------------- snippets */

export const SNIPPET_LENGTH = 200

/** One line of preview text: collapsed whitespace, cut on a word boundary. */
export function snippetOf(body: string | null | undefined, length = SNIPPET_LENGTH): string {
  const value = (body ?? '').replace(/\s+/g, ' ').trim()
  if (value.length <= length) return value
  const cut = value.slice(0, length)
  const space = cut.lastIndexOf(' ')
  return `${(space > length * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/**
 * The timeline summary when an email is logged as an interaction (I-5: contact
 * + summary are the only required fields). Subject first so the timeline reads
 * as a list of subjects, then the opening of the message.
 */
export function timelineSummary(
  subject: string | null | undefined,
  bodyText: string | null | undefined,
): string {
  const head = (subject ?? '').replace(/\s+/g, ' ').trim() || '(no subject)'
  const tail = snippetOf(bodyText, SNIPPET_LENGTH)
  return tail === '' ? head : `${head} — ${tail}`
}

/** Strip tags crudely, for the rare message that arrives as HTML only. */
export function textFromHtml(html: string | null | undefined): string {
  return (html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* ------------------------------------------------------------ inbound parse */

export interface InboundAttachment {
  filename: string
  content_type: string
  /** Base64 payload when the provider inlines it; absent for URL-only. */
  content?: string
  /** Where the provider is hosting it, when it does not inline. */
  url?: string
  size_bytes: number
}

export interface InboundEmail {
  from_addr: string
  to_addrs: string[]
  cc_addrs: string[]
  subject: string
  body_text: string
  body_html: string | null
  /** The provider's own id — the idempotency key. */
  provider_message_id: string | null
  /** The RFC 5322 `Message-ID`. */
  rfc_message_id: string | null
  in_reply_to: string | null
  occurred_at: string | null
  attachments: InboundAttachment[]
  /** Which shape we recognised — echoed in the webhook response for setup. */
  shape: 'resend' | 'generic'
}

type Unknown = Record<string, unknown>

const asObject = (value: unknown): Unknown | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Unknown) : null

const asString = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/**
 * Addresses arrive as a string, an array of strings, `{name,email}` objects,
 * or a comma-joined string. All four collapse to a list of raw header values.
 */
function addressList(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return value.flatMap((entry) => addressList(entry))

  const object = asObject(value)
  if (object) {
    const address = asString(object.email ?? object.address ?? object.addr)
    if (address === '') return []
    const name = asString(object.name)
    return [name === '' ? address : `${name} <${address}>`]
  }

  const text = asString(value).trim()
  if (text === '') return []
  // A single header line may carry several addresses. Split on commas that are
  // not inside a quoted display name.
  return text
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/** Headers arrive as `{name,value}[]` (Resend) or as a plain object. */
function headerValue(headers: unknown, wanted: string): string {
  const target = wanted.toLowerCase()
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      const object = asObject(entry)
      if (!object) continue
      if (asString(object.name).toLowerCase() === target) return asString(object.value).trim()
    }
    return ''
  }
  const object = asObject(headers)
  if (!object) return ''
  for (const [key, value] of Object.entries(object)) {
    if (key.toLowerCase() === target) return asString(value).trim()
  }
  return ''
}

function attachmentsFrom(value: unknown): InboundAttachment[] {
  if (!Array.isArray(value)) return []
  const out: InboundAttachment[] = []
  for (const entry of value) {
    const object = asObject(entry)
    if (!object) continue
    const filename = asString(object.filename ?? object.name ?? object.file_name).trim() || 'attachment'
    const contentType =
      asString(object.content_type ?? object.contentType ?? object.type).trim() || 'application/octet-stream'
    const content = asString(object.content ?? object.data ?? object.base64).trim()
    const url = asString(object.url ?? object.download_url ?? object.href).trim()
    const declared = Number(object.size ?? object.size_bytes ?? object.content_length)
    // Base64 is 4 characters per 3 bytes; close enough to enforce a size cap on.
    const derived = content === '' ? 0 : Math.floor((content.replace(/=+$/, '').length * 3) / 4)
    const attachment: InboundAttachment = {
      filename,
      content_type: contentType,
      size_bytes: Number.isFinite(declared) && declared > 0 ? declared : derived,
    }
    if (content !== '') attachment.content = content
    if (url !== '') attachment.url = url
    out.push(attachment)
  }
  return out
}

/**
 * Parse an inbound webhook body.
 *
 * **Primary shape: Resend inbound** — `{ type: 'email.received', data: { from,
 * to, cc, subject, text, html, headers, attachments, email_id } }`. Resend
 * nests the message under `data` and sends headers as a `{name,value}` list.
 *
 * **Documented generic fallback** — the same fields at the top level, with the
 * aliases any hand-rolled forwarder is likely to use:
 *
 * ```json
 * { "from": "donor@example.com", "to": ["inbox@yeshiva.org"], "cc": [],
 *   "subject": "Re: the dinner", "text": "…", "html": "…",
 *   "message_id": "<abc@mail>", "in_reply_to": "<xyz@mail>",
 *   "attachments": [{ "filename": "pledge.pdf", "content_type":
 *     "application/pdf", "content": "<base64>" }] }
 * ```
 *
 * Returns `null` when the body carries no sender at all — the one thing a
 * message cannot be filed without. Everything else degrades: no subject is
 * `(no subject)`, no text falls back to the stripped HTML, no ids means the
 * message simply is not de-duplicated.
 */
export function parseInboundPayload(payload: unknown): InboundEmail | null {
  const root = asObject(payload)
  if (!root) return null

  const data = asObject(root.data)
  // Resend nests under `data` and stamps `type: 'email.received'`.
  const isResend = data !== null && (asString(root.type).startsWith('email.') || data.from !== undefined)
  const body: Unknown = isResend && data ? data : root

  const from = addressList(body.from ?? body.sender ?? body.from_addr)[0] ?? ''
  if (from.trim() === '') return null

  const headers = body.headers
  const html = asString(body.html ?? body.body_html ?? body.html_body).trim()
  const textRaw = asString(body.text ?? body.body_text ?? body.plain ?? body.text_body).trim()
  const text = textRaw !== '' ? textRaw : textFromHtml(html)

  const rfcMessageId =
    asString(body.message_id ?? body.rfc_message_id ?? body.messageId).trim() ||
    headerValue(headers, 'message-id')
  const inReplyTo =
    asString(body.in_reply_to ?? body.inReplyTo).trim() || headerValue(headers, 'in-reply-to')
  const providerId =
    asString(body.email_id ?? body.id ?? body.provider_message_id ?? root.id).trim() || rfcMessageId

  const occurredAt =
    asString(body.created_at ?? body.date ?? body.received_at ?? root.created_at).trim() || null

  return {
    from_addr: from.trim(),
    to_addrs: addressList(body.to ?? body.to_addrs ?? body.recipient),
    cc_addrs: addressList(body.cc ?? body.cc_addrs),
    subject: asString(body.subject).replace(/\s+/g, ' ').trim(),
    body_text: text,
    body_html: html === '' ? null : html,
    provider_message_id: providerId === '' ? null : providerId,
    rfc_message_id: rfcMessageId === '' ? null : rfcMessageId,
    in_reply_to: inReplyTo === '' ? null : inReplyTo,
    occurred_at: occurredAt,
    attachments: attachmentsFrom(body.attachments),
    shape: isResend ? 'resend' : 'generic',
  }
}

/** Attachments above this never touch storage — they are recorded by name only. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/* -------------------------------------------------------------- compose */

export interface ComposeDraft {
  to: string
  cc: string
  subject: string
  body: string
}

export interface ComposeValidation {
  ok: boolean
  /** Field-keyed messages, in the order a reader meets the fields. */
  errors: Partial<Record<'to' | 'cc' | 'subject' | 'body', string>>
  /** The parsed, de-duplicated recipient lists a send would use. */
  to: string[]
  cc: string[]
}

/** Split a comma/semicolon-separated recipient box into raw address values. */
export function splitAddresses(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/**
 * What Send needs before it is allowed to be pressed (I-10: a human decides,
 * so the human must be told exactly what is missing). Subject may be blank —
 * mail works that way — but a recipient and a body may not.
 */
export function validateCompose(draft: ComposeDraft): ComposeValidation {
  const errors: ComposeValidation['errors'] = {}

  const toRaw = splitAddresses(draft.to)
  const ccRaw = splitAddresses(draft.cc)

  const badTo = toRaw.filter((value) => !isValidAddress(value))
  const badCc = ccRaw.filter((value) => !isValidAddress(value))

  if (toRaw.length === 0) errors.to = 'Add at least one recipient.'
  else if (badTo.length > 0) errors.to = `Not an email address: ${badTo.join(', ')}`

  if (badCc.length > 0) errors.cc = `Not an email address: ${badCc.join(', ')}`

  if ((draft.body ?? '').trim() === '') errors.body = 'Write something before sending.'

  const dedupe = (values: string[]): string[] => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const value of values) {
      const key = normaliseAddress(value)
      if (key === '' || seen.has(key)) continue
      seen.add(key)
      out.push(storedAddress(value))
    }
    return out
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    to: dedupe(toRaw),
    cc: dedupe(ccRaw.filter((value) => isValidAddress(value))),
  }
}

/** `Re: …` / `Fwd: …` without stacking a prefix that is already there. */
export function replySubject(subject: string | null | undefined): string {
  const value = (subject ?? '').trim()
  if (value === '') return 'Re:'
  return /^re\s*(\[\d+\])?\s*:/i.test(value) ? value : `Re: ${value}`
}

export function forwardSubject(subject: string | null | undefined): string {
  const value = (subject ?? '').trim()
  if (value === '') return 'Fwd:'
  return /^fwd?\s*:/i.test(value) ? value : `Fwd: ${value}`
}

/** The quoted original a forward carries into the compose box. */
export function forwardBody(email: {
  from_addr?: string | null
  to_addrs?: string[] | null
  subject?: string | null
  occurred_at?: string | null
  body_text?: string | null
}): string {
  const lines = [
    '',
    '---------- Forwarded message ----------',
    `From: ${email.from_addr ?? ''}`,
    `To: ${(email.to_addrs ?? []).join(', ')}`,
    `Subject: ${email.subject ?? ''}`,
    email.occurred_at ? `Date: ${email.occurred_at}` : '',
    '',
    email.body_text ?? '',
  ]
  return lines.filter((line, index) => line !== '' || index < lines.length - 1).join('\n')
}

/* ------------------------------------------------------------- list shaping */

export interface EmailLike {
  id: string
  folder: string
  direction: 'in' | 'out'
  from_addr: string
  to_addrs: string[] | null
  cc_addrs?: string[] | null
  subject: string | null
  snippet: string | null
  body_text?: string | null
  thread_key: string | null
  contact_id: string | null
  read_at: string | null
  occurred_at: string
}

/** Unread means: inbound, still in the Inbox, never opened. */
export function isUnread(email: Pick<EmailLike, 'direction' | 'folder' | 'read_at'>): boolean {
  return email.direction === 'in' && email.folder === 'inbox' && email.read_at === null
}

export function unreadCount(emails: ReadonlyArray<Pick<EmailLike, 'direction' | 'folder' | 'read_at'>>): number {
  let total = 0
  for (const email of emails) if (isUnread(email)) total += 1
  return total
}

export interface EmailThread<T extends EmailLike = EmailLike> {
  thread_key: string
  /** Oldest first — a conversation reads downwards (04 §2 timeline order). */
  messages: T[]
  /** The message whose subject and time head the row. */
  latest: T
  unread: number
  subject: string
  contact_id: string | null
}

const byOccurredAsc = <T extends EmailLike>(a: T, b: T): number =>
  a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : a.id < b.id ? -1 : 1

/**
 * Group a folder's rows into threads, newest conversation first, each one's
 * messages oldest first. A row with no `thread_key` is its own thread — the
 * trigger fills the column, but a hand-written row must never disappear.
 */
export function groupThreads<T extends EmailLike>(emails: readonly T[]): Array<EmailThread<T>> {
  const buckets = new Map<string, T[]>()
  for (const email of emails) {
    const key = email.thread_key ?? `thread:${email.id}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(email)
    else buckets.set(key, [email])
  }

  const threads: Array<EmailThread<T>> = []
  for (const [thread_key, bucket] of buckets) {
    const messages = [...bucket].sort(byOccurredAsc)
    const latest = messages[messages.length - 1] as T
    threads.push({
      thread_key,
      messages,
      latest,
      unread: unreadCount(messages),
      subject: (messages.find((m) => (m.subject ?? '').trim() !== '')?.subject ?? '').trim(),
      contact_id: messages.find((m) => m.contact_id !== null)?.contact_id ?? null,
    })
  }

  return threads.sort((a, b) =>
    a.latest.occurred_at > b.latest.occurred_at ? -1 : a.latest.occurred_at < b.latest.occurred_at ? 1 : 0,
  )
}

/** The other party on a message, as a raw header value for display. */
export function counterpartLabel(email: Pick<EmailLike, 'direction' | 'from_addr' | 'to_addrs'>): string {
  if (email.direction === 'in') return addressLabel(email.from_addr)
  const first = (email.to_addrs ?? [])[0]
  return first ? addressLabel(first) : '(no recipient)'
}

/* ------------------------------------------------------------- matching */

export interface ContactEmailLike {
  id: string
  email: string | null
}

/**
 * Which contact an address belongs to, comparing normalised on both sides
 * (rule 1). Returns null rather than guessing — an unmatched email sits in the
 * inbox with a "Link to contact" affordance, which is the honest state.
 */
export function matchContactByAddress(
  raw: string | null | undefined,
  contacts: readonly ContactEmailLike[],
): string | null {
  const key = normaliseAddress(raw)
  if (key === '') return null
  for (const contact of contacts) {
    if (normaliseAddress(contact.email) === key) return contact.id
  }
  return null
}

/** How a match was made — stored on the row so the UI can say so. */
export type MatchedBy = 'from_addr' | 'to_addr' | 'manual'
