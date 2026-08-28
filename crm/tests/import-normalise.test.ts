/**
 * Normalisation preview (06 §5, step 3).
 *
 * Two things are being asserted throughout: that the rewrite is *right*, and
 * that it is *reported*. A correct-but-silent import is the failure mode this
 * screen exists to prevent, so every case that changes a value also checks the
 * change appears in `row.changes`.
 *
 * The phone rules themselves live in `features/contacts/normalise.ts` and are
 * covered by `contacts-normalise.test.ts`; what is tested here is that the
 * import uses the same door (02 §6).
 */

import { describe, expect, it } from 'vitest'
import { parseCsv } from '../src/features/import/csv'
import {
  countChanges,
  isBlocked,
  normalisePreview,
  normaliseRow,
  normaliseTitle,
  parseAmount,
  titleCase,
  toISODate,
} from '../src/features/import/normalisePreview'
import type { ColumnMapping } from '../src/features/import/types'

describe('toISODate', () => {
  it('reads UK day-first dates', () => {
    expect(toISODate('03/04/2024')).toBe('2024-04-03')
    expect(toISODate('3-4-2024')).toBe('2024-04-03')
    expect(toISODate('31/12/1999')).toBe('1999-12-31')
  })

  it('takes an ISO date as written', () => {
    expect(toISODate('2024-04-03')).toBe('2024-04-03')
  })

  it('reads named months', () => {
    expect(toISODate('3 April 2024')).toBe('2024-04-03')
    expect(toISODate('15 Sep 2023')).toBe('2023-09-15')
  })

  it('falls back to month-first only when day-first is impossible', () => {
    // 13 is not a month, so this can only be 13 April in US order.
    expect(toISODate('04/13/2024')).toBe('2024-04-13')
  })

  it('pivots two-digit years at 70', () => {
    expect(toISODate('01/01/99')).toBe('1999-01-01')
    expect(toISODate('01/01/24')).toBe('2024-01-01')
  })

  it('returns null for nonsense rather than inventing a date', () => {
    expect(toISODate('')).toBeNull()
    expect(toISODate('sometime last year')).toBeNull()
    expect(toISODate('31/02/2024')).toBeNull()
  })
})

describe('titleCase and titles', () => {
  it('fixes shouting and lowercase', () => {
    expect(titleCase('DOVID')).toBe('Dovid')
    expect(titleCase('cohen')).toBe('Cohen')
    expect(titleCase("o'brien")).toBe("O'Brien")
    expect(titleCase('mcdonald')).toBe('McDonald')
  })

  it('leaves deliberate mixed case alone', () => {
    expect(titleCase('deVries')).toBe('deVries')
    expect(titleCase('McCarthy')).toBe('McCarthy')
  })

  it('canonicalises the honorifics the yeshiva actually uses', () => {
    expect(normaliseTitle('rabbi')).toBe('Rabbi')
    expect(normaliseTitle('R.')).toBe("R'")
    expect(normaliseTitle('MR')).toBe('Mr')
    expect(normaliseTitle('Mr & Mrs')).toBe('Mr & Mrs')
    expect(normaliseTitle('')).toBe('')
  })
})

describe('parseAmount', () => {
  it('strips currency and separators', () => {
    expect(parseAmount('£1,250.50')).toBe(1250.5)
    expect(parseAmount(' 500 ')).toBe(500)
  })

  it('returns null for empty and non-numbers', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('cheque')).toBeNull()
  })
})

const MAPPING: ColumnMapping = [
  'title', 'first_name', 'last_name', 'email', 'phone', 'city', 'birthday',
]

describe('normaliseRow', () => {
  it('rewrites and reports every change', () => {
    const row = normaliseRow(
      ['rabbi', 'DOVID', 'cohen', ' Dovid@Example.COM ', '07700 900123', 'golders green', '03/04/1975'],
      MAPPING,
      1,
    )

    expect(row.contact).toMatchObject({
      title: 'Rabbi',
      first_name: 'Dovid',
      last_name: 'Cohen',
      email: 'dovid@example.com',
      phone: '+447700900123',
      city: 'Golders Green',
      birthday: '1975-04-03',
    })

    const rules = row.changes.map((c) => c.rule)
    expect(rules).toContain('phone → E.164')
    expect(rules).toContain('date → ISO')
    expect(rules).toContain('lowercased')
    expect(rules).toContain('title case')
    expect(row.changes.find((c) => c.field === 'phone')).toMatchObject({
      from: '07700 900123',
      to: '+447700900123',
    })
  })

  it('reports no change when the value was already right', () => {
    const row = normaliseRow(['', 'Dovid', 'Cohen', '', '', '', ''], MAPPING, 1)
    expect(row.changes).toEqual([])
    expect(row.issues).toEqual([])
  })

  it('blocks a row with no name and no organisation', () => {
    const row = normaliseRow(['', '', '', 'x@y.com', '', '', ''], MAPPING, 4)
    expect(isBlocked(row)).toBe(true)
    expect(row.issues[0]).toMatchObject({ field: 'row', level: 'block' })
  })

  it('warns but keeps the row when a date cannot be read', () => {
    const row = normaliseRow(['', 'Dovid', 'Cohen', '', '', '', 'last spring'], MAPPING, 2)
    expect(isBlocked(row)).toBe(false)
    expect(row.contact.birthday).toBeUndefined()
    expect(row.issues[0]).toMatchObject({ field: 'birthday', level: 'warn' })
  })

  it('uppercases and single-spaces a postcode', () => {
    const row = normaliseRow(['nw11  8aa'], ['postcode'], 1)
    expect(row.contact.postcode).toBe('NW11 8AA')
  })
})

describe('gift columns', () => {
  const giftMapping: ColumnMapping = ['first_name', 'last_name', 'gift_amount', 'gift_date', 'gift_fund']

  it('builds a gift from an amount and a date', () => {
    const row = normaliseRow(['Dovid', 'Cohen', '£1,000', '15/03/2024', 'Building'], giftMapping, 1)
    expect(row.gift).toEqual({
      amount: 1000,
      donated_on: '2024-03-15',
      fund: 'Building',
      campaign: null,
      appeal: null,
      payment_method: null,
      notes: null,
    })
  })

  it('carries no gift when the sheet has none for that row', () => {
    const row = normaliseRow(['Dovid', 'Cohen', '', '', ''], giftMapping, 1)
    expect(row.gift).toBeNull()
    expect(row.issues).toEqual([])
  })

  it('blocks a row whose amount is not a number', () => {
    const row = normaliseRow(['Dovid', 'Cohen', 'cheque', '15/03/2024', ''], giftMapping, 1)
    expect(isBlocked(row)).toBe(true)
    expect(row.gift).toBeNull()
  })

  it('blocks a gift with an unreadable date rather than dating it today', () => {
    const row = normaliseRow(['Dovid', 'Cohen', '500', 'whenever', ''], giftMapping, 1)
    expect(isBlocked(row)).toBe(true)
  })

  it('refuses a zero or negative gift', () => {
    expect(isBlocked(normaliseRow(['A', 'B', '0', '15/03/2024', ''], giftMapping, 1))).toBe(true)
    expect(isBlocked(normaliseRow(['A', 'B', '-10', '15/03/2024', ''], giftMapping, 1))).toBe(true)
  })

  it('warns rather than blocks when a date has no amount beside it', () => {
    const row = normaliseRow(['Dovid', 'Cohen', '', '15/03/2024', ''], giftMapping, 1)
    expect(isBlocked(row)).toBe(false)
    expect(row.gift).toBeNull()
    expect(row.issues[0].level).toBe('warn')
  })
})

describe('normalisePreview over a parsed file', () => {
  const csv = [
    'First Name,Surname,Mobile,Date Given,Amount',
    'DOVID,cohen,07700 900123,03/04/2024,£500',
    'rivky,COHEN,,,',
    ',,,,',
  ].join('\n')

  it('numbers rows the way a human counts them', () => {
    const parsed = parseCsv(csv, 'book.csv')
    // The all-blank line is dropped by the parser, not counted as a row.
    expect(parsed.rows).toHaveLength(2)

    const rows = normalisePreview(parsed.rows, [
      'first_name', 'last_name', 'phone', 'gift_date', 'gift_amount',
    ])
    expect(rows.map((r) => r.line)).toEqual([1, 2])
    expect(rows[0].displayName).toBe('Dovid Cohen')
    expect(rows[0].gift?.amount).toBe(500)
    expect(rows[1].gift).toBeNull()
  })

  it('counts the rewrites by rule for the summary strip', () => {
    const parsed = parseCsv(csv, 'book.csv')
    const rows = normalisePreview(parsed.rows, [
      'first_name', 'last_name', 'phone', 'gift_date', 'gift_amount',
    ])
    const counts = countChanges(rows)
    expect(counts['title case']).toBe(4)
    expect(counts['phone → E.164']).toBe(1)
  })
})

describe('parseCsv', () => {
  it('pads short rows so later columns do not shift', () => {
    const parsed = parseCsv('A,B,C\n1,2', 'x.csv')
    expect(parsed.rows[0]).toEqual(['1', '2', ''])
  })

  it('de-duplicates repeated header names', () => {
    const parsed = parseCsv('Notes,Notes\n1,2', 'x.csv')
    expect(parsed.headers).toEqual(['Notes', 'Notes (2)'])
  })

  it('names an empty header cell after its position', () => {
    const parsed = parseCsv('First Name,,Surname\na,b,c', 'x.csv')
    expect(parsed.headers[1]).toBe('Column 2')
  })

  it('reports a file with nothing in it', () => {
    expect(parseCsv('', 'x.csv').problems[0]).toMatch(/no rows/)
  })
})
