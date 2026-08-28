import { describe, expect, it } from 'vitest'
import {
  HOLIDAYS,
  addBusinessDays,
  formatResolvedDate,
  isWithinCalendarTable,
  parseCalendarDate,
  resolveDateExpression,
  toCalendarDate,
} from '../src/lib/jewish-dates'

/**
 * The date resolver is the product's signature trick (09 §2) — the model
 * extracts the *phrase*, this maps it to a date, and the confirm sheet echoes
 * the mapping as a refusable chip. These tests are the contract.
 */

const on = (iso: string): Date => {
  const parsed = parseCalendarDate(iso)
  if (!parsed) throw new Error(`bad fixture date ${iso}`)
  return parsed
}

/** Local weekday name, so the "2 business days" rule is visible in failures. */
const weekday = (iso: string): string =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][on(iso).getDay()] as string

describe('the calendar table', () => {
  it('carries every key the resolver knows about, with Sukkos cycles', () => {
    for (const key of [
      'purim',
      'pesach',
      'shavuot',
      'tisha_bav',
      'rosh_hashana',
      'yom_kippur',
      'sukkot',
      'shmini_atzeret',
      'simchat_torah',
      'chanukah',
    ] as const) {
      expect(HOLIDAYS[key]?.length ?? 0).toBeGreaterThan(0)
    }
    for (const span of HOLIDAYS.sukkot) {
      // Sukkos spans run to Simchas Torah for the "after sukkos" rule.
      expect(span.end_cycle).toBeTruthy()
      expect(span.end_cycle! > span.end).toBe(true)
    }
  })

  it('knows the window it covers', () => {
    expect(isWithinCalendarTable(on('2026-08-25'))).toBe(true)
    expect(isWithinCalendarTable(on('2035-01-01'))).toBe(false)
  })
})

describe('addBusinessDays', () => {
  it('skips the weekend and never counts the starting day', () => {
    // Sunday 4 Oct 2026 → Mon 5th (1) → Tue 6th (2).
    expect(toCalendarDate(addBusinessDays(on('2026-10-04'), 2))).toBe('2026-10-06')
    // Friday 2 Oct 2026 → Mon 5th (1) → Tue 6th (2).
    expect(toCalendarDate(addBusinessDays(on('2026-10-02'), 2))).toBe('2026-10-06')
    expect(toCalendarDate(addBusinessDays(on('2026-10-05'), 1))).toBe('2026-10-06')
  })
})

describe('after ⟨chag⟩ — 2 business days after the chag ends', () => {
  const today = on('2026-08-25')

  it('resolves "after sukkos" to Tue 6 Oct 2026 (the wireframe case)', () => {
    const resolved = resolveDateExpression('after sukkos', today)
    expect(resolved).not.toBeNull()
    expect(resolved!.date).toBe('2026-10-06')
    expect(weekday(resolved!.date)).toBe('Tue')
    expect(resolved!.confident).toBe(true)
    expect(resolved!.label).toBe('after Sukkos')
    expect(formatResolvedDate(resolved!.date)).toBe('Tue 6 Oct')
  })

  it('counts from Simchas Torah, not from the last day of Sukkos itself', () => {
    // end = 2026-10-02, end_cycle = 2026-10-04. From `end` the answer would be
    // Mon 5 Oct; the house rule waits for the whole Tishrei cycle.
    expect(resolveDateExpression('after sukkos', today)!.date).toBe('2026-10-06')
  })

  it('accepts the spelling variants a UK charedi office actually types', () => {
    for (const spelling of ['after sukkot', 'after succos', 'after Sukkos', 'after succoth', 'after sukkes']) {
      expect(resolveDateExpression(spelling, today)!.date).toBe('2026-10-06')
    }
    expect(resolveDateExpression('after pesach', today)!.label).toBe('after Pesach')
    expect(resolveDateExpression('after passover', today)!.label).toBe('after Pesach')
    expect(resolveDateExpression('after shavuos', today)!.label).toBe('after Shavuos')
    expect(resolveDateExpression('after rosh hashanah', today)!.label).toBe('after Rosh Hashanah')
    expect(resolveDateExpression("after tisha b'av", today)!.label).toBe("after Tisha B'Av")
    expect(resolveDateExpression('after chanuka', today)!.label).toBe('after Chanukah')
  })

  it('reads a longer spelling before a shorter one it contains', () => {
    expect(resolveDateExpression('after simchas torah', today)!.label).toBe('after Simchas Torah')
    expect(resolveDateExpression('after shmini atzeres', today)!.label).toBe('after Shmini Atzeres')
  })

  it('still means this year when said during chol hamoed', () => {
    // 29 Sep 2026 is inside Sukkos; "after sukkos" is days away, not a year.
    expect(resolveDateExpression('after sukkos', on('2026-09-29'))!.date).toBe('2026-10-06')
  })

  it('rolls to the next occurrence once the chag has passed', () => {
    // Pesach 2026 ended 9 Apr; in June the next one is Pesach 2027 (ends 29 Apr,
    // a Thursday) → Fri 30 Apr (1) → Mon 3 May (2).
    const resolved = resolveDateExpression('after pesach', on('2026-06-01'))
    expect(resolved!.date).toBe('2027-05-03')
    expect(weekday(resolved!.date)).toBe('Mon')
  })

  it('handles a chag that spans the civil year end (Chanukah 2027/28)', () => {
    // 24 Dec 2027 → 1 Jan 2028 (a Saturday) → Mon 3rd (1) → Tue 4th (2).
    const resolved = resolveDateExpression('after chanukah', on('2027-12-01'))
    expect(resolved!.date).toBe('2028-01-04')
    expect(weekday(resolved!.date)).toBe('Tue')
    // Said mid-Chanukah it must not jump a year.
    expect(resolveDateExpression('after chanukah', on('2027-12-28'))!.date).toBe('2028-01-04')
  })

  it('reads a bare chag name as "after" it — nobody schedules a call on yom tov', () => {
    expect(resolveDateExpression('sukkos', today)!.date).toBe('2026-10-06')
  })

  it('reads "following" and "once … is over" as after', () => {
    expect(resolveDateExpression('following sukkos', today)!.date).toBe('2026-10-06')
    expect(resolveDateExpression('once sukkos is over', today)!.date).toBe('2026-10-06')
  })
})

describe('before ⟨chag⟩ — 7 days before it starts', () => {
  it('resolves "before pesach" to 7 days before Pesach 2027 starts', () => {
    // Said 1 Jun 2026, the next Pesach starts Thu 22 Apr 2027.
    const resolved = resolveDateExpression('before pesach', on('2026-06-01'))
    expect(resolved!.date).toBe('2027-04-15')
    expect(weekday(resolved!.date)).toBe('Thu')
    expect(resolved!.confident).toBe(true)
    expect(resolved!.label).toBe('before Pesach')
  })

  it('uses this year when Pesach is still ahead', () => {
    // Pesach 2026 starts 2 Apr; on 1 Feb 2026 "before pesach" is 26 Mar 2026.
    expect(resolveDateExpression('before pesach', on('2026-02-01'))!.date).toBe('2026-03-26')
  })

  it('pulls to tomorrow (and drops confidence) inside the last week', () => {
    // 30 Mar 2026 — Pesach starts in three days, so "minus 7" is in the past.
    const resolved = resolveDateExpression('before pesach', on('2026-03-30'))
    expect(resolved!.date).toBe('2026-03-31')
    expect(resolved!.confident).toBe(false)
  })

  it('reads "in time for" and "ahead of" the same way', () => {
    expect(resolveDateExpression('in time for purim', on('2026-01-05'))!.date).toBe('2026-02-24')
    expect(resolveDateExpression('ahead of purim', on('2026-01-05'))!.label).toBe('before Purim')
  })

  it('resolves "erev pesach" to the day before it starts', () => {
    const resolved = resolveDateExpression('erev pesach', on('2026-02-01'))
    expect(resolved!.date).toBe('2026-04-01')
    expect(resolved!.label).toBe('erev Pesach')
  })
})

describe('around ⟨chag⟩ — the span start, flagged as fuzzy', () => {
  it('resolves "around chanukah" to first candle and marks it unconfident', () => {
    const resolved = resolveDateExpression('around chanukah', on('2026-08-25'))
    expect(resolved!.date).toBe('2026-12-04')
    expect(resolved!.confident).toBe(false)
    expect(resolved!.label).toBe('around Chanukah')
  })

  it('treats "sometime around purim" the same', () => {
    expect(resolveDateExpression('sometime around purim', on('2026-08-25'))!.confident).toBe(false)
  })
})

describe('after the chagim — the Tishrei cycle, or the next chag', () => {
  it('means after Simchas Torah when we are in the run-up', () => {
    const resolved = resolveDateExpression('after the chagim', on('2026-08-25'))
    expect(resolved!.date).toBe('2026-10-06')
    expect(resolved!.label).toBe('after the chagim')
  })

  it('accepts "after the holidays" and "after yomim tovim"', () => {
    expect(resolveDateExpression('after the holidays', on('2026-08-25'))!.date).toBe('2026-10-06')
    expect(resolveDateExpression('after yomim tovim', on('2026-08-25'))!.date).toBe('2026-10-06')
  })

  it('falls back to the next chag when the cycle is a year away', () => {
    // 20 Nov 2026: the next Tishrei cycle is 11 months off, so "after the
    // chagim" means after Chanukah 2026 (ends Sat 12 Dec) → Tue 15 Dec.
    const resolved = resolveDateExpression('after the chagim', on('2026-11-20'))
    expect(resolved!.date).toBe('2026-12-15')
    expect(resolved!.label).toBe('after Chanukah')
  })

  it('resolves "before the chagim" to a week before Rosh Hashanah', () => {
    const resolved = resolveDateExpression('before the chagim', on('2026-06-01'))
    expect(resolved!.date).toBe('2026-09-05')
  })
})

describe('bare "yom tov" — the next multi-day one', () => {
  it('resolves "after yom tov" in late August to after the Tishrei cycle', () => {
    // The next multi-day yom tov from 25 Aug 2026 is Rosh Hashanah (12–13 Sep,
    // ends Sunday) → Mon 14th (1) → Tue 15th (2).
    const resolved = resolveDateExpression('after yom tov', on('2026-08-25'))
    expect(resolved!.date).toBe('2026-09-15')
    expect(resolved!.label).toBe('after Rosh Hashanah')
  })

  it('resolves "after yom tov" in March to after Pesach', () => {
    const resolved = resolveDateExpression('after yontif', on('2026-03-10'))
    expect(resolved!.label).toBe('after Pesach')
    expect(resolved!.date).toBe('2026-04-13')
  })

  it('never picks a single-day fast or Purim for a bare "yom tov"', () => {
    expect(resolveDateExpression('after yom tov', on('2026-07-01'))!.label).toBe('after Rosh Hashanah')
  })
})

describe('relative English', () => {
  const today = on('2026-08-25') // a Tuesday

  it('resolves "in three months"', () => {
    const resolved = resolveDateExpression('in three months', today)
    expect(resolved!.date).toBe('2026-11-25')
    expect(resolved!.label).toBe('in 3 months')
    expect(resolved!.confident).toBe(true)
  })

  it('resolves digits and words alike', () => {
    expect(resolveDateExpression('in 10 days', today)!.date).toBe('2026-09-04')
    expect(resolveDateExpression('in two weeks', today)!.date).toBe('2026-09-08')
    expect(resolveDateExpression('in a couple of weeks', today)!.date).toBe('2026-09-08')
    expect(resolveDateExpression('in a month', today)!.date).toBe('2026-09-25')
    expect(resolveDateExpression('in 6 months time', today)!.date).toBe('2027-02-25')
  })

  it('resolves "next tuesday" to the following Tuesday, not today', () => {
    const resolved = resolveDateExpression('next tuesday', today)
    expect(resolved!.date).toBe('2026-09-01')
    expect(weekday(resolved!.date)).toBe('Tue')
    expect(resolved!.label).toBe('next Tuesday')
  })

  it('resolves the other weekdays and their abbreviations', () => {
    expect(resolveDateExpression('next monday', today)!.date).toBe('2026-08-31')
    expect(resolveDateExpression('on thursday', today)!.date).toBe('2026-08-27')
    expect(resolveDateExpression('weds', today)!.date).toBe('2026-08-26')
  })

  it('resolves tomorrow / next week / next month', () => {
    expect(resolveDateExpression('tomorrow', today)!.date).toBe('2026-08-26')
    expect(resolveDateExpression('next week', today)!.date).toBe('2026-09-01')
    expect(resolveDateExpression('next month', today)!.date).toBe('2026-09-25')
    expect(resolveDateExpression('end of the month', today)!.date).toBe('2026-08-31')
  })

  it('accepts a literal ISO date without interpreting it', () => {
    expect(resolveDateExpression('2026-10-06', today)!.date).toBe('2026-10-06')
  })
})

describe('refusing to guess', () => {
  const today = on('2026-08-25')

  it('returns null for expressions with no calendar meaning', () => {
    for (const phrase of [
      'before the dinner',
      'when he gets back from antwerp',
      'after the board meeting',
      'soon',
      '',
      '   ',
      'sometime',
    ]) {
      expect(resolveDateExpression(phrase, today)).toBeNull()
    }
  })

  it('returns null rather than throwing on non-string input', () => {
    expect(resolveDateExpression(undefined as unknown as string, today)).toBeNull()
    expect(resolveDateExpression(null as unknown as string, today)).toBeNull()
  })

  it('returns null when the chag is outside the ±3-year table', () => {
    expect(resolveDateExpression('after sukkos', on('2032-01-01'))).toBeNull()
  })
})
