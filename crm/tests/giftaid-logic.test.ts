import { describe, expect, it } from 'vitest'
import {
  awaitsWrittenConfirmation,
  claimableLines,
  coversLabel,
  coveringDeclaration,
  declarationCovers,
  declarationState,
  hmrcAmount,
  hmrcCsv,
  hmrcDate,
  hmrcFilename,
  hmrcRow,
  HMRC_CSV_HEADER,
  houseNumber,
  mailtoHref,
  missingQueue,
  recoverable,
  requestDraftText,
  summariseValidation,
  validationChip,
} from '../src/features/giftaid/logic'
import type {
  ClaimLine,
  DeclarationRow,
  GaContactRow,
  GaDonationRow,
  MissingDeclarationRow,
  ValidationFailure,
} from '../src/features/giftaid/types'

/**
 * The Gift Aid workspace's pure half (05 §5, 02 §3.7).
 *
 * The HMRC schedule is the reason this file is strict about bytes: Charities
 * Online rejects a file as a whole, so a wrong header, a `2026-03-04` date or
 * an unescaped comma is not a cosmetic bug — it is a rejected quarter.
 */

const contact = (over: Partial<GaContactRow> = {}): GaContactRow =>
  ({
    id: 'c1',
    title: 'Mr',
    first_name: 'Dovid',
    last_name: 'Cohen',
    hebrew_name: null,
    organization: null,
    position: null,
    industry: null,
    contact_kind: 'individual',
    is_organisation_self: false,
    photo_url: null,
    household_id: null,
    email: 'dovid@example.com',
    phone: null,
    whatsapp: null,
    preferred_language: null,
    preferred_channel: null,
    best_time_to_contact: null,
    assistant_name: null,
    assistant_contact: null,
    linkedin_url: null,
    website_url: null,
    address_line1: '12 The Drive',
    address_line2: null,
    city: 'Golders Green',
    postcode: 'NW11 8AA',
    country: 'United Kingdom',
    source: null,
    introduced_by_id: null,
    introduced_by_note: null,
    relationship_owner_id: null,
    relationship_strength: null,
    known_since: null,
    mutual_connections: null,
    birthday: null,
    spouse_name: null,
    family_notes: null,
    things_to_remember: null,
    stage: 'active_donor',
    priority: 'medium',
    tier: null,
    estimated_capacity: null,
    contact_frequency_days: null,
    kit_paused_until: null,
    engagement_score: null,
    engagement_tier: null,
    pinned_note_id: null,
    is_archived: false,
    merged_into_id: null,
    ga_house_no: null,
    ...over,
  }) as GaContactRow

const gift = (over: Partial<GaDonationRow> = {}): GaDonationRow =>
  ({
    id: 'g1',
    contact_id: 'c1',
    donated_on: '2026-03-04',
    amount: 250,
    currency: 'GBP',
    amount_gbp: 250,
    fund_id: 'f1',
    campaign_id: null,
    appeal_id: null,
    payment_method: 'bank_transfer',
    status: 'received',
    pledge_id: null,
    installment_id: null,
    recurring_agreement_id: null,
    receipt_status: 'sent',
    receipt_pref: null,
    thank_you_status: 'done',
    gift_aid_status: 'eligible',
    gift_aid_claim_id: 'claim-1',
    is_gasds: false,
    notes: null,
    ...over,
  }) as GaDonationRow

const declaration = (over: Partial<DeclarationRow> = {}): DeclarationRow => ({
  id: 'd1',
  contact_id: 'c1',
  declared_on: '2026-01-15',
  method: 'written',
  wording_version: 'HMRC 2024-04',
  covers_past: true,
  covers_future: true,
  covers_from: null,
  oral_confirmation_sent_on: null,
  cancelled_on: null,
  evidence_url: null,
  ...over,
})

/* ----------------------------------------------------------- house number */

describe('houseNumber — the HMRC "House name or number" rule', () => {
  it('prefers the explicit ga_house_no override', () => {
    expect(houseNumber(contact({ ga_house_no: 'Flat 2b', address_line1: '12 The Drive' }))).toBe('Flat 2b')
  })

  it('falls back to the leading token of address_line1', () => {
    expect(houseNumber(contact({ address_line1: '12 The Drive' }))).toBe('12')
    expect(houseNumber(contact({ address_line1: 'Elm House, Sentinel Square' }))).toBe('Elm')
  })

  it('is empty when there is nothing to take', () => {
    expect(houseNumber(contact({ address_line1: null }))).toBe('')
    expect(houseNumber(contact({ address_line1: '   ' }))).toBe('')
    expect(houseNumber(null)).toBe('')
  })

  it('ignores a blank override rather than exporting whitespace', () => {
    expect(houseNumber(contact({ ga_house_no: '   ', address_line1: '9 Ravenscroft' }))).toBe('9')
  })
})

/* ------------------------------------------------------------------ dates */

describe('hmrcDate — DD/MM/YY, the only format Charities Online accepts', () => {
  it('zero-pads day and month and takes two year digits', () => {
    expect(hmrcDate('2026-03-04')).toBe('04/03/26')
    expect(hmrcDate('2025-12-31')).toBe('31/12/25')
    expect(hmrcDate('2026-01-01')).toBe('01/01/26')
  })

  it('is empty for a missing date rather than "Invalid Date"', () => {
    expect(hmrcDate(null)).toBe('')
    expect(hmrcDate('')).toBe('')
  })
})

/* -------------------------------------------------------------------- CSV */

describe('hmrcCsv — the Charities Online schedule', () => {
  const line = (over: { gift?: Partial<GaDonationRow>; contact?: Partial<GaContactRow> } = {}): ClaimLine => ({
    gift: gift(over.gift),
    contact: contact(over.contact),
  })

  it('uses exactly the nine spec columns, in order', () => {
    expect([...HMRC_CSV_HEADER]).toEqual([
      'Title',
      'First name',
      'Last name',
      'House name or number',
      'Postcode',
      'Aggregated donations',
      'Sponsored event',
      'Donation date',
      'Amount',
    ])
    expect(hmrcCsv([]).split('\r\n')[0]).toBe(
      'Title,First name,Last name,House name or number,Postcode,Aggregated donations,Sponsored event,Donation date,Amount',
    )
  })

  it('renders one gift exactly, with aggregated and sponsored left blank', () => {
    expect(hmrcRow(line())).toEqual(['Mr', 'Dovid', 'Cohen', '12', 'NW11 8AA', '', '', '04/03/26', '250.00'])
  })

  it('writes amounts to two decimals from amount_gbp', () => {
    expect(hmrcAmount(line({ gift: { amount_gbp: 1234.5, amount: 9999 } }))).toBe('1234.50')
    // No GBP conversion stored: the ledger amount is the sterling amount.
    expect(hmrcAmount(line({ gift: { amount_gbp: null, amount: 40 } }))).toBe('40.00')
  })

  it('escapes commas, quotes and newlines the way RFC 4180 requires', () => {
    const csv = hmrcCsv([
      line({ contact: { last_name: 'Cohen, Jr', first_name: 'Do"vid', address_line1: 'Elm House' } }),
    ])
    const row = csv.split('\r\n')[1] as string
    expect(row).toContain('"Cohen, Jr"')
    expect(row).toContain('"Do""vid"')
  })

  it('orders rows by donation date, oldest first', () => {
    const csv = hmrcCsv([
      line({ gift: { id: 'b', donated_on: '2026-06-01' } }),
      line({ gift: { id: 'a', donated_on: '2026-02-01' } }),
    ])
    const [, first, second] = csv.split('\r\n')
    expect(first).toContain('01/02/26')
    expect(second).toContain('01/06/26')
  })

  it('renders an unknown donor as empty cells rather than the word "null"', () => {
    const csv = hmrcCsv([{ gift: gift(), contact: null }])
    expect(csv.split('\r\n')[1]).toBe(',,,,,,,04/03/26,250.00')
  })

  it('keeps GASDS and non-received rows out of the schedule', () => {
    const rows = [line(), line({ gift: { id: 'gasds', is_gasds: true } }), line({ gift: { id: 'refunded', status: 'refunded' } })]
    expect(claimableLines(rows).map((row) => row.gift.id)).toEqual(['g1'])
  })

  it('names the file by the day it was generated', () => {
    expect(hmrcFilename('2026-08-28')).toBe('gift-aid-claim-2026-08-28.csv')
  })
})

/* --------------------------------------------------- declaration coverage */

describe('declarationCovers — the coverage window (02 §3.7)', () => {
  it('covers gifts from the declaration date onward when enduring', () => {
    const d = declaration({ covers_future: true, covers_past: false })
    expect(declarationCovers(d, '2026-01-15')).toBe(true)
    expect(declarationCovers(d, '2026-06-01')).toBe(true)
    expect(declarationCovers(d, '2025-12-31')).toBe(false)
  })

  it('covers the four back-years when covers_past is set', () => {
    const d = declaration({ covers_past: true, covers_future: true })
    expect(declarationCovers(d, '2022-01-15')).toBe(true)
    expect(declarationCovers(d, '2022-01-14')).toBe(false)
  })

  it('anchors the whole window on covers_from when the donor named one', () => {
    // Declared in 2026 but only covering giving from 2024 — a gift in 2023 is
    // outside the window even though it is inside four years of the signature.
    const d = declaration({ declared_on: '2026-01-15', covers_from: '2024-04-06', covers_past: false })
    expect(declarationCovers(d, '2024-04-06')).toBe(true)
    expect(declarationCovers(d, '2024-04-05')).toBe(false)
    expect(declarationCovers(d, '2025-01-01')).toBe(true)
  })

  it('reaches back four years from covers_from, not from declared_on', () => {
    const d = declaration({ declared_on: '2026-01-15', covers_from: '2024-04-06', covers_past: true })
    expect(declarationCovers(d, '2020-04-06')).toBe(true)
    expect(declarationCovers(d, '2020-04-05')).toBe(false)
  })

  it('stops covering gifts made on or after the cancellation date', () => {
    const d = declaration({ cancelled_on: '2026-05-01' })
    expect(declarationCovers(d, '2026-04-30')).toBe(true)
    expect(declarationCovers(d, '2026-05-01')).toBe(false)
    expect(declarationCovers(d, '2026-05-02')).toBe(false)
  })

  it('covers nothing while a declaration is neither past nor future', () => {
    const d = declaration({ covers_future: false, covers_past: false })
    expect(declarationCovers(d, '2026-01-15')).toBe(false)
    expect(declarationCovers(d, '2025-01-15')).toBe(false)
  })

  it('picks the first declaration on file that covers a date', () => {
    const cancelled = declaration({ id: 'old', cancelled_on: '2026-02-01' })
    const live = declaration({ id: 'new', declared_on: '2026-02-02' })
    expect(coveringDeclaration([cancelled, live], '2026-03-01')?.id).toBe('new')
    expect(coveringDeclaration([cancelled, live], '2026-01-20')?.id).toBe('old')
    expect(coveringDeclaration([], '2026-01-20')).toBeNull()
  })

  it('labels what a declaration covers', () => {
    expect(coversLabel(declaration())).toBe('future + 4 back-years')
    expect(coversLabel(declaration({ covers_past: false }))).toBe('future gifts')
    expect(coversLabel(declaration({ covers_future: false }))).toBe('4 back-years')
    expect(coversLabel(declaration({ covers_future: false, covers_past: false }))).toBe('this gift only')
  })
})

/* ------------------------------------------------- oral confirmation states */

describe('oral declarations — unusable until confirmed in writing (HMRC)', () => {
  const oral = (over: Partial<DeclarationRow> = {}) => declaration({ method: 'oral', ...over })

  it('reads as pending confirmation, and covers nothing', () => {
    const d = oral()
    expect(declarationState(d)).toBe('pending_confirmation')
    expect(awaitsWrittenConfirmation(d)).toBe(true)
    expect(declarationCovers(d, '2026-06-01')).toBe(false)
    expect(declarationCovers(d, '2025-06-01')).toBe(false)
  })

  it('becomes active — and starts covering — once the confirmation is stamped', () => {
    const d = oral({ oral_confirmation_sent_on: '2026-01-18' })
    expect(declarationState(d)).toBe('active')
    expect(awaitsWrittenConfirmation(d)).toBe(false)
    expect(declarationCovers(d, '2026-06-01')).toBe(true)
  })

  it('a cancelled oral declaration is cancelled, not pending', () => {
    const d = oral({ cancelled_on: '2026-02-01' })
    expect(declarationState(d)).toBe('cancelled')
    expect(awaitsWrittenConfirmation(d)).toBe(false)
  })

  it('written and online declarations need no confirmation', () => {
    expect(declarationState(declaration({ method: 'written' }))).toBe('active')
    expect(declarationState(declaration({ method: 'online' }))).toBe('active')
  })
})

/* ------------------------------------------------------- recoverable money */

describe('recoverable — the +25%', () => {
  it('is a quarter of the eligible giving, to the penny', () => {
    expect(recoverable(1800)).toBe(450)
    expect(recoverable(1200)).toBe(300)
    expect(recoverable(33.33)).toBe(8.33)
  })

  it('is zero for nothing at all', () => {
    expect(recoverable(null)).toBe(0)
    expect(recoverable(undefined)).toBe(0)
    expect(recoverable(Number.NaN)).toBe(0)
  })
})

describe('missingQueue — found money, richest first (05 §5)', () => {
  const row = (over: Partial<MissingDeclarationRow>): MissingDeclarationRow => ({
    contact_id: 'c1',
    gift_count: 2,
    eligible_total: 400,
    recoverable: 100,
    eligible_total_4y: 400,
    recoverable_4y: 100,
    first_gift_on: '2025-01-01',
    last_gift_on: '2026-01-01',
    ...over,
  })

  const rows = [
    row({ contact_id: 'small', eligible_total: 600, recoverable: 150, recoverable_4y: 150, eligible_total_4y: 600 }),
    row({ contact_id: 'big', eligible_total: 1800, recoverable: 450, recoverable_4y: 300, eligible_total_4y: 1200 }),
    row({ contact_id: 'mid', eligible_total: 1200, recoverable: 300, recoverable_4y: 300, eligible_total_4y: 1200 }),
  ]

  it('sorts by what a declaration would recover', () => {
    const queue = missingQueue(rows, {})
    expect(queue.rows.map((r) => r.contact_id)).toEqual(['big', 'mid', 'small'])
  })

  it('totals the header line — "£900 recoverable from 3 donors"', () => {
    const queue = missingQueue(rows, {})
    expect(queue.recoverableTotal).toBe(900)
    expect(queue.donorCount).toBe(3)
  })

  it('keeps the four-year slice separate from the lifetime one (07 §10)', () => {
    const queue = missingQueue(rows, {})
    expect(queue.recoverable4y).toBe(750)
    expect(queue.eligible4y).toBe(3000)
  })

  it('joins the donor record when one is loaded', () => {
    const queue = missingQueue([row({ contact_id: 'c1' })], { c1: contact() })
    expect(queue.rows[0]?.contact?.first_name).toBe('Dovid')
    expect(missingQueue([row({ contact_id: 'ghost' })], {}).rows[0]?.contact).toBeNull()
  })
})

/* ------------------------------------------------------------- validation */

describe('summariseValidation — one row per gift, not per failure', () => {
  const failure = (over: Partial<ValidationFailure>): ValidationFailure => ({
    donation_id: 'g1',
    contact_id: 'c1',
    donor_name: 'Mr Dovid Cohen',
    donated_on: '2026-03-04',
    amount_gbp: 250,
    code: 'missing_postcode',
    message: 'Postcode missing — HMRC needs it to match the donor',
    ...over,
  })

  it('groups a gift with two problems into one row', () => {
    const summary = summariseValidation([
      failure({}),
      failure({ code: 'missing_house_no', message: 'House name or number missing' }),
    ])
    expect(summary.giftCount).toBe(1)
    expect(summary.groups[0]?.failures).toHaveLength(2)
    expect(summary.ready).toBe(false)
  })

  it('is ready when the pass returns nothing', () => {
    const summary = summariseValidation([])
    expect(summary.ready).toBe(true)
    expect(summary.giftCount).toBe(0)
    expect(validationChip(summary)).toBe('Validation: every row is claimable')
  })

  it('names the commonest blocker in the hero chip', () => {
    const summary = summariseValidation([
      failure({ donation_id: 'a' }),
      failure({ donation_id: 'b' }),
      failure({ donation_id: 'c', code: 'not_gbp', message: 'Only sterling gifts can be claimed' }),
    ])
    expect(validationChip(summary)).toBe('Validation: 2 rows need a postcode · 1 more blocked')
  })

  it('drops the tail when a single blocker explains everything', () => {
    const summary = summariseValidation([failure({ donation_id: 'a' })])
    expect(validationChip(summary)).toBe('Validation: 1 row needs a postcode')
  })
})

/* -------------------------------------------------------- request drafting */

describe('requestDraftText — the app drafts, the human sends', () => {
  it('names the donor, the charity and what a declaration is worth', () => {
    const text = requestDraftText({ donorName: 'Aron Berger', recoverable: 450, charityName: 'Yeshivas Ohr' })
    expect(text).toContain('Dear Aron Berger')
    expect(text).toContain('£450')
    expect(text).toContain('Yeshivas Ohr')
  })

  it('links the form when there is one, and offers to send it when there is not', () => {
    expect(
      requestDraftText({
        donorName: 'A',
        recoverable: 10,
        charityName: 'X',
        formUrl: 'https://example.org/ga',
      }),
    ).toContain('https://example.org/ga')
    expect(requestDraftText({ donorName: 'A', recoverable: 10, charityName: 'X' })).toContain(
      'send the one-line declaration form',
    )
  })

  it('builds a mailto only when there is an address to send to', () => {
    expect(mailtoHref('a@b.test', 'Subject', 'Body')).toContain('mailto:a%40b.test')
    expect(mailtoHref('a@b.test', 'S&S', 'x y')).toContain('subject=S%26S')
    expect(mailtoHref(null, 'S', 'B')).toBeNull()
    expect(mailtoHref('   ', 'S', 'B')).toBeNull()
  })
})
