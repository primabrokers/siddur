/**
 * Journey scheduling arithmetic (08 §4) — pure, no React, no network.
 *
 * **What this is and is not.** This is not a second engine. The engine is
 * `run_journey_steps()` / `crm_journey_materialise()` in Postgres (005 + 005c)
 * and it alone writes tasks. What the browser needs is the *same arithmetic*
 * for two things the database cannot answer:
 *
 *   1. the attach preview — "here is the whole future task list, with dates,
 *      before you commit" (08 §4). There is no enrolment yet, so there is
 *      nothing to read;
 *   2. the active-journey card — "step 2 of 4, next: send the impact note,
 *      27 Sep". Steps beyond today have no task row yet, so their dates are
 *      arithmetic, not data.
 *
 * That is not a rollup and not a flag, so I-8/I-9 ("derived numbers come from
 * `contact_stats`") is not in play — but the duplication is real, so the rules
 * are stated once here and mirrored line-for-line from the SQL:
 *
 *   due date          started_on + offset_days
 *   depends_on_prev   step n waits for step n-1's task to be `done`; the whole
 *                     tail waits with it. When it unblocks, its date is
 *                     max(offset date, today) — a step that waited is never
 *                     born already overdue.
 *   exit_on_gift      a received gift dated on/after started_on and recorded
 *                     no earlier than the enrolment ends the journey.
 */

import { addDays } from 'date-fns'
import { toISODate } from '../../lib/dates'
import type { JourneyEnrollment, JourneyStepRow, JourneyTaskState } from './types'

/** Where one step of one enrolment stands right now. */
export type StepState =
  /** A task exists and is still open. */
  | 'open'
  /** A task exists and was completed. */
  | 'done'
  /** A task exists and was cancelled (detach, or auto-exit). */
  | 'cancelled'
  /** Due today or earlier — the engine creates it on its next pass. */
  | 'due'
  /** Waiting for the previous step to be completed. */
  | 'blocked'
  /** Dated, not yet due. */
  | 'future'

export interface ScheduledStep {
  step: JourneyStepRow
  /**
   * The day this step lands, ISO. For a materialised step it is the task's own
   * `due_on` (the engine may have pushed it to the unblock day); otherwise it
   * is the arithmetic date.
   */
  dateISO: string
  state: StepState
  /** The task the engine created for this step, if it has run yet. */
  task: JourneyTaskState | null
}

const OPEN_STATUSES = new Set(['todo', 'in_progress', 'waiting', 'queued'])

/** `started_on + offset_days`, as an ISO date. */
export function stepDate(startedOn: string, offsetDays: number): string {
  const [y, m, d] = startedOn.split('-').map(Number)
  // Constructed in local time so the ISO round-trip cannot drift a day.
  return toISODate(addDays(new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1), offsetDays))
}

export interface ScheduleOptions {
  /** ISO date treated as "today". Defaults to the real one; tests pin it. */
  todayISO?: string
  /** Keyed by step id — the tasks the engine has already created. */
  tasksByStep?: Record<string, JourneyTaskState>
}

/**
 * The whole sequence for one start date, in step order, each row carrying the
 * date it lands on and where it stands. Feeds both the preview (no tasks yet)
 * and the active card (some tasks).
 */
export function scheduleSteps(
  steps: JourneyStepRow[],
  startedOn: string,
  options: ScheduleOptions = {},
): ScheduledStep[] {
  const todayISO = options.todayISO ?? toISODate(new Date())
  const tasksByStep = options.tasksByStep ?? {}
  const ordered = [...steps].sort((a, b) => a.step_no - b.step_no)

  const out: ScheduledStep[] = []
  /** Once one step waits, the whole tail waits with it — the SQL exits the loop. */
  let tailBlocked = false
  /** The engine materialises strictly in step order, so dates never go backwards. */
  let floor = ''

  for (let index = 0; index < ordered.length; index += 1) {
    const step = ordered[index]!
    const task = tasksByStep[step.id] ?? null
    const offsetDate = stepDate(startedOn, step.offset_days)

    if (task) {
      const dateISO = task.due_on ?? offsetDate
      floor = dateISO > floor ? dateISO : floor
      out.push({
        step,
        dateISO,
        state: task.status === 'done' ? 'done' : task.status === 'cancelled' ? 'cancelled' : 'open',
        task,
      })
      continue
    }

    const previous = index > 0 ? out[index - 1] : null
    const waits =
      tailBlocked ||
      (step.depends_on_previous && step.step_no > 1 && previous?.state !== 'done')

    // The earliest a step could land: its own offset, never before today, and
    // never before the step ahead of it (materialisation is sequential).
    let dateISO = offsetDate < floor ? floor : offsetDate
    if (waits && dateISO < todayISO) dateISO = todayISO
    floor = dateISO

    if (waits) {
      tailBlocked = true
      out.push({ step, dateISO, state: 'blocked', task: null })
      continue
    }

    out.push({ step, dateISO, state: dateISO <= todayISO ? 'due' : 'future', task: null })
  }

  return out
}

export interface JourneyProgress {
  /** How many steps the sequence has. */
  total: number
  /** How many are completed. */
  done: number
  /** 1-based position of the step in play — what "step x of y" shows. */
  current: number
  /** The next step that still has to happen, or null when the run is over. */
  next: ScheduledStep | null
  /** Every step, in order, with its date and state. */
  steps: ScheduledStep[]
}

/** "Step 2 of 4 · next: Send the impact note, 27 Sep" — the active card's line. */
export function journeyProgress(
  entry: JourneyEnrollment,
  options: { todayISO?: string } = {},
): JourneyProgress {
  const steps = scheduleSteps(entry.template.steps, entry.enrollment.started_on, {
    todayISO: options.todayISO,
    tasksByStep: entry.tasksByStep,
  })
  const done = steps.filter((row) => row.state === 'done').length
  const next = steps.find((row) => row.state !== 'done' && row.state !== 'cancelled') ?? null
  return {
    total: steps.length,
    done,
    current: Math.min(done + 1, Math.max(steps.length, 1)),
    next,
    steps,
  }
}

/** The still-open tasks a detach has to cancel ("deleting mid-way cancels remaining steps"). */
export function openJourneyTasks(entry: JourneyEnrollment): JourneyTaskState[] {
  return Object.values(entry.tasksByStep).filter((task) => OPEN_STATUSES.has(task.status))
}

export const isOpenJourneyTask = (status: string): boolean => OPEN_STATUSES.has(status)

export interface GiftLike {
  status: string
  donated_on: string
  created_at: string
}

/**
 * Mirror of the SQL auto-exit predicate, so the UI can say "this journey ends
 * itself when a gift arrives" and a test can pin the rule.
 *
 * The `created_at` half matters: a lapsed-reactivation journey is attached
 * *because* they have not given, so the older gift that prompted the attach
 * must not end it on the same night; a back-dated gift entered later is
 * excluded by the `donated_on` half for the same reason.
 */
export function exitsOnGift(
  template: { exit_on_gift: boolean },
  enrollment: { started_on: string; created_at?: string | null },
  gifts: GiftLike[],
): boolean {
  if (!template.exit_on_gift) return false
  const since = enrollment.created_at ?? ''
  return gifts.some(
    (gift) =>
      gift.status === 'received' &&
      gift.donated_on >= enrollment.started_on &&
      gift.created_at >= since,
  )
}
