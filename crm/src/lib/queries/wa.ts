/**
 * Typed data access for the WhatsApp channel (10 §2 Tier 2).
 *
 * Rules this file keeps:
 *
 * - **The browser never holds a Meta credential.** Sending goes through
 *   `functions.invoke('wa-send')`; the access token, the phone number id, the
 *   verify token and the app secret are Supabase secrets read only by the two
 *   edge functions.
 * - **Unconfigured is a state, not an error.** A 503 `wa_unconfigured` resolves
 *   to the setup card, and Tier 1 (the wa.me deep link + Quick Capture) is the
 *   product's normal state throughout — it covers ~90% of the need (10 §2).
 * - **The window is never cached as a boolean.** Conversations carry
 *   `last_inbound_at`; `windowState()` derives openness at render time (I-9).
 *   The server re-derives it again inside `wa-send`, which is the check that
 *   actually binds.
 * - **Humans send** (I-10). There is no mutation here that fires without a
 *   person pressing something, and none that any automation can reach.
 * - No PostgREST embeds: contacts are fetched by id and joined client-side,
 *   the same rule as `queries/contacts.ts`.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { supabase } from '../supabase'
import { isConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from '../env'
import { wak } from './waKeys'
import { qk } from './keys'
import { selectRows, unique } from './rest'
import { windowState } from '../../features/whatsapp/core'
import type {
  WaConfigStatus,
  WaConversationItem,
  WaConversationRow,
  WaMessageRow,
  WaTemplateRow,
} from '../../features/whatsapp/types'
import type { ContactRow } from '../../features/contacts/types'

interface Failed {
  message: string
}

/** The list is worked from the top; the tail is not navigation. */
const CONVERSATION_LIMIT = 200
/** A thread long enough to read, short enough to render at once. */
const THREAD_LIMIT = 400

/* ------------------------------------------------------------- the transport */

/** Why an outbound call did not go through. `null` means it did. */
export type WaFailure = 'unconfigured' | 'window_closed' | 'forbidden' | 'offline' | 'error'

export class WaCallError extends Error {
  readonly failure: WaFailure
  constructor(failure: WaFailure, message: string) {
    super(message)
    this.name = 'WaCallError'
    this.failure = failure
  }
}

export const WA_NOTICE: Record<WaFailure, string> = {
  unconfigured:
    'WhatsApp Business is not connected yet. The wa.me link on the profile still works — log what you send with Quick Capture.',
  window_closed:
    'The 24-hour customer-service window has closed. Send an approved template instead.',
  forbidden: 'Only admins and fundraisers send messages.',
  offline: 'No connection. Nothing was sent.',
  error: 'WhatsApp could not be reached. Nothing was sent.',
}

async function classify(error: unknown, response?: Response): Promise<{ failure: WaFailure; message: string }> {
  const context = (error as { context?: unknown })?.context
  const asResponse =
    response ?? (context && typeof (context as Response).status === 'number' ? (context as Response) : undefined)

  if (asResponse) {
    let body: { error?: string; message?: string } = {}
    try {
      body = await asResponse.clone().json()
    } catch {
      /* not JSON — status alone decides */
    }
    if (asResponse.status === 503 || body.error === 'wa_unconfigured') {
      return { failure: 'unconfigured', message: body.message ?? WA_NOTICE.unconfigured }
    }
    if (asResponse.status === 409 || body.error === 'window_closed') {
      return { failure: 'window_closed', message: body.message ?? WA_NOTICE.window_closed }
    }
    if (asResponse.status === 403) return { failure: 'forbidden', message: body.message ?? WA_NOTICE.forbidden }
    return { failure: 'error', message: body.message ?? WA_NOTICE.error }
  }

  const name = (error as { name?: string })?.name ?? ''
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase()
  if (name === 'FunctionsFetchError' || message.includes('failed to fetch') || message.includes('fetch failed')) {
    return { failure: 'offline', message: WA_NOTICE.offline }
  }
  if (message.includes('wa_unconfigured')) return { failure: 'unconfigured', message: WA_NOTICE.unconfigured }
  if (message.includes('window_closed')) return { failure: 'window_closed', message: WA_NOTICE.window_closed }
  return { failure: 'error', message: WA_NOTICE.error }
}

async function invokeWa<T>(body: Record<string, unknown>): Promise<T> {
  try {
    const result = await supabase.functions.invoke<T>('wa-send', { body })
    if (result.error) {
      const { failure, message } = await classify(result.error, result.response)
      throw new WaCallError(failure, message)
    }
    if (!result.data) throw new WaCallError('error', 'The function returned nothing.')
    return result.data
  } catch (caught) {
    if (caught instanceof WaCallError) throw caught
    const { failure, message } = await classify(caught)
    throw new WaCallError(failure, message)
  }
}

/* --------------------------------------------------------- the conversations */

const snippetOf = (message: WaMessageRow | undefined): string => {
  if (!message) return 'No messages yet'
  if (message.msg_type === 'template') return message.template_name ? `Template · ${message.template_name}` : 'Template'
  const body = (message.body ?? '').replace(/\s+/g, ' ').trim()
  if (body !== '') return body
  return message.msg_type === 'media' ? 'Attachment' : 'Message'
}

async function fetchConversations(): Promise<WaConversationItem[]> {
  const conversations = await selectRows<WaConversationRow>('wa_conversations', (q) =>
    q.order('last_message_at', { ascending: false, nullsFirst: false }).limit(CONVERSATION_LIMIT),
  )
  if (conversations.length === 0) return []

  const contactIds = unique(
    conversations.map((row) => row.contact_id).filter((id): id is string => typeof id === 'string' && id !== ''),
  )
  const [contacts, latest] = await Promise.all([
    contactIds.length === 0
      ? Promise.resolve<ContactRow[]>([])
      : selectRows<ContactRow>('contacts', (q) => q.in('id', contactIds)),
    // One read for the snippets: the most recent messages across all threads,
    // reduced client-side. Cheaper than a per-thread query and honest about
    // the cap — a thread whose last message falls outside it shows its
    // conversation timestamp instead of a stale line.
    selectRows<WaMessageRow>('wa_messages', (q) =>
      q.order('occurred_at', { ascending: false }).limit(CONVERSATION_LIMIT * 2),
    ),
  ])

  const byId: Record<string, ContactRow> = {}
  for (const contact of contacts) byId[contact.id] = contact

  const lastByConversation: Record<string, WaMessageRow> = {}
  for (const message of latest) {
    if (!lastByConversation[message.conversation_id]) lastByConversation[message.conversation_id] = message
  }

  const now = Date.now()
  return conversations.map((conversation) => ({
    conversation,
    contact: conversation.contact_id ? (byId[conversation.contact_id] ?? null) : null,
    window: windowState(conversation.last_inbound_at, now),
    snippet: snippetOf(lastByConversation[conversation.id]),
    at: conversation.last_message_at ?? conversation.last_inbound_at ?? conversation.created_at ?? null,
  }))
}

export function useWaConversations(): UseQueryResult<WaConversationItem[]> {
  return useQuery<WaConversationItem[]>({
    queryKey: wak.wa.conversations(),
    enabled: isConfigured,
    // Inbound arrives by webhook, not by anything this tab did, so the list is
    // kept short-lived rather than pinned.
    staleTime: 15_000,
    refetchInterval: 60_000,
    queryFn: fetchConversations,
  })
}

/** The rail badge: unread conversations, not unread messages. */
export function useWaUnreadCount(): number | undefined {
  const { data } = useWaConversations()
  if (!data) return undefined
  return data.filter((item) => item.conversation.unread_count > 0).length
}

export function useWaThread(conversationId: string | null): UseQueryResult<WaMessageRow[]> {
  return useQuery<WaMessageRow[]>({
    queryKey: wak.wa.thread(conversationId ?? 'none'),
    enabled: isConfigured && Boolean(conversationId),
    staleTime: 10_000,
    refetchInterval: 30_000,
    queryFn: async () =>
      selectRows<WaMessageRow>('wa_messages', (q) =>
        q.eq('conversation_id', conversationId).order('occurred_at', { ascending: true }).limit(THREAD_LIMIT),
      ),
  })
}

/**
 * The one conversation belonging to a donor, if there is one.
 *
 * Used by the profile's action bar to offer the in-app thread *beside* the
 * wa.me link rather than instead of it: Tier 1 is not deprecated by Tier 2,
 * and a fundraiser who prefers their phone should keep getting their phone
 * (10 §2). One tiny read, no contact join — the profile already has the donor.
 */
export function useWaConversationForContact(contactId: string | null | undefined) {
  return useQuery<WaConversationRow | null>({
    queryKey: [...wak.wa.all, 'for-contact', contactId ?? 'none'],
    enabled: isConfigured && Boolean(contactId),
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const rows = await selectRows<WaConversationRow>('wa_conversations', (q) =>
        q.eq('contact_id', contactId).limit(1),
      )
      return rows[0] ?? null
    },
  })
}

export function useWaTemplates(): UseQueryResult<WaTemplateRow[]> {
  return useQuery<WaTemplateRow[]>({
    queryKey: wak.wa.templates(),
    enabled: isConfigured,
    staleTime: 5 * 60_000,
    queryFn: async () => selectRows<WaTemplateRow>('wa_templates', (q) => q.order('name', { ascending: true })),
  })
}

/* -------------------------------------------------------------- the mutations */

const fail = (error: unknown): never => {
  throw new Error((error as Failed)?.message ?? 'Write failed')
}

/**
 * Opening a conversation clears its unread badge. Fire-and-forget by design
 * (I-12): the badge disappears on the optimistic cache write, and a failed
 * PATCH simply means it comes back on the next refetch — nothing is lost.
 */
export function useMarkWaConversationRead() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase
        .from('wa_conversations')
        .update({ unread_count: 0 })
        .eq('id', conversationId)
        .gt('unread_count', 0)
      if (error) fail(error)
      return conversationId
    },
    onMutate: async (conversationId: string) => {
      client.setQueryData<WaConversationItem[]>(wak.wa.conversations(), (previous) =>
        (previous ?? []).map((item) =>
          item.conversation.id === conversationId
            ? { ...item, conversation: { ...item.conversation, unread_count: 0 } }
            : item,
        ),
      )
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: wak.wa.conversations() })
    },
  })
}

/** "Link to contact" — the human's correction of an unmatched number. */
export function useLinkWaConversation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ conversationId, contactId }: { conversationId: string; contactId: string }) => {
      const { error } = await supabase
        .from('wa_conversations')
        .update({ contact_id: contactId, matched_by: 'manual' })
        .eq('id', conversationId)
      if (error) fail(error)
      return { conversationId, contactId }
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: wak.wa.all })
      void client.invalidateQueries({ queryKey: qk.contacts.all })
    },
  })
}

export interface SendWaInput {
  conversationId?: string | null
  toWaId?: string | null
  /** Free-form — permitted only inside the 24-hour window, server-enforced. */
  body?: string
  /** Approved template — permitted always. */
  templateName?: string
  language?: string
  params?: string[]
}

/**
 * The send. A person pressed a button; nothing else can reach this (I-10).
 *
 * Not optimistic: an outbound row is written by the edge function *after* Meta
 * accepts the message, so the bubble that appears is a message that exists.
 * A hopeful bubble that turns out never to have been sent is worse than a
 * half-second wait.
 */
export function useSendWaMessage() {
  const client = useQueryClient()
  return useMutation<{ conversation_id?: string; wa_message_id?: string | null }, WaCallError, SendWaInput>({
    mutationFn: async (input: SendWaInput) =>
      invokeWa({
        conversation_id: input.conversationId ?? undefined,
        to_wa_id: input.toWaId ?? undefined,
        body: input.body,
        template_name: input.templateName,
        language: input.language,
        params: input.params,
      }),
    onSuccess: (_result, input) => {
      void client.invalidateQueries({ queryKey: wak.wa.conversations() })
      if (input.conversationId) {
        void client.invalidateQueries({ queryKey: wak.wa.thread(input.conversationId) })
      }
    },
  })
}

export interface LogWaInput {
  contactId: string
  summary: string
  occurredAt: string
}

/**
 * "Log to timeline" — the durable value of a WhatsApp thread (10 §2: the
 * summary and the next action, not the transcript).
 *
 * `kind: 'whatsapp'`, `source: 'manual'`: a human wrote this sentence, even
 * though a machine offered the first draft of it from the last few messages.
 */
export function useLogWaToTimeline() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: LogWaInput) => {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData?.user?.id ?? null
      const { data, error } = await supabase
        .from('interactions')
        .insert({
          contact_id: input.contactId,
          occurred_at: input.occurredAt,
          kind: 'whatsapp',
          status: 'logged',
          summary: input.summary,
          source: 'manual',
          team_member_id: userId,
          created_by: userId,
        })
        .select('id')
        .single()
      if (error) fail(error)
      return data as { id: string }
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.interactions.all })
      void client.invalidateQueries({ queryKey: qk.contacts.all })
      void client.invalidateQueries({ queryKey: wak.wa.all })
    },
  })
}

/* ------------------------------------------------------------- configuration */

const functionsBase = (): string => `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1`

/** The URL the Meta app config wants in "Callback URL". */
export const waCallbackUrl = (): string => `${functionsBase()}/wa-webhook`

/**
 * Probe the four secrets rather than read them — the browser cannot see a
 * Supabase secret, and a screen that claimed otherwise would be lying.
 *
 * Each answer is the deployed function's own behaviour:
 *   GET  wa-webhook with no params → 503 = WA_VERIFY_TOKEN unset, 403 = set
 *   POST wa-webhook unsigned       → 503 = WA_APP_SECRET unset,  401 = set
 *   wa-send {action:'status'}      → 503 = token/phone id unset, 200 = set
 *
 * The webhook probes are deliberately unauthenticated `fetch` calls, because
 * that is exactly how Meta will reach it.
 */
export function useWaConfig(): UseQueryResult<WaConfigStatus> {
  return useQuery<WaConfigStatus>({
    queryKey: wak.wa.config(),
    enabled: isConfigured,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const callbackUrl = waCallbackUrl()
      const status: WaConfigStatus = {
        sendConfigured: false,
        verifyTokenSet: false,
        appSecretSet: false,
        templatesSyncable: false,
        callbackUrl,
        probeError: null,
      }

      try {
        const [handshake, unsigned] = await Promise.all([
          fetch(callbackUrl, { method: 'GET' }),
          fetch(callbackUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          }),
        ])
        status.verifyTokenSet = handshake.status !== 503
        status.appSecretSet = unsigned.status !== 503
      } catch (caught) {
        status.probeError = caught instanceof Error ? caught.message : 'The webhook could not be reached.'
      }

      try {
        const result = await invokeWa<{ configured?: boolean; templates_syncable?: boolean }>({ action: 'status' })
        status.sendConfigured = result.configured === true
        status.templatesSyncable = result.templates_syncable === true
      } catch (caught) {
        if (!(caught instanceof WaCallError) || caught.failure === 'offline') {
          status.probeError = status.probeError ?? (caught instanceof Error ? caught.message : 'unreachable')
        }
      }

      return status
    },
  })
}

/**
 * "Sync templates" — a Graph `GET /<WABA_ID>/message_templates`, run by the
 * edge function so the token stays server-side. Approval itself happens in
 * Meta Business Manager; this only mirrors the catalogue.
 */
export function useSyncWaTemplates() {
  const client = useQueryClient()
  return useMutation<{ synced?: number }, WaCallError, void>({
    mutationFn: async () => invokeWa({ action: 'sync_templates' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: wak.wa.templates() })
    },
  })
}

/** Exported for the Settings card's instructions block. */
export const WA_ANON_KEY_HINT = SUPABASE_ANON_KEY.slice(0, 12)
