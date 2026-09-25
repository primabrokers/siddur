import { describe, expect, it } from 'vitest'
import { addDays, format, subDays } from 'date-fns'
import {
  actionGroupLabel,
  filterBoard,
  hasOwnTasks,
  isKeepInTouch,
  originLabel,
  partitionTasks,
  planFollowUp,
  rescheduleAllPlan,
  snoozedDueOn,
  sortQueued,
  taskFlag,
} from '../src/features/tasks/logic'
import { EMPTY_BOARD, type TaskBoard, type TaskRecord } from '../src/features/tasks/types'

const iso = (date: Date) => format(date, 'yyyy-MM-dd')
/** A Wednesday — mid-week, so the spread has days left on both sides. */
const NOW = new Date(2026, 7, 26, 9, 0, 0)

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 't1',
    contact_id: 'c1',
    title: 'Call re proposal',
    action_type: 'call',
    details: null,
    assigned_to: 'braun',
    due_on: iso(NOW),
    priority: 'medium',
    status: 'todo',
    waiting_for: null,
    completed_at: null,
    origin: 'manual',
    queue_order: null,
    opportunity_id: null,
    ...overrides,
  }
}

describe('taskFlag — the row-level flag language (03 §2)', () => {
  it('reads overdue / today / future from the row own due date', () => {
    expect(taskFlag(task({ due_on: iso(subDays(NOW, 3)) }), NOW)).toBe('overdue')
    expect(taskFlag(task({ due_on: iso(NOW) }), NOW)).toBe('today')
    expect(taskFlag(task({ due_on: iso(addDays(NOW, 3)) }), NOW)).toBe('future')
  })

  it('puts status ahead of the date: waiting is blue, queued is dashed', () => {
    expect(taskFlag(task({ status: 'waiting', due_on: iso(subDays(NOW, 9)) }), NOW)).toBe('waiting')
    expect(taskFlag(task({ status: 'queued', due_on: null }), NOW)).toBe('queued')
  })
})

describe('partitionTasks', () => {
  const tasks = [
    task({ id: 'overdue', due_on: iso(subDays(NOW, 4)) }),
    task({ id: 'today', due_on: iso(NOW) }),
    task({ id: 'kit', due_on: iso(NOW), origin: 'auto:kit', action_type: 'keep_in_touch' }),
    task({ id: 'waiting', status: 'waiting', due_on: iso(subDays(NOW, 10)), waiting_for: 'GA form' }),
    task({ id: 'future', due_on: iso(addDays(NOW, 5)) }),
    task({ id: 'queued', status: 'queued', due_on: null, queue_order: 1 }),
  ]

  it('splits by the row own date, keep-in-touch in its own bucket', () => {
    const parts = partitionTasks(tasks, NOW)
    expect(parts.overdue.map((t) => t.id)).toEqual(['overdue'])
    expect(parts.due.map((t) => t.id)).toEqual(['today'])
    expect(parts.kit.map((t) => t.id)).toEqual(['kit'])
    expect(parts.future.map((t) => t.id)).toEqual(['future'])
    expect(parts.queued.map((t) => t.id)).toEqual(['queued'])
  })

  it('never files a waiting task under overdue — the ball is in their court', () => {
    const parts = partitionTasks(tasks, NOW)
    expect(parts.waiting.map((t) => t.id)).toEqual(['waiting'])
    expect(parts.overdue.map((t) => t.id)).not.toContain('waiting')
  })
})

describe('close the loop (I-4) — planFollowUp', () => {
  it('offers the first queued task, dated today + 3 (04 §3 default)', () => {
    const queued = [
      task({ id: 'q2', status: 'queued', due_on: null, queue_order: 2, title: 'Send the update' }),
      task({ id: 'q1', status: 'queued', due_on: null, queue_order: 1, title: 'Invite to the dinner' }),
    ]
    const plan = planFollowUp({ task: task(), queued, now: NOW })

    expect(plan.mode).toBe('queued')
    expect(plan.queuedTask?.id).toBe('q1')
    expect(plan.title).toBe('Invite to the dinner')
    expect(plan.dueOn).toBe(iso(addDays(NOW, 3)))
    expect(plan.dueSource).toBe('queue-activation')
  })

  it('honours a configured activation delay', () => {
    const queued = [task({ id: 'q1', status: 'queued', due_on: null, queue_order: 1 })]
    const plan = planFollowUp({ task: task(), queued, now: NOW, queueActivationDays: 10 })
    expect(plan.dueOn).toBe(iso(addDays(NOW, 10)))
  })

  it("prefills the same action type and the contact's cadence date", () => {
    const plan = planFollowUp({
      task: task({ action_type: 'whatsapp', title: 'WhatsApp about the dinner' }),
      contact: { contact_frequency_days: 60 } as never,
      now: NOW,
    })

    expect(plan.mode).toBe('new')
    expect(plan.actionType).toBe('whatsapp')
    expect(plan.title).toBe('WhatsApp about the dinner')
    expect(plan.dueOn).toBe(iso(addDays(NOW, 60)))
    expect(plan.dueSource).toBe('cadence')
  })

  it('falls back to a future kit_due_on from contact_stats', () => {
    const plan = planFollowUp({
      task: task(),
      contact: { contact_frequency_days: null } as never,
      stats: { kit_due_on: iso(addDays(NOW, 21)) } as never,
      now: NOW,
    })
    expect(plan.dueOn).toBe(iso(addDays(NOW, 21)))
    expect(plan.dueSource).toBe('kit-due')
  })

  it('ignores a kit_due_on already in the past and uses +7 days (03 §5.5)', () => {
    const plan = planFollowUp({
      task: task(),
      stats: { kit_due_on: iso(subDays(NOW, 5)) } as never,
      now: NOW,
    })
    expect(plan.dueOn).toBe(iso(addDays(NOW, 7)))
    expect(plan.dueSource).toBe('default')
  })

  it('sorts a queue with missing order values deterministically', () => {
    const rows = [
      task({ id: 'b', queue_order: null, title: 'B' }),
      task({ id: 'a', queue_order: 1, title: 'A' }),
      task({ id: 'c', queue_order: null, title: 'C' }),
    ]
    expect(sortQueued(rows).map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('reschedule all (03 §5.4)', () => {
  const overdue = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => task({ id }))

  it('moves everything to today', () => {
    const plan = rescheduleAllPlan(overdue, 'today', NOW)
    expect(plan).toHaveLength(6)
    expect(new Set(plan.map((c) => c.due_on))).toEqual(new Set([iso(NOW)]))
  })

  it('spreads over the days left in this week, today included', () => {
    // Wednesday → Wed, Thu, Fri, Sat, Sun = 5 days.
    const plan = rescheduleAllPlan(overdue, 'week', NOW)
    expect(plan.map((c) => c.due_on)).toEqual([
      iso(NOW),
      iso(addDays(NOW, 1)),
      iso(addDays(NOW, 2)),
      iso(addDays(NOW, 3)),
      iso(addDays(NOW, 4)),
      iso(NOW),
    ])
  })

  it('collapses to today when the week has no days left', () => {
    const sunday = new Date(2026, 7, 30, 9, 0, 0)
    const plan = rescheduleAllPlan(overdue, 'week', sunday)
    expect(new Set(plan.map((c) => c.due_on))).toEqual(new Set([iso(sunday)]))
  })

  it('snooze is a due-date shift, not a new state', () => {
    expect(snoozedDueOn(7, NOW)).toBe(iso(addDays(NOW, 7)))
  })
})

describe('labels', () => {
  it('groups due-today work by action type', () => {
    expect(actionGroupLabel('call')).toBe('CALLS DUE')
    expect(actionGroupLabel('whatsapp')).toBe('WHATSAPPS DUE')
    expect(actionGroupLabel('send_email')).toBe('EMAILS DUE')
    expect(actionGroupLabel(null)).toBe('OTHER ACTIONS DUE')
    expect(actionGroupLabel('site_visit', 'Site visit')).toBe('SITE VISIT DUE')
  })

  it('badges automation and AI origins only', () => {
    expect(originLabel('manual')).toBeNull()
    expect(originLabel('auto:kit')).toBe('Keep in touch')
    expect(originLabel('auto:pledge_chase')).toBe('Pledge chase')
    expect(originLabel('quick_capture_ai')).toBe('AI capture')
  })

  it('recognises keep-in-touch rows by origin or action type', () => {
    expect(isKeepInTouch({ origin: 'auto:kit', action_type: null })).toBe(true)
    expect(isKeepInTouch({ origin: 'manual', action_type: 'keep_in_touch' })).toBe(true)
    expect(isKeepInTouch({ origin: 'manual', action_type: 'call' })).toBe(false)
  })
})

describe('filterBoard', () => {
  const board: TaskBoard = {
    ...EMPTY_BOARD,
    tasks: [
      task({ id: 'mine', assigned_to: 'braun', action_type: 'call', origin: 'manual' }),
      task({ id: 'theirs', assigned_to: 'other', action_type: 'call', origin: 'auto:kit' }),
      task({ id: 'ai', assigned_to: 'braun', action_type: 'whatsapp', origin: 'quick_capture_ai' }),
    ],
  }

  it('narrows to mine', () => {
    expect(filterBoard(board, { memberId: 'braun', scope: 'mine' }).tasks.map((t) => t.id)).toEqual([
      'mine',
      'ai',
    ])
  })

  it('narrows by action type and by origin family', () => {
    expect(filterBoard(board, { actionType: 'whatsapp' }).tasks.map((t) => t.id)).toEqual(['ai'])
    expect(filterBoard(board, { origin: 'auto' }).tasks.map((t) => t.id)).toEqual(['theirs'])
    expect(filterBoard(board, { origin: 'quick_capture_ai' }).tasks.map((t) => t.id)).toEqual(['ai'])
  })

  it('knows whether the member has a queue of their own', () => {
    expect(hasOwnTasks(board, 'braun')).toBe(true)
    expect(hasOwnTasks(board, 'nobody')).toBe(false)
    expect(hasOwnTasks(board, null)).toBe(false)
  })
})
