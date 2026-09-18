/**
 * Giving logic — every rule the Giving screens need, as pure functions.
 *
 * Nothing here touches the network or React, so the arithmetic that matters
 * (schedule splits, Gift Aid eligibility, the ask array, queue filters, the
 * receipt CSV) is testable without a database: tests/giving-logic.test.ts.
 *
 * Two boundaries the spec draws and this file respects:
 * - **Per-contact rollups come from `contact_stats`** (I-8/I-9). The ask array
 *   *reads* that view; it never recomputes a donor's history.
 * - **Gift Aid status is set by a database trigger** (08 §2 `gift_aid_evaluate`).
 *   `previewGiftAid` is entry-time UX only — a preview of what the trigger will
 *   decide, never the stored value.
 */

import { addDays, addMonths, differenceInCalendarDays, subYears } from 'date-fns'
import { toISODate } from '../../lib/dates'
import { formatMoney } from '../../lib/format'
import type {
  ContactRow,
  ContactStats,
  DonationRow,
  GiftAidDeclarationRow,
  GivingBoard,
  InstallmentDraft,
  PledgeBalanceRow,
  PledgeInstallmentRow,
  PledgeRow,
  RecurringAgreementRow,
  ScheduleFrequency,
} from './types'

/* ------------------------------------------------------------------ money */

/** Pence-integer maths, so a five-way split of £1,000 never drifts by a penny. */
const toPence = (pounds: number): number => Math.round(pounds * 100)
const toPounds = (pence: number): number => Math.round(pence) / 100

export const parseAmount = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) return null
  const text = String(value).replace(/[£,\s]/g, '')
  if (text === '') return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

/* --------------------------------------------------- schedule builder (§2) */

export const SCHEDULE_FREQUENCIES: Array<{ value: ScheduleFrequency; label: string }> = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'custom', label: 'Custom interval' },
]

export interface ScheduleSpec {
  total: number
  count: number
  frequency: ScheduleFrequency
  startOn: string
  /** Days between installments when `frequency === 'custom'`. */
  customDays?: number
}

/**
 * Generate the installment rows for a pledge (05 §2): equal split, **remainder
 * on the last row**, dates stepped monthly / quarterly / every N days from the
 * start date. The rows come back editable — the sheet may change any amount or
 * date afterwards, which is why `scheduleSum` exists as a separate check.
 */
export function buildSchedule(spec: ScheduleSpec): InstallmentDraft[] {
  const count = Math.trunc(spec.count)
  if (!Number.isFinite(count) || count < 1) return []
  const total = Number.isFinite(spec.total) ? spec.total : 0

  const totalPence = toPence(total)
  const base = Math.floor(totalPence / count)
  const step = spec.frequency === 'custom' ? Math.max(1, Math.trunc(spec.customDays ?? 30)) : 0
  const start = new Date(`${spec.startOn}T00:00:00`)
  const startValid = !Number.isNaN(start.getTime())

  const rows: InstallmentDraft[] = []
  for (let i = 0; i < count; i += 1) {
    // The last row absorbs the rounding remainder, so the schedule always sums
    // back to the pledged total.
    const pence = i === count - 1 ? totalPence - base * (count - 1) : base
    const due = !startValid
      ? spec.startOn
      : spec.frequency === 'monthly'
        ? toISODate(addMonths(start, i))
        : spec.frequency === 'quarterly'
          ? toISODate(addMonths(start, i * 3))
          : toISODate(addDays(start, i * step))
    rows.push({ key: `ins-${i + 1}`, due_on: due, amount: toPounds(pence).toFixed(2) })
  }
  return rows
}

/** Live sum of the (possibly hand-edited) schedule rows. */
export function scheduleSum(rows: InstallmentDraft[]): number {
  return toPounds(rows.reduce((sum, row) => sum + toPence(parseAmount(row.amount) ?? 0), 0))
}

export interface ScheduleCheck {
  sum: number
  total: number
  /** Signed: positive when the rows overshoot the pledged total. */
  difference: number
  balanced: boolean
}

/** The sheet's live "rows sum to the total" check (05 §2). */
export function checkSchedule(total: number, rows: InstallmentDraft[]): ScheduleCheck {
  const sum = scheduleSum(rows)
  const difference = toPounds(toPence(sum) - toPence(total))
  return { sum, total, difference, balanced: difference === 0 }
}

/* ------------------------------------------------------- ask array (05 §1) */

/**
 * Round an ask to a step a human would say out loud. £4,812 reads as £4,800;
 * £137 as £140. Steps widen with size, so small gifts stay recognisable.
 */
export function roundAsk(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  const step =
    amount < 50 ? 5 : amount < 200 ? 10 : amount < 1_000 ? 25 : amount < 10_000 ? 100 : amount < 50_000 ? 500 : 1_000
  return Math.round(amount / step) * step
}

const askStep = (amount: number): number =>
  amount < 50 ? 5 : amount < 200 ? 10 : amount < 1_000 ? 25 : amount < 10_000 ? 100 : amount < 50_000 ? 500 : 1_000

export interface AskChip {
  id: 'last' | 'highest' | 'stretch'
  label: string
  amount: number
}

/**
 * The entry shortcuts above the amount field (05 §1): last gift · highest gift ·
 * highest + 25%. Read straight off `contact_stats` (I-8) and rounded; a donor
 * with no history gets no chips, and a repeated amount appears once.
 */
export function askArray(stats: Pick<ContactStats, 'last_gift_amount' | 'largest_gift'> | null | undefined): AskChip[] {
  if (!stats) return []
  const last = roundAsk(stats.last_gift_amount ?? 0)
  const highest = roundAsk(stats.largest_gift ?? 0)
  let stretch = roundAsk((stats.largest_gift ?? 0) * 1.25)
  // Rounding can collapse the stretch ask back onto the highest gift; nudge it
  // up one step so the chip is always an actual stretch.
  if (highest > 0 && stretch <= highest) stretch = highest + askStep(highest)

  const chips: AskChip[] = []
  const add = (chip: AskChip) => {
    if (chip.amount <= 0) return
    if (chips.some((existing) => existing.amount === chip.amount)) return
    chips.push(chip)
  }
  add({ id: 'last', label: `Last ${formatMoney(last)}`, amount: last })
  add({ id: 'highest', label: `Highest ${formatMoney(highest)}`, amount: highest })
  add({ id: 'stretch', label: `Highest +25% ${formatMoney(stretch)}`, amount: stretch })
  return chips
}

/* --------------------------------------------- Gift Aid preview (05 §1, §5) */

/** Contact kinds that cannot Gift Aid: a company is not an individual taxpayer. */
const ORGANISATION_KINDS = new Set(['business', 'organisation', 'organization', 'company', 'trust', 'foundation'])

export const isOrganisationKind = (kind: string | null | undefined): boolean =>
  kind !== null && kind !== undefined && ORGANISATION_KINDS.has(kind.trim().toLowerCase())

/** HMRC allows a declaration to reach back four years (02 §3.7). */
const BACK_YEARS = 4

/**
 * Does this declaration cover a gift made on `date`?
 *
 * - cancelled declarations stop covering gifts from the cancellation date
 * - gifts on/after the declaration date need `covers_future` (or the very day
 *   it was signed — that gift is what prompted it)
 * - earlier gifts need `covers_past`, bounded by `covers_from` when set and by
 *   the four-year back-claim window otherwise
 */
export function declarationCovers(declaration: GiftAidDeclarationRow, date: string): boolean {
  if (!declaration.declared_on || !date) return false
  if (declaration.cancelled_on && date >= declaration.cancelled_on) return false

  if (date >= declaration.declared_on) {
    if (date === declaration.declared_on) return true
    return declaration.covers_future !== false
  }

  if (!declaration.covers_past) return false
  const from = declaration.covers_from ?? toISODate(subYears(new Date(`${declaration.declared_on}T00:00:00`), BACK_YEARS))
  return date >= from
}

export type GiftAidState = 'eligible' | 'no_declaration' | 'ineligible'

export interface GiftAidPreview {
  state: GiftAidState
  /** The inline line's text — the spec's own wording (05 §1). */
  label: string
  /** Why, when the answer is "ineligible". */
  reason: string | null
  /** The declaration that covers the gift, when there is one. */
  declaration: GiftAidDeclarationRow | null
}

export interface GiftAidPreviewInput {
  currency: string
  donatedOn: string
  contactKind: string | null | undefined
  declarations: GiftAidDeclarationRow[] | null | undefined
}

/**
 * The inline Gift Aid line at entry (05 §1). **Preview only** — the
 * authoritative `donations.gift_aid_status` is written by the
 * `gift_aid_evaluate` trigger (08 §2) and read back on refetch.
 */
export function previewGiftAid(input: GiftAidPreviewInput): GiftAidPreview {
  const currency = (input.currency || 'GBP').toUpperCase()
  if (currency !== 'GBP') {
    return {
      state: 'ineligible',
      label: 'Ineligible for Gift Aid',
      reason: `${currency} gifts cannot be claimed — Gift Aid is a sterling relief`,
      declaration: null,
    }
  }
  if (isOrganisationKind(input.contactKind)) {
    return {
      state: 'ineligible',
      label: 'Ineligible for Gift Aid',
      reason: 'company and trust gifts carry no personal tax to reclaim',
      declaration: null,
    }
  }

  const covering = (input.declarations ?? []).find((declaration) => declarationCovers(declaration, input.donatedOn))
  if (covering) {
    return {
      state: 'eligible',
      label: 'Eligible — declaration on file ✓ (joins the current claim)',
      reason: null,
      declaration: covering,
    }
  }

  return {
    state: 'no_declaration',
    label: 'No declaration on file — request one?',
    reason: null,
    declaration: null,
  }
}

/** GASDS: small cash/contactless collections, no declaration needed (02 §3.4). */
export const GASDS_METHODS = new Set(['cash', 'contactless', 'card_contactless', 'collection'])
export const GASDS_LIMIT = 30

/**
 * Whether the GASDS checkbox is offered at all (05 §1): cash or contactless,
 * £30 or less, and sterling. Everything else hides it rather than disabling it —
 * an unavailable claim type is noise, not a choice.
 */
export function gasdsAvailable(input: { paymentMethod: string | null | undefined; amountGbp: number | null; currency?: string }): boolean {
  const method = (input.paymentMethod ?? '').trim().toLowerCase()
  if (!GASDS_METHODS.has(method)) return false
  if ((input.currency ?? 'GBP').toUpperCase() !== 'GBP') return false
  const amount = input.amountGbp
  return amount !== null && amount > 0 && amount <= GASDS_LIMIT
}

/* -------------------------------------------------- multi-currency (05 §1) */

/**
 * Indicative conversion so the GBP box is not blank on a non-GBP gift.
 *
 * TODO(M7): read the rate from a stored FX table — schema v2 has none, so these
 * are labelled indicative in the UI and always editable. The ledger value is
 * whatever hit the bank, which only the fundraiser knows.
 */
export const INDICATIVE_RATES: Record<string, number> = {
  GBP: 1,
  USD: 0.79,
  EUR: 0.85,
  ILS: 0.21,
  CHF: 0.88,
}

export function indicativeGbp(amount: number | null, currency: string): number | null {
  if (amount === null || !Number.isFinite(amount)) return null
  const rate = INDICATIVE_RATES[(currency || 'GBP').toUpperCase()]
  if (rate === undefined) return null
  return Math.round(amount * rate * 100) / 100
}

/* ------------------------------------------------------ applies-to (05 §1) */

export interface AppliesToOption {
  id: string
  kind: 'installment' | 'pledge' | 'recurring'
  label: string
  amount: number | null
  dueOn: string | null
  overdue: boolean
  pledgeId: string | null
  installmentId: string | null
  recurringId: string | null
}

/**
 * Structural on purpose: the profile passes `ContactGiving`'s rows and the
 * Giving board passes its own, and neither should have to convert.
 */
export interface AppliesToSource {
  pledges: PledgeRow[]
  installments: PledgeInstallmentRow[]
  recurring: Array<Pick<RecurringAgreementRow, 'id' | 'amount' | 'frequency' | 'status'>>
}

/**
 * The applies-to banner's offers (05 §1 → 02 §3.4): every open pledge's
 * expected installments (overdue first, then earliest due), a bare
 * "apply to the pledge" option, and any live recurring agreement.
 */
export function appliesToOptions(source: AppliesToSource, now: Date = new Date()): AppliesToOption[] {
  const todayISO = toISODate(now)
  const open = source.pledges.filter((pledge) => pledge.status === 'open')
  const options: AppliesToOption[] = []

  for (const pledge of open) {
    const rows = source.installments
      .filter((row) => row.pledge_id === pledge.id && row.status !== 'paid' && row.status !== 'written_off')
      .sort((a, b) => a.due_on.localeCompare(b.due_on))
    for (const row of rows) {
      const overdue = row.due_on < todayISO
      options.push({
        id: `installment:${row.id}`,
        kind: 'installment',
        label: `Installment of ${formatMoney(row.amount)}`,
        amount: row.amount,
        dueOn: row.due_on,
        overdue,
        pledgeId: pledge.id,
        installmentId: row.id,
        recurringId: null,
      })
    }
    options.push({
      id: `pledge:${pledge.id}`,
      kind: 'pledge',
      label: `The pledge itself (no installment)`,
      amount: null,
      dueOn: null,
      overdue: false,
      pledgeId: pledge.id,
      installmentId: null,
      recurringId: null,
    })
  }

  for (const agreement of source.recurring) {
    if (agreement.status === 'cancelled') continue
    options.push({
      id: `recurring:${agreement.id}`,
      kind: 'recurring',
      label: `${formatMoney(agreement.amount)} ${agreement.frequency} standing order`,
      amount: agreement.amount,
      dueOn: null,
      overdue: agreement.status === 'failing',
      pledgeId: null,
      installmentId: null,
      recurringId: agreement.id,
    })
  }

  // Overdue installments first, then earliest due, then the rest in order.
  return options.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
    if (a.dueOn && b.dueOn) return a.dueOn.localeCompare(b.dueOn)
    if (a.dueOn) return -1
    if (b.dueOn) return 1
    return 0
  })
}

/** The three foreign keys a chosen applies-to option writes (02 §3.4). */
export function appliesToPatch(option: AppliesToOption | null): {
  pledge_id: string | null
  installment_id: string | null
  recurring_agreement_id: string | null
} {
  return {
    pledge_id: option?.pledgeId ?? null,
    installment_id: option?.installmentId ?? null,
    recurring_agreement_id: option?.recurringId ?? null,
  }
}

/* ----------------------------------------------------- pledge maths (05 §2) */

export interface PledgeProgress {
  total: number
  paid: number
  writtenOff: number
  balance: number
  fraction: number
  next: PledgeInstallmentRow | null
  overdue: PledgeInstallmentRow[]
  overdueAmount: number
  /** True when the money came from `pledge_balances` rather than the fallback. */
  fromView: boolean
}

const numeric = (value: number | null | undefined): number | null => {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Paid / balance / next installment / overdue rows for one pledge.
 *
 * The money comes from the **`pledge_balances` view** (02 §3.5/§4, I-8/I-9) —
 * balance due = total − payments applied − write-off is the database's
 * arithmetic, not the client's. The fallback below runs only when the view is
 * unavailable (a fresh project, or a restricted read), so the card degrades to
 * an approximation instead of an empty panel.
 *
 * Which rows *look* overdue is a date comparison on rows already in hand, not a
 * rollup, so it stays here either way (`overdue` is computed, never stored).
 */
export function pledgeProgress(
  pledge: PledgeRow,
  source: { donations: DonationRow[]; installments: PledgeInstallmentRow[] },
  now: Date = new Date(),
  view: PledgeBalanceRow | null = null,
): PledgeProgress {
  const todayISO = toISODate(now)
  const total = numeric(view?.amount_gbp) ?? pledge.amount_gbp ?? pledge.total_amount ?? 0

  const open = source.installments
    .filter((row) => row.pledge_id === pledge.id && row.status !== 'paid' && row.status !== 'written_off')
    .sort((a, b) => a.due_on.localeCompare(b.due_on))
  const overdue = open.filter((row) => row.due_on < todayISO)

  const fallbackPaid = source.donations
    .filter((gift) => gift.pledge_id === pledge.id && gift.status === 'received')
    .reduce((sum, gift) => sum + (gift.amount_gbp ?? gift.amount ?? 0), 0)

  const paid = numeric(view?.paid_amount) ?? fallbackPaid
  const writtenOff = numeric(view?.write_off_amount) ?? pledge.write_off_amount ?? 0
  const balance =
    numeric(view?.balance) ?? Math.max(0, toPounds(toPence(total) - toPence(paid) - toPence(writtenOff)))

  const next =
    (view?.next_installment_id ? open.find((row) => row.id === view.next_installment_id) : undefined) ??
    open.find((row) => row.due_on >= todayISO) ??
    open[0] ??
    null

  return {
    total,
    paid,
    writtenOff,
    balance,
    fraction: total > 0 ? Math.min(1, paid / total) : 0,
    next,
    overdue,
    overdueAmount:
      numeric(view?.overdue_amount) ?? toPounds(overdue.reduce((sum, row) => sum + toPence(row.amount), 0)),
    fromView: view !== null,
  }
}

/** The header card: outstanding balance across every open pledge. */
export function outstandingPledgeBalance(board: GivingBoard, now: Date = new Date()): number {
  return board.pledges
    .filter((pledge) => pledge.status === 'open')
    .reduce(
      (sum, pledge) =>
        sum +
        pledgeProgress(
          pledge,
          { donations: board.gifts, installments: board.installments },
          now,
          board.balances[pledge.id] ?? null,
        ).balance,
      0,
    )
}

/* --------------------------------------------------------- metrics (05 §4) */

const receivedTotal = (gifts: DonationRow[]): number =>
  gifts
    .filter((gift) => gift.status === 'received')
    .reduce((sum, gift) => sum + (Number(gift.amount_gbp ?? gift.amount) || 0), 0)

export interface GivingMetrics {
  monthTotal: number
  monthCount: number
  yearTotal: number
  yearCount: number
  pledgeBalance: number
  failingRecurring: number
}

export function givingMetrics(board: GivingBoard, now: Date = new Date()): GivingMetrics {
  const monthGifts = board.monthGifts.filter((gift) => gift.status === 'received')
  const yearGifts = board.yearGifts.filter((gift) => gift.status === 'received')
  return {
    monthTotal: receivedTotal(monthGifts),
    monthCount: monthGifts.length,
    yearTotal: receivedTotal(yearGifts),
    yearCount: yearGifts.length,
    pledgeBalance: outstandingPledgeBalance(board, now),
    failingRecurring: board.recurring.filter((agreement) => agreement.status === 'failing').length,
  }
}

/* ---------------------------------------------------------- queues (05 §3) */

/** 08 §2 `thank_you_on_gift`: £500 routes to the relationship owner. */
export const BIG_GIFT_THRESHOLD = 500
/** The norm the queue shows as a target (05 §3). */
export const THANKS_TARGET_HOURS = 48

export interface QueueRow {
  gift: DonationRow
  contact: ContactRow | null
  daysSince: number
  /** ≥ £500 — flagged in the queue so the big ones are never merged into the pile. */
  isBig: boolean
  /** Past the 48-hour norm. */
  pastTarget: boolean
}

const queueRow = (gift: DonationRow, contact: ContactRow | null, now: Date): QueueRow => {
  const daysSince = Math.max(0, differenceInCalendarDays(now, new Date(`${gift.donated_on}T00:00:00`)))
  const amount = Number(gift.amount_gbp ?? gift.amount) || 0
  // The 48-hour norm in calendar days: a gift two days old has missed it.
  return { gift, contact, daysSince, isBig: amount >= BIG_GIFT_THRESHOLD, pastTarget: daysSince >= 2 }
}

/** Unthanked gifts, biggest-and-oldest first (05 §3). */
export function needsThanks(board: GivingBoard, now: Date = new Date()): QueueRow[] {
  return board.gifts
    .filter((gift) => gift.status === 'received' && gift.thank_you_status !== 'done')
    .map((gift) => queueRow(gift, board.contacts[gift.contact_id] ?? null, now))
    .sort((a, b) => {
      if (a.isBig !== b.isBig) return a.isBig ? -1 : 1
      return b.daysSince - a.daysSince
    })
}

export const RECEIPT_PENDING = new Set(['not_sent', 'queued'])

/** Unreceipted gifts — `not_sent` / `queued`, oldest first (05 §3). */
export function needsReceipts(board: GivingBoard, now: Date = new Date()): QueueRow[] {
  return board.gifts
    .filter((gift) => gift.status === 'received' && RECEIPT_PENDING.has(gift.receipt_status))
    .map((gift) => queueRow(gift, board.contacts[gift.contact_id] ?? null, now))
    .sort((a, b) => b.daysSince - a.daysSince)
}

/* ------------------------------------------------------- CSV export (05 §3) */

/** RFC4180: quote anything with a comma, quote or newline; double inner quotes. */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: Array<Array<unknown>>): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

export const RECEIPT_CSV_HEADER = [
  'Gift ID',
  'Donor',
  'Address',
  'Postcode',
  'Gift date',
  'Amount GBP',
  'Currency',
  'Amount',
  'Fund',
  'Payment method',
  'Receipt preference',
] as const

const contactName = (contact: ContactRow | null): string => {
  if (!contact) return 'Unknown donor'
  const name = [contact.title, contact.first_name, contact.last_name].filter(Boolean).join(' ').trim()
  return name === '' ? (contact.organization ?? 'Unknown donor') : name
}

const addressOf = (contact: ContactRow | null): string =>
  contact ? [contact.address_line1, contact.address_line2, contact.city].filter(Boolean).join(', ') : ''

/**
 * The receipt queue as a mail-merge CSV (05 §3: no built-in merge in P1 —
 * letters export for Word). One header row plus one row per queued gift.
 */
export function receiptCsv(rows: QueueRow[], fundNames: Record<string, string> = {}): string {
  const body = rows.map(({ gift, contact }) => [
    gift.id,
    contactName(contact),
    addressOf(contact),
    contact?.postcode ?? '',
    gift.donated_on,
    (Number(gift.amount_gbp ?? gift.amount) || 0).toFixed(2),
    gift.currency,
    (Number(gift.amount) || 0).toFixed(2),
    gift.fund_id ? (fundNames[gift.fund_id] ?? '') : '',
    gift.payment_method ?? '',
    gift.receipt_pref ?? '',
  ])
  return toCsv([[...RECEIPT_CSV_HEADER], ...body])
}

/* --------------------------------------------------------------- labelling */

export const humanise = (value: string | null | undefined): string =>
  value === null || value === undefined || value === ''
    ? '—'
    : value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** `Scholarships · Dinner 2026 · Dinner letter` — the three coding axes. */
export function codingLine(
  gift: Pick<DonationRow, 'fund_id' | 'campaign_id' | 'appeal_id'>,
  refs: { funds: Record<string, string>; campaigns: Record<string, string>; appeals: Record<string, string> } | null | undefined,
): string {
  const parts = [
    gift.fund_id ? refs?.funds[gift.fund_id] : null,
    gift.campaign_id ? refs?.campaigns[gift.campaign_id] : null,
    gift.appeal_id ? refs?.appeals[gift.appeal_id] : null,
  ].filter(Boolean)
  return parts.length === 0 ? '—' : parts.join(' · ')
}

export const RECURRING_ACTIVE = new Set(['active', 'failing'])
