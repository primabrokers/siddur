/**
 * Opportunity shapes for the Pipeline board (06 §2 · 02 §3.9).
 *
 * `lost_reason` is the one column 02 §3.9 does not list; it is added by
 * `supabase/migrations/010_pipeline_seeds.sql` because 06 §2 requires a lookup
 * reason on every loss and the conversion report (06 §3) has to group by it.
 */

import type { ContactRow, LookupOption } from '../contacts/types'
import type { TaskRecord } from '../tasks/types'

export type OpportunityStatus = 'open' | 'won' | 'lost' | 'on_hold'

export interface OpportunityRow {
  id: string
  contact_id: string
  name: string
  campaign_id: string | null
  fund_id: string | null
  ask_amount: number | null
  ask_date: string | null
  projection_high: number | null
  projection_low: number | null
  probability_pct: number | null
  expected_amount: number | null
  stage: string
  /** Set on every stage change — the rotting clock (06 §2 ▸ Pipedrive). */
  stage_entered_at: string
  /** Set on *forward* stage changes only — the stale clock (▸ MarketSmart). */
  last_moved_forward_at: string | null
  expected_decision_on: string | null
  motivation: string | null
  restrictions: string | null
  status: OpportunityStatus
  opened_on: string
  closed_on: string | null
  lost_reason: string | null
  notes: string | null
  created_at?: string
}

/** What the sheet writes; every field is optional so an edit patches narrowly. */
export interface OpportunityDraft {
  contact_id?: string
  name?: string
  campaign_id?: string | null
  fund_id?: string | null
  ask_amount?: number | null
  ask_date?: string | null
  projection_high?: number | null
  projection_low?: number | null
  probability_pct?: number | null
  expected_amount?: number | null
  stage?: string
  stage_entered_at?: string
  last_moved_forward_at?: string | null
  expected_decision_on?: string | null
  motivation?: string | null
  restrictions?: string | null
  status?: OpportunityStatus
  closed_on?: string | null
  lost_reason?: string | null
  notes?: string | null
}

/**
 * One read behind the whole board: the opportunities, the donors they belong
 * to, and every open task carrying an `opportunity_id` (the "next move" line).
 *
 * Same rule as the Giving board — one cache shape, so an optimistic drag has
 * exactly one place to patch (I-12).
 */
export interface PipelineBoard {
  opportunities: OpportunityRow[]
  contacts: Record<string, ContactRow>
  /** Open tasks (`todo`/`in_progress`/`waiting`) with an `opportunity_id`. */
  tasks: TaskRecord[]
}

export const EMPTY_PIPELINE: PipelineBoard = {
  opportunities: [],
  contacts: {},
  tasks: [],
}

/** A stage column, read from `lookup_options('opportunity_stage')` (02 §6). */
export interface PipelineStage {
  value: string
  label: string
  sortOrder: number
  /** meta.exit_criteria — "what must be true to advance" (06 §2). */
  exitCriteria: string | null
  /** meta.rot_days — the per-stage idle threshold; null = never rots. */
  rotDays: number | null
}

export type { ContactRow, LookupOption, TaskRecord }
