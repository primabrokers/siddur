/**
 * Quick Capture's data access: the roster it matches against, the one edge
 * function call, and the single save that writes the interaction, the task,
 * the AI log row and any accepted tags.
 *
 * Rules this file keeps:
 * - The browser never talks to the model. Parsing goes through
 *   `functions.invoke('ai-quick-capture')`; the key is a server secret (09 §1).
 * - A parse failure is a *supported state*, not an exception to swallow: it is
 *   classified into a `CaptureFailure` so the UI can fall back to the manual
 *   form with the dictation intact.
 * - Every AI run writes `ai_activity_log` with resolution accepted/edited and
 *   the fields the user changed (09 §1.5), and the interaction keeps
 *   `ai_raw_input` verbatim (02 §3.2).
 * - Nothing here recomputes a rollup; the flag/KIT/next-action numbers all come
 *   from `contact_stats` after invalidation (I-8/I-9).
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { isConfigured } from '../env'
import { ck } from './captureKeys'
import { qk } from './keys'
import { normaliseEmail, normalisePhone, nullable } from '../../features/contacts/normalise'
import { splitName } from '../../features/capture/contactMatch'
import type { CaptureContact, CaptureFailure, CaptureParseResult } from '../../features/capture/types'
import type { InteractionRow, TagRow, TaskRow } from '../../features/contacts/types'

interface Failed {
  message: string
}

/** The roster is a matching aid, not a directory — keep it narrow and cheap. */
const ROSTER_COLUMNS = 'id, first_name, last_name, organization, city, tier, email, phone, whatsapp'
export const ROSTER_LIMIT = 500
/** What we hand the model as spelling context (09 §2). */
export const ROSTER_PROMPT_LIMIT = 200
/** Latency target is <3s; past this the manual form is the better answer. */
export const PARSE_TIMEOUT_MS = 15_000

/* ------------------------------------------------------------------- roster */

export function useCaptureContacts(): UseQueryResult<CaptureContact[]> {
  return useQuery<CaptureContact[]>({
    queryKey: ck.capture.contacts(),
    enabled: isConfigured,
    // Held warm across sheet opens: capture must feel instant (03 §5.1).
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select(ROSTER_COLUMNS)
        .is('merged_into_id', null)
        .eq('is_archived', false)
        .order('updated_at', { ascending: false })
        .limit(ROSTER_LIMIT)
      if (error) throw new Error((error as Failed).message)
      return ((data ?? []) as unknown) as CaptureContact[]
    },
  })
}

export function useCaptureTags(): UseQueryResult<TagRow[]> {
  return useQuery<TagRow[]>({
    queryKey: ck.capture.tags(),
    enabled: isConfigured,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('tags').select('*').order('name', { ascending: true })
      if (error) throw new Error((error as Failed).message)
      return ((data ?? []) as unknown) as TagRow[]
    },
  })
}

/* -------------------------------------------------------------------- parse */

export class CaptureParseError extends Error {
  readonly failure: CaptureFailure
  constructor(failure: CaptureFailure, message: string) {
    super(message)
    this.name = 'CaptureParseError'
    this.failure = failure
  }
}

export interface ParseCaptureInput {
  text: string
  today?: Date
  /** Recent names, for spelling context only — the matching stays client-side. */
  roster?: CaptureContact[]
}

const isoDay = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** Read the function's status code from whichever shape supabase-js returns. */
async function classifyInvokeError(error: unknown, response?: Response): Promise<CaptureFailure> {
  const context = (error as { context?: unknown })?.context
  const asResponse =
    response ??
    (context && typeof (context as Response).status === 'number' ? (context as Response) : undefined)

  if (asResponse) {
    if (asResponse.status === 503) return 'unconfigured'
    // A 503 body can also arrive via a 500-shaped relay error; read it once.
    try {
      const body = await asResponse.clone().json()
      if (body?.error === 'ai_unconfigured') return 'unconfigured'
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
  if (message.includes('timeout') || message.includes('timed out')) return 'timeout'
  return 'error'
}

/**
 * One structured-output call (09 §2). Resolves to the extraction; rejects with
 * a `CaptureParseError` whose `failure` tells the UI which notice to show.
 */
export async function parseCapture(input: ParseCaptureInput): Promise<CaptureParseResult> {
  const today = input.today ?? new Date()
  const body = {
    text: input.text,
    today: isoDay(today),
    contact_names: (input.roster ?? []).slice(0, ROSTER_PROMPT_LIMIT).map((contact) => ({
      id: contact.id,
      name: [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim(),
      org: contact.organization,
    })),
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new CaptureParseError('timeout', 'The parse timed out.')), PARSE_TIMEOUT_MS)
  })

  try {
    const result = await Promise.race([
      supabase.functions.invoke<CaptureParseResult>('ai-quick-capture', { body }),
      timeout,
    ])

    if (result.error) {
      const failure = await classifyInvokeError(result.error, result.response)
      throw new CaptureParseError(failure, (result.error as Failed).message ?? 'Parse failed')
    }
    if (!result.data || typeof result.data !== 'object' || !result.data.interaction) {
      throw new CaptureParseError('error', 'The parser returned nothing usable.')
    }
    return result.data
  } catch (caught) {
    if (caught instanceof CaptureParseError) throw caught
    throw new CaptureParseError(await classifyInvokeError(caught), 'Parse failed')
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function useParseCapture() {
  return useMutation<CaptureParseResult, CaptureParseError, ParseCaptureInput>({
    mutationFn: parseCapture,
    retry: false,
  })
}

/* --------------------------------------------------------------------- save */

/** A brand-new contact from the "Create new: ⟨name⟩?" chip. */
export interface MinimalContactInput {
  name: string
  phone?: string | null
  email?: string | null
}

/**
 * The row for a capture-created contact — 02 §6's data-quality rules apply at
 * the door here exactly as they do in the full create sheet: phone/WhatsApp to
 * E.164, email lowercased, no empty strings in nullable columns.
 */
export function minimalContactRow(input: MinimalContactInput): Record<string, unknown> {
  const { first_name, last_name } = splitName(input.name)
  const phone = normalisePhone(input.phone)
  return {
    first_name,
    last_name,
    email: normaliseEmail(input.email),
    phone,
    // WhatsApp defaults to the phone, as in the full create path.
    whatsapp: phone,
    contact_kind: 'individual',
    stage: 'prospect',
    priority: 'medium',
    country: 'United Kingdom',
    preferred_language: 'en',
    source: 'quick_capture',
    organization: nullable(null),
  }
}

export interface SaveCaptureInput {
  source: 'ai' | 'manual'
  /** The dictation, verbatim — stored regardless of path (04 §4). */
  rawText: string
  contact: { id: string | null; createName: string | null }
  interaction: {
    kind: string
    /** Local wall-clock `yyyy-MM-ddTHH:mm`. */
    occurredAt: string
    location: string | null
    summary: string
    outcome: string | null
    askAmount: number | null
    isScheduled: boolean
  }
  nextAction: { type: string; title: string; dueOn: string | null } | null
  /** Accepted tag suggestions, by name. */
  tags: string[]
  /** Present on the AI path only. */
  ai?: {
    model: string
    output: unknown
    resolution: 'accepted' | 'edited'
    editedFields: string[]
    latencyMs: number | null
    tokensIn: number | null
    tokensOut: number | null
  }
}

export interface SaveCaptureResult {
  contactId: string
  interactionId: string | null
  taskId: string | null
  aiActivityId: string | null
  tagCount: number
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser()
  return data?.user?.id ?? null
}

/**
 * Find a tag by name (case-insensitive) or create it, then attach it. Tags are
 * a controlled vocabulary in Settings, so a suggestion must not silently
 * fork "Building project" into two rows.
 */
async function attachTag(contactId: string, name: string): Promise<boolean> {
  const trimmed = name.trim()
  if (trimmed === '') return false

  const existing = await supabase.from('tags').select('id').ilike('name', trimmed).limit(1)
  if (existing.error) throw new Error((existing.error as Failed).message)

  let tagId = (existing.data?.[0] as { id: string } | undefined)?.id ?? null
  if (!tagId) {
    const created = await supabase
      .from('tags')
      .insert({ name: trimmed, category: 'interest' })
      .select('id')
      .single()
    if (created.error) throw new Error((created.error as Failed).message)
    tagId = (created.data as { id: string }).id
  }

  const tagging = await supabase.from('taggings').insert({ tag_id: tagId, contact_id: contactId })
  if (tagging.error) throw new Error((tagging.error as Failed).message)
  return true
}

/**
 * The whole write, in order: log → contact → interaction → task → tags.
 *
 * The AI log row goes first so `interactions.ai_activity_id` can point at it
 * (02 §3.2) — the provenance link is what lets Settings compute the edit rate
 * per feature and lets a reviewer trace any summary back to its dictation.
 */
export async function saveCapture(input: SaveCaptureInput): Promise<SaveCaptureResult> {
  const userId = await currentUserId()

  let aiActivityId: string | null = null
  if (input.ai) {
    const logged = await supabase
      .from('ai_activity_log')
      .insert({
        feature: 'quick_capture',
        model: input.ai.model,
        raw_input: input.rawText,
        output: input.ai.output as never,
        resolution: input.ai.resolution,
        edited_fields: input.ai.editedFields,
        latency_ms: input.ai.latencyMs,
        tokens_in: input.ai.tokensIn,
        tokens_out: input.ai.tokensOut,
        team_member_id: userId,
      })
      .select('id')
      .single()
    if (logged.error) throw new Error((logged.error as Failed).message)
    aiActivityId = (logged.data as { id: string }).id
  }

  let contactId = input.contact.id
  if (!contactId) {
    if (!input.contact.createName) throw new Error('No contact chosen.')
    const created = await supabase
      .from('contacts')
      .insert({ ...minimalContactRow({ name: input.contact.createName }), created_by: userId })
      .select('id')
      .single()
    if (created.error) throw new Error((created.error as Failed).message)
    contactId = (created.data as { id: string }).id
  }

  const occurredAt = new Date(input.interaction.occurredAt)
  const interaction = await supabase
    .from('interactions')
    .insert({
      contact_id: contactId,
      occurred_at: (Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt).toISOString(),
      kind: input.interaction.kind,
      // A future arrangement is a scheduled interaction, not a logged one (04 §4).
      status: input.interaction.isScheduled ? 'scheduled' : 'logged',
      summary: input.interaction.summary,
      outcome: input.interaction.outcome,
      location: input.interaction.location,
      ask_amount: input.interaction.askAmount,
      source: input.source === 'ai' ? 'quick_capture_ai' : 'manual',
      ai_raw_input: input.rawText,
      ai_activity_id: aiActivityId,
      team_member_id: userId,
      created_by: userId,
    })
    .select('id')
    .single()
  if (interaction.error) throw new Error((interaction.error as Failed).message)

  let taskId: string | null = null
  if (input.nextAction && input.nextAction.title.trim() !== '') {
    const dueOn = input.nextAction.dueOn && input.nextAction.dueOn !== '' ? input.nextAction.dueOn : null
    const task = await supabase
      .from('tasks')
      .insert({
        contact_id: contactId,
        title: input.nextAction.title.trim(),
        action_type: input.nextAction.type,
        due_on: dueOn,
        // No date yet → the queued stack, which is what `queued` is for (02 §3.3
        // requires a due date on everything else).
        status: dueOn ? 'todo' : 'queued',
        priority: 'medium',
        origin: input.source === 'ai' ? 'quick_capture_ai' : 'manual',
        assigned_to: userId,
        created_by: userId,
      })
      .select('id')
      .single()
    if (task.error) throw new Error((task.error as Failed).message)
    taskId = (task.data as { id: string }).id
  }

  let tagCount = 0
  for (const tag of input.tags) {
    // A tag that will not attach must not lose the interaction that did save.
    try {
      if (await attachTag(contactId, tag)) tagCount += 1
    } catch {
      /* best effort — the interaction and task are already written */
    }
  }

  return {
    contactId,
    interactionId: (interaction.data as { id: string }).id,
    taskId,
    aiActivityId,
    tagCount,
  }
}

export function useSaveCapture() {
  const client = useQueryClient()
  return useMutation<SaveCaptureResult, Error, SaveCaptureInput>({
    mutationFn: saveCapture,
    retry: false,
    onSuccess: (result) => {
      // Everything derived — the flag, days-since, KIT due, the next action —
      // is recomputed by `contact_stats`, so sweep rather than patch (I-8).
      void client.invalidateQueries({ queryKey: qk.contacts.all })
      void client.invalidateQueries({ queryKey: qk.contacts.timeline(result.contactId) })
      void client.invalidateQueries({ queryKey: qk.tasks.all })
      void client.invalidateQueries({ queryKey: qk.interactions.all })
      void client.invalidateQueries({ queryKey: qk.nudges.all })
      void client.invalidateQueries({ queryKey: ck.capture.all })
    },
  })
}

export type { InteractionRow, TaskRow }
