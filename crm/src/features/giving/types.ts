/**
 * Row and draft shapes for the Giving surfaces (05 §1–§4).
 *
 * The ledger rows themselves (`DonationRow`, `PledgeRow`, …) already live in
 * `features/contacts/types.ts` — spec 02 §3.4–3.8 defines them once, so they are
 * re-exported here rather than duplicated. Everything below is either a shape
 * the ledger tables lack (soft credits, tributes) or a *draft* — what the entry
 * sheets hold before it becomes a row.
 */

import type {
  ContactRow,
  ContactStats,
  DonationRow,
  GiftAidDeclarationRow,
  GivingRefs,
  PledgeInstallmentRow,
  PledgeRow,
  RecurringAgreementRow,
} from '../contacts/types'

export type {
  ContactRow,
  ContactStats,
  DonationRow,
  GiftAidDeclarationRow,
  GivingRefs,
  PledgeInstallmentRow,
  PledgeRow,
  RecurringAgreementRow,
}

/** 02 §3.14 — parallel credit, never added to financial totals (D2). */
export type SoftCreditRole = 'household' | 'influencer' | 'solicitor' | 'matched_by' | 'other'

export interface SoftCreditRow {
  id: string
  donation_id: string
  contact_id: string
  role: SoftCreditRole
  amount: number | null
}

/** 02 §3.15 — in honor / in memory / yahrzeit / simcha, with the acknowledgee loop. */
export interface TributeRow {
  id: string
  donation_id: string
  tribute_type: string
  honoree_name: string
  honoree_contact_id: string | null
  acknowledgee_name: string | null
  acknowledgee_address: string | null
  acknowledgee_contact_id: string | null
  notify: boolean | null
  notified_at: string | null
}

/** One selectable coding axis (02 §3.8). Inactive rows never reach the sheet. */
export interface GivingOption {
  id: string
  name: string
  is_active: boolean | null
}

export interface GivingSelects {
  funds: GivingOption[]
  campaigns: GivingOption[]
  appeals: GivingOption[]
}

/** A gift row with its donor resolved — the Giving screen's table row. */
export interface GiftListRow {
  gift: DonationRow
  contact: ContactRow | null
}

/**
 * Everything the Giving screen reads, in one query (see `qk.giving.board`).
 * Contacts are indexed by id and joined client-side — no PostgREST embeds.
 */
export interface GivingBoard {
  gifts: DonationRow[]
  pledges: PledgeRow[]
  installments: PledgeInstallmentRow[]
  recurring: RecurringAgreementRow[]
  contacts: Record<string, ContactRow>
  /** Gifts inside the metric windows (this month / this year), unfiltered. */
  yearGifts: DonationRow[]
  monthGifts: DonationRow[]
  /** The gifts came through `donations_redacted`: show the ledger, not the money (11 §2). */
  amountsHidden: boolean
}

export const EMPTY_BOARD: GivingBoard = {
  gifts: [],
  pledges: [],
  installments: [],
  recurring: [],
  contacts: {},
  yearGifts: [],
  monthGifts: [],
  amountsHidden: false,
}

/* ------------------------------------------------------------------ drafts */

/** The gift-entry sheet's state (05 §1). Strings: it is form state. */
export interface GiftDraft {
  contact_id: string
  amount: string
  currency: string
  amount_gbp: string
  donated_on: string
  fund_id: string
  campaign_id: string
  appeal_id: string
  payment_method: string
  notes: string
  is_gasds: boolean
  /** Applies-to (02 §3.4): set by the banner's one-tap link. */
  pledge_id: string | null
  installment_id: string | null
  recurring_agreement_id: string | null
  /** Soft credit for the introducer (02 §3.14, role `influencer`). */
  credit_introducer: boolean
  /** Tribute block (02 §3.15). */
  tribute: boolean
  tribute_type: string
  honoree_name: string
  acknowledgee_name: string
  acknowledgee_address: string
  notify: boolean
}

export const CURRENCIES = ['GBP', 'USD', 'EUR', 'ILS', 'CHF'] as const

export function emptyGiftDraft(today: string, contactId = ''): GiftDraft {
  return {
    contact_id: contactId,
    amount: '',
    currency: 'GBP',
    amount_gbp: '',
    donated_on: today,
    fund_id: '',
    campaign_id: '',
    appeal_id: '',
    payment_method: '',
    notes: '',
    is_gasds: false,
    pledge_id: null,
    installment_id: null,
    recurring_agreement_id: null,
    credit_introducer: false,
    tribute: false,
    tribute_type: '',
    honoree_name: '',
    acknowledgee_name: '',
    acknowledgee_address: '',
    notify: false,
  }
}

/** What `useCreateGift` writes: the donation row plus its two optional children. */
export interface GiftInput {
  donation: Record<string, unknown>
  softCredit: { contact_id: string; role: SoftCreditRole; amount: number } | null
  tribute: Record<string, unknown> | null
}

/** One editable row in the pledge sheet's schedule builder (05 §2). */
export interface InstallmentDraft {
  /** Local key only — the database assigns the real id. */
  key: string
  due_on: string
  amount: string
}

export type ScheduleFrequency = 'monthly' | 'quarterly' | 'custom'

export interface PledgeDraft {
  contact_id: string
  total_amount: string
  currency: string
  fund_id: string
  campaign_id: string
  appeal_id: string
  pledged_on: string
  notes: string
  /** Schedule builder inputs. */
  count: string
  frequency: ScheduleFrequency
  custom_days: string
  starts_on: string
  installments: InstallmentDraft[]
}

export interface RecurringDraft {
  contact_id: string
  amount: string
  currency: string
  frequency: string
  payment_method: string
  fund_id: string
  starts_on: string
  ends_on: string
  expected_day: string
}

export const RECURRING_FREQUENCIES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Annual' },
] as const
