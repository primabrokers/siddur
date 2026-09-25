/**
 * Row shapes for the Gift Aid workspace (05 §5).
 *
 * Local interfaces, as everywhere else in this codebase: the generated Supabase
 * types are a placeholder, so each query annotates its own result. Field names
 * come from spec 02 §3.7 and from migration `007_gift_aid_claim_flow.sql`.
 */

import type { ContactRow, DonationRow } from '../contacts/types'

export type { ContactRow, DonationRow }

/**
 * `contacts` as the HMRC export reads it. `ga_house_no` exists in schema v2 but
 * not in `ContactRow` (02 §3.1 lists it under the Gift Aid fields), so it is
 * widened here rather than in the shared contact shape.
 */
export interface GaContactRow extends ContactRow {
  ga_house_no?: string | null
}

/** A donation as the claim reads it — 007 adds the two hold-back columns. */
export interface GaDonationRow extends DonationRow {
  ga_excluded_at?: string | null
  ga_exclude_reason?: string | null
}

export type ClaimStatus = 'draft-rolling' | 'ready' | 'submitted' | 'paid'

/** 02 §3.7 — `gift_aid_claims`. */
export interface GiftAidClaimRow {
  id: string
  status: ClaimStatus
  submitted_on: string | null
  /** 007 addition: the history's "PAID 21 Jul" pill needs a date. */
  paid_on: string | null
  hmrc_reference: string | null
  total_donations: number | null
  total_claimed: number | null
  gasds_total: number | null
  created_at: string
}

/**
 * The `gift_aid_claim_totals` view (007). **Every** number the hero and the
 * history show comes from here — the client never sums claim lines (I-8/I-9).
 */
export interface ClaimTotalsRow {
  claim_id: string
  status: ClaimStatus
  building_since: string | null
  submitted_on: string | null
  paid_on: string | null
  hmrc_reference: string | null
  donations_total: number | null
  claimable_total: number | null
  gasds_total: number | null
  gift_count: number | null
  donor_count: number | null
}

/** The `ga_missing_declarations` view (007) — found money, per donor. */
export interface MissingDeclarationRow {
  contact_id: string
  gift_count: number | null
  eligible_total: number | null
  recoverable: number | null
  eligible_total_4y: number | null
  recoverable_4y: number | null
  first_gift_on: string | null
  last_gift_on: string | null
}

export type DeclarationMethod = 'written' | 'oral' | 'online'

/** 02 §3.7 — `gift_aid_declarations`, all of it (the profile's row shape is narrower). */
export interface DeclarationRow {
  id: string
  contact_id: string
  declared_on: string
  method: DeclarationMethod | string
  wording_version: string | null
  covers_past: boolean | null
  covers_future: boolean | null
  covers_from: string | null
  oral_confirmation_sent_on: string | null
  cancelled_on: string | null
  evidence_url: string | null
  created_at?: string | null
}

/** One row of `ga_claim_validation(claim)` — a single failure on a single gift. */
export interface ValidationFailure {
  donation_id: string
  contact_id: string
  donor_name: string | null
  donated_on: string
  amount_gbp: number | null
  code: ValidationCode | string
  message: string
}

export type ValidationCode =
  | 'missing_postcode'
  | 'missing_house_no'
  | 'not_gbp'
  | 'not_individual'
  | 'no_declaration'

/** One gift on the claim, joined to its donor — the CSV's unit of work. */
export interface ClaimLine {
  gift: GaDonationRow
  contact: GaContactRow | null
}

/** Everything the workspace reads, in one query (`gak.giftAid.board`). */
export interface GiftAidBoard {
  /** The single open claim (02 §3.7). Null only before the first gift lands. */
  rolling: ClaimTotalsRow | null
  /** Submitted + paid claims, newest first. */
  history: ClaimTotalsRow[]
  /** Donors with eligible-but-undeclared gifts, richest recovery first. */
  missing: MissingDeclarationRow[]
  /** Recent declarations, newest first. */
  declarations: DeclarationRow[]
  /** Gifts a human held back from the claim (007 `ga_excluded_at`). */
  excluded: GaDonationRow[]
  contacts: Record<string, GaContactRow>
  /** The ledger came through `donations_redacted`: no money to render (11 §2). */
  amountsHidden: boolean
}

export const EMPTY_BOARD: GiftAidBoard = {
  rolling: null,
  history: [],
  missing: [],
  declarations: [],
  excluded: [],
  contacts: {},
  amountsHidden: false,
}

/* ------------------------------------------------------------------ drafts */

/** The declaration sheet's state (05 §5 panel 2 / 02 §3.7). Strings: form state. */
export interface DeclarationDraft {
  contact_id: string
  declared_on: string
  method: DeclarationMethod
  covers_future: boolean
  covers_past: boolean
  covers_from: string
  evidence_url: string
}

export function emptyDeclarationDraft(today: string, contactId = ''): DeclarationDraft {
  return {
    contact_id: contactId,
    declared_on: today,
    method: 'written',
    covers_future: true,
    covers_past: true,
    covers_from: '',
    evidence_url: '',
  }
}
