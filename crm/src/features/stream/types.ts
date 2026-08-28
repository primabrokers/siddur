/**
 * Row shapes for the Action Stream's rail.
 *
 * `signals` (02 §3.18) is the nudge rail's storage: one row per fired rule with
 * the "why am I seeing this" reason string, produced by the nightly run (08 §3).
 */

import type { ContactRow } from '../contacts/types'

export type SignalState = 'open' | 'snoozed' | 'dismissed' | 'acted'

export interface SignalRow {
  id: string
  contact_id: string
  /** `first_gift_call` · `recurring_failing` · `neglect_flags` … (08 §2–3). */
  rule_key: string
  reason: string
  state: SignalState
  snoozed_until: string | null
  dedupe_key: string
  created_at: string
  resolved_at: string | null
}

/** A signal with the contact it points at, ready for a `<NudgeCard>`. */
export interface SignalWithContact {
  signal: SignalRow
  contact: ContactRow | null
  contactName: string
}

export interface SignalsResult {
  items: SignalWithContact[]
  /** Non-null when the `signals` table is unreadable — the rail hides itself. */
  error: string | null
}

/** The rail's pledge card — computed from overdue installments (04 §1). */
export interface PledgeSummary {
  overdueCount: number
  outstanding: number
}
