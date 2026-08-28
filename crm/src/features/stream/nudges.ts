/**
 * `signals.rule_key` → the nudge card's colour, headline and primary verb
 * (04 §1, 08 §2–3). One table so the rail stays legible when the nightly run
 * adds a rule: an unknown key still renders, in the neutral accent, with its
 * key humanised — never silently dropped.
 */

import type { NudgeAccent } from '../../components'

export type NudgeAction = 'profile' | 'call' | 'task'

export interface NudgeSpec {
  accent: NudgeAccent
  /** Uppercase headline — "FIRST GIFT THIS WEEK". */
  title: string
  primaryLabel: string
  primary: NudgeAction
  /** Prefill for the task the primary verb creates. */
  actionType?: string
}

const SPECS: Record<string, NudgeSpec> = {
  first_gift_call: {
    accent: 'accent',
    title: 'FIRST GIFT THIS WEEK',
    primaryLabel: 'Call now',
    primary: 'call',
    actionType: 'call',
  },
  thank_you_on_gift: {
    accent: 'accent',
    title: 'MAJOR GIFT — SAY THANK YOU',
    primaryLabel: 'Open profile',
    primary: 'profile',
  },
  recurring_failing: {
    accent: 'overdue',
    title: 'STANDING ORDER FAILED',
    primaryLabel: 'Open profile',
    primary: 'profile',
  },
  pledge_chase: {
    accent: 'gold',
    title: 'PLEDGE OVERDUE',
    primaryLabel: 'Schedule chase',
    primary: 'task',
    actionType: 'call',
  },
  neglect_flags: {
    accent: 'today',
    title: 'GOING QUIET',
    primaryLabel: 'Schedule call',
    primary: 'task',
    actionType: 'call',
  },
  engagement_recompute: {
    accent: 'today',
    title: 'ENGAGEMENT DROPPING',
    primaryLabel: 'Schedule call',
    primary: 'task',
    actionType: 'call',
  },
  donor_status_recompute: {
    accent: 'today',
    title: 'ENTERING PRE-LAPSED',
    primaryLabel: 'Schedule call',
    primary: 'task',
    actionType: 'call',
  },
  proposal_follow_up: {
    accent: 'accent',
    title: 'PROPOSAL WAITING',
    primaryLabel: 'Schedule follow-up',
    primary: 'task',
    actionType: 'follow_up_proposal',
  },
  ga_declaration_chase: {
    accent: 'gold',
    title: 'GIFT AID DECLARATION MISSING',
    primaryLabel: 'Open profile',
    primary: 'profile',
  },
  meeting_reminder: {
    accent: 'accent',
    title: 'MEETING TOMORROW',
    primaryLabel: 'Open profile',
    primary: 'profile',
  },
}

export function nudgeSpec(ruleKey: string): NudgeSpec {
  const known = SPECS[ruleKey]
  if (known) return known
  return {
    accent: 'accent',
    title: ruleKey.replace(/[:_]/g, ' ').toUpperCase(),
    primaryLabel: 'Open profile',
    primary: 'profile',
  }
}

/** Ordering on the rail: red first, then orange, then the rest (03 §2). */
const ACCENT_RANK: Record<NudgeAccent, number> = {
  overdue: 0,
  today: 1,
  gold: 2,
  accent: 3,
  none: 4,
}

export const nudgeRank = (ruleKey: string): number => ACCENT_RANK[nudgeSpec(ruleKey).accent]
