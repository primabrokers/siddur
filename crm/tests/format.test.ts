import { describe, expect, it } from 'vitest'
import {
  formatDate,
  formatDayCount,
  formatDayHeading,
  formatMoney,
  formatNumber,
  formatRelativeDays,
  formatTime,
  initialsOf,
  toDate,
} from '../src/lib/format'

describe('formatMoney', () => {
  it('renders GBP with no pence by default', () => {
    expect(formatMoney(8400)).toBe('£8,400')
    expect(formatMoney(0)).toBe('£0')
    expect(formatMoney(20000)).toBe('£20,000')
  })

  it('renders pence when asked', () => {
    expect(formatMoney(1234.5, { pence: true })).toBe('£1,234.50')
  })

  it('rounds to whole pounds in the default mode', () => {
    expect(formatMoney(180.4)).toBe('£180')
  })

  it('handles negatives (write-offs, refunds)', () => {
    expect(formatMoney(-250)).toBe('-£250')
  })

  it('falls back for null/undefined/NaN', () => {
    expect(formatMoney(null)).toBe('—')
    expect(formatMoney(undefined)).toBe('—')
    expect(formatMoney(Number.NaN)).toBe('—')
    expect(formatMoney(null, { fallback: 'hidden' })).toBe('hidden')
  })
})

describe('formatNumber', () => {
  it('groups thousands', () => {
    expect(formatNumber(12400)).toBe('12,400')
  })

  it('falls back', () => {
    expect(formatNumber(undefined)).toBe('—')
  })
})

describe('formatDate', () => {
  it('is en-GB day-first', () => {
    expect(formatDate('2026-08-11')).toBe('11 Aug 2026')
    expect(formatDate(new Date(2026, 2, 12))).toBe('12 Mar 2026')
  })

  it('accepts ISO timestamps', () => {
    expect(formatDate('2026-08-11T14:00:00Z')).toBe('11 Aug 2026')
  })

  it('falls back on junk', () => {
    expect(formatDate('not-a-date')).toBe('—')
    expect(formatDate(null)).toBe('—')
    expect(formatDate('')).toBe('—')
  })
})

describe('formatDayHeading / formatTime', () => {
  it('renders the Today header form', () => {
    expect(formatDayHeading('2026-08-24')).toBe('Mon 24 Aug')
  })

  it('renders 24h times', () => {
    expect(formatTime(new Date(2026, 7, 24, 14, 0))).toBe('14:00')
  })
})

describe('formatRelativeDays', () => {
  const from = new Date(2026, 7, 24, 9, 0) // Mon 24 Aug 2026, 09:00

  it('names today, tomorrow and yesterday', () => {
    expect(formatRelativeDays(new Date(2026, 7, 24, 23, 30), from)).toBe('Today')
    expect(formatRelativeDays(new Date(2026, 7, 25, 1, 0), from)).toBe('Tomorrow')
    expect(formatRelativeDays(new Date(2026, 7, 23, 22, 0), from)).toBe('Yesterday')
  })

  it('uses calendar days, not 24-hour buckets', () => {
    // 20 hours later but the next calendar day → "Tomorrow", not "Today".
    expect(formatRelativeDays(new Date(2026, 7, 25, 5, 0), from)).toBe('Tomorrow')
  })

  it('counts forwards and backwards', () => {
    expect(formatRelativeDays(new Date(2026, 7, 28), from)).toBe('in 4 days')
    expect(formatRelativeDays(new Date(2026, 7, 12), from)).toBe('12 days ago')
  })

  it('falls back', () => {
    expect(formatRelativeDays(null, from)).toBe('—')
  })
})

describe('formatDayCount', () => {
  it('renders the compact chip form', () => {
    expect(formatDayCount(63)).toBe('63d')
    expect(formatDayCount(0)).toBe('0d')
    expect(formatDayCount(null)).toBe('—')
  })
})

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('Dovid Cohen')).toBe('DC')
    expect(initialsOf('Reuven Adler')).toBe('RA')
    expect(initialsOf('Goldstein Family')).toBe('GF')
  })

  it('handles single names and organisations', () => {
    expect(initialsOf('Klein')).toBe('KL')
    expect(initialsOf("R' Braun")).toBe('RB')
  })

  it('falls back on empty input', () => {
    expect(initialsOf('')).toBe('?')
    expect(initialsOf(null)).toBe('?')
  })
})

describe('toDate', () => {
  it('passes Dates through and parses strings and epochs', () => {
    const d = new Date(2026, 0, 1)
    expect(toDate(d)).toBe(d)
    expect(toDate('2026-01-01')?.getFullYear()).toBe(2026)
    expect(toDate(d.getTime())?.getFullYear()).toBe(2026)
  })

  it('returns null for empty and invalid values', () => {
    expect(toDate(null)).toBeNull()
    expect(toDate('')).toBeNull()
    expect(toDate('nope')).toBeNull()
  })
})
