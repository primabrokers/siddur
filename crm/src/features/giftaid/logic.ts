/**
 * Pure logic for the Gift Aid workspace (05 §5, 07 §8, 02 §3.7).
 *
 * The rules this file keeps:
 *
 * - **Nothing here writes and nothing here fetches.** Every function is a pure
 *   transformation, so the HMRC file's exact bytes, the coverage windows and
 *   the recoverable arithmetic are all testable without a database.
 * - **Totals are read, not recomputed** (I-8/I-9). The 25% that appears here is
 *   only ever applied to a *hypothetical* — "what a declaration would recover"
 *   — never to a claim; a claim's numbers come from `gift_aid_claim_totals`.
 * - **`declarationCovers` mirrors the database predicate** `ga_declaration_covers`
 *   (007) line for line, including the oral-confirmation rule. The validation
 *   pass is served by the database; this copy exists so the UI can explain a
 *   declaration before anything is saved.
 */

import { subYears } from 'date-fns'
import { toISODate } from '../../lib/dates'
import { formatMoney, toDate } from '../../lib/format'
import { csvCell, toCsv } from '../giving/logic'
import type {
  ClaimLine,
  DeclarationRow,
  GaContactRow,
  MissingDeclarationRow,
  ValidationFailure,
} from './types'

/** The basic-rate reclaim: 20/80 of the gift, i.e. 25% on top (HMRC). */
export const GIFT_AID_RATE = 0.25

/** HMRC lets a declaration reach back four years (02 §3.7). */
export const BACK_YEARS = 4

/**
 * The wording the donor saw, stamped on every declaration this app records
 * (02 §3.7 `wording_version` ▸ Beacon). Bump only when HMRC's model
 * declaration changes — old declarations keep the version they were made under.
 */
export const GA_WORDING_VERSION = 'HMRC model declaration 2024-04'

/** Round to pence — money arithmetic never leaves a float tail on screen. */
export const toPence = (value: number): number => Math.round(value * 100) / 100

/** What a declaration would recover on a body of eligible giving. */
export const recoverable = (amountGbp: number | null | undefined): number =>
  amountGbp === null || amountGbp === undefined || !Number.isFinite(amountGbp)
    ? 0
    : toPence(amountGbp * GIFT_AID_RATE)

/* ------------------------------------------------- declaration coverage */

export type DeclarationState = 'active' | 'pending_confirmation' | 'cancelled'

/**
 * Where a declaration stands right now (05 §5 "recent declarations").
 *
 * An oral declaration is *not* usable until the written confirmation HMRC
 * requires has been sent — it shows "confirmation pending" until stamped.
 */
export function declarationState(declaration: DeclarationRow): DeclarationState {
  if (declaration.cancelled_on) return 'cancelled'
  if (declaration.method === 'oral' && !declaration.oral_confirmation_sent_on) return 'pending_confirmation'
  return 'active'
}

/** True while HMRC still needs the written confirmation of an oral declaration. */
export const awaitsWrittenConfirmation = (declaration: DeclarationRow): boolean =>
  declaration.method === 'oral' && !declaration.oral_confirmation_sent_on && !declaration.cancelled_on

/**
 * The date the declaration is anchored on: `covers_from` when the donor named
 * one, otherwise the day it was made. Same `coalesce` the database uses.
 */
export const coverageAnchor = (declaration: DeclarationRow): string =>
  declaration.covers_from ?? declaration.declared_on

/**
 * Does this declaration cover a gift made on `date`?
 *
 * Mirrors `public.ga_declaration_covers` (007) exactly:
 *  - a cancelled declaration stops covering gifts **from** the cancellation date
 *  - an oral declaration counts only once its written confirmation is sent
 *  - `covers_future` covers the anchor date and everything after it
 *  - `covers_past` covers the `backYears` window *before* the anchor
 */
export function declarationCovers(
  declaration: DeclarationRow,
  date: string,
  backYears: number = BACK_YEARS,
): boolean {
  if (!declaration.declared_on || !date) return false
  if (declaration.cancelled_on && date >= declaration.cancelled_on) return false
  if (awaitsWrittenConfirmation(declaration)) return false

  const anchor = coverageAnchor(declaration)
  if (date >= anchor) return declaration.covers_future === true

  if (declaration.covers_past !== true) return false
  const anchorDate = toDate(anchor)
  if (!anchorDate) return false
  return date >= toISODate(subYears(anchorDate, backYears))
}

/** The first declaration on file that covers a gift date, if any. */
export const coveringDeclaration = (
  declarations: DeclarationRow[] | null | undefined,
  date: string,
): DeclarationRow | null => (declarations ?? []).find((d) => declarationCovers(d, date)) ?? null

/** `future + 4 back-years` — the wireframe's "Covers" column. */
export function coversLabel(declaration: DeclarationRow, backYears: number = BACK_YEARS): string {
  const parts: string[] = []
  if (declaration.covers_future) parts.push('future gifts')
  if (declaration.covers_past) parts.push(`${backYears} back-years`)
  if (parts.length === 0) return 'this gift only'
  return parts.join(' + ')
}

/* ------------------------------------------------------- missing-declaration queue */

export interface MissingQueueRow extends MissingDeclarationRow {
  contact: GaContactRow | null
}

export interface MissingQueueSummary {
  rows: MissingQueueRow[]
  /** "£1,240 recoverable from 8 donors" — the panel header (05 §5). */
  recoverableTotal: number
  donorCount: number
  /** The slice HMRC will still accept — the 4-year back-claim card (07 §10). */
  recoverable4y: number
  eligible4y: number
}

/**
 * The found-money queue, richest recovery first (05 §5). The per-donor figures
 * come from the `ga_missing_declarations` view; the only arithmetic here is
 * adding them up for the header.
 */
export function missingQueue(
  rows: MissingDeclarationRow[],
  contacts: Record<string, GaContactRow>,
): MissingQueueSummary {
  const joined: MissingQueueRow[] = rows
    .map((row) => ({ ...row, contact: contacts[row.contact_id] ?? null }))
    .sort((a, b) => (b.recoverable ?? 0) - (a.recoverable ?? 0))

  return {
    rows: joined,
    recoverableTotal: toPence(joined.reduce((sum, row) => sum + (row.recoverable ?? 0), 0)),
    donorCount: joined.length,
    recoverable4y: toPence(joined.reduce((sum, row) => sum + (row.recoverable_4y ?? 0), 0)),
    eligible4y: toPence(joined.reduce((sum, row) => sum + (row.eligible_total_4y ?? 0), 0)),
  }
}

/* ------------------------------------------------------------- HMRC export */

/**
 * The HMRC Charities Online schedule columns — **exactly** this set, in this
 * order (05 §5). HMRC rejects a file whose header row differs.
 */
export const HMRC_CSV_HEADER = [
  'Title',
  'First name',
  'Last name',
  'House name or number',
  'Postcode',
  'Aggregated donations',
  'Sponsored event',
  'Donation date',
  'Amount',
] as const

/**
 * HMRC's "House name or number": the explicit `ga_house_no` when the donor has
 * one, otherwise the leading token of `address_line1` — "12 The Drive" → `12`,
 * "Elm House, Sentinel Sq" → `Elm`. Mirrors `public.ga_house_number` (007).
 */
export function houseNumber(contact: GaContactRow | null | undefined): string {
  const explicit = (contact?.ga_house_no ?? '').trim()
  if (explicit !== '') return explicit
  const line = (contact?.address_line1 ?? '').trim()
  if (line === '') return ''
  return line.split(/[\s,]+/)[0] ?? ''
}

/** HMRC wants the donation date as `DD/MM/YY`. */
export function hmrcDate(value: string | null | undefined): string {
  const date = toDate(value)
  if (!date) return ''
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = String(date.getFullYear() % 100).padStart(2, '0')
  return `${day}/${month}/${year}`
}

/** The claimed amount for one line: the sterling value that reached the bank. */
export const hmrcAmount = (line: ClaimLine): string =>
  (Number(line.gift.amount_gbp ?? line.gift.amount) || 0).toFixed(2)

/** One CSV row for one gift, in header order. */
export function hmrcRow(line: ClaimLine): string[] {
  const contact = line.contact
  return [
    contact?.title ?? '',
    contact?.first_name ?? '',
    contact?.last_name ?? '',
    houseNumber(contact),
    contact?.postcode ?? '',
    // Aggregated donations and Sponsored event are blank on a per-gift
    // schedule: the first is for pooled small gifts, the second for events.
    '',
    '',
    hmrcDate(line.gift.donated_on),
    hmrcAmount(line),
  ]
}

/**
 * The HMRC Charities Online schedule for one claim. Rows are ordered by
 * donation date, oldest first — the order a reviewer reads a bank statement in.
 */
export function hmrcCsv(lines: ClaimLine[]): string {
  const ordered = [...lines].sort((a, b) => {
    const byDate = String(a.gift.donated_on).localeCompare(String(b.gift.donated_on))
    return byDate !== 0 ? byDate : String(a.gift.id).localeCompare(String(b.gift.id))
  })
  return toCsv([[...HMRC_CSV_HEADER], ...ordered.map(hmrcRow)])
}

/** `gift-aid-claim-2026-08-28.csv`. */
export const hmrcFilename = (on: string = toISODate(new Date())): string => `gift-aid-claim-${on}.csv`

/** GASDS lines carry no donor detail, so they never reach the schedule. */
export const claimableLines = (lines: ClaimLine[]): ClaimLine[] =>
  lines.filter((line) => !line.gift.is_gasds && line.gift.status === 'received')

/* ------------------------------------------------------------- validation */

export interface ValidationGroup {
  donationId: string
  contactId: string
  donorName: string
  donatedOn: string
  amountGbp: number | null
  failures: ValidationFailure[]
}

export interface ValidationSummary {
  groups: ValidationGroup[]
  /** How many *gifts* are blocked, not how many failures they carry. */
  giftCount: number
  /** `{ missing_postcode: 2, … }` — the hero chip's wording. */
  byCode: Record<string, number>
  ready: boolean
}

const CODE_LABEL: Record<string, string> = {
  missing_postcode: 'need a postcode',
  missing_house_no: 'need a house name or number',
  not_gbp: 'are not in sterling',
  not_individual: 'are not from an individual',
  no_declaration: 'have no covering declaration',
}

/** Group the per-failure rows by gift, so one row shows one gift's problems. */
export function summariseValidation(failures: ValidationFailure[]): ValidationSummary {
  const groups = new Map<string, ValidationGroup>()
  const byCode: Record<string, number> = {}

  for (const failure of failures) {
    byCode[failure.code] = (byCode[failure.code] ?? 0) + 1
    const existing = groups.get(failure.donation_id)
    if (existing) {
      existing.failures.push(failure)
      continue
    }
    groups.set(failure.donation_id, {
      donationId: failure.donation_id,
      contactId: failure.contact_id,
      donorName: failure.donor_name ?? 'Unknown donor',
      donatedOn: failure.donated_on,
      amountGbp: failure.amount_gbp,
      failures: [failure],
    })
  }

  return {
    groups: [...groups.values()],
    giftCount: groups.size,
    byCode,
    ready: failures.length === 0,
  }
}

/** "2 rows need a postcode" — the hero's validation chip (wireframe A7). */
export function validationChip(summary: ValidationSummary): string {
  if (summary.ready) return 'Validation: every row is claimable'
  const worst = Object.entries(summary.byCode).sort((a, b) => b[1] - a[1])[0]
  if (!worst) return 'Validation: every row is claimable'
  const [code, count] = worst
  const rest = summary.giftCount - count
  const head = `Validation: ${count} row${count === 1 ? '' : 's'} ${CODE_LABEL[code] ?? 'need attention'}`
  return rest > 0 ? `${head} · ${rest} more blocked` : head
}

/* -------------------------------------------------- declaration requests */

export interface RequestDraftInput {
  donorName: string
  recoverable: number
  charityName: string
  /** Where the declaration form lives; blank until the yeshiva has one. */
  formUrl?: string | null
}

/**
 * The declaration-request draft (05 §5, 08 §2 `ga_declaration_chase`).
 *
 * **The app drafts, the human sends** — nothing here opens a channel by itself
 * (03 §5.2: leaving the system is always the person's action).
 */
export function requestDraftText(input: RequestDraftInput): string {
  const charity = input.charityName.trim() === '' ? 'the yeshiva' : input.charityName.trim()
  const amount = formatMoney(input.recoverable)
  const link = input.formUrl?.trim()
    ? `\n\nThe declaration form is here: ${input.formUrl.trim()}`
    : '\n\nI can send the one-line declaration form over however suits you.'
  return (
    `Dear ${input.donorName},\n\n` +
    `Thank you again for your support of ${charity}.\n\n` +
    `If you are a UK taxpayer, a Gift Aid declaration would let us reclaim ` +
    `${amount} from HMRC on the gifts you have already made — at no cost to you.` +
    `${link}\n\n` +
    `With gratitude,\n${charity}`
  )
}

export const requestSubject = (charityName: string): string =>
  `Gift Aid — ${charityName.trim() === '' ? 'a quick one-liner' : charityName.trim()}`

/** `mailto:` for the email draft; the person's client sends it, not the app. */
export function mailtoHref(email: string | null | undefined, subject: string, body: string): string | null {
  if (!email || email.trim() === '') return null
  return `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/* --------------------------------------------------------------- labelling */

export const CLAIM_STATUS_LABEL: Record<string, string> = {
  'draft-rolling': 'Rolling',
  ready: 'Ready',
  submitted: 'Submitted',
  paid: 'Paid',
}

export const METHOD_LABEL: Record<string, string> = {
  written: 'written',
  oral: 'oral',
  online: 'online',
}

/** Re-exported so tests can assert the escaping the export relies on. */
export { csvCell, toCsv }
