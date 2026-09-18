/**
 * Typed data access for the Pipeline board (06 §2 · 02 §3.9).
 *
 * Rules this file keeps (the same ones `queries/giving.ts` keeps):
 * - **One board query** (`pk.pipeline.board`) behind the columns, the header
 *   totals and the stale panel, so an optimistic drag has exactly one cache
 *   shape to patch (I-12 / CLAUDE.md rule 4).
 * - No PostgREST embeds — contacts and the linked tasks are fetched by id and
 *   joined client-side, so nothing depends on FK constraint names.
 * - The two clocks (`stage_entered_at`, `last_moved_forward_at`) are written by
 *   the client because 02 §3.9 marks them "auto on stage change" and no trigger
 *   owns them yet; the patch itself is computed by `features/pipeline/logic`
 *   so the rule is testable without a database. TODO(08 §2): move both to a
 *   `before update` trigger and let this send only `stage`.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { supabase } from '../supabase'
import { isConfigured } from '../env'
import { qk } from './keys'
import { pk } from './pipelineKeys'
import { selectRows, unique } from './rest'
import { OPEN_TASK_STATUSES } from '../../features/pipeline/logic'
import {
  EMPTY_PIPELINE,
  type OpportunityDraft,
  type OpportunityRow,
  type PipelineBoard,
} from '../../features/pipeline/types'
import type { ContactRow } from '../../features/contacts/types'
import type { TaskRecord } from '../../features/tasks/types'

interface Failed {
  message: string
}

const fail = (error: unknown): never => {
  throw new Error((error as Failed)?.message ?? 'Write failed')
}

/* ------------------------------------------------------------------ board */

async function fetchPipeline(): Promise<PipelineBoard> {
  const opportunities = await selectRows<OpportunityRow>('opportunities', (q) =>
    q.order('stage_entered_at', { ascending: true }),
  )
  if (opportunities.length === 0) return EMPTY_PIPELINE

  const contactIds = unique(opportunities.map((row) => row.contact_id))
  const ids = opportunities.map((row) => row.id)

  const [contactRows, tasks] = await Promise.all([
    selectRows<ContactRow>('contacts', (q) => q.in('id', contactIds)),
    // The next-move line: open tasks that name the ask (02 §3.9). Linked tasks
    // are few, so this is one narrow read rather than a slice of the stream.
    selectRows<TaskRecord>('tasks', (q) =>
      q.in('opportunity_id', ids).in('status', [...OPEN_TASK_STATUSES]).order('due_on', { ascending: true }),
    ),
  ])

  const contacts: Record<string, ContactRow> = {}
  for (const row of contactRows) contacts[row.id] = row

  return { opportunities, contacts, tasks }
}

/**
 * The one read behind /pipeline. Won and lost rows come back with the open
 * ones — the history toggle and the conversion figures need them, and the table
 * is small enough that a second query would cost more than it saves.
 */
export function usePipelineBoard(): UseQueryResult<PipelineBoard> {
  return useQuery<PipelineBoard>({
    queryKey: pk.pipeline.board(),
    enabled: isConfigured,
    queryFn: fetchPipeline,
    placeholderData: (previous) => previous,
  })
}

/* ----------------------------------------------------------- invalidation */

/**
 * A pipeline write touches: the board, the donor's profile (the ask shows on
 * it), and the task surfaces whenever a next move was created alongside.
 */
function invalidatePipeline(client: QueryClient, contactId?: string | null) {
  void client.invalidateQueries({ queryKey: pk.pipeline.all })
  void client.invalidateQueries({ queryKey: qk.opportunities.all })
  void client.invalidateQueries({ queryKey: qk.tasks.all })
  if (contactId) {
    void client.invalidateQueries({ queryKey: qk.contacts.detail(contactId) })
    void client.invalidateQueries({ queryKey: qk.contacts.timeline(contactId) })
  }
}

/** Patch the board cache in place — the optimistic half of a drag (I-12). */
function patchBoard(client: QueryClient, id: string, patch: Partial<OpportunityRow>) {
  client.setQueriesData<PipelineBoard>({ queryKey: pk.pipeline.boards }, (board) =>
    board && Array.isArray(board.opportunities)
      ? {
          ...board,
          opportunities: board.opportunities.map((row) => (row.id === id ? { ...row, ...patch } : row)),
        }
      : board,
  )
}

/* -------------------------------------------------------------- mutations */

export interface OpportunityPatchInput {
  id: string
  contactId?: string | null
  patch: Partial<OpportunityRow>
}

/**
 * The single write path for a card: the drag between columns, the footer
 * outcome zones and the sheet's edits all land here, already carrying the
 * patch `features/pipeline/logic` computed. Optimistic, because a card that
 * snaps back after a successful drop reads as a bug.
 */
export function useUpdateOpportunity() {
  const client = useQueryClient()
  return useMutation<void, Error, OpportunityPatchInput>({
    mutationFn: async ({ id, patch }) => {
      const { error } = await supabase.from('opportunities').update(patch).eq('id', id)
      if (error) fail(error)
    },
    onMutate: async ({ id, patch }) => {
      await client.cancelQueries({ queryKey: pk.pipeline.boards })
      patchBoard(client, id, patch)
    },
    onSettled: (_d, _e, variables) => invalidatePipeline(client, variables.contactId ?? null),
  })
}

/** Create or edit one ask (06 §2: contact + name + ask are the minimum). */
export function useSaveOpportunity() {
  const client = useQueryClient()
  return useMutation<OpportunityRow, Error, { id?: string | null; draft: OpportunityDraft }>({
    mutationFn: async ({ id, draft }) => {
      if (id) {
        const { data, error } = await supabase
          .from('opportunities')
          .update(draft)
          .eq('id', id)
          .select('*')
          .single()
        if (error) fail(error)
        return data as unknown as OpportunityRow
      }
      const { data, error } = await supabase.from('opportunities').insert(draft).select('*').single()
      if (error) fail(error)
      return data as unknown as OpportunityRow
    },
    onSettled: (_d, _e, variables) => invalidatePipeline(client, variables.draft.contact_id ?? null),
  })
}

export function useDeleteOpportunity() {
  const client = useQueryClient()
  return useMutation<void, Error, { id: string; contactId?: string | null }>({
    mutationFn: async ({ id }) => {
      // The linked tasks outlive the ask — they belong to the person (I-2), so
      // they are unlinked rather than deleted.
      await supabase.from('tasks').update({ opportunity_id: null }).eq('opportunity_id', id)
      const { error } = await supabase.from('opportunities').delete().eq('id', id)
      if (error) fail(error)
    },
    onSettled: (_d, _e, variables) => invalidatePipeline(client, variables.contactId ?? null),
  })
}

export interface NextMoveInput {
  opportunityId: string
  contactId: string
  title: string
  dueOn: string
  actionType?: string | null
  priority?: string
}

/**
 * The next move a stage advance asks for (I-3/I-4). It is a plain task with the
 * ask attached — `features/tasks` owns the sheet, but its `TaskDraft` carries
 * no `opportunity_id`, so the link is written here rather than by widening a
 * shape three other screens depend on.
 */
export function useCreateNextMove() {
  const client = useQueryClient()
  return useMutation<TaskRecord, Error, NextMoveInput>({
    mutationFn: async (input) => {
      const { data: session } = await supabase.auth.getUser()
      const userId = session?.user?.id ?? null
      const row = {
        contact_id: input.contactId,
        opportunity_id: input.opportunityId,
        title: input.title,
        action_type: input.actionType ?? null,
        due_on: input.dueOn,
        priority: input.priority ?? 'medium',
        status: 'todo',
        origin: 'pipeline',
        assigned_to: userId,
        created_by: userId,
      }
      const { data, error } = await supabase.from('tasks').insert(row).select('*').single()
      if (error) fail(error)
      return data as unknown as TaskRecord
    },
    onSettled: (_d, _e, input) => invalidatePipeline(client, input.contactId),
  })
}

/** Undo for a just-created next move. */
export function useDeleteNextMove() {
  const client = useQueryClient()
  return useMutation<void, Error, { id: string; contactId?: string | null }>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('tasks').delete().eq('id', id)
      if (error) fail(error)
    },
    onSettled: (_d, _e, variables) => invalidatePipeline(client, variables.contactId ?? null),
  })
}
