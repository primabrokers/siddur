/**
 * Normalisation preview (06 §5, step 3).
 *
 * The rule the spec sets is "phones→E.164, dates, titles" — and the rule this
 * module sets for itself is that **every rewrite is shown**. A silent import
 * that quietly turns `07700 900123` into `+447700900123` is correct but
 * untrustworthy; the wizard lists the change, the row and the reason, so the
 * person clicking Commit has actually seen what will be written.
 *
 * The phone/email rules are the same functions the create sheet uses
 * (`features/contacts/normalise.ts`) — data quality at the door and data
 * quality at the loading bay must not drift apart (02 §6).
 */

import { normaliseEmail, normalisePhone } from '../contacts/normalise'
import type {
  ColumnMapping,
  ContactField,
  FieldChange,
  GiftDraft,
  ImportField,
  NormalisedRow,
  RowIssue,
} from './types'
import { GIFT_FIELDS } from './mapping'

/* ------------------------------------------------------------------- dates */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

const pad = (n: number): string => String(n).padStart(2, '0')

function valid(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/**
 * Spreadsheet dates → ISO `yyyy-mm-dd`.
 *
 * **Day-first**, deliberately: the file is a UK charity's export, and
 * `03/04/2024` there means 3 April. An unambiguous `2024-04-03` is taken as
 * written; `04/13/2024` (impossible day-first) falls back to month-first
 * rather than being rejected, because a US-formatted stray row is common and
 * recoverable. Two-digit years pivot at 70 → 1970..2069.
 */
export function toISODate(input: string): string | null {
  const value = input.trim()
  if (value === '') return null

  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value)
  if (iso) {
    const [, y, m, d] = iso
    const year = Number(y)
    const month = Number(m)
    const day = Number(d)
    return valid(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : null
  }

  const named = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-](\d{2,4})$/.exec(value)
  if (named) {
    const [, d, monthName, y] = named
    const month = MONTHS[monthName.slice(0, 4).toLowerCase()] ?? MONTHS[monthName.slice(0, 3).toLowerCase()]
    if (!month) return null
    const year = expandYear(Number(y))
    const day = Number(d)
    return valid(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : null
  }

  const slashed = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(value)
  if (slashed) {
    const [, a, b, y] = slashed
    const year = expandYear(Number(y))
    const first = Number(a)
    const second = Number(b)
    if (valid(year, second, first)) return `${year}-${pad(second)}-${pad(first)}`
    if (valid(year, first, second)) return `${year}-${pad(first)}-${pad(second)}`
    return null
  }

  return null
}

function expandYear(year: number): number {
  if (year >= 100) return year
  return year >= 70 ? 1900 + year : 2000 + year
}

/* ------------------------------------------------------------------ titles */

/** Honorifics the yeshiva's sheet actually uses, canonicalised. */
const TITLES: Record<string, string> = {
  r: "R'",
  rb: "R'",
  reb: "Reb",
  rav: 'Rav',
  rabbi: 'Rabbi',
  rebbetzin: 'Rebbetzin',
  mr: 'Mr',
  mrs: 'Mrs',
  ms: 'Ms',
  miss: 'Miss',
  dr: 'Dr',
  prof: 'Prof',
  professor: 'Prof',
  sir: 'Sir',
  lady: 'Lady',
  mrandmrs: 'Mr & Mrs',
}

export function normaliseTitle(input: string): string {
  const key = input.trim().toLowerCase().replace(/[^a-z]/g, '')
  if (key === '') return ''
  return TITLES[key] ?? titleCase(input)
}

/**
 * `DOVID` → `Dovid`, `mcdonald` → `McDonald`, `o'brien` → `O'Brien`. Mixed-case
 * input is left alone: someone who typed `deVries` meant it.
 */
export function titleCase(input: string): string {
  const value = input.trim()
  if (value === '') return ''
  const hasLower = /[a-z]/.test(value)
  const hasUpper = /[A-Z]/.test(value)
  if (hasLower && hasUpper) return value

  return value
    .toLowerCase()
    .replace(/(^|[\s'’\-])([a-z])/g, (_m, lead: string, ch: string) => lead + ch.toUpperCase())
    .replace(/\bMc([a-z])/g, (_m, ch: string) => `Mc${ch.toUpperCase()}`)
}

/* ----------------------------------------------------------------- amounts */

/** `£1,250.50` → 1250.5; `(50)` → -50 is *not* supported (refunds aren't imports). */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[£$€,\s]/g, '').trim()
  if (cleaned === '') return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

/* --------------------------------------------------------------------- row */

const NAME_FIELDS: ContactField[] = ['first_name', 'last_name', 'spouse_name']
const DATE_FIELDS: ImportField[] = ['birthday', 'gift_date']

function cells(row: string[], mapping: ColumnMapping): Partial<Record<ImportField, string>> {
  const out: Partial<Record<ImportField, string>> = {}
  mapping.forEach((field, index) => {
    if (!field) return
    const value = (row[index] ?? '').trim()
    if (value !== '') out[field] = value
  })
  return out
}

/**
 * Normalise one CSV row into the values that will be written, plus the list of
 * changes the preview shows and the issues that gate the commit.
 *
 * `block` issues stop a row being written at all (no name, an amount that is
 * not a number). `warn` issues are shown and imported anyway — a birthday we
 * could not read is dropped, not a reason to lose the donor.
 */
export function normaliseRow(row: string[], mapping: ColumnMapping, line: number): NormalisedRow {
  const raw = cells(row, mapping)
  const contact: Partial<Record<ContactField, string>> = {}
  const changes: FieldChange[] = []
  const issues: RowIssue[] = []

  const note = (field: ImportField, from: string, to: string, rule: string) => {
    if (from !== to) changes.push({ field, from, to, rule })
  }

  for (const [key, original] of Object.entries(raw) as Array<[ImportField, string]>) {
    if ((GIFT_FIELDS as ImportField[]).includes(key)) continue
    const field = key as ContactField

    if (field === 'email') {
      const value = normaliseEmail(original)
      if (!value) continue
      if (!value.includes('@')) issues.push({ field, level: 'warn', message: `"${original}" is not an email address — imported as written.` })
      note(field, original, value, 'lowercased')
      contact[field] = value
      continue
    }

    if (field === 'phone' || field === 'whatsapp') {
      const value = normalisePhone(original)
      if (!value) continue
      if (!value.startsWith('+')) {
        issues.push({ field, level: 'warn', message: `"${original}" has no usable digits — imported as written.` })
      }
      note(field, original, value, 'phone → E.164')
      contact[field] = value
      continue
    }

    if (field === 'title') {
      const value = normaliseTitle(original)
      if (value === '') continue
      note(field, original, value, 'title')
      contact[field] = value
      continue
    }

    if (NAME_FIELDS.includes(field) || field === 'organization' || field === 'city') {
      const value = titleCase(original)
      note(field, original, value, 'title case')
      contact[field] = value
      continue
    }

    if (DATE_FIELDS.includes(field)) {
      const value = toISODate(original)
      if (!value) {
        issues.push({ field, level: 'warn', message: `Could not read the date "${original}" — left empty.` })
        continue
      }
      note(field, original, value, 'date → ISO')
      contact[field] = value
      continue
    }

    if (field === 'postcode') {
      const value = original.toUpperCase().replace(/\s+/g, ' ')
      note(field, original, value, 'postcode case')
      contact[field] = value
      continue
    }

    contact[field] = original
  }

  const named = Boolean(contact.first_name || contact.last_name || contact.organization)
  if (!named) issues.push({ field: 'row', level: 'block', message: 'No name and no organisation — nothing to create.' })

  const gift = buildGift(raw, issues, changes)

  const displayName =
    [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.organization || '(no name)'

  return { line, contact, gift, changes, issues, displayName }
}

/**
 * The gift half of a row. Its rewrites go into the same `changes` list as the
 * contact's: "£1,000" becoming `1000` and "15/03/2024" becoming `2024-03-15`
 * are exactly the kind of thing the preview promises to show.
 */
function buildGift(
  raw: Partial<Record<ImportField, string>>,
  issues: RowIssue[],
  changes: FieldChange[],
): GiftDraft | null {
  const amountText = raw.gift_amount
  const dateText = raw.gift_date
  if (!amountText && !dateText) return null

  const amount = amountText ? parseAmount(amountText) : null
  if (amountText && amount === null) {
    issues.push({ field: 'gift_amount', level: 'block', message: `"${amountText}" is not an amount.` })
    return null
  }
  if (amount === null) {
    issues.push({ field: 'gift_amount', level: 'warn', message: 'A gift date with no amount — no gift imported for this row.' })
    return null
  }
  if (amount <= 0) {
    issues.push({ field: 'gift_amount', level: 'block', message: `A gift of ${amountText} is not a gift.` })
    return null
  }

  const donated_on = dateText ? toISODate(dateText) : null
  if (!donated_on) {
    issues.push({ field: 'gift_date', level: 'block', message: dateText ? `Could not read the gift date "${dateText}".` : 'A gift amount with no date.' })
    return null
  }

  if (amountText && amountText !== String(amount)) {
    changes.push({ field: 'gift_amount', from: amountText, to: String(amount), rule: 'amount' })
  }
  if (dateText && dateText !== donated_on) {
    changes.push({ field: 'gift_date', from: dateText, to: donated_on, rule: 'date → ISO' })
  }

  return {
    amount,
    donated_on,
    fund: raw.gift_fund?.trim() || null,
    campaign: raw.gift_campaign?.trim() || null,
    appeal: raw.gift_appeal?.trim() || null,
    payment_method: raw.gift_payment_method?.trim() || null,
    notes: raw.gift_notes?.trim() || null,
  }
}

/** Normalise the whole file. Line numbers are 1-based, header excluded. */
export function normalisePreview(rows: string[][], mapping: ColumnMapping): NormalisedRow[] {
  return rows.map((row, index) => normaliseRow(row, mapping, index + 1))
}

/** A row with any `block` issue is never written. */
export const isBlocked = (row: NormalisedRow): boolean => row.issues.some((i) => i.level === 'block')

export function countChanges(rows: NormalisedRow[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const row of rows) for (const change of row.changes) counts[change.rule] = (counts[change.rule] ?? 0) + 1
  return counts
}
