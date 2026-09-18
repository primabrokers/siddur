import { describe, expect, it } from 'vitest'
import {
  buildCards,
  cardFlag,
  cardSummary,
  compactMoney,
  daysInStage,
  defaultExpected,
  filterByScope,
  groupByStage,
  idleDays,
  isForwardMove,
  isRotting,
  movePatch,
  nextMoveFor,
  nextMoveWhen,
  pipelineTotals,
  revertMovePatch,
  revertStatusPatch,
  sortCards,
  staleCards,
  staleDaysFrom,
  statusPatch,
  toStages,
  weightedValue,
} from '../src/features/pipeline/logic'
import type {
  LookupOption,
  OpportunityRow,
  PipelineBoard,
  TaskRecord,
} from '../src/features/pipeline/types'

/**
 * The Pipeline board's arithmetic (06 §2): the urgency sort, the rotting
 * clock, forward-move detection, the weighted totals and the won/lost
 * transitions. All pure — no database, no React, one frozen "now".
 */

const NOW = new Date('2026-08-28T09:00:00.000Z')

const STAGE_OPTIONS: LookupOption[] = [
  {
    value: 'identified',
    label: 'Identified',
    sort_order: 10,
    color: null,
    meta: { exit_criteria: 'We know who they are', rot_days: 45 },
  },
  {
    value: 'qualified',
    label: 'Qualified',
    sort_order: 20,
    color: null,
    meta: { exit_criteria: 'Capacity confirmed', rot_days: 30 },
  },
  {
    value: 'cultivating',
    label: 'Cultivating',
    sort_order: 30,
    color: null,
    meta: { exit_criteria: 'They have seen the work', rot_days: 45 },
  },
  {
    value: 'solicited',
    label: 'Solicited',
    sort_order: 40,
    color: null,
    meta: { exit_criteria: 'A number has been asked for', rot_days: 14 },
  },
  {
    value: 'pledged',
    label: 'Pledged',
    sort_order: 50,
    color: null,
    meta: { exit_criteria: 'Commitment made' },
  },
]

const stages = toStages(STAGE_OPTIONS)

const opportunity = (over: Partial<OpportunityRow> = {}): OpportunityRow => ({
  id: 'o1',
  contact_id: 'c1',
  name: 'Building campaign',
  campaign_id: null,
  fund_id: null,
  ask_amount: 20000,
  ask_date: null,
  projection_high: null,
  projection_low: null,
  probability_pct: 70,
  expected_amount: null,
  stage: 'cultivating',
  stage_entered_at: '2026-08-20T09:00:00.000Z',
  last_moved_forward_at: '2026-08-20T09:00:00.000Z',
  expected_decision_on: '2026-10-15',
  motivation: null,
  restrictions: null,
  status: 'open',
  opened_on: '2026-05-01',
  closed_on: null,
  lost_reason: null,
  notes: null,
  ...over,
})

const task = (over: Partial<TaskRecord> = {}): TaskRecord =>
  ({
    id: 't1',
    contact_id: 'c1',
    opportunity_id: 'o1',
    title: 'Call re proposal',
    action_type: 'call',
    details: null,
    assigned_to: null,
    due_on: '2026-08-30',
    priority: 'medium',
    status: 'todo',
    waiting_for: null,
    queue_order: null,
    completed_at: null,
    origin: 'manual',
    ...over,
  }) as TaskRecord

const contact = (id: string, first: string, last: string, ownerId: string | null) =>
  ({
    id,
    title: null,
    first_name: first,
    last_name: last,
    hebrew_name: null,
    organization: null,
    relationship_owner_id: ownerId,
  }) as never

/* --------------------------------------------------------------- stages */

describe('stage configuration (lookup meta)', () => {
  it('reads exit criteria and rot days out of lookup meta, in sort order', () => {
    expect(stages.map((stage) => stage.value)).toEqual([
      'identified',
      'qualified',
      'cultivating',
      'solicited',
      'pledged',
    ])
    expect(stages[1]).toMatchObject({ exitCriteria: 'Capacity confirmed', rotDays: 30 })
  })

  it('treats a stage with no rot_days as one that never rots', () => {
    expect(stages[4]?.rotDays).toBeNull()
  })
})

/* -------------------------------------------------- forward-move detection */

describe('forward-move detection', () => {
  it('is forward only when the stage is later in the configured flow', () => {
    expect(isForwardMove(stages, 'qualified', 'solicited')).toBe(true)
    expect(isForwardMove(stages, 'solicited', 'qualified')).toBe(false)
    expect(isForwardMove(stages, 'qualified', 'qualified')).toBe(false)
  })

  it('never calls a move involving a retired stage forward', () => {
    expect(isForwardMove(stages, 'legacy_stage', 'pledged')).toBe(false)
    expect(isForwardMove(stages, 'qualified', 'legacy_stage')).toBe(false)
  })

  it('restarts the stage clock on every move but the forward clock only on advances', () => {
    const row = opportunity({ stage: 'qualified' })
    const forward = movePatch(row, 'solicited', stages, NOW)
    expect(forward).toEqual({
      stage: 'solicited',
      stage_entered_at: NOW.toISOString(),
      last_moved_forward_at: NOW.toISOString(),
    })

    const backward = movePatch(row, 'identified', stages, NOW)
    expect(backward).toEqual({ stage: 'identified', stage_entered_at: NOW.toISOString() })
    expect(backward && 'last_moved_forward_at' in backward).toBe(false)
  })

  it('is a no-op when the card is dropped back on its own column', () => {
    expect(movePatch(opportunity({ stage: 'qualified' }), 'qualified', stages, NOW)).toBeNull()
  })

  it('restores both clocks exactly on undo', () => {
    const row = opportunity({ stage: 'qualified', last_moved_forward_at: null })
    expect(revertMovePatch(row)).toEqual({
      stage: 'qualified',
      stage_entered_at: row.stage_entered_at,
      last_moved_forward_at: null,
    })
  })
})

/* ----------------------------------------------------------------- rotting */

describe('rotting (per-stage idle threshold)', () => {
  it('counts whole calendar days in the current stage', () => {
    expect(daysInStage({ stage_entered_at: '2026-07-21T23:30:00.000Z' }, NOW)).toBe(38)
  })

  it('shades a card only once it is past its own stage threshold', () => {
    const idle38 = { stage_entered_at: '2026-07-21T09:00:00.000Z', status: 'open' as const }
    // 38 days: past qualified's 30, inside cultivating's 45.
    expect(isRotting({ ...idle38, stage: 'qualified' }, stages, NOW)).toBe(true)
    expect(isRotting({ ...idle38, stage: 'cultivating' }, stages, NOW)).toBe(false)
  })

  it('does not rot exactly on the threshold — only past it', () => {
    const exactly14 = { stage: 'solicited', stage_entered_at: '2026-08-14T09:00:00.000Z', status: 'open' as const }
    expect(isRotting(exactly14, stages, NOW)).toBe(false)
    expect(isRotting({ ...exactly14, stage_entered_at: '2026-08-13T09:00:00.000Z' }, stages, NOW)).toBe(true)
  })

  it('never rots a stage with no threshold, or an ask that is already decided', () => {
    expect(
      isRotting({ stage: 'pledged', stage_entered_at: '2025-01-01T09:00:00.000Z', status: 'open' }, stages, NOW),
    ).toBe(false)
    expect(
      isRotting({ stage: 'solicited', stage_entered_at: '2025-01-01T09:00:00.000Z', status: 'won' }, stages, NOW),
    ).toBe(false)
  })
})

/* --------------------------------------------------------------- next move */

describe('the next move', () => {
  it('is the earliest open task linked to the ask', () => {
    const tasks = [
      task({ id: 'later', due_on: '2026-09-10' }),
      task({ id: 'soonest', due_on: '2026-08-29' }),
      task({ id: 'other-ask', opportunity_id: 'o2', due_on: '2026-08-01' }),
      task({ id: 'done', due_on: '2026-08-02', status: 'done' }),
    ]
    expect(nextMoveFor('o1', tasks)?.id).toBe('soonest')
  })

  it('ignores dateless queued tasks — a move without a date is not a move', () => {
    expect(nextMoveFor('o1', [task({ status: 'queued', due_on: null })])).toBeNull()
  })

  it('flags the card from the task, and yellow when there is none (I-3)', () => {
    expect(cardFlag(null, NOW)).toBe('none')
    expect(cardFlag(task({ due_on: '2026-08-27' }), NOW)).toBe('overdue')
    expect(cardFlag(task({ due_on: '2026-08-28' }), NOW)).toBe('today')
    expect(cardFlag(task({ due_on: '2026-09-03' }), NOW)).toBe('future')
    expect(cardFlag(task({ status: 'waiting', due_on: '2026-09-03' }), NOW)).toBe('waiting')
  })

  it('words the due date the way the card reads it', () => {
    expect(nextMoveWhen(task({ due_on: '2026-08-20' }), NOW)).toBe('overdue')
    expect(nextMoveWhen(task({ due_on: '2026-08-28' }), NOW)).toBe('today')
    expect(nextMoveWhen(task({ due_on: '2026-08-29' }), NOW)).toBe('tomorrow')
    expect(nextMoveWhen(task({ due_on: '2026-09-03' }), NOW)).toBe('3 Sep')
  })
})

/* ------------------------------------------------------------ urgency sort */

describe('urgency sort within a column (▸ Pipedrive)', () => {
  const board = (rows: OpportunityRow[], tasks: TaskRecord[]): PipelineBoard => ({
    opportunities: rows,
    contacts: {
      c1: contact('c1', 'Dovid', 'Cohen', 'braun'),
      c2: contact('c2', 'Naftoli', 'Katz', 'braun'),
      c3: contact('c3', 'Bina', 'Halberstam', 'klein'),
      c4: contact('c4', 'Feld Brothers', 'Ltd', 'braun'),
    },
    tasks,
  })

  it('puts red and orange first, yellow above grey, and value nowhere', () => {
    const rows = [
      opportunity({ id: 'future-big', contact_id: 'c3', ask_amount: 80000 }),
      opportunity({ id: 'overdue-small', contact_id: 'c1', ask_amount: 2000 }),
      opportunity({ id: 'no-move', contact_id: 'c4', ask_amount: 12000 }),
      opportunity({ id: 'today', contact_id: 'c2', ask_amount: 40000 }),
    ]
    const tasks = [
      task({ id: 'a', opportunity_id: 'future-big', due_on: '2026-09-30' }),
      task({ id: 'b', opportunity_id: 'overdue-small', due_on: '2026-08-01' }),
      task({ id: 'c', opportunity_id: 'today', due_on: '2026-08-28' }),
    ]
    const sorted = sortCards(buildCards(board(rows, tasks), stages, NOW))
    expect(sorted.map((card) => card.opportunity.id)).toEqual([
      'overdue-small',
      'today',
      'no-move',
      'future-big',
    ])
  })

  it('breaks ties by the earlier date, then by the larger ask', () => {
    const rows = [
      opportunity({ id: 'small-same-day', contact_id: 'c1', ask_amount: 1000 }),
      opportunity({ id: 'big-same-day', contact_id: 'c2', ask_amount: 90000 }),
      opportunity({ id: 'earlier', contact_id: 'c3', ask_amount: 5000 }),
    ]
    const tasks = [
      task({ id: 'a', opportunity_id: 'small-same-day', due_on: '2026-09-05' }),
      task({ id: 'b', opportunity_id: 'big-same-day', due_on: '2026-09-05' }),
      task({ id: 'c', opportunity_id: 'earlier', due_on: '2026-09-01' }),
    ]
    const sorted = sortCards(buildCards(board(rows, tasks), stages, NOW))
    expect(sorted.map((card) => card.opportunity.id)).toEqual([
      'earlier',
      'big-same-day',
      'small-same-day',
    ])
  })

  it('groups into columns with a Σ ask per column', () => {
    const rows = [
      opportunity({ id: 'q1', stage: 'qualified', ask_amount: 40000 }),
      opportunity({ id: 'q2', stage: 'qualified', ask_amount: 12000 }),
      opportunity({ id: 's1', stage: 'solicited', ask_amount: 35000 }),
    ]
    const columns = groupByStage(buildCards(board(rows, []), stages, NOW), stages)
    expect(columns.find((column) => column.stage.value === 'qualified')?.total).toBe(52000)
    expect(columns.find((column) => column.stage.value === 'solicited')?.total).toBe(35000)
    expect(columns.find((column) => column.stage.value === 'identified')?.cards).toEqual([])
  })
})

/* -------------------------------------------------------- weighted totals */

describe('weighted pipeline totals', () => {
  it('weights each ask by its probability', () => {
    expect(weightedValue({ ask_amount: 40000, probability_pct: 40, expected_amount: null })).toBe(16000)
    expect(weightedValue({ ask_amount: 20000, probability_pct: 70, expected_amount: null })).toBe(14000)
  })

  it('falls back to a stored expected amount when there is no probability', () => {
    expect(weightedValue({ ask_amount: 20000, probability_pct: null, expected_amount: 9000 })).toBe(9000)
    expect(weightedValue({ ask_amount: null, probability_pct: null, expected_amount: null })).toBe(0)
  })

  it('sums ask, weighted, open count and the no-next-move count over open asks only', () => {
    const rows = [
      opportunity({ id: 'a', ask_amount: 40000, probability_pct: 40 }),
      opportunity({ id: 'b', ask_amount: 20000, probability_pct: 70 }),
      opportunity({ id: 'c', ask_amount: 80000, probability_pct: 30 }),
      opportunity({ id: 'won', ask_amount: 99000, probability_pct: 100, status: 'won' }),
    ]
    const cards = buildCards(
      { opportunities: rows, contacts: {}, tasks: [task({ opportunity_id: 'a' })] },
      stages,
      NOW,
    )
    expect(pipelineTotals(cards)).toEqual({
      ask: 140000,
      weighted: 16000 + 14000 + 24000,
      open: 3,
      needsNextMove: 2,
    })
  })

  it('offers ask × probability as the expected default the sheet prefills', () => {
    expect(defaultExpected(40000, 40)).toBe(16000)
    expect(defaultExpected(40000, null)).toBeNull()
  })

  it('compacts money the way the columns and cards render it', () => {
    expect(compactMoney(40000)).toBe('£40k')
    expect(compactMoney(52000)).toBe('£52k')
    expect(compactMoney(1500)).toBe('£1.5k')
    expect(compactMoney(1_250_000)).toBe('£1.3m')
    expect(compactMoney(750)).toBe('£750')
    expect(compactMoney(null)).toBe('—')
  })
})

/* ------------------------------------------------------------------ stale */

describe('the stale-prospects list (▸ MarketSmart, adapted)', () => {
  it('measures from the last forward move, falling back to when it opened', () => {
    expect(idleDays(opportunity({ last_moved_forward_at: '2026-04-20T09:00:00.000Z' }), NOW)).toBe(130)
    expect(
      idleDays(opportunity({ last_moved_forward_at: null, opened_on: '2026-01-01' }), NOW),
    ).toBe(239)
  })

  it('lists only open asks past the window, worst first', () => {
    const rows = [
      opportunity({ id: 'fresh', last_moved_forward_at: '2026-08-01T09:00:00.000Z' }),
      opportunity({ id: 'stale', last_moved_forward_at: '2026-04-20T09:00:00.000Z' }),
      opportunity({ id: 'worse', last_moved_forward_at: '2026-01-20T09:00:00.000Z' }),
      opportunity({ id: 'lost-old', last_moved_forward_at: '2025-01-20T09:00:00.000Z', status: 'lost' }),
    ]
    const cards = buildCards({ opportunities: rows, contacts: {}, tasks: [] }, stages, NOW)
    expect(staleCards(cards, 90).map((card) => card.opportunity.id)).toEqual(['worse', 'stale'])
  })

  it('empties when the rule is switched off — it is a covenant, not a law', () => {
    const rows = [opportunity({ last_moved_forward_at: '2025-01-20T09:00:00.000Z' })]
    const cards = buildCards({ opportunities: rows, contacts: {}, tasks: [] }, stages, NOW)
    expect(staleCards(cards, 90, false)).toEqual([])
  })

  it('reads the window from automation_rules, defaulting to 90 days', () => {
    expect(staleDaysFrom([{ rule_key: 'stale_prospects', is_enabled: true, params: { days: 60 } }])).toBe(60)
    expect(staleDaysFrom([{ rule_key: 'other', is_enabled: true, params: {} }])).toBe(90)
    expect(staleDaysFrom(undefined)).toBe(90)
  })
})

/* ------------------------------------------------------- won/lost outcomes */

describe('won / lost / on-hold transitions', () => {
  it('closes a win with the decision date and no reason', () => {
    expect(statusPatch('won', { now: NOW })).toEqual({
      status: 'won',
      closed_on: '2026-08-28',
      lost_reason: null,
    })
  })

  it('closes a loss with the lookup reason the conversion report groups by', () => {
    expect(statusPatch('lost', { reason: 'gave_elsewhere', now: NOW })).toEqual({
      status: 'lost',
      closed_on: '2026-08-28',
      lost_reason: 'gave_elsewhere',
    })
  })

  it('does not close an ask that is only on hold', () => {
    expect(statusPatch('on_hold', { now: NOW })).toEqual({
      status: 'on_hold',
      closed_on: null,
      lost_reason: null,
    })
  })

  it('clears a stale reason when an ask is reopened', () => {
    expect(statusPatch('open', { reason: 'timing', now: NOW }).lost_reason).toBeNull()
  })

  it('restores status, close date and reason together on undo', () => {
    const row = opportunity({ status: 'lost', closed_on: '2026-08-01', lost_reason: 'timing' })
    expect(revertStatusPatch(row)).toEqual({
      status: 'lost',
      closed_on: '2026-08-01',
      lost_reason: 'timing',
    })
  })
})

/* -------------------------------------------------------------- portfolio */

describe('the Mine / Everyone portfolio filter', () => {
  const rows = [
    opportunity({ id: 'mine', contact_id: 'c1' }),
    opportunity({ id: 'theirs', contact_id: 'c3' }),
  ]
  const cards = buildCards(
    {
      opportunities: rows,
      contacts: { c1: contact('c1', 'Dovid', 'Cohen', 'braun'), c3: contact('c3', 'Bina', 'H', 'klein') },
      tasks: [],
    },
    stages,
    NOW,
  )

  it('scopes by the donor’s relationship owner', () => {
    expect(filterByScope(cards, 'mine', 'braun').map((card) => card.opportunity.id)).toEqual(['mine'])
    expect(filterByScope(cards, 'everyone', 'braun')).toHaveLength(2)
  })

  it('shows everything when the member is not known yet', () => {
    expect(filterByScope(cards, 'mine', null)).toHaveLength(2)
  })
})

/* ----------------------------------------------------------------- labels */

describe('the card summary line', () => {
  it('reads name · probability · decision month', () => {
    expect(cardSummary(opportunity())).toBe('Building campaign · 70% · decide Oct')
  })

  it('says so when there is no decision date', () => {
    expect(cardSummary(opportunity({ expected_decision_on: null, probability_pct: 30 }))).toBe(
      'Building campaign · 30% · no date',
    )
  })
})
