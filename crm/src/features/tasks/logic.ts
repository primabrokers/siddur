/**
 * Task arithmetic that must be testable without a browser: the close-the-loop
 * follow-up plan (I-4), "reschedule all" (03 §5.4), and the labels the stream
 * and the tasks view share.
 *
 * These are calendar-day partitions and defaults for *new* rows — not derived
 * rollups. Every rollup, flag and KIT due date still comes from
 * `contact_stats` (I-8/I-9); nothing here recomputes one.
 */

import { addDays, differenceInCalendarDays, endOfWeek, startOfDay } from 'date-fns'
import type { FlagVariant } from '../../components'
import { toISODate, today as todayStart } from '../../lib/dates'
import { toDate } from '../../lib/format'
import type { ContactRow, ContactStats } from '../contacts/types'
import type { TaskBoard, TaskRecord } from './types'

/* ----------------------------------------------------------------- labels */

/** Group headings for due-today tasks — "CALLS DUE · 3" (brief §19). */
const GROUP_LABELS: Record<string, string> = {
  call: 'CALLS DUE',
  whatsapp: 'WHATSAPPS DUE',
  send_email: 'EMAILS DUE',
  email: 'EMAILS DUE',
  arrange_meeting: 'MEETINGS TO ARRANGE',
  send_proposal: 'PROPOSALS DUE',
  follow_up_proposal: 'PROPOSAL FOLLOW-UPS DUE',
  ask: 'ASKS DUE',
  send_update: 'UPDATES DUE',
  invite_event: 'INVITES DUE',
  thank_you: 'THANK-YOUS DUE',
  send_receipt: 'RECEIPTS DUE',
  speak_to_introducer: 'INTRODUCTIONS DUE',
  keep_in_touch: 'KEEP IN TOUCH DUE',
  other: 'OTHER ACTIONS DUE',
}

/**
 * `call` → `CALLS DUE`. Unknown types fall back to the lookup label from
 * `lookup_options` (02 §6) so an admin-added action type still reads properly.
 */
export function actionGroupLabel(actionType: string | null, lookupLabel?: string | null): string {
  if (!actionType) return 'OTHER ACTIONS DUE'
  const known = GROUP_LABELS[actionType]
  if (known) return known
  const base = (lookupLabel ?? actionType.replace(/_/g, ' ')).toUpperCase()
  return `${base} DUE`
}

/** Order the due-today groups appear in: calls first, then messages (brief §19). */
const GROUP_ORDER = [
  'call',
  'whatsapp',
  'send_email',
  'email',
  'arrange_meeting',
  'send_proposal',
  'follow_up_proposal',
  'ask',
  'send_update',
  'invite_event',
  'thank_you',
  'send_receipt',
  'speak_to_introducer',
  'other',
]

export function actionGroupRank(actionType: string | null): number {
  const index = actionType ? GROUP_ORDER.indexOf(actionType) : -1
  return index === -1 ? GROUP_ORDER.length : index
}

/** Origin badge text for automation/AI-created rows (04 §3). */
export function originLabel(origin: string | null | undefined): string | null {
  if (!origin || origin === 'manual') return null
  if (origin === 'quick_capture_ai') return 'AI capture'
  if (origin.startsWith('journey:')) return `Journey · ${origin.slice('journey:'.length).replace(/_/g, ' ')}`
  if (origin.startsWith('auto:')) {
    const key = origin.slice('auto:'.length)
    const known: Record<string, string> = {
      kit: 'Keep in touch',
      thank_you: 'Auto thank-you',
      receipt: 'Auto receipt',
      pledge_chase: 'Pledge chase',
      proposal_follow_up: 'Proposal follow-up',
      meeting_reminder: 'Meeting reminder',
      signal: 'Signal',
    }
    return known[key] ?? `Auto · ${key.replace(/_/g, ' ')}`
  }
  return origin.replace(/_/g, ' ')
}

/** A keep-in-touch row: the nightly `kit_due` rule's output (08 §3). */
export function isKeepInTouch(task: Pick<TaskRecord, 'origin' | 'action_type'>): boolean {
  return (task.origin ?? '').startsWith('auto:kit') || task.action_type === 'keep_in_touch'
}

/* ------------------------------------------------------------------ flags */

/**
 * The flag for one *task row* (03 §2): a direct reading of the row's own
 * `status` + `due_on`, not a contact rollup. The contact-level flag still
 * comes from `contact_stats`.
 */
export function taskFlag(task: Pick<TaskRecord, 'status' | 'due_on'>, from: Date = new Date()): FlagVariant {
  if (task.status === 'queued') return 'queued'
  if (task.status === 'waiting') return 'waiting'
  const due = toDate(task.due_on)
  if (!due) return 'none'
  const diff = differenceInCalendarDays(startOfDay(due), startOfDay(from))
  if (diff < 0) return 'overdue'
  if (diff === 0) return 'today'
  return 'future'
}

export const isOpenStatus = (status: string): boolean =>
  status === 'todo' || status === 'in_progress' || status === 'waiting'

/* ------------------------------------------------------------- partitions */

export interface TaskPartition {
  overdue: TaskRecord[]
  /** Due today, excluding keep-in-touch (which gets its own section). */
  due: TaskRecord[]
  kit: TaskRecord[]
  waiting: TaskRecord[]
  future: TaskRecord[]
  queued: TaskRecord[]
}

/**
 * One pass over the open tasks, partitioned by the row's own `due_on` — the
 * shared basis for the stream's sections and the tasks view's groups.
 *
 * A waiting task never sits under OVERDUE: the ball is in the donor's court and
 * the blue flag says so (03 §2).
 */
export function partitionTasks(tasks: TaskRecord[], now: Date = new Date()): TaskPartition {
  const out: TaskPartition = { overdue: [], due: [], kit: [], waiting: [], future: [], queued: [] }
  const base = startOfDay(now)

  for (const task of tasks) {
    if (task.status === 'queued') {
      out.queued.push(task)
      continue
    }
    if (task.status === 'waiting') {
      out.waiting.push(task)
      continue
    }
    const due = toDate(task.due_on)
    if (!due) continue
    const diff = differenceInCalendarDays(startOfDay(due), base)
    if (diff < 0) out.overdue.push(task)
    else if (diff === 0) (isKeepInTouch(task) ? out.kit : out.due).push(task)
    else out.future.push(task)
  }

  return out
}

/* ---------------------------------------------------------------- filters */

export type TaskScope = 'mine' | 'everyone'

export interface BoardFilter {
  memberId?: string | null
  scope?: TaskScope
  /** `lookup_options('action_type')` value, or null for all. */
  actionType?: string | null
  /** `manual` · `auto` (any `auto:*`) · `quick_capture_ai` · null for all. */
  origin?: string | null
}

function matchesOrigin(origin: string | null | undefined, filter: string): boolean {
  const value = origin ?? 'manual'
  if (filter === 'auto') return value.startsWith('auto:')
  return value === filter
}

/**
 * Client-side narrowing of the one board query (mine/everyone, action type,
 * origin). Filtering here rather than server-side keeps Today and /tasks on a
 * single cache entry, so an optimistic complete shows up on both at once.
 */
export function filterBoard(board: TaskBoard, filter: BoardFilter): TaskBoard {
  const mine = filter.scope === 'mine' && filter.memberId ? filter.memberId : null

  const keep = (task: TaskRecord): boolean => {
    if (mine && task.assigned_to !== mine) return false
    if (filter.actionType && task.action_type !== filter.actionType) return false
    if (filter.origin && !matchesOrigin(task.origin, filter.origin)) return false
    return true
  }

  return {
    ...board,
    tasks: board.tasks.filter(keep),
    doneToday: board.doneToday.filter(keep),
    meetings: mine ? board.meetings.filter((m) => !m.team_member_id || m.team_member_id === mine) : board.meetings,
  }
}

/** Does this member have any open task of their own? Drives the default scope. */
export function hasOwnTasks(board: TaskBoard, memberId: string | null | undefined): boolean {
  if (!memberId) return false
  return board.tasks.some((task) => task.assigned_to === memberId)
}

/* ------------------------------------------------------- close the loop */

export type FollowUpMode = 'queued' | 'new'
export type DueSource = 'queue-activation' | 'cadence' | 'kit-due' | 'default'

export interface FollowUpPlan {
  mode: FollowUpMode
  /** Present when `mode === 'queued'` — the stack's first dateless task. */
  queuedTask: TaskRecord | null
  actionType: string | null
  title: string
  /** ISO date, editable in the dialog. */
  dueOn: string
  dueSource: DueSource
}

export interface FollowUpInput {
  task: Pick<TaskRecord, 'title' | 'action_type' | 'contact_id'>
  contact?: ContactRow | null
  stats?: ContactStats | null
  /** The contact's dateless stack (any order — the plan sorts it). */
  queued?: TaskRecord[]
  now?: Date
  /** `queued → today + n` on activation; the rule's configurable default. */
  queueActivationDays?: number
  /** Fallback when the contact has no cadence at all. */
  fallbackDays?: number
}

/** Queue order first, then creation order, then title — a stable "next up". */
export function sortQueued(queued: TaskRecord[]): TaskRecord[] {
  return [...queued].sort((a, b) => {
    const ao = a.queue_order ?? Number.MAX_SAFE_INTEGER
    const bo = b.queue_order ?? Number.MAX_SAFE_INTEGER
    if (ao !== bo) return ao - bo
    const ac = a.created_at ?? ''
    const bc = b.created_at ?? ''
    if (ac !== bc) return ac < bc ? -1 : 1
    return a.title.localeCompare(b.title, 'en-GB')
  })
}

/**
 * I-4, never complete into a void. Completing a task offers, in the same
 * dialog, either the contact's next queued action or a prefilled new one:
 *
 * - queued stack non-empty → activate the first, `due_on = today + 3` (04 §3);
 * - otherwise same action type, same title, due from the contact's cadence
 *   (`contact_frequency_days`, else a future `contact_stats.kit_due_on`),
 *   falling back to +7 days (03 §5.5).
 *
 * Declining is a first-class outcome — the caller writes nothing and the
 * contact goes yellow (I-3).
 */
export function planFollowUp(input: FollowUpInput): FollowUpPlan {
  const now = input.now ?? new Date()
  const base = startOfDay(now)
  const queueActivationDays = input.queueActivationDays ?? 3
  const fallbackDays = input.fallbackDays ?? 7

  const queued = sortQueued(input.queued ?? [])
  const first = queued[0]
  if (first) {
    return {
      mode: 'queued',
      queuedTask: first,
      actionType: first.action_type,
      title: first.title,
      dueOn: toISODate(addDays(base, queueActivationDays)),
      dueSource: 'queue-activation',
    }
  }

  const cadenceDays = input.contact?.contact_frequency_days ?? null
  if (cadenceDays && cadenceDays > 0) {
    return {
      mode: 'new',
      queuedTask: null,
      actionType: input.task.action_type,
      title: input.task.title,
      dueOn: toISODate(addDays(base, cadenceDays)),
      dueSource: 'cadence',
    }
  }

  const kitDue = toDate(input.stats?.kit_due_on ?? null)
  if (kitDue && differenceInCalendarDays(startOfDay(kitDue), base) > 0) {
    return {
      mode: 'new',
      queuedTask: null,
      actionType: input.task.action_type,
      title: input.task.title,
      dueOn: toISODate(kitDue),
      dueSource: 'kit-due',
    }
  }

  return {
    mode: 'new',
    queuedTask: null,
    actionType: input.task.action_type,
    title: input.task.title,
    dueOn: toISODate(addDays(base, fallbackDays)),
    dueSource: 'default',
  }
}

/* ------------------------------------------------------- reschedule all */

export type RescheduleMode = 'today' | 'week'

export interface RescheduleChange {
  id: string
  due_on: string
}

/**
 * 03 §5.4 — coming back after Yom Tov must not mean 40 individual re-dates.
 *
 * - `today`: everything lands on today;
 * - `week`: dealt round-robin across the days left in this week (Mon–Sun),
 *   today included, so the load spreads instead of piling up.
 */
export function rescheduleAllPlan(
  tasks: Array<Pick<TaskRecord, 'id'>>,
  mode: RescheduleMode,
  now: Date = new Date(),
): RescheduleChange[] {
  const base = startOfDay(now)
  if (mode === 'today') return tasks.map((task) => ({ id: task.id, due_on: toISODate(base) }))

  const lastDay = endOfWeek(base, { weekStartsOn: 1 })
  const span = Math.max(differenceInCalendarDays(lastDay, base) + 1, 1)
  return tasks.map((task, index) => ({ id: task.id, due_on: toISODate(addDays(base, index % span)) }))
}

/** Snooze on a task is a due-date shift, not a separate state (03 §5.3). */
export function snoozedDueOn(days: number, now: Date = new Date()): string {
  return toISODate(addDays(startOfDay(now), days))
}

/** Today, as the wire format Postgres `date` columns expect. */
export const todayISO = (): string => toISODate(todayStart())
