/**
 * The Reports payload (06 §3) — a TypeScript mirror of what
 * `report_overview(p_year)` returns from `supabase/migrations/006_rfm.sql`.
 *
 * Every number here is computed by Postgres (I-8). The client does presentation
 * arithmetic only: bar geometry, movement deltas, percentage-of-a-returned-pair.
 * Nothing in `features/reports` re-derives a total from a row list.
 *
 * Money fields are `number | null` because a member without `can_see_amounts`
 * gets the same payload with every money key nulled and `amounts_hidden` true
 * (11 §2) — the counts survive, so the cards degrade to count-based rather than
 * to an empty screen.
 */

/** The period the whole screen is scoped to. `null` year = all time. */
export type ReportScope = 'this_year' | 'last_year' | 'all_time'

export interface RetentionSummary {
  year: number
  /** Donors who gave in the prior year — the denominator. */
  gave_prior: number
  /** Gave last year AND this year — the numerator. */
  retained: number
  new_donors: number
  /** Same set as `retained`, named for the card's counts row. */
  repeat_donors: number
  /** Gave this year, not last, but had given before. */
  reactivated: number
  lapsed: number
  current_donors: number
  rate: number | null
  prior_rate: number | null
  delta_pts: number | null
  benchmark_overall: number | null
  benchmark_7plus: number | null
  benchmark_source: string | null
  benchmark_year: number | null
}

export interface GivingBucket {
  /** `2026-03` for a month, `2025` for a year. Also the drill argument. */
  bucket_key: string
  label: string
  total: number | null
  gift_count: number
  donor_count: number
  is_current: boolean
}

export interface GivingSummary {
  buckets: GivingBucket[]
  total: number | null
  gift_count: number
  peak_key: string | null
}

export interface RfmSegment {
  segment: string
  tag_id: string | null
  headcount: number
  /** Headcount at the previous recompute; null before the second run. */
  previous: number | null
  is_alert: boolean
  sort_order: number
}

export interface RfmSummary {
  segments: RfmSegment[]
  computed_at: string | null
  previous_computed_at: string | null
  donors: number | null
}

export interface CampaignRow {
  id: string
  name: string
  goal: number | null
  raised: number | null
  pledged_outstanding: number | null
  gift_count: number
  donor_count: number
  /** Percent of goal — a ratio, so it survives redaction. */
  pct: number | null
  starts_on: string | null
  ends_on: string | null
}

export interface AppealRow {
  id: string
  name: string
  year: number | null
  channel: string | null
  total: number | null
  gift_count: number
  prior_id: string | null
  prior_name: string | null
  prior_year: number | null
  prior_total: number | null
  delta_pct: number | null
}

export interface ActivityMember {
  member_id: string
  member_name: string
  interactions: number
  tasks_completed: number
  gifts: number
  gift_total: number | null
}

export interface ActivitySummary {
  /** `This month` · `2025` · `All time` — the window the DB picked. */
  label: string
  from: string | null
  to: string | null
  members: ActivityMember[]
}

export interface GiftAidSummary {
  claimed: number | null
  recoverable: number | null
  coverage_pct: number | null
  donors_with_declaration: number
  donor_count: number
  eligible_gift_count: number
  pending_gift_count: number
}

export interface ReportOverview {
  year: number
  scope: string
  granularity: 'month' | 'year'
  amounts_hidden: boolean
  generated_at: string
  retention: RetentionSummary
  giving: GivingSummary
  rfm: RfmSummary
  campaigns: CampaignRow[]
  appeals: AppealRow[]
  activity: ActivitySummary
  gift_aid: GiftAidSummary
}

/* --------------------------------------------------------------- drill-through */

/**
 * The keys `report_drill(p_key, p_year, p_arg)` understands. Every number on
 * the screen maps to one of these — 06 §3: "every report ends in an actionable
 * list".
 */
export type DrillKey =
  | 'retention_new'
  | 'retention_repeat'
  | 'retention_reactivated'
  | 'retention_lapsed'
  | 'retention_prior'
  | 'donors'
  | 'rfm'
  | 'bucket'
  | 'campaign'
  | 'appeal'
  | 'activity'
  | 'gift_aid_pending'
  | 'gift_aid_eligible'

export interface DrillRow {
  contact_id: string
  contact_name: string
  secondary: string | null
  amount: number | null
  gift_count: number
  last_gift_on: string | null
}

/** What the UI passes around when a number is clicked. */
export interface DrillTarget {
  key: DrillKey
  /** Sheet heading — "Lapsed donors · 2026". */
  title: string
  arg?: string | null
  /** Overrides the screen's year (the drill is always year-scoped in SQL). */
  year?: number | null
}

/* ------------------------------------------------------------- campaign page */

export interface CampaignDetailCampaign {
  id: string
  name: string
  description: string | null
  goal: number | null
  starts_on: string | null
  ends_on: string | null
  is_active: boolean
}

export interface CampaignAppealRow {
  id: string
  name: string
  channel: string | null
  year: number | null
  total: number | null
  gift_count: number
  donor_count: number
}

export interface CampaignGiftRow {
  id: string
  contact_id: string
  contact_name: string
  donated_on: string
  amount: number | null
  appeal_name: string | null
  fund_name?: string | null
  thank_you_status?: string | null
}

export interface CampaignPledgeRow {
  id: string
  contact_id: string
  contact_name: string
  total_amount: number | null
  paid: number | null
  outstanding: number | null
  status: string
  next_due_on: string | null
  overdue_count: number
}

export interface CampaignDetail {
  campaign: CampaignDetailCampaign | null
  amounts_hidden: boolean
  progress: CampaignRow | null
  appeals: CampaignAppealRow[]
  top_gifts: CampaignGiftRow[]
  gifts: CampaignGiftRow[]
  pledges: CampaignPledgeRow[]
}
