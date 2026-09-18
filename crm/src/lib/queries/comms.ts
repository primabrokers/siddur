/**
 * Typed data access for the email inbox (10 §3).
 *
 * Rules this file keeps:
 *
 * - **No PostgREST embeds**, like every other query module here: emails and
 *   their contacts are two small reads joined client-side, so nothing depends
 *   on a foreign-key constraint name.
 * - **The database owns the derived columns.** `thread_key`, `contact_id` and
 *   `snippet` are filled by the 011 trigger; nothing in this file writes them
 *   on an insert. The one exception is a *deliberate* link — a human pressing
 *   "Link to contact" — which sets `contact_id` and stamps `matched_by =
 *   'manual'` so the row says a person decided it.
 * - **Every mutation is reversible and returns what its undo needs** (I-12 /
 *   CLAUDE.md rule 4). Folder moves, read/unread and contact links all hand
 *   back the previous values; the 6-second toast lives at the call site.
 * - **Nothing sends from here** except `useSendEmail`, which is called from a
 *   Send button a human pressed (I-10).
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { isConfigured, SUPABASE_URL } from '../env'
import { qk } from './keys'
import { ck } from './commsKeys'
import { selectRows, unique } from './rest'
import {
  groupThreads,
  timelineSummary,
  unreadCount,
  type EmailFolder,
  type EmailThread,
} from '../../features/comms/core'

interface Failed {
  message: string
}

/* ------------------------------------------------------------------ types */

export interface EmailRow {
  id: string
  folder: EmailFolder
  direction: 'in' | 'out'
  from_addr: string
  to_addrs: string[] | null
  cc_addrs: string[] | null
  subject: string | null
  body_text: string | null
  body_html: string | null
  snippet: string | null
  provider_message_id: string | null
  rfc_message_id: string | null
  in_reply_to: string | null
  thread_key: string | null
  contact_id: string | null
  matched_by: 'from_addr' | 'to_addr' | 'manual' | null
  read_at: string | null
  sent_by: string | null
  occurred_at: string
  created_at: string
}

export interface EmailAttachmentRow {
  id: string
  email_id: string
  filename: string
  content_type: string | null
  size_bytes: number | null
  storage_path: string | null
  external_url: string | null
}

/** Just enough of a contact to draw a chip and offer it in the To box. */
export interface EmailContact {
  id: string
  /** Not null in the schema — only `first_name` is ever required (I-5). */
  first_name: string
  last_name: string | null
  organization: string | null
  title: string | null
  email: string | null
}

export interface FolderResult {
  emails: EmailRow[]
  threads: Array<EmailThread<EmailRow>>
  contacts: Record<string, EmailContact>
}

const EMPTY_FOLDER: FolderResult = { emails: [], threads: [], contacts: {} }

/** One screen's worth. The inbox is a working surface, not an archive browser. */
const PAGE = 200

/* ----------------------------------------------------------------- reads */

const contactFields = 'id, first_name, last_name, organization, title, email'

async function contactsFor(ids: string[]): Promise<Record<string, EmailContact>> {
  const wanted = unique(ids)
  if (wanted.length === 0) return {}
  const { data, error } = await supabase.from('contacts').select(contactFields).in('id', wanted)
  if (error) throw new Error((error as Failed).message)
  const map: Record<string, EmailContact> = {}
  for (const row of (data ?? []) as unknown as EmailContact[]) map[row.id] = row
  return map
}

async function fetchFolder(folder: EmailFolder, contactId: string | null): Promise<FolderResult> {
  const emails = await selectRows<EmailRow>('emails', (q) => {
    let query = q.eq('folder', folder)
    if (contactId) query = query.eq('contact_id', contactId)
    return query.order('occurred_at', { ascending: false }).limit(PAGE)
  })
  if (emails.length === 0) return EMPTY_FOLDER

  const contacts = await contactsFor(
    emails.map((row) => row.contact_id).filter((id): id is string => typeof id === 'string'),
  )
  return { emails, threads: groupThreads(emails), contacts }
}

/**
 * One folder's conversations. The `?contact=` scope is a filter on the list,
 * not a separate screen — the profile's "Emails" chip lands here.
 */
export function useEmailFolder(
  folder: EmailFolder,
  contactId: string | null = null,
): UseQueryResult<FolderResult> {
  return useQuery<FolderResult>({
    queryKey: ck.emails.folder(folder, contactId ? { contact: contactId } : undefined),
    enabled: isConfigured,
    queryFn: () => fetchFolder(folder, contactId),
  })
}

export interface ThreadResult {
  messages: EmailRow[]
  contacts: Record<string, EmailContact>
  attachments: Record<string, EmailAttachmentRow[]>
}

const EMPTY_THREAD: ThreadResult = { messages: [], contacts: {}, attachments: {} }

/**
 * A whole conversation, oldest first, across every folder — a reply you
 * archived is still part of the thread you are reading.
 */
async function fetchThread(threadKey: string): Promise<ThreadResult> {
  const messages = await selectRows<EmailRow>('emails', (q) =>
    q.eq('thread_key', threadKey).order('occurred_at', { ascending: true }).limit(PAGE),
  )
  if (messages.length === 0) return EMPTY_THREAD

  const [contacts, attachmentRows] = await Promise.all([
    contactsFor(messages.map((row) => row.contact_id).filter((id): id is string => typeof id === 'string')),
    selectRows<EmailAttachmentRow>('email_attachments', (q) =>
      q.in('email_id', messages.map((row) => row.id)),
    ).catch(() => [] as EmailAttachmentRow[]),
  ])

  const attachments: Record<string, EmailAttachmentRow[]> = {}
  for (const row of attachmentRows) {
    const list = attachments[row.email_id]
    if (list) list.push(row)
    else attachments[row.email_id] = [row]
  }

  return { messages, contacts, attachments }
}

export function useEmailThread(threadKey: string | null): UseQueryResult<ThreadResult> {
  return useQuery<ThreadResult>({
    queryKey: ck.emails.thread(threadKey),
    enabled: isConfigured && Boolean(threadKey),
    queryFn: () => (threadKey ? fetchThread(threadKey) : Promise.resolve(EMPTY_THREAD)),
  })
}

/**
 * The rail badge. A plain row read rather than a `count` head request: the
 * partial index in 011 makes it cheap, and one shape of result is easier to
 * keep honest than two.
 */
export function useUnreadEmailCount(): UseQueryResult<number> {
  return useQuery<number>({
    queryKey: ck.emails.unread(),
    enabled: isConfigured,
    staleTime: 30_000,
    queryFn: async () => {
      const rows = await selectRows<Pick<EmailRow, 'id' | 'direction' | 'folder' | 'read_at'>>(
        'emails',
        (q) => q.eq('folder', 'inbox').eq('direction', 'in').is('read_at', null).limit(500),
      )
      return unreadCount(rows as Array<{ direction: 'in' | 'out'; folder: string; read_at: string | null }>)
    },
  })
}

/** Contacts with an email on file — the To box's autocomplete. */
export function useEmailAddressBook(): UseQueryResult<EmailContact[]> {
  return useQuery<EmailContact[]>({
    queryKey: ck.addressBook.list(),
    enabled: isConfigured,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // No server-side `email is not null` filter on purpose: it would be the
      // one place in this module relying on PostgREST's `not.is` grammar, and
      // at the yeshiva's scale (~10k contacts, 11 §5) one capped, five-minute
      // cached read of six narrow columns is cheaper than the special case.
      const rows = await selectRows<EmailContact>('contacts', (q) =>
        q.eq('is_archived', false).order('last_name', { ascending: true }).limit(1000),
      )
      return rows.filter((row) => (row.email ?? '').trim() !== '')
    },
  })
}

/* ------------------------------------------------------------- the sweep */

/**
 * One invalidation, written once. Every email mutation moves rows between the
 * folder lists, the open thread and the rail badge at the same time, so they
 * all sweep the same prefix.
 */
function useEmailSweep() {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: ck.emails.all })
  }
}

/* --------------------------------------------------------------- folders */

/** What a folder move has to remember to be undoable. */
export interface FolderMove {
  id: string
  folder: EmailFolder
}

async function applyFolders(moves: FolderMove[]): Promise<void> {
  // Grouped by destination so a thread of nine messages is one request, not
  // nine. The undo takes the same path with the previous folders.
  const byFolder = new Map<EmailFolder, string[]>()
  for (const move of moves) {
    const bucket = byFolder.get(move.folder)
    if (bucket) bucket.push(move.id)
    else byFolder.set(move.folder, [move.id])
  }
  for (const [folder, ids] of byFolder) {
    const { error } = await supabase.from('emails').update({ folder }).in('id', ids)
    if (error) throw new Error((error as Failed).message)
  }
}

/**
 * Archive / Trash / Restore. No confirm dialog — a folder move is a single
 * reversible record change, so it gets the 6-second undo like everything else
 * (I-12). Deleting for real is admin-only and lives in the database (11 §1).
 */
export function useMoveEmails() {
  const sweep = useEmailSweep()
  return useMutation<void, Error, { moves: FolderMove[] }>({
    mutationFn: ({ moves }) => applyFolders(moves),
    onSettled: sweep,
  })
}

/* ------------------------------------------------------------ read state */

export interface ReadChange {
  id: string
  read_at: string | null
}

async function applyRead(changes: ReadChange[]): Promise<void> {
  const read = changes.filter((change) => change.read_at !== null)
  const unread = changes.filter((change) => change.read_at === null)
  if (unread.length > 0) {
    const { error } = await supabase
      .from('emails')
      .update({ read_at: null })
      .in('id', unread.map((change) => change.id))
    if (error) throw new Error((error as Failed).message)
  }
  for (const change of read) {
    const { error } = await supabase
      .from('emails')
      .update({ read_at: change.read_at })
      .eq('id', change.id)
    if (error) throw new Error((error as Failed).message)
  }
}

/**
 * Mark read (on open) or unread (explicitly). Opening a thread marks it read
 * *without* a toast — an undo prompt for something the reader did by looking
 * would be noise; the explicit "Mark unread" is the affordance that matters.
 */
export function useSetEmailRead() {
  const sweep = useEmailSweep()
  return useMutation<void, Error, { changes: ReadChange[] }>({
    mutationFn: ({ changes }) => applyRead(changes),
    onSettled: sweep,
  })
}

/* --------------------------------------------------------- contact links */

/** The previous `contact_id`/`matched_by` of one row, so undo is exact. */
export interface ContactLink {
  id: string
  contact_id: string | null
  matched_by: 'from_addr' | 'to_addr' | 'manual' | null
}

/**
 * Link a whole thread to a contact (or unlink it). Stamped `matched_by =
 * 'manual'` so the row records that a person decided this, not the matcher —
 * which is what lets the UI say "linked by hand" instead of implying the
 * address matched.
 */
export function useLinkEmailsToContact() {
  const sweep = useEmailSweep()
  const client = useQueryClient()
  return useMutation<void, Error, { ids: string[]; contactId: string | null }>({
    mutationFn: async ({ ids, contactId }) => {
      if (ids.length === 0) return
      const { error } = await supabase
        .from('emails')
        .update({ contact_id: contactId, matched_by: contactId ? 'manual' : null })
        .in('id', ids)
      if (error) throw new Error((error as Failed).message)
    },
    onSettled: () => {
      sweep()
      // A linked thread changes what the profile shows.
      void client.invalidateQueries({ queryKey: qk.contacts.all })
    },
  })
}

/** Undo for the above: put each row's previous link back, exactly. */
export function useRestoreEmailLinks() {
  const sweep = useEmailSweep()
  const client = useQueryClient()
  return useMutation<void, Error, { links: ContactLink[] }>({
    mutationFn: async ({ links }) => {
      for (const link of links) {
        const { error } = await supabase
          .from('emails')
          .update({ contact_id: link.contact_id, matched_by: link.matched_by })
          .eq('id', link.id)
        if (error) throw new Error((error as Failed).message)
      }
    },
    onSettled: () => {
      sweep()
      void client.invalidateQueries({ queryKey: qk.contacts.all })
    },
  })
}

/* ------------------------------------------------------- log to timeline */

export interface LogEmailVariables {
  email: Pick<EmailRow, 'id' | 'subject' | 'body_text' | 'occurred_at' | 'direction'>
  /** Required — I-2/I-5: an interaction without a contact cannot exist. */
  contactId: string
  teamMemberId: string | null
}

/**
 * Turn a message into a timeline interaction (10 §1: "every integration writes
 * through the same records — no shadow inboxes"). `source = 'email_ingest'`
 * marks where it came from; the summary is the subject plus the opening of the
 * message, which is what a fundraiser scanning the timeline actually needs.
 */
export function useLogEmailToTimeline() {
  const client = useQueryClient()
  return useMutation<{ id: string }, Error, LogEmailVariables>({
    mutationFn: async ({ email, contactId, teamMemberId }) => {
      const { data, error } = await supabase
        .from('interactions')
        .insert({
          contact_id: contactId,
          occurred_at: email.occurred_at,
          kind: 'email',
          status: 'logged',
          source: 'email_ingest',
          summary: timelineSummary(email.subject, email.body_text),
          team_member_id: teamMemberId,
          created_by: teamMemberId,
        })
        .select('id')
        .single()
      if (error) throw new Error((error as Failed).message)
      return data as unknown as { id: string }
    },
    onSettled: (_data, _error, variables) => {
      // An interaction moves last-contact, the flag and every derived number
      // hanging off it (I-8/I-9), so the whole contacts prefix goes.
      void client.invalidateQueries({ queryKey: qk.contacts.all })
      void client.invalidateQueries({ queryKey: qk.interactions.all })
      void client.invalidateQueries({ queryKey: qk.contacts.timeline(variables.contactId) })
    },
  })
}

/** Undo for the above — the interaction is removed, not marked cancelled. */
export function useUnlogEmailInteraction() {
  const client = useQueryClient()
  return useMutation<void, Error, { interactionId: string; contactId: string }>({
    mutationFn: async ({ interactionId }) => {
      const { error } = await supabase.from('interactions').delete().eq('id', interactionId)
      if (error) throw new Error((error as Failed).message)
    },
    onSettled: (_data, _error, variables) => {
      void client.invalidateQueries({ queryKey: qk.contacts.all })
      void client.invalidateQueries({ queryKey: qk.interactions.all })
      void client.invalidateQueries({ queryKey: qk.contacts.timeline(variables.contactId) })
    },
  })
}

/* -------------------------------------------------------------- sending */

export type EmailFailure = 'unconfigured' | 'invalid' | 'failed'

export class EmailSendError extends Error {
  failure: EmailFailure
  constructor(failure: EmailFailure, message: string) {
    super(message)
    this.failure = failure
    this.name = 'EmailSendError'
  }
}

/** The one line the UI shows for each failure. Plain, never a stack trace. */
export const EMAIL_NOTICE: Record<EmailFailure, string> = {
  unconfigured:
    'Email sending is not set up yet. An admin needs to add the mail provider keys before anything can go out.',
  invalid: 'That draft is not ready to send.',
  failed: 'The mail provider could not be reached. Nothing was sent — try again.',
}

export interface SendEmailVariables {
  to: string[]
  cc: string[]
  subject: string
  body_text: string
  in_reply_to_email_id?: string | null
}

export interface SendEmailResult {
  sent: boolean
  recorded: boolean
  id: string | null
  thread_key: string | null
  contact_id: string | null
}

/**
 * Send (I-10: a human pressed a button; this function is never called by a
 * timer, a rule or an AI path). The edge function holds the provider key and
 * writes the Sent row as the caller, so RLS decides whether they may.
 */
export function useSendEmail() {
  const sweep = useEmailSweep()
  return useMutation<SendEmailResult, EmailSendError, SendEmailVariables>({
    mutationFn: async (variables) => {
      const { data, error } = await supabase.functions.invoke('email-send', { body: variables })
      if (error) {
        const status = (error as { context?: { status?: number } }).context?.status ?? 0
        const message = (error as Failed).message ?? ''
        if (status === 503 || message.includes('email_unconfigured')) {
          throw new EmailSendError('unconfigured', EMAIL_NOTICE.unconfigured)
        }
        if (status === 400) throw new EmailSendError('invalid', EMAIL_NOTICE.invalid)
        throw new EmailSendError('failed', message || EMAIL_NOTICE.failed)
      }
      const result = data as { error?: string } & SendEmailResult
      if (result?.error === 'email_unconfigured') {
        throw new EmailSendError('unconfigured', EMAIL_NOTICE.unconfigured)
      }
      return result
    },
    onSettled: sweep,
  })
}

/* ---------------------------------------------------------------- setup */

export interface EmailSetupStatus {
  /** Outbound: RESEND_API_KEY + EMAIL_FROM are both set on the project. */
  sendConfigured: boolean
  /** The address outbound mail will come from, when it is set. */
  from: string | null
  /** Inbound: EMAIL_INBOUND_SECRET is set (the webhook answers 404, not 503). */
  inboundConfigured: boolean
  /** True when the inbound function is not deployed at all. */
  inboundMissing: boolean
}

/** `…/functions/v1/email-inbound` — the URL the provider posts to. */
export const emailInboundUrl = (secretPlaceholder = 'YOUR_SECRET'): string =>
  `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/email-inbound?secret=${secretPlaceholder}`

/**
 * What Settings shows.
 *
 * Neither secret is ever readable from the browser (the same rule the AI tab
 * states), so this asks the functions themselves:
 *
 * - `email-send` has an explicit status mode — it answers what is set without
 *   sending anything.
 * - `email-inbound` needs no status mode: with no secret configured it answers
 *   **503**, and with one configured it answers **404** to a caller that has
 *   not got it. Those two are exactly the question being asked, and neither
 *   reveals the secret.
 */
export function useEmailSetupStatus(): UseQueryResult<EmailSetupStatus> {
  return useQuery<EmailSetupStatus>({
    queryKey: ck.setup.status(),
    enabled: isConfigured,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const status: EmailSetupStatus = {
        sendConfigured: false,
        from: null,
        inboundConfigured: false,
        inboundMissing: false,
      }

      const probe = await supabase.functions.invoke('email-send', { body: { status: true } })
      const data = probe.data as { configured?: boolean; from?: string | null } | null
      if (data && typeof data.configured === 'boolean') {
        status.sendConfigured = data.configured
        status.from = data.from ?? null
      }

      try {
        const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/email-inbound`, {
          method: 'GET',
        })
        // 404 = the secret is set and ours is not it (as expected from a browser).
        // 503 = no secret configured. 404 is the healthy answer here.
        status.inboundConfigured = response.status === 404
        status.inboundMissing = response.status !== 404 && response.status !== 503
      } catch {
        status.inboundMissing = true
      }

      return status
    },
  })
}
