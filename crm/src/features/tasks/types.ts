/**
 * Task shapes for the Action Stream and the Tasks view.
 *
 * `TaskRecord` extends M1's `TaskRow` (02 §3.3) with the two columns only the
 * task surfaces read — the queue position and the opportunity link — so the
 * contacts feature keeps its narrower shape.
 */

import type { ContactRow, ContactStats, InteractionRow, TaskRow } from '../contacts/types'

export interface TaskRecord extends TaskRow {
  /** Order within a contact's queued stack (D8; 04 §3). */
  queue_order: number | null
  opportunity_id: string | null
  created_at?: string
}

/** Statuses that mean "still on someone's plate". */
export const OPEN_STATUSES = ['todo', 'in_progress', 'waiting'] as const
/** Open + the dateless queue — everything the board holds besides done. */
export const BOARD_STATUSES = ['todo', 'in_progress', 'waiting', 'queued'] as const

export type TaskStatus = 'todo' | 'in_progress' | 'waiting' | 'queued' | 'done' | 'cancelled'

/**
 * One fetch behind both task surfaces: open tasks, the queue, today's
 * completions, today's meetings, and the contacts + `contact_stats` rows they
 * reference. One cache shape means one place to patch optimistically.
 */
export interface TaskBoard {
  /** todo · in_progress · waiting · queued, ascending by due date. */
  tasks: TaskRecord[]
  /** status=done with `completed_at` today (the Done tab / end-of-day glow). */
  doneToday: TaskRecord[]
  /** `interactions` with status='scheduled' occurring today. */
  meetings: InteractionRow[]
  contacts: Record<string, ContactRow>
  stats: Record<string, ContactStats>
  /** Non-null when `contact_stats` is unavailable — the screen degrades (M1). */
  statsError: string | null
  /** Active-stage contacts whose stats flag is yellow (I-3). */
  needsActionIds: string[]
}

export const EMPTY_BOARD: TaskBoard = {
  tasks: [],
  doneToday: [],
  meetings: [],
  contacts: {},
  stats: {},
  statsError: null,
  needsActionIds: [],
}

/** Everything the close-the-loop dialog needs about the completed task's person. */
export interface TaskContext {
  contact: ContactRow | null
  stats: ContactStats | null
  /** The contact's dateless stack, ascending by `queue_order`. */
  queued: TaskRecord[]
}

export interface TaskDraft {
  contact_id: string
  title: string
  action_type: string | null
  due_on: string | null
  priority: string
  details?: string | null
  status?: TaskStatus
  origin?: string
  assigned_to?: string | null
  waiting_for?: string | null
  queue_order?: number | null
}
