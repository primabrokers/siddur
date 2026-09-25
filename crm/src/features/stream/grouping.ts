/**
 * Turning the task board into the Action Stream's sections (04 §1).
 *
 * Pure and date-injectable so the ordering rules are testable: section order,
 * the flag sort (red → orange → yellow → blue → grey, yellow worse than grey —
 * I-3), and the grouping of due-today work by action type (brief §19).
 *
 * Nothing here computes a rollup. Task rows are partitioned by their own
 * `due_on`; contact-level flags come from `contact_stats` (I-8/I-9).
 */

import { differenceInCalendarDays, format, startOfDay } from 'date-fns'
import { FLAG_ORDER, type FlagVariant } from '../../components'
import type { SectionLabelTone } from '../../components/SectionLabel'
import { toDate } from '../../lib/format'
import { displayName } from '../contacts/normalise'
import type { ContactRow, ContactStats, InteractionRow } from '../contacts/types'
import { actionGroupLabel, actionGroupRank, partitionTasks, taskFlag } from '../tasks/logic'
import type { TaskBoard, TaskRecord } from '../tasks/types'

export type StreamRowKind = 'task' | 'meeting' | 'needs-action'

export interface StreamRowModel {
  id: string
  kind: StreamRowKind
  contactId: string
  name: string
  contact: ContactRow | null
  stats: ContactStats | null
  flag: FlagVariant
  /** The one next-action line under the name. */
  line: string
  /** `14:00` for meeting rows. */
  time?: string
  task?: TaskRecord
  meeting?: InteractionRow
}

export type StreamSectionKind =
  | 'meetings'
  | 'overdue'
  | 'due'
  | 'kit'
  | 'needs-action'
  | 'day'
  | 'queued'
  | 'done'

export interface StreamSection {
  id: string
  kind: StreamSectionKind
  label: string
  tone: SectionLabelTone
  count: number
  rows: StreamRowModel[]
  /** Dashed rows — the "needs a next action" treatment. */
  dashed?: boolean
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

const byFlagThenPriority = (a: StreamRowModel, b: StreamRowModel): number => {
  const flag = FLAG_ORDER[a.flag] - FLAG_ORDER[b.flag]
  if (flag !== 0) return flag
  const pa = PRIORITY_RANK[a.task?.priority ?? 'medium'] ?? 1
  const pb = PRIORITY_RANK[b.task?.priority ?? 'medium'] ?? 1
  if (pa !== pb) return pa - pb
  return a.name.localeCompare(b.name, 'en-GB')
}

/** "was due Thu" · "was due 12 Jul" · "due today" · "due in 4 days". */
export function dueWording(dueOn: string | null, now: Date = new Date()): string {
  const due = toDate(dueOn)
  if (!due) return 'no date'
  const diff = differenceInCalendarDays(startOfDay(due), startOfDay(now))
  if (diff === 0) return 'due today'
  if (diff === 1) return 'due tomorrow'
  if (diff > 1) return `due ${format(due, 'EEE d MMM')}`
  if (diff === -1) return 'was due yesterday'
  if (diff >= -6) return `was due ${format(due, 'EEE')}`
  return `was due ${format(due, 'd MMM')}`
}

function contactName(board: TaskBoard, contactId: string): string {
  const contact = board.contacts[contactId]
  return contact ? displayName(contact) : 'Unknown contact'
}

function taskLine(task: TaskRecord, now: Date): string {
  if (task.status === 'waiting') {
    return task.waiting_for ? `Waiting — ${task.waiting_for}` : `Waiting — ${task.title}`
  }
  return `${task.title} — ${dueWording(task.due_on, now)}`
}

export function toTaskRow(board: TaskBoard, task: TaskRecord, now: Date): StreamRowModel {
  return {
    id: task.id,
    kind: 'task',
    contactId: task.contact_id,
    name: contactName(board, task.contact_id),
    contact: board.contacts[task.contact_id] ?? null,
    stats: board.stats[task.contact_id] ?? null,
    flag: taskFlag(task, now),
    line: taskLine(task, now),
    task,
  }
}

/* ----------------------------------------------------------------- today */

export interface TodayOptions {
  now?: Date
  /** `lookup_options('action_type')` labels, for group headings. */
  actionLabels?: Record<string, string>
}

/**
 * Sections in the spec's order: meetings → overdue → due-today by action type
 * → keep-in-touch → needs a next action (04 §1).
 */
export function buildTodaySections(board: TaskBoard, options: TodayOptions = {}): StreamSection[] {
  const now = options.now ?? new Date()
  const labels = options.actionLabels ?? {}
  const sections: StreamSection[] = []
  const parts = partitionTasks(board.tasks, now)

  if (board.meetings.length > 0) {
    sections.push({
      id: 'meetings',
      kind: 'meetings',
      label: 'MEETINGS TODAY',
      tone: 'muted',
      count: board.meetings.length,
      rows: board.meetings.map((meeting) => ({
        id: meeting.id,
        kind: 'meeting' as const,
        contactId: meeting.contact_id,
        name: contactName(board, meeting.contact_id),
        contact: board.contacts[meeting.contact_id] ?? null,
        stats: board.stats[meeting.contact_id] ?? null,
        flag: 'future' as FlagVariant,
        line: [meeting.purpose, meeting.location].filter(Boolean).join(' — ') || meeting.summary,
        time: format(toDate(meeting.occurred_at) ?? now, 'HH:mm'),
        meeting,
      })),
    })
  }

  if (parts.overdue.length > 0) {
    const rows = parts.overdue.map((task) => toTaskRow(board, task, now)).sort(byFlagThenPriority)
    sections.push({
      id: 'overdue',
      kind: 'overdue',
      label: `OVERDUE · ${rows.length}`,
      tone: 'overdue',
      count: rows.length,
      rows,
    })
  }

  // Due today, grouped by action type: calls together, WhatsApps together.
  const groups = new Map<string, TaskRecord[]>()
  for (const task of [...parts.due, ...parts.waiting]) {
    const key = task.action_type ?? 'other'
    const bucket = groups.get(key)
    if (bucket) bucket.push(task)
    else groups.set(key, [task])
  }

  const orderedKeys = [...groups.keys()].sort((a, b) => {
    const rank = actionGroupRank(a) - actionGroupRank(b)
    return rank !== 0 ? rank : a.localeCompare(b)
  })

  for (const key of orderedKeys) {
    const rows = (groups.get(key) ?? []).map((task) => toTaskRow(board, task, now)).sort(byFlagThenPriority)
    sections.push({
      id: `due-${key}`,
      kind: 'due',
      label: `${actionGroupLabel(key === 'other' ? null : key, labels[key])} · ${rows.length}`,
      tone: 'muted',
      count: rows.length,
      rows,
    })
  }

  if (parts.kit.length > 0) {
    const rows = parts.kit.map((task) => toTaskRow(board, task, now)).sort(byFlagThenPriority)
    sections.push({
      id: 'kit',
      kind: 'kit',
      label: `KEEP IN TOUCH DUE · ${rows.length}`,
      tone: 'muted',
      count: rows.length,
      rows,
    })
  }

  const needsAction = board.needsActionIds
    .map((contactId): StreamRowModel | null => {
      const contact = board.contacts[contactId]
      if (!contact) return null
      return {
        id: `needs-${contactId}`,
        kind: 'needs-action',
        contactId,
        name: displayName(contact),
        contact,
        stats: board.stats[contactId] ?? null,
        flag: 'none',
        line: 'Active stage, no open action — decide the next move',
      }
    })
    .filter((row): row is StreamRowModel => row !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'en-GB'))

  if (needsAction.length > 0) {
    sections.push({
      id: 'needs-action',
      kind: 'needs-action',
      label: `NEEDS A NEXT ACTION · ${needsAction.length}`,
      tone: 'none',
      count: needsAction.length,
      rows: needsAction,
      dashed: true,
    })
  }

  return sections
}

/* -------------------------------------------------------------- upcoming */

/** Future dated tasks grouped by day, then the dateless queue (04 §1). */
export function buildUpcomingSections(board: TaskBoard, now: Date = new Date()): StreamSection[] {
  const parts = partitionTasks(board.tasks, now)
  const byDay = new Map<string, TaskRecord[]>()
  for (const task of parts.future) {
    const key = task.due_on ?? ''
    const bucket = byDay.get(key)
    if (bucket) bucket.push(task)
    else byDay.set(key, [task])
  }

  const sections: StreamSection[] = [...byDay.keys()]
    .sort()
    .map((day) => {
      const date = toDate(day) ?? now
      const diff = differenceInCalendarDays(startOfDay(date), startOfDay(now))
      const label = diff === 1 ? 'TOMORROW' : format(date, 'EEE d MMM').toUpperCase()
      const rows = (byDay.get(day) ?? []).map((task) => toTaskRow(board, task, now)).sort(byFlagThenPriority)
      return {
        id: `day-${day}`,
        kind: 'day' as const,
        label: `${label} · ${rows.length}`,
        tone: 'muted' as SectionLabelTone,
        count: rows.length,
        rows,
      }
    })

  if (parts.queued.length > 0) {
    const rows = parts.queued.map((task) => toTaskRow(board, task, now))
    sections.push({
      id: 'queued',
      kind: 'queued',
      label: `QUEUED · ${rows.length}`,
      tone: 'faint',
      count: rows.length,
      rows,
    })
  }

  return sections
}

/* ------------------------------------------------------------------ done */

export function buildDoneSections(board: TaskBoard, now: Date = new Date()): StreamSection[] {
  if (board.doneToday.length === 0) return []
  const rows = board.doneToday.map((task) => ({
    ...toTaskRow(board, task, now),
    flag: 'future' as FlagVariant,
    line: task.title,
  }))
  return [
    {
      id: 'done',
      kind: 'done',
      label: `DONE TODAY · ${rows.length}`,
      tone: 'accent',
      count: rows.length,
      rows,
    },
  ]
}

/* --------------------------------------------------------------- metrics */

export interface StreamMetrics {
  dueToday: number
  overdue: number
  meetings: number
  doneToday: number
}

export function streamMetrics(board: TaskBoard, now: Date = new Date()): StreamMetrics {
  const parts = partitionTasks(board.tasks, now)
  return {
    dueToday: parts.due.length + parts.kit.length,
    overdue: parts.overdue.length,
    meetings: board.meetings.length,
    doneToday: board.doneToday.length,
  }
}
