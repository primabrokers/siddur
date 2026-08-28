/**
 * Data access for the M9a AI surfaces (09 §3–§5).
 *
 * Rules this file keeps:
 * - **The browser never talks to the model.** Every call goes through
 *   `functions.invoke(...)`; the key is a Supabase secret (09 §1).
 * - **Unavailable is a state, not an error.** A 503 `ai_unconfigured`, an
 *   offline browser or a switched-off feature all resolve to the same quiet
 *   outcome: the surface hides itself and the manual path (read the timeline,
 *   write the message) is the whole product, as it was before AI existed
 *   (CLAUDE.md rule 6).
 * - **Every human verdict is logged.** `useResolveAiActivity` PATCHes the
 *   `ai_activity_log` row the edge function opened as `pending` to
 *   accepted / edited / rejected (09 §1.5) — that ratio is the tuning alarm
 *   Settings shows.
 * - Nothing here recomputes a rollup; the brief's numbers were computed by
 *   `contact_stats` before the model ever saw them (I-8/I-9).
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { isConfigured } from '../env'
import { aik } from './aiKeys'
import { qk } from './keys'
import { readAiFeatures, useAutomationRules, AI_FEATURES_KEY } from './settings'
import type {
  AiLabelEvent,
  BriefResponse,
  DraftPurpose,
  DraftResult,
} from '../../features/ai/core'
import { resolutionFor } from '../../features/ai/core'

interface Failed {
  message: string
}

/** Why an AI surface is not available right now. `null` means it is. */
export type AiUnavailable = 'unconfigured' | 'offline' | 'error' | 'refused' | 'disabled'

export class AiCallError extends Error {
  readonly failure: AiUnavailable
  constructor(failure: AiUnavailable, message: string) {
    super(message)
    this.name = 'AiCallError'
    this.failure = failure
  }
}

/** Past this the fundraiser is better served by the screen they already have. */
export const AI_TIMEOUT_MS = 30_000

/* --------------------------------------------------------- feature switches */

/**
 * 06 §4 / 09 §1: each feature is independently switchable and a missing row
 * means **on** — that is how the app shipped, and an absent settings row must
 * not silently disable the product.
 */
export function useAiFeature(key: 'daily_brief' | 'drafting' | 'digest_narrative' | 'quick_capture_parse'): boolean {
  const rules = useAutomationRules()
  const stored = readAiFeatures(rules.data)
  const hasRow = (rules.data ?? []).some((rule) => rule.rule_key === AI_FEATURES_KEY)
  return hasRow && key in stored ? stored[key] === true : true
}

/* ------------------------------------------------------------- the transport */

/** Read the function's status from whichever shape supabase-js hands back. */
async function classify(error: unknown, response?: Response): Promise<AiUnavailable> {
  const context = (error as { context?: unknown })?.context
  const asResponse =
    response ?? (context && typeof (context as Response).status === 'number' ? (context as Response) : undefined)

  if (asResponse) {
    if (asResponse.status === 503) return 'unconfigured'
    if (asResponse.status === 422) return 'refused'
    try {
      const body = await asResponse.clone().json()
      if (body?.error === 'ai_unconfigured') return 'unconfigured'
      if (body?.error === 'ai_refused') return 'refused'
    } catch {
      /* not JSON — fall through */
    }
    return 'error'
  }

  const name = (error as { name?: string })?.name ?? ''
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase()
  if (name === 'FunctionsFetchError' || message.includes('failed to fetch') || message.includes('fetch failed')) {
    return 'offline'
  }
  if (message.includes('ai_unconfigured')) return 'unconfigured'
  return 'error'
}

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new AiCallError('error', 'The request timed out.')), AI_TIMEOUT_MS)
  })

  try {
    const result = await Promise.race([supabase.functions.invoke<T>(name, { body }), timeout])
    if (result.error) {
      throw new AiCallError(await classify(result.error, result.response), (result.error as Failed).message ?? 'Failed')
    }
    if (!result.data) throw new AiCallError('error', 'The function returned nothing.')
    return result.data
  } catch (caught) {
    if (caught instanceof AiCallError) throw caught
    throw new AiCallError(await classify(caught), caught instanceof Error ? caught.message : 'Failed')
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------- brief */

export interface BriefOptions {
  contactId: string | undefined
  /** The button, not the page load: a brief costs money, so it is opt-in (09 §3). */
  enabled: boolean
}

/**
 * "Brief me" (04 §5.8). Fetched only once the fundraiser asks — `enabled` is
 * the button press — and then held by TanStack Query for the session while the
 * *server* holds the real cache, invalidated by a database trigger when a new
 * interaction lands.
 */
export function useDonorBrief({ contactId, enabled }: BriefOptions): UseQueryResult<BriefResponse, AiCallError> {
  return useQuery<BriefResponse, AiCallError>({
    queryKey: aik.ai.brief(contactId ?? 'none'),
    enabled: isConfigured && enabled && Boolean(contactId),
    retry: false,
    // The server cache is authoritative; this one only stops a re-render from
    // paying twice.
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    queryFn: () => invoke<BriefResponse>('donor-brief', { contact_id: contactId }),
  })
}

/** The regenerate button (09 §3): a fresh run, cache bypassed on both sides. */
export function useRegenerateBrief() {
  const client = useQueryClient()
  return useMutation<BriefResponse, AiCallError, { contactId: string }>({
    retry: false,
    mutationFn: ({ contactId }) => invoke<BriefResponse>('donor-brief', { contact_id: contactId, force: true }),
    onSuccess: (data, variables) => {
      client.setQueryData(aik.ai.brief(variables.contactId), data)
      // The holding line was rewritten on the contact row too.
      void client.invalidateQueries({ queryKey: qk.contacts.detail(variables.contactId) })
    },
  })
}

/* ------------------------------------------------------------------ drafts */

export interface DraftInput {
  contactId: string
  purpose: DraftPurpose
  giftId?: string | null
}

/**
 * One draft, on demand (09 §4). A mutation rather than a query because a draft
 * is an event: it is never refetched behind the user's back, and regenerating
 * is a deliberate second press.
 */
export function useDraftMessage() {
  const client = useQueryClient()
  return useMutation<DraftResult, AiCallError, DraftInput>({
    retry: false,
    mutationFn: (input) =>
      invoke<DraftResult>('draft-message', {
        contact_id: input.contactId,
        purpose: input.purpose,
        ...(input.giftId ? { gift_id: input.giftId } : {}),
      }),
    onSuccess: (data, variables) => {
      client.setQueryData(aik.ai.draft(variables.contactId, variables.purpose, variables.giftId), data)
    },
  })
}

/* ------------------------------------------------------------------ logging */

export interface ResolveInput {
  aiActivityId: string | null | undefined
  event: AiLabelEvent
  /** Which fields the human changed, for the per-field edit rate (09 §8). */
  editedFields?: string[]
}

/**
 * The accept / edit / reject write (09 §1.5). The edge function opened the row
 * as `pending`; this closes it.
 *
 * Failure is swallowed on purpose. A logging write that throws would turn
 * "I accepted the draft" into an error dialog, and the KPI is not worth
 * interrupting the work for — the row simply stays `pending`, which reads
 * honestly as "nobody said".
 */
export function useResolveAiActivity() {
  return useMutation<void, Error, ResolveInput>({
    retry: false,
    mutationFn: async ({ aiActivityId, event, editedFields }) => {
      if (!aiActivityId) return
      const resolution = resolutionFor(event)
      if (resolution === 'pending') return
      const { error } = await supabase
        .from('ai_activity_log')
        .update({
          resolution,
          ...(editedFields && editedFields.length > 0 ? { edited_fields: editedFields } : {}),
        })
        .eq('id', aiActivityId)
      if (error) console.warn('[ai] resolution not logged:', (error as Failed).message)
    },
  })
}

/* ------------------------------------------------------------ holding line */

export interface BriefReview {
  id: string | null
  resolution: string | null
  /** 09 §1.4's one boolean, derived rather than stored. */
  reviewed: boolean
}

/**
 * Has a person looked at this contact's AI content yet?
 *
 * 09 §1.4 calls the label "one boolean, rendered everywhere the content
 * appears". There is deliberately no `holding_line_reviewed` column: the answer
 * already exists in `ai_activity_log`, which 09 §1.5 requires anyway, and a
 * second copy would be a second thing to keep true. The brief run stamps
 * `raw_input = brief:<contact id>`; its resolution *is* the label.
 */
export function useBriefReview(contactId: string | undefined): UseQueryResult<BriefReview> {
  return useQuery<BriefReview>({
    queryKey: aik.ai.review(contactId ?? 'none'),
    enabled: isConfigured && Boolean(contactId),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_activity_log')
        .select('id, resolution')
        .eq('feature', 'brief')
        .eq('raw_input', `brief:${contactId}`)
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) throw new Error((error as Failed).message)
      const row = (data ?? [])[0] as { id: string; resolution: string | null } | undefined
      const resolution = row?.resolution ?? null
      return {
        id: row?.id ?? null,
        resolution,
        reviewed: resolution === 'accepted' || resolution === 'edited',
      }
    },
  })
}

export interface AcceptHoldingLineInput {
  contactId: string
  line: string
  aiActivityId?: string | null
}

/**
 * Accepting the rolling line (04 §5.8). The column already holds the text —
 * the edge function wrote it — so what "accept" changes is the *label*: the
 * chip stops saying "Drafted with AI" and the ledger records that a person
 * looked (09 §1.4). Editing writes the human's wording back over it.
 */
export function useSaveHoldingLine() {
  const client = useQueryClient()
  return useMutation<void, Error, AcceptHoldingLineInput & { edited?: boolean }>({
    retry: false,
    mutationFn: async ({ contactId, line, edited }) => {
      if (!edited) return
      const { error } = await supabase
        .from('contacts')
        .update({ holding_line: line, holding_line_at: new Date().toISOString() })
        .eq('id', contactId)
      if (error) throw new Error((error as Failed).message)
    },
    onSuccess: (_result, variables) => {
      void client.invalidateQueries({ queryKey: qk.contacts.detail(variables.contactId) })
      void client.invalidateQueries({ queryKey: aik.ai.review(variables.contactId) })
    },
  })
}

/* ------------------------------------------------------------ the notices */

/**
 * What an unavailable surface says. Every line names the manual path, because
 * the manual path is the product and AI is the shortcut (CLAUDE.md rule 6).
 */
export const AI_NOTICE: Record<AiUnavailable, string> = {
  unconfigured: 'AI is not configured on this project — no model key is set. Everything below is the record itself.',
  offline: 'No connection to the AI service. The record below is unaffected.',
  refused: 'The model declined this one. Write it by hand — nothing was lost.',
  error: 'The AI service could not be reached. The record below is unaffected.',
  disabled: 'This AI feature is switched off in Settings.',
}

/* ------------------------------------------------------------------ digest */

export interface DigestPreview {
  preview: boolean
  delivery: string
  narrative: string | null
  narrative_available: boolean
  subject: string
  body_text: string
  payload: unknown
}

/** Settings' "what would today's digest say?" — a preview, written nowhere. */
export function useDigestPreview(enabled: boolean): UseQueryResult<DigestPreview, AiCallError> {
  return useQuery<DigestPreview, AiCallError>({
    queryKey: aik.ai.digestPreview(),
    enabled: isConfigured && enabled,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: () => invoke<DigestPreview>('send-digest', {}),
  })
}

export type { BriefResponse, DraftResult, DraftPurpose }
