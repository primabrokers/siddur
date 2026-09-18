/**
 * Types for `reports-fixtures.mjs`.
 *
 * The harness is plain ESM so `reports-fixture-server.mjs` can run it under
 * bare node with no build step; this file lets the vitest suites import the
 * same module with types. The shapes are deliberately the ones the RPCs return
 * (`features/reports/types.ts`), so a drift between the two shows up as a type
 * error rather than as a wrong-looking screenshot.
 */

import type {
  CampaignDetail,
  DrillKey,
  DrillRow,
  GivingBucket,
  ReportOverview,
  RetentionSummary,
} from '../src/features/reports/types'

export interface RfmParams {
  lookbackMonths: number
  minDonors: number
  topScore: number
  lowRecency: number
  newMonths: number
}

export interface LedgerGift {
  id: string
  contact_id: string
  donated_on: string
  amount_gbp: number
  status: string
  fund: { id: string; name: string }
  campaign_id: string | null
  appeal_id: string | null
  created_by: string
}

export interface LedgerContact {
  id: string
  name: string
  secondary: string
}

export interface Ledger {
  contacts: LedgerContact[]
  gifts: LedgerGift[]
}

export interface ScoredDonor {
  contact_id: string
  first_gift_on: string
  last_gift_on: string
  gift_count: number
  lifetime: number
  r_score: number
  f_score: number
  m_score: number
  segment: string
}

export interface RfmResult {
  donors: number
  counts: Record<string, number>
  assignments: Map<string, string>
  scored?: ScoredDonor[]
  skipped?: string
}

export declare const RFM_DEFAULTS: RfmParams
export declare const RFM_SEGMENTS: Array<{ name: string; isAlert: boolean; sortOrder: number }>
export declare const MONEY_KEYS: string[]
export declare const FUNDS: Array<{ id: string; name: string }>
export declare const CAMPAIGNS: Array<{
  id: string
  name: string
  goal: number
  description: string
  starts_on: string
  ends_on: string
  is_active: boolean
}>
export declare const APPEALS: Array<{
  id: string
  name: string
  year: number
  channel: string
  campaign_id: string
}>
export declare const TEAM: Array<{ member_id: string; member_name: string }>
export declare const PLEDGES: Array<{
  id: string
  contact_id: string
  campaign_id: string
  total_amount: number
  paid: number
  outstanding: number
  status: string
  next_due_on: string
  overdue_count: number
}>

export declare function isoDate(date: Date): string
export declare function monthsBefore(date: Date, months: number): Date

export declare function cumeDistScores(values: number[]): number[]
export declare function rfmPersona(input: {
  r: number
  f: number
  m: number
  firstGiftOn: string
  today?: Date
  params?: RfmParams
}): string
export declare function runRfm(
  gifts: Array<Pick<LedgerGift, 'contact_id' | 'donated_on' | 'amount_gbp' | 'status'>>,
  options?: { today?: Date; params?: RfmParams },
): RfmResult

export declare function runRetention(
  gifts: Array<Pick<LedgerGift, 'contact_id' | 'donated_on' | 'status'>>,
  year: number,
): Omit<
  RetentionSummary,
  'benchmark_overall' | 'benchmark_7plus' | 'benchmark_source' | 'benchmark_year'
>

export declare function givingBuckets(
  gifts: Array<Pick<LedgerGift, 'contact_id' | 'donated_on' | 'amount_gbp' | 'status'>>,
  year: number | null,
  today?: Date,
): GivingBucket[]

export declare function scrubMoney<T>(doc: T, keys?: string[]): T

export declare function buildLedger(options?: {
  today?: Date
  seed?: number
  contactCount?: number
}): Ledger

export declare function buildOverview(options?: {
  year: number | null
  today?: Date
  amountsHidden?: boolean
  ledger?: Ledger
}): ReportOverview

export declare function buildCampaignDetail(
  campaignId: string,
  options?: { today?: Date; amountsHidden?: boolean; ledger?: Ledger },
): CampaignDetail

export declare function buildDrill(options: {
  key: DrillKey
  year?: number | null
  arg?: string | null
  today?: Date
  amountsHidden?: boolean
  ledger?: Ledger
}): DrillRow[]
