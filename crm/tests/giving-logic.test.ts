import { describe, expect, it } from 'vitest'
import { addDays, format, subDays } from 'date-fns'

/**
 * The Giving rules that must never drift (05 §1–§3): the schedule split, the
 * Gift Aid preview, the ask array, the applies-to offers, the queue filters and
 * the receipt CSV. All pure — no database, no React.
 */

import {
  appliesToOptions,
  appliesToPatch,
  askArray,
  BIG_GIFT_THRESHOLD,
  buildSchedule,
  checkSchedule,
  csvCell,
  declarationCovers,
  gasdsAvailable,
  givingMetrics,
  indicativeGbp,
  needsReceipts,
  needsThanks,
  outstandingPledgeBalance,
  pledgeProgress,
  previewGiftAid,
  receiptCsv,
  RECEIPT_CSV_HEADER,
  roundAsk,
  scheduleSum,
} from '../src/features/giving/logic'
import { EMPTY_BOARD } from '../src/features/giving/types'
import type {
  ContactRow,
  DonationRow,
  GiftAidDeclarationRow,
  GivingBoard,
  PledgeInstallmentRow,
  PledgeRow,
} from '../src/features/giving/types'

const iso = (date: Date) => format(date, 'yyyy-MM-dd')
const NOW = new Date(2026, 7, 28) // 28 Aug 2026, a fixed "now" for the queues

const gift = (over: Partial<DonationRow> & { id: string }): DonationRow => ({
  contact_id: 'dovid',
  donated_on: iso(NOW),
  amount: 100,
  currency: 'GBP',
  amount_gbp: 100,
  fund_id: 'f1',
  campaign_id: null,
  appeal_id: null,
  payment_method: 'bank_transfer',
  status: 'received',
  pledge_id: null,
  installment_id: null,
  recurring_agreement_id: null,
  receipt_status: 'not_sent',
  receipt_pref: null,
  thank_you_status: 'not_done',
  gift_aid_status: 'pending_declaration',
  gift_aid_claim_id: null,
  is_gasds: false,
  notes: null,
  ...over,
})

const pledge = (over: Partial<PledgeRow> & { id: string }): PledgeRow => ({
  contact_id: 'dovid',
  total_amount: 25000,
  amount_gbp: 25000,
  currency: 'GBP',
  fund_id: 'f2',
  campaign_id: null,
  appeal_id: null,
  pledged_on: '2025-10-01',
  status: 'open',
  write_off_amount: null,
  notes: null,
  ...over,
})

const installment = (over: Partial<PledgeInstallmentRow> & { id: string; pledge_id: string }): PledgeInstallmentRow => ({
  due_on: iso(NOW),
  amount: 5000,
  status: 'expected',
  ...over,
})

const contact = (id: string, over: Partial<ContactRow> = {}): ContactRow =>
  ({
    id,
    title: null,
    first_name: 'Dovid',
    last_name: 'Cohen',
    contact_kind: 'individual',
    address_line1: '12 The Drive',
    address_line2: null,
    city: 'Golders Green',
    postcode: 'NW11 8AA',
    organization: null,
    ...over,
  }) as ContactRow

const declaration = (over: Partial<GiftAidDeclarationRow> = {}): GiftAidDeclarationRow => ({
  id: 'ga1',
  contact_id: 'dovid',
  declared_on: '2026-01-10',
  method: 'written',
  covers_past: false,
  covers_future: true,
  covers_from: null,
  cancelled_on: null,
  evidence_url: null,
  ...over,
})

/* ------------------------------------------------------- schedule builder */

describe('schedule builder (05 §2)', () => {
  it('splits equally when the total divides cleanly', () => {
    const rows = buildSchedule({ total: 5000, count: 5, frequency: 'monthly', startOn: '2026-09-15' })
    expect(rows.map((r) => r.amount)).toEqual(['1000.00', '1000.00', '1000.00', '1000.00', '1000.00'])
    expect(rows.map((r) => r.due_on)).toEqual([
      '2026-09-15',
      '2026-10-15',
      '2026-11-15',
      '2026-12-15',
      '2027-01-15',
    ])
  })

  it('puts the remainder on the last installment', () => {
    const rows = buildSchedule({ total: 1000, count: 3, frequency: 'monthly', startOn: '2026-09-01' })
    expect(rows.map((r) => r.amount)).toEqual(['333.33', '333.33', '333.34'])
    expect(scheduleSum(rows)).toBe(1000)
  })

  it('keeps pennies exact on an awkward total', () => {
    const rows = buildSchedule({ total: 100.01, count: 3, frequency: 'monthly', startOn: '2026-09-01' })
    expect(rows.map((r) => r.amount)).toEqual(['33.33', '33.33', '33.35'])
    expect(scheduleSum(rows)).toBe(100.01)
  })

  it('steps quarterly and by a custom interval', () => {
    expect(
      buildSchedule({ total: 900, count: 3, frequency: 'quarterly', startOn: '2026-01-31' }).map((r) => r.due_on),
    ).toEqual(['2026-01-31', '2026-04-30', '2026-07-31'])
    expect(
      buildSchedule({ total: 300, count: 3, frequency: 'custom', startOn: '2026-01-01', customDays: 14 }).map(
        (r) => r.due_on,
      ),
    ).toEqual(['2026-01-01', '2026-01-15', '2026-01-29'])
  })

  it('returns nothing for a nonsense count', () => {
    expect(buildSchedule({ total: 500, count: 0, frequency: 'monthly', startOn: '2026-09-01' })).toEqual([])
  })

  it('checks the live sum after hand edits', () => {
    const rows = buildSchedule({ total: 5000, count: 5, frequency: 'monthly', startOn: '2026-09-15' })
    expect(checkSchedule(5000, rows)).toMatchObject({ balanced: true, difference: 0, sum: 5000 })

    const edited = rows.map((row, index) => (index === 0 ? { ...row, amount: '1200' } : row))
    const check = checkSchedule(5000, edited)
    expect(check.balanced).toBe(false)
    expect(check.difference).toBe(200)
    expect(check.sum).toBe(5200)

    const short = rows.slice(0, 4)
    expect(checkSchedule(5000, short).difference).toBe(-1000)
  })
})

/* ------------------------------------------------------------- Gift Aid */

describe('Gift Aid preview (05 §1 — preview only; the trigger decides)', () => {
  it('is eligible when an enduring declaration predates the gift', () => {
    const preview = previewGiftAid({
      currency: 'GBP',
      donatedOn: '2026-08-01',
      contactKind: 'individual',
      declarations: [declaration()],
    })
    expect(preview.state).toBe('eligible')
    expect(preview.label).toMatch(/declaration on file/i)
    expect(preview.declaration?.id).toBe('ga1')
  })

  it('asks for a declaration when none covers the gift', () => {
    const preview = previewGiftAid({
      currency: 'GBP',
      donatedOn: '2026-08-01',
      contactKind: 'individual',
      declarations: [],
    })
    expect(preview.state).toBe('no_declaration')
    expect(preview.label).toMatch(/request one/i)
  })

  it('is ineligible for non-GBP and for companies', () => {
    expect(
      previewGiftAid({
        currency: 'USD',
        donatedOn: '2026-08-01',
        contactKind: 'individual',
        declarations: [declaration()],
      }),
    ).toMatchObject({ state: 'ineligible' })

    expect(
      previewGiftAid({
        currency: 'GBP',
        donatedOn: '2026-08-01',
        contactKind: 'business',
        declarations: [declaration()],
      }),
    ).toMatchObject({ state: 'ineligible' })
  })

  it('respects covers_past, covers_future, covers_from and cancellation', () => {
    const enduring = declaration()
    expect(declarationCovers(enduring, '2026-01-10')).toBe(true) // the day it was signed
    expect(declarationCovers(enduring, '2026-06-01')).toBe(true)
    expect(declarationCovers(enduring, '2025-06-01')).toBe(false) // no covers_past

    const backdated = declaration({ covers_past: true })
    expect(declarationCovers(backdated, '2024-06-01')).toBe(true) // inside 4 years
    expect(declarationCovers(backdated, '2019-06-01')).toBe(false) // outside 4 years

    const fromDate = declaration({ covers_past: true, covers_from: '2025-04-06' })
    expect(declarationCovers(fromDate, '2025-05-01')).toBe(true)
    expect(declarationCovers(fromDate, '2025-01-01')).toBe(false)

    const cancelled = declaration({ cancelled_on: '2026-05-01' })
    expect(declarationCovers(cancelled, '2026-04-30')).toBe(true)
    expect(declarationCovers(cancelled, '2026-05-02')).toBe(false)

    const singleGift = declaration({ covers_future: false })
    expect(declarationCovers(singleGift, '2026-01-10')).toBe(true)
    expect(declarationCovers(singleGift, '2026-02-10')).toBe(false)
  })

  it('offers GASDS only for small cash/contactless sterling gifts', () => {
    expect(gasdsAvailable({ paymentMethod: 'cash', amountGbp: 20 })).toBe(true)
    expect(gasdsAvailable({ paymentMethod: 'contactless', amountGbp: 30 })).toBe(true)
    expect(gasdsAvailable({ paymentMethod: 'cash', amountGbp: 30.01 })).toBe(false)
    expect(gasdsAvailable({ paymentMethod: 'bank_transfer', amountGbp: 20 })).toBe(false)
    expect(gasdsAvailable({ paymentMethod: 'cash', amountGbp: null })).toBe(false)
    expect(gasdsAvailable({ paymentMethod: 'cash', amountGbp: 20, currency: 'USD' })).toBe(false)
  })

  it('converts non-GBP with an indicative rate', () => {
    expect(indicativeGbp(100, 'USD')).toBe(79)
    expect(indicativeGbp(100, 'GBP')).toBe(100)
    expect(indicativeGbp(null, 'USD')).toBeNull()
    expect(indicativeGbp(100, 'XYZ')).toBeNull()
  })
})

/* ------------------------------------------------------------- ask array */

describe('ask array (05 §1)', () => {
  it('rounds to steps a human would say', () => {
    expect(roundAsk(42)).toBe(40)
    expect(roundAsk(137)).toBe(140)
    expect(roundAsk(612)).toBe(600)
    expect(roundAsk(4812)).toBe(4800)
    expect(roundAsk(23_400)).toBe(23_500)
    expect(roundAsk(87_600)).toBe(88_000)
    expect(roundAsk(0)).toBe(0)
    expect(roundAsk(-5)).toBe(0)
  })

  it('offers last · highest · highest+25%', () => {
    const chips = askArray({ last_gift_amount: 1000, largest_gift: 5000 })
    expect(chips.map((c) => c.id)).toEqual(['last', 'highest', 'stretch'])
    expect(chips.map((c) => c.amount)).toEqual([1000, 5000, 6300])
    expect(chips[0]?.label).toBe('Last £1,000')
    expect(chips[2]?.label).toContain('+25%')
  })

  it('never repeats an amount, and always stretches past the highest', () => {
    const same = askArray({ last_gift_amount: 500, largest_gift: 500 })
    expect(same.map((c) => c.amount)).toEqual([500, 625])

    // £22 rounds onto the £20 last gift, so that chip drops; the stretch stays.
    const tiny = askArray({ last_gift_amount: 20, largest_gift: 22 })
    expect(tiny.map((c) => c.amount)).toEqual([20, 30])
    expect(tiny.map((c) => c.id)).toEqual(['last', 'stretch'])
  })

  it('shows nothing for a donor with no history', () => {
    expect(askArray(null)).toEqual([])
    expect(askArray({ last_gift_amount: null, largest_gift: null })).toEqual([])
  })
})

/* ------------------------------------------------------------ applies-to */

describe('applies-to (05 §1 → 02 §3.4)', () => {
  const source = {
    pledges: [pledge({ id: 'pl-1' }), pledge({ id: 'pl-closed', status: 'written_off' })],
    installments: [
      installment({ id: 'ins-paid', pledge_id: 'pl-1', due_on: '2025-11-15', status: 'paid' }),
      installment({ id: 'ins-overdue', pledge_id: 'pl-1', due_on: iso(subDays(NOW, 20)) }),
      installment({ id: 'ins-next', pledge_id: 'pl-1', due_on: iso(addDays(NOW, 19)) }),
      installment({ id: 'ins-closed', pledge_id: 'pl-closed', due_on: iso(NOW) }),
    ],
    recurring: [
      { id: 'rec-1', amount: 150, frequency: 'monthly', status: 'failing' },
      { id: 'rec-dead', amount: 50, frequency: 'monthly', status: 'cancelled' },
    ],
  }

  it('offers open installments overdue-first, then the pledge and live agreements', () => {
    const options = appliesToOptions(source, NOW)
    expect(options.map((o) => o.id)).toEqual([
      'installment:ins-overdue',
      'recurring:rec-1',
      'installment:ins-next',
      'pledge:pl-1',
    ])
    expect(options[0]?.overdue).toBe(true)
    expect(options[0]?.amount).toBe(5000)
  })

  it('excludes paid installments, closed pledges and cancelled agreements', () => {
    const ids = appliesToOptions(source, NOW).map((o) => o.id)
    expect(ids).not.toContain('installment:ins-paid')
    expect(ids).not.toContain('installment:ins-closed')
    expect(ids).not.toContain('pledge:pl-closed')
    expect(ids).not.toContain('recurring:rec-dead')
  })

  it('writes exactly the three foreign keys', () => {
    const options = appliesToOptions(source, NOW)
    const chosen = options.find((o) => o.id === 'installment:ins-next')
    expect(appliesToPatch(chosen ?? null)).toEqual({
      pledge_id: 'pl-1',
      installment_id: 'ins-next',
      recurring_agreement_id: null,
    })
    expect(appliesToPatch(options.find((o) => o.kind === 'recurring') ?? null)).toEqual({
      pledge_id: null,
      installment_id: null,
      recurring_agreement_id: 'rec-1',
    })
    expect(appliesToPatch(null)).toEqual({
      pledge_id: null,
      installment_id: null,
      recurring_agreement_id: null,
    })
  })
})

/* --------------------------------------------------------- pledge maths */

describe('pledge progress and balance (05 §2)', () => {
  const donations = [
    gift({ id: 'g1', pledge_id: 'pl-1', amount: 5000, amount_gbp: 5000 }),
    gift({ id: 'g2', pledge_id: 'pl-1', amount: 5000, amount_gbp: 5000, status: 'refunded' }),
    gift({ id: 'g3', pledge_id: null }),
  ]
  const installments = [
    installment({ id: 'i1', pledge_id: 'pl-1', due_on: iso(subDays(NOW, 30)), amount: 5000 }),
    installment({ id: 'i2', pledge_id: 'pl-1', due_on: iso(addDays(NOW, 30)), amount: 5000 }),
  ]

  it('counts received payments only and subtracts the write-off', () => {
    const progress = pledgeProgress(pledge({ id: 'pl-1', write_off_amount: 2000 }), { donations, installments }, NOW)
    expect(progress.paid).toBe(5000)
    expect(progress.balance).toBe(18000)
    expect(progress.fraction).toBeCloseTo(0.2)
    expect(progress.overdue.map((row) => row.id)).toEqual(['i1'])
    expect(progress.next?.id).toBe('i2')
  })

  it('prefers the pledge_balances view over the client fallback (I-8/I-9)', () => {
    const view = {
      pledge_id: 'pl-1',
      contact_id: 'dovid',
      status: 'open',
      total_amount: 25000,
      amount_gbp: 25000,
      // Deliberately different from what the client would compute, so the test
      // fails the moment the view stops being the source of truth.
      paid_amount: 12345,
      payment_count: 3,
      write_off_amount: 500,
      balance: 12155,
      installment_count: 2,
      paid_installment_count: 1,
      overdue_installment_count: 1,
      overdue_amount: 4321,
      next_installment_id: 'i2',
      next_installment_due_on: iso(addDays(NOW, 30)),
      next_installment_amount: 5000,
    }
    const progress = pledgeProgress(pledge({ id: 'pl-1' }), { donations, installments }, NOW, view)
    expect(progress).toMatchObject({
      paid: 12345,
      writtenOff: 500,
      balance: 12155,
      overdueAmount: 4321,
      fromView: true,
    })
    expect(progress.next?.id).toBe('i2')
    // The overdue *rows* still come from the installments in hand.
    expect(progress.overdue.map((row) => row.id)).toEqual(['i1'])

    // Without the view the card still renders, from the payments it can see.
    const fallback = pledgeProgress(pledge({ id: 'pl-1' }), { donations, installments }, NOW)
    expect(fallback).toMatchObject({ paid: 5000, balance: 20000, overdueAmount: 5000, fromView: false })
  })

  it('sums the outstanding balance across open pledges only', () => {
    const board: GivingBoard = {
      ...EMPTY_BOARD,
      gifts: donations,
      pledges: [pledge({ id: 'pl-1' }), pledge({ id: 'pl-2', total_amount: 4000, amount_gbp: 4000 }), pledge({ id: 'pl-3', status: 'cancelled' })],
      installments,
    }
    expect(outstandingPledgeBalance(board, NOW)).toBe(24000)
  })
})

/* -------------------------------------------------------------- queues */

describe('queues and metrics (05 §3–§4)', () => {
  const board: GivingBoard = {
    ...EMPTY_BOARD,
    gifts: [
      gift({ id: 'old-big', donated_on: iso(subDays(NOW, 9)), amount: 5000, amount_gbp: 5000 }),
      gift({ id: 'fresh', donated_on: iso(NOW), amount: 180, amount_gbp: 180 }),
      gift({ id: 'older', donated_on: iso(subDays(NOW, 4)), amount: 100, amount_gbp: 100 }),
      gift({ id: 'done', donated_on: iso(subDays(NOW, 3)), thank_you_status: 'done', receipt_status: 'sent' }),
      gift({ id: 'refunded', donated_on: iso(subDays(NOW, 1)), status: 'refunded' }),
      gift({ id: 'queued', donated_on: iso(subDays(NOW, 2)), thank_you_status: 'done', receipt_status: 'queued' }),
      gift({
        id: 'not-required',
        donated_on: iso(subDays(NOW, 2)),
        thank_you_status: 'done',
        receipt_status: 'not_required',
      }),
    ],
    contacts: { dovid: contact('dovid') },
    monthGifts: [gift({ id: 'fresh', amount_gbp: 180 }), gift({ id: 'refunded', status: 'refunded', amount_gbp: 999 })],
    yearGifts: [gift({ id: 'fresh', amount_gbp: 180 }), gift({ id: 'old-big', amount_gbp: 5000 })],
    recurring: [
      { id: 'r1', contact_id: 'dovid', amount: 150, currency: 'GBP', frequency: 'monthly', payment_method: null, fund_id: null, starts_on: '2025-01-01', ends_on: null, status: 'failing', last_payment_on: null, missed_count: 2, expected_day: 1 },
      { id: 'r2', contact_id: 'dovid', amount: 50, currency: 'GBP', frequency: 'monthly', payment_method: null, fund_id: null, starts_on: '2025-01-01', ends_on: null, status: 'active', last_payment_on: null, missed_count: 0, expected_day: 1 },
    ],
  }

  it('queues unthanked gifts big-first then oldest, flagging the 48h norm', () => {
    const rows = needsThanks(board, NOW)
    expect(rows.map((row) => row.gift.id)).toEqual(['old-big', 'older', 'fresh'])
    expect(rows[0]).toMatchObject({ isBig: true, daysSince: 9, pastTarget: true })
    expect(rows[2]).toMatchObject({ isBig: false, daysSince: 0, pastTarget: false })
    // Refunded and already-thanked rows never enter the queue.
    expect(rows.map((row) => row.gift.id)).not.toContain('refunded')
    expect(rows.map((row) => row.gift.id)).not.toContain('done')
    expect(BIG_GIFT_THRESHOLD).toBe(500)
  })

  it('queues not_sent and queued receipts only, oldest first', () => {
    const rows = needsReceipts(board, NOW)
    expect(rows.map((row) => row.gift.id)).toEqual(['old-big', 'older', 'queued', 'fresh'])
    expect(rows.map((row) => row.gift.id)).not.toContain('not-required')
    expect(rows.map((row) => row.gift.id)).not.toContain('done')
  })

  it('totals only received gifts and counts failing agreements', () => {
    const metrics = givingMetrics(board, NOW)
    expect(metrics.monthTotal).toBe(180)
    expect(metrics.monthCount).toBe(1)
    expect(metrics.yearTotal).toBe(5180)
    expect(metrics.failingRecurring).toBe(1)
  })
})

/* ----------------------------------------------------------- CSV export */

describe('receipt CSV (05 §3 — export for a Word merge)', () => {
  it('escapes commas, quotes and newlines', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('Cohen, Dovid')).toBe('"Cohen, Dovid"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell(null)).toBe('')
  })

  it('writes the header and one row per queued gift', () => {
    const board: GivingBoard = {
      ...EMPTY_BOARD,
      gifts: [gift({ id: 'g1', donated_on: '2026-08-20', amount: 250, amount_gbp: 250 })],
      contacts: { dovid: contact('dovid', { title: 'Rabbi', address_line1: '12 The Drive, Flat 2' }) },
    }
    const csv = receiptCsv(needsReceipts(board, NOW), { f1: 'Scholarships' })
    const lines = csv.split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(RECEIPT_CSV_HEADER.join(','))
    expect(lines[1]).toBe(
      'g1,Rabbi Dovid Cohen,"12 The Drive, Flat 2, Golders Green",NW11 8AA,2026-08-20,250.00,GBP,250.00,Scholarships,bank_transfer,',
    )
  })

  it('is header-only when nothing is queued', () => {
    expect(receiptCsv([])).toBe(RECEIPT_CSV_HEADER.join(','))
  })
})
