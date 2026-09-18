/**
 * Typed data access for the Action Stream (04 §1) and the Tasks view (04 §3).
 *
 * Rules this file keeps:
 * - One board query behind both surfaces (`qk.tasks.stream`), so an optimistic
 *   complete/snooze/reschedule has exactly one cache shape to patch (I-12).
 * - Derived numbers come from `contact_stats` only (I-8/I-9). The board never
 *   recomputes a rollup; it partitions rows by their own `due_on`.
 * - No PostgREST embeds — contacts and stats are fetched by id and joined here.
 * - Every task carries a contact (I-2); `createTask` cannot be called without one.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { endOfMonth, startOfMonth } from 'date-fns'
import { supabase } from '../supabase'
import { isConfigured } from '../env'
import { qk } from './keys'
import { fetchStats, fetchYellowFlaggedIds, selectRows, unique } from './rest'
import { toISODate, today } from '../dates'
import { isOpenStatus } from '../../features/tasks/logic'
import {
  BOARD_STATUSES,
  EMPTY_BOARD,
  type TaskBoard,
  type TaskDraft,
  type TaskRecord,
} from '../../features/tasks/types'
import type {
  ContactRow,
  DonationRow,
  InteractionRow,
  TeamMemberLite,
} from '../../features/contacts/types'

interface Failed {
  message: string
}

/**
 * Stages that end a relationship's active life. Everything else counts as
 * active for the I-3 yellow surfacing — defined as a deny-list so an
 * admin-added stage is active by default rather than silently invisible.
 */
export const INACTIVE_STAGES = new Set([
  'archived',
  'inactive',
  'not_interested',
  'unable_to_reach',
])

export interface TaskBoardFilters {
  /** Only tasks assigned to this member. Ignored when the id is unknown. */
  mine?: boolean
  memberId?: string | null
}

const boardKey = (filters: TaskBoardFilters) =>
  qk.tasks.stream({ mine: filters.mine ? (filters.memberId ?? 'me') : 'everyone' })

/* ------------------------------------------------------------------ board */

async function fetchBoard(filters: TaskBoardFilters): Promise<TaskBoard> {
  const dayStart = today()
  const dayStartISO = dayStart.toISOString()
  const nextDayISO = new Date(dayStart.getTime() + 86_400_000).toISOString()
  const mine = Boolean(filters.mine && filters.memberId)

  const [tasks, doneToday, meetings, yellow] = await Promise.all([
    selectRows<TaskRecord>('tasks', (q) => {
      const query = q.in('status', [...BOARD_STATUSES]).order('due_on', { ascending: true })
      return mine ? query.eq('assigned_to', filters.memberId) : query
    }),
    selectRows<TaskRecord>('tasks', (q) => {
      const query = q
        .eq('status', 'done')
        .gte('completed_at', dayStartISO)
        .order('completed_at', { ascending: false })
      return mine ? query.eq('assigned_to', filters.memberId) : query
    }),
    selectRows<InteractionRow>('interactions', (q) =>
      q
        .eq('status', 'scheduled')
        .gte('occurred_at', dayStartISO)
        .lt('occurred_at', nextDayISO)
        .order('occurred_at', { ascending: true }),
    ),
    fetchYellowFlaggedIds(),
  ])

  const contactIds = unique([
    ...tasks.map((t) => t.contact_id),
    ...doneToday.map((t) => t.contact_id),
    ...meetings.map((m) => m.contact_id),
    ...yellow.ids,
  ])

  const contactRows =
    contactIds.length > 0
      ? await selectRows<ContactRow>('contacts', (q) => q.in('id', contactIds))
      : []

  const contacts: Record<string, ContactRow> = {}
  for (const row of contactRows) contacts[row.id] = row

  const { stats, error } = await fetchStats(contactIds)

  // I-3: yellow only counts for contacts still in an active stage.
  const needsActionIds = yellow.ids.filter((id) => {
    const contact = contacts[id]
    if (!contact || contact.is_archived) return false
    return !INACTIVE_STAGES.has(contact.stage)
  })

  return {
    tasks,
    doneToday,
    meetings,
    contacts,
    stats,
    statsError: error ?? yellow.error,
    needsActionIds,
  }
}

/**
 * The one read behind Today and /tasks.
 *
 * No realtime subscription: the day's queue changes at human speed, so the
 * board refetches when the tab regains focus (the app-wide default is off) and
 * after every mutation. Previous data stays on screen while it refreshes, so a
 * refetch never blanks the stream.
 */
export function useTaskBoard(filters: TaskBoardFilters = {}): UseQueryResult<TaskBoard> {
  return useQuery<TaskBoard>({
    queryKey: boardKey(filters),
    enabled: isConfigured,
    queryFn: () => fetchBoard(filters),
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  })
}

/* ------------------------------------------------------- cache patching */

type BoardUpdater = (board: TaskBoard) => TaskBoard

function patchBoards(client: QueryClient, update: BoardUpdater) {
  client.setQueriesData<TaskBoard>({ queryKey: qk.tasks.all }, (board) =>
    board ? update(board) : board,
  )
}

/** Apply a partial task update wherever the row currently sits on the board. */
export function applyTaskPatch(board: TaskBoard, id: string, patch: Partial<TaskRecord>): TaskBoard {
  const all = [...board.tasks, ...board.doneToday]
  const found = all.find((task) => task.id === id)
  if (!found) return board
  const next: TaskRecord = { ...found, ...patch }
  const stillOpen = next.status !== 'done' && next.status !== 'cancelled'
  return {
    ...board,
    tasks: stillOpen
      ? [...board.tasks.filter((t) => t.id !== id), next].sort(byDue)
      : board.tasks.filter((t) => t.id !== id),
    doneToday:
      next.status === 'done'
        ? [next, ...board.doneToday.filter((t) => t.id !== id)]
        : board.doneToday.filter((t) => t.id !== id),
  }
}

const byDue = (a: TaskRecord, b: TaskRecord): number => {
  if (!a.due_on && !b.due_on) return (a.queue_order ?? 0) - (b.queue_order ?? 0)
  if (!a.due_on) return 1
  if (!b.due_on) return -1
  return a.due_on.localeCompare(b.due_on)
}

/** Contact-level flag/next-action live in `contact_stats` — resweep them too. */
function invalidateTaskSurfaces(client: QueryClient, contactId?: string) {
  void client.invalidateQueries({ queryKey: qk.tasks.all })
  void client.invalidateQueries({ queryKey: qk.contacts.all })
  if (contactId) void client.invalidateQueries({ queryKey: qk.contacts.detail(contactId) })
}

/* -------------------------------------------------------------- mutations */

export interface UpdateTaskInput {
  id: string
  patch: Partial<TaskRecord>
  /** Sweep this contact's profile queries too. */
  contactId?: string
}

/** The single write path for due/priority/assignee/status edits — optimistic. */
export function useUpdateTask() {
  const client = useQueryClient()
  return useMutation<TaskRecord, Error, UpdateTaskInput, { previous: TaskBoard[] }>({
    mutationFn: async ({ id, patch }) => {
      const { data, error } = await supabase.from('tasks').update(patch).eq('id', id).select('*').single()
      if (error) throw new Error((error as Failed).message)
      return data as unknown as TaskRecord
    },
    onMutate: async ({ id, patch }) => {
      await client.cancelQueries({ queryKey: qk.tasks.all })
      const previous = client
        .getQueriesData<TaskBoard>({ queryKey: qk.tasks.all })
        .map(([, board]) => board)
        .filter((board): board is TaskBoard => Boolean(board))
      patchBoards(client, (board) => applyTaskPatch(board, id, patch))
      return { previous }
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: qk.tasks.all })
    },
    onSettled: (_d, _e, variables) => invalidateTaskSurfaces(client, variables.contactId),
  })
}

export interface CompleteTaskInput {
  task: TaskRecord
}

/**
 * Completing writes `status='done'` + `completed_at` (I-4's first half — the
 * follow-up prompt is the dialog at the call site). Reversed by `useReopenTask`
 * inside the 6-second undo window.
 */
export function useCompleteTask() {
  const update = useUpdateTask()
  return {
    ...update,
    completeAsync: (task: TaskRecord) =>
      update.mutateAsync({
        id: task.id,
        contactId: task.contact_id,
        patch: { status: 'done', completed_at: new Date().toISOString() },
      }),
  }
}

export function useReopenTask() {
  const update = useUpdateTask()
  return (task: TaskRecord) =>
    update.mutateAsync({
      id: task.id,
      contactId: task.contact_id,
      patch: { status: task.status, completed_at: null },
    })
}

/** Bulk re-date (03 §5.4). One request per row, one undo for the batch. */
export function useRescheduleTasks() {
  const client = useQueryClient()
  return useMutation<void, Error, Array<{ id: string; due_on: string }>>({
    mutationFn: async (changes) => {
      for (const change of changes) {
        const { error } = await supabase.from('tasks').update({ due_on: change.due_on }).eq('id', change.id)
        if (error) throw new Error((error as Failed).message)
      }
    },
    onMutate: async (changes) => {
      await client.cancelQueries({ queryKey: qk.tasks.all })
      patchBoards(client, (board) =>
        changes.reduce((acc, change) => applyTaskPatch(acc, change.id, { due_on: change.due_on }), board),
      )
    },
    onSettled: () => invalidateTaskSurfaces(client),
  })
}

/** Create a next action. `contact_id` is required by the type (I-2). */
export function useCreateTask() {
  const client = useQueryClient()
  return useMutation<TaskRecord, Error, TaskDraft>({
    mutationFn: async (draft) => {
      const { data: session } = await supabase.auth.getUser()
      const userId = session?.user?.id ?? null
      const row = {
        contact_id: draft.contact_id,
        title: draft.title,
        action_type: draft.action_type,
        details: draft.details ?? null,
        due_on: draft.status === 'queued' ? null : draft.due_on,
        priority: draft.priority,
        status: draft.status ?? 'todo',
        origin: draft.origin ?? 'manual',
        waiting_for: draft.waiting_for ?? null,
        queue_order: draft.queue_order ?? null,
        assigned_to: draft.assigned_to === undefined ? userId : draft.assigned_to,
        created_by: userId,
      }
      const { data, error } = await supabase.from('tasks').insert(row).select('*').single()
      if (error) throw new Error((error as Failed).message)
      return data as unknown as TaskRecord
    },
    onSettled: (_d, _e, draft) => invalidateTaskSurfaces(client, draft.contact_id),
  })
}

export function useDeleteTask() {
  const client = useQueryClient()
  return useMutation<void, Error, { id: string; contactId?: string }>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('tasks').delete().eq('id', id)
      if (error) throw new Error((error as Failed).message)
    },
    onSettled: (_d, _e, variables) => invalidateTaskSurfaces(client, variables.contactId),
  })
}

/**
 * Activate the first queued task when the active next action completes
 * (04 §3): it gets a date and enters the stream.
 */
export function useActivateQueued() {
  const update = useUpdateTask()
  return (task: TaskRecord, dueOn: string) =>
    update.mutateAsync({
      id: task.id,
      contactId: task.contact_id,
      patch: { status: 'todo', due_on: dueOn },
    })
}

/** Arrows, not drag: reorder a contact's queued stack (04 §3). */
export function useReorderQueued() {
  const client = useQueryClient()
  return useMutation<void, Error, Array<{ id: string; queue_order: number }>>({
    mutationFn: async (changes) => {
      for (const change of changes) {
        const { error } = await supabase
          .from('tasks')
          .update({ queue_order: change.queue_order })
          .eq('id', change.id)
        if (error) throw new Error((error as Failed).message)
      }
    },
    onMutate: async (changes) => {
      await client.cancelQueries({ queryKey: qk.tasks.all })
      patchBoards(client, (board) =>
        changes.reduce(
          (acc, change) => applyTaskPatch(acc, change.id, { queue_order: change.queue_order }),
          board,
        ),
      )
    },
    onSettled: () => invalidateTaskSurfaces(client),
  })
}

/* ------------------------------------------------------------- queued read */

/** A contact's dateless stack — read on demand by the close-the-loop dialog. */
export function useQueuedTasks(contactId: string | null | undefined): UseQueryResult<TaskRecord[]> {
  return useQuery<TaskRecord[]>({
    queryKey: qk.tasks.queued(contactId ?? 'none'),
    enabled: isConfigured && Boolean(contactId),
    queryFn: () =>
      selectRows<TaskRecord>('tasks', (q) =>
        q.eq('contact_id', contactId).eq('status', 'queued').order('queue_order', { ascending: true }),
      ),
  })
}

/* ----------------------------------------------------------- contact picker */

/** New task → contact picker first (I-2). Name/organisation search, capped. */
export function useContactSearch(term: string): UseQueryResult<ContactRow[]> {
  const trimmed = term.trim()
  return useQuery<ContactRow[]>({
    queryKey: qk.contacts.search(trimmed.toLowerCase()),
    enabled: isConfigured,
    staleTime: 30_000,
    queryFn: async () => {
      const rows = await selectRows<ContactRow>('contacts', (q) =>
        q.eq('is_archived', false).order('last_name', { ascending: true }).limit(400),
      )
      if (trimmed === '') return rows.slice(0, 25)
      const needle = trimmed.toLowerCase()
      return rows
        .filter((row) =>
          [row.first_name, row.last_name, row.organization, row.hebrew_name]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(needle)),
        )
        .slice(0, 25)
    },
  })
}

export function useTeamMemberOptions(): UseQueryResult<TeamMemberLite[]> {
  return useQuery<TeamMemberLite[]>({
    queryKey: qk.team.list(),
    enabled: isConfigured,
    staleTime: 10 * 60_000,
    queryFn: () => selectRows<TeamMemberLite>('team_members', (q) => q.order('full_name', { ascending: true })),
  })
}

/* -------------------------------------------------------- stream metrics */

export interface MonthGiving {
  total: number
  giftCount: number
  /** ISO first-of-month, so the card can label itself ("AUGUST GIVING"). */
  month: string
}

/**
 * The metric strip's money card: gifts *received* this calendar month. Amounts
 * are gated by RLS for restricted viewers (11 §2) — the card is hidden rather
 * than shown empty when the role cannot see amounts.
 */
export function useMonthGiving(enabled = true): UseQueryResult<MonthGiving> {
  const month = toISODate(startOfMonth(new Date()))
  return useQuery<MonthGiving>({
    queryKey: qk.reports.monthGiving(month),
    enabled: isConfigured && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const rows = await selectRows<DonationRow>('donations', (q) =>
        q
          .eq('status', 'received')
          .gte('donated_on', month)
          .lte('donated_on', toISODate(endOfMonth(new Date()))),
      )
      const total = rows.reduce((sum, row) => sum + (Number(row.amount_gbp) || 0), 0)
      return { total, giftCount: rows.length, month }
    },
  })
}

/* ----------------------------------------------------------------- helpers */

export { isOpenStatus }
export const openTasksOf = (board: TaskBoard | undefined): TaskRecord[] =>
  (board ?? EMPTY_BOARD).tasks.filter((task) => isOpenStatus(task.status))
