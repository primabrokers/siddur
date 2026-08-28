/**
 * Everything the Pipeline board decides, as pure functions (06 §2).
 *
 * The three borrowed behaviours live here and nowhere else:
 *  1. cards sort by **next-activity urgency**, never by value (▸ Pipedrive);
 *  2. a card **rots** once it has sat in its stage past that stage's
 *     `meta.rot_days` — ambient shading, no notification (▸ Pipedrive);
 *  3. an opportunity goes **stale** when it has not moved *forward* inside the
 *     `stale_prospects` window (▸ MarketSmart, softened to a visible list).
 *
 * Nothing here touches the network or React, so the arithmetic the board is
 * trusted for is unit-testable on its own (tests/pipeline-logic.test.ts).
 */

import { differenceInCalendarDays, format, startOfDay } from 'date-fns'
import { FLAG_ORDER, type FlagVariant } from '../../components/FlagDot'
import { toDate } from '../../lib/format'
import { toISODate } from '../../lib/dates'
import { displayName } from '../contacts/normalise'
import type {
  ContactRow,
  LookupOption,
  OpportunityRow,
  OpportunityStatus,
  PipelineBoard,
  PipelineStage,
  TaskRecord,
} from './types'

/** Statuses that still sit on someone's plate — the same set the tasks use. */
export const OPEN_TASK_STATUSES = ['todo', 'in_progress', 'waiting'] as const

/** The stale-prospects default when `automation_rules` has no row (08 §7). */
export const DEFAULT_STALE_DAYS = 90

/** PostgREST hands numerics back as numbers; a string still slips through CSV
 *  imports and fixtures, so every amount goes through here first. */
export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * What someone typed into a money field: `£40,000` → `40000`.
 * (The same rule as `giving/logic.parseAmount`, restated rather than imported —
 * the sheet should not pull the whole giving module in for four lines.)
 */
export const parseAmount = (value: string | number | null | undefined): number | null =>
  num(typeof value === 'string' ? value.replace(/[£,\s]/g, '') : value)

/* ------------------------------------------------------------------ stages */

/** `lookup_options('opportunity_stage')` → the board's columns, in order. */
export function toStages(options: LookupOption[] | undefined | null): PipelineStage[] {
  return [...(options ?? [])]
    .map((option) => {
      const meta = (option.meta ?? {}) as Record<string, unknown>
      const rot = num(meta.rot_days)
      const exit = typeof meta.exit_criteria === 'string' ? meta.exit_criteria.trim() : ''
      return {
        value: option.value,
        label: option.label,
        sortOrder: option.sort_order,
        exitCriteria: exit === '' ? null : exit,
        rotDays: rot !== null && rot > 0 ? Math.round(rot) : null,
      }
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

/** Position of a stage in the flow; `-1` for a value no longer in the list. */
export const stageRank = (stages: PipelineStage[], value: string): number =>
  stages.findIndex((stage) => stage.value === value)

export const stageOf = (stages: PipelineStage[], value: string): PipelineStage | null =>
  stages.find((stage) => stage.value === value) ?? null

/**
 * Forward = later in the configured flow. A retired stage (rank -1) can never
 * count as forward motion in either direction: we do not know where it sat.
 */
export function isForwardMove(stages: PipelineStage[], from: string, to: string): boolean {
  if (from === to) return false
  const a = stageRank(stages, from)
  const b = stageRank(stages, to)
  if (a < 0 || b < 0) return false
  return b > a
}

export interface StagePatch {
  stage: string
  stage_entered_at: string
  /**
   * Only written on a forward move — that is what makes the stale list mean
   * "has not advanced" rather than "has not been touched". The undo patch sets
   * it back explicitly, hence `null` as well as absent.
   */
  last_moved_forward_at?: string | null
}

/**
 * The write behind a drag between columns (02 §3.9): the stage clock always
 * restarts, the *forward* clock only when the card actually advanced.
 * Returns null for a drop back onto the same column.
 */
export function movePatch(
  opportunity: Pick<OpportunityRow, 'stage'>,
  toStage: string,
  stages: PipelineStage[],
  now: Date = new Date(),
): StagePatch | null {
  if (opportunity.stage === toStage) return null
  const stamp = now.toISOString()
  const patch: StagePatch = { stage: toStage, stage_entered_at: stamp }
  if (isForwardMove(stages, opportunity.stage, toStage)) patch.last_moved_forward_at = stamp
  return patch
}

/** Undo for a move — every clock the drag touched, restored verbatim. */
export function revertMovePatch(opportunity: OpportunityRow): StagePatch {
  return {
    stage: opportunity.stage,
    stage_entered_at: opportunity.stage_entered_at,
    last_moved_forward_at: opportunity.last_moved_forward_at,
  }
}

/* ----------------------------------------------------------------- rotting */

/** Whole days the card has sat in its current column. */
export function daysInStage(opportunity: Pick<OpportunityRow, 'stage_entered_at'>, now: Date = new Date()): number {
  const entered = toDate(opportunity.stage_entered_at)
  if (!entered) return 0
  return Math.max(0, differenceInCalendarDays(startOfDay(now), startOfDay(entered)))
}

/**
 * Rotting: idle *past* the stage's threshold. Closed opportunities never rot —
 * a won ask sitting in `pledged` is finished, not neglected.
 */
export function isRotting(
  opportunity: Pick<OpportunityRow, 'stage' | 'stage_entered_at' | 'status'>,
  stages: PipelineStage[],
  now: Date = new Date(),
): boolean {
  if (opportunity.status !== 'open') return false
  const rotDays = stageOf(stages, opportunity.stage)?.rotDays ?? null
  if (rotDays === null) return false
  return daysInStage(opportunity, now) > rotDays
}

/* --------------------------------------------------------------- next move */

const isOpenTask = (task: Pick<TaskRecord, 'status'>): boolean =>
  (OPEN_TASK_STATUSES as readonly string[]).includes(task.status)

/**
 * The next move on a card: the earliest-dated open task linked to it
 * (`tasks.opportunity_id`, 02 §3.9). Dateless (queued) tasks are not a move —
 * they carry no commitment — so they never win here.
 */
export function nextMoveFor(opportunityId: string, tasks: TaskRecord[]): TaskRecord | null {
  const linked = tasks.filter(
    (task) => task.opportunity_id === opportunityId && isOpenTask(task) && Boolean(task.due_on),
  )
  if (linked.length === 0) return null
  return [...linked].sort((a, b) => (a.due_on ?? '').localeCompare(b.due_on ?? ''))[0] ?? null
}

/**
 * The card's flag (03 §2) — the *task's* own reading, not a contact rollup.
 * No open move at all is yellow, which sorts worse than a grey future one
 * (I-3, the Pipedrive insight the whole board leans on).
 */
export function cardFlag(task: TaskRecord | null, now: Date = new Date()): FlagVariant {
  if (!task) return 'none'
  if (task.status === 'waiting') return 'waiting'
  const due = toDate(task.due_on)
  if (!due) return 'none'
  const diff = differenceInCalendarDays(startOfDay(due), startOfDay(now))
  if (diff < 0) return 'overdue'
  if (diff === 0) return 'today'
  return 'future'
}

/** `overdue` · `today` · `tomorrow` · `3 Sep` — the tail of the next-move line. */
export function nextMoveWhen(task: TaskRecord, now: Date = new Date()): string {
  const due = toDate(task.due_on)
  if (!due) return 'no date'
  const diff = differenceInCalendarDays(startOfDay(due), startOfDay(now))
  if (diff < 0) return 'overdue'
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  return format(due, 'd MMM')
}

/* ------------------------------------------------------------------ money */

/** Ask × probability, falling back to a stored `expected_amount` (02 §3.9). */
export function weightedValue(opportunity: Pick<OpportunityRow, 'ask_amount' | 'probability_pct' | 'expected_amount'>): number {
  const ask = num(opportunity.ask_amount)
  const probability = num(opportunity.probability_pct)
  if (ask !== null && probability !== null) return Math.round((ask * probability) / 100)
  return num(opportunity.expected_amount) ?? 0
}

/** The default the sheet offers for `expected_amount` (ask × probability). */
export const defaultExpected = (ask: number | null, probability: number | null): number | null =>
  ask === null || probability === null ? null : Math.round((ask * probability) / 100)

/** `£40k` · `£212k` · `£1.2m` — the column-header and card compaction the
 *  wireframe uses. The header keeps full precision; cards do not have room. */
export function compactMoney(amount: number | null | undefined): string {
  const value = num(amount)
  if (value === null) return '—'
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs >= 1_000_000) {
    const millions = abs / 1_000_000
    return `${sign}£${millions >= 10 ? Math.round(millions) : Number(millions.toFixed(1))}m`
  }
  if (abs >= 1_000) {
    const thousands = abs / 1_000
    return `${sign}£${thousands >= 10 ? Math.round(thousands) : Number(thousands.toFixed(1))}k`
  }
  return `${sign}£${Math.round(abs)}`
}

/* ------------------------------------------------------------------ cards */

export interface PipelineCard {
  opportunity: OpportunityRow
  contact: ContactRow | null
  /** Display name, resolved once so sorting and search do not redo it. */
  donor: string
  nextMove: TaskRecord | null
  flag: FlagVariant
  rotting: boolean
  daysInStage: number
  ask: number | null
  weighted: number
  /** Days since the last *forward* move (or since it opened). */
  idleDays: number
}

/** Days since forward motion — `last_moved_forward_at`, else `opened_on`. */
export function idleDays(opportunity: OpportunityRow, now: Date = new Date()): number {
  const moved = toDate(opportunity.last_moved_forward_at) ?? toDate(opportunity.opened_on)
  if (!moved) return 0
  return Math.max(0, differenceInCalendarDays(startOfDay(now), startOfDay(moved)))
}

export function buildCard(
  opportunity: OpportunityRow,
  board: PipelineBoard,
  stages: PipelineStage[],
  now: Date = new Date(),
): PipelineCard {
  const contact = board.contacts[opportunity.contact_id] ?? null
  const nextMove = nextMoveFor(opportunity.id, board.tasks)
  return {
    opportunity,
    contact,
    donor: contact ? displayName(contact) : 'Unknown donor',
    nextMove,
    flag: cardFlag(nextMove, now),
    rotting: isRotting(opportunity, stages, now),
    daysInStage: daysInStage(opportunity, now),
    ask: num(opportunity.ask_amount),
    weighted: weightedValue(opportunity),
    idleDays: idleDays(opportunity, now),
  }
}

export function buildCards(
  board: PipelineBoard,
  stages: PipelineStage[],
  now: Date = new Date(),
): PipelineCard[] {
  return board.opportunities.map((opportunity) => buildCard(opportunity, board, stages, now))
}

/**
 * Urgency first (red → orange → yellow → blue → grey), then the earliest date,
 * then the biggest ask as a tie-break. Value never outranks urgency: that is
 * the whole point of the borrowed sort (06 §2 behaviour 1).
 */
export function sortCards(cards: PipelineCard[]): PipelineCard[] {
  return [...cards].sort((a, b) => {
    const flag = FLAG_ORDER[a.flag] - FLAG_ORDER[b.flag]
    if (flag !== 0) return flag
    const dueA = a.nextMove?.due_on ?? ''
    const dueB = b.nextMove?.due_on ?? ''
    if (dueA !== dueB) {
      if (dueA === '') return 1
      if (dueB === '') return -1
      return dueA.localeCompare(dueB)
    }
    return (b.ask ?? 0) - (a.ask ?? 0)
  })
}

export interface PipelineColumn {
  stage: PipelineStage
  cards: PipelineCard[]
  /** Σ ask in the column — the figure beside the stage name. */
  total: number
}

/** Group the open cards into columns, sorted, with the header total. */
export function groupByStage(cards: PipelineCard[], stages: PipelineStage[]): PipelineColumn[] {
  return stages.map((stage) => {
    const inStage = sortCards(cards.filter((card) => card.opportunity.stage === stage.value))
    return {
      stage,
      cards: inStage,
      total: inStage.reduce((sum, card) => sum + (card.ask ?? 0), 0),
    }
  })
}

/* ----------------------------------------------------------------- totals */

export interface PipelineTotals {
  /** Σ ask across the open opportunities on the board. */
  ask: number
  /** Σ ask × probability — the weighted pipeline (06 §2). */
  weighted: number
  open: number
  /** Open cards with no open linked task (I-3: surfaced, never enforced). */
  needsNextMove: number
}

export function pipelineTotals(cards: PipelineCard[]): PipelineTotals {
  const open = cards.filter((card) => card.opportunity.status === 'open')
  return {
    ask: open.reduce((sum, card) => sum + (card.ask ?? 0), 0),
    weighted: open.reduce((sum, card) => sum + card.weighted, 0),
    open: open.length,
    needsNextMove: open.filter((card) => card.nextMove === null).length,
  }
}

/* ------------------------------------------------------------------ stale */

/** `automation_rules('stale_prospects').params.days`, default 90 (08 §7). */
export function staleDaysFrom(
  rules: Array<{ rule_key: string; is_enabled: boolean; params: Record<string, unknown> }> | undefined | null,
): number {
  const rule = (rules ?? []).find((row) => row.rule_key === 'stale_prospects')
  const days = num(rule?.params?.days)
  return days !== null && days > 0 ? Math.round(days) : DEFAULT_STALE_DAYS
}

/**
 * "Advance or decide" (06 §2 behaviour 3): open opportunities with no forward
 * move inside the window, worst first. A rule switched off empties the panel —
 * it is a covenant the organisation opts into, not a law.
 */
export function staleCards(cards: PipelineCard[], days: number, enabled = true): PipelineCard[] {
  if (!enabled) return []
  return cards
    .filter((card) => card.opportunity.status === 'open' && card.idleDays > days)
    .sort((a, b) => b.idleDays - a.idleDays)
}

/* -------------------------------------------------------------- outcomes */

export interface StatusPatch {
  status: OpportunityStatus
  closed_on: string | null
  lost_reason: string | null
}

/**
 * Won · lost · on hold · reopened (06 §2 footer zones).
 *
 * Won and lost close the record with a date so the conversion report can count
 * days-to-decision; on hold does not — a paused ask is still live. Only a loss
 * carries a reason, and moving off `lost` clears it so no stale reason survives
 * a reopen.
 */
export function statusPatch(
  status: OpportunityStatus,
  options: { reason?: string | null; now?: Date } = {},
): StatusPatch {
  const now = options.now ?? new Date()
  return {
    status,
    closed_on: status === 'won' || status === 'lost' ? toISODate(now) : null,
    lost_reason: status === 'lost' ? (options.reason?.trim() || null) : null,
  }
}

/** Undo for an outcome — the row exactly as it was before the drop. */
export function revertStatusPatch(opportunity: OpportunityRow): StatusPatch {
  return {
    status: opportunity.status,
    closed_on: opportunity.closed_on,
    lost_reason: opportunity.lost_reason,
  }
}

export const isClosed = (status: OpportunityStatus): boolean => status === 'won' || status === 'lost'

/* ------------------------------------------------------------- portfolio */

export type PortfolioScope = 'mine' | 'everyone'

/**
 * "Mine" is the donor's relationship owner (06 §2 portfolio filter) — the
 * opportunity itself has no owner column, and the person owns the relationship.
 */
export function filterByScope(
  cards: PipelineCard[],
  scope: PortfolioScope,
  memberId: string | null | undefined,
): PipelineCard[] {
  if (scope === 'everyone' || !memberId) return cards
  return cards.filter((card) => card.contact?.relationship_owner_id === memberId)
}

/* ---------------------------------------------------------------- labels */

/** `Building campaign · 70% · decide Oct` — the card's second line. */
export function cardSummary(opportunity: OpportunityRow): string {
  const probability = num(opportunity.probability_pct)
  const decision = toDate(opportunity.expected_decision_on)
  return [
    opportunity.name,
    probability === null ? null : `${Math.round(probability)}%`,
    decision ? `decide ${format(decision, 'MMM')}` : 'no date',
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ')
}

export const STATUS_LABEL: Record<OpportunityStatus, string> = {
  open: 'Open',
  won: 'Won',
  lost: 'Lost',
  on_hold: 'On hold',
}
