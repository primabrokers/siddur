/**
 * The deterministic date resolver — Quick Capture's signature trick (09 §2).
 *
 * The model never does date arithmetic. It extracts the *expression* it heard
 * ("after sukkos", "in three months", "next tuesday") and this module maps it
 * to a real date, which the confirm sheet then echoes as a refusable chip
 * ("after sukkos → Tue 6 Oct").
 *
 * Two sources of truth:
 *   - `holidays.json` — a Hebcal-derived span table for ±3 years (10 §6).
 *     Each entry is `{start, end}` in local calendar dates; the Sukkos entries
 *     also carry `end_cycle`, the end of the whole Tishrei run (Simchas Torah).
 *   - date-fns, for the plain-English relative expressions.
 *
 * House rules (09 §2):
 *   - "after ⟨chag⟩"    → 2 **business** days (Mon–Fri) after the span end;
 *                          for Sukkos that is `end_cycle`, i.e. after Simchas
 *                          Torah, because nobody is working during chol
 *                          hamoed either.
 *   - "before ⟨chag⟩"   → 7 days before the span start.
 *   - "around ⟨chag⟩"   → the span start, flagged `confident: false`.
 *   - "after the chagim" → after the Tishrei cycle when we are in its run-up,
 *                          otherwise after whichever chag comes next.
 *   - bare "after yom tov" → after the next multi-day yom tov.
 *
 * Anything it cannot read returns `null`. Guessing a date is worse than
 * handing the user an empty date box with the phrase as a hint.
 */

import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  format,
  isValid,
  nextDay,
  type Day,
} from 'date-fns'
import table from './holidays.json'

/* ------------------------------------------------------------------ types */

export interface HolidaySpan {
  /** First day of the chag, `yyyy-MM-dd`. */
  start: string
  /** Last day of the chag itself. */
  end: string
  /** Sukkos only: the end of the whole Tishrei cycle (Simchas Torah). */
  end_cycle?: string
}

export type HolidayKey =
  | 'purim'
  | 'pesach'
  | 'shavuot'
  | 'tisha_bav'
  | 'rosh_hashana'
  | 'yom_kippur'
  | 'sukkot'
  | 'shmini_atzeret'
  | 'simchat_torah'
  | 'chanukah'

export interface ResolvedDate {
  /** `yyyy-MM-dd` — what goes into `tasks.due_on`. */
  date: string
  /** False when the rule is inherently fuzzy ("around Chanukah"). */
  confident: boolean
  /** Tidy human phrase for the chip and the saved pane ("after Sukkos"). */
  label: string
}

export const HOLIDAYS = table as Record<HolidayKey, HolidaySpan[]>

/** Display names in the Anglo-charedi register the wireframes use. */
export const HOLIDAY_LABEL: Record<HolidayKey, string> = {
  purim: 'Purim',
  pesach: 'Pesach',
  shavuot: 'Shavuos',
  tisha_bav: "Tisha B'Av",
  rosh_hashana: 'Rosh Hashanah',
  yom_kippur: 'Yom Kippur',
  sukkot: 'Sukkos',
  shmini_atzeret: 'Shmini Atzeres',
  simchat_torah: 'Simchas Torah',
  chanukah: 'Chanukah',
}

/**
 * Spelling variants, longest first so "shmini atzeret" is not eaten by a
 * shorter alternative. Yinglish, Ashkenazi and Sephardi spellings all land on
 * the same key — this is a UK charedi address book (09 §2 multilingual).
 */
const SPELLINGS: Array<[HolidayKey, string[]]> = [
  ['rosh_hashana', ['rosh hashanah', 'rosh hashana', 'rosh hashono', 'rosh hashonoh', 'roshashana', 'rosh ha shana']],
  ['yom_kippur', ['yom kippur', 'yom kipur', 'yom hakippurim', 'yonkippur', 'yom kippurim']],
  ['shmini_atzeret', ['shmini atzeret', 'shmini atzeres', 'shemini atzeret', 'shemini atzeres']],
  ['simchat_torah', ['simchat torah', 'simchas torah', 'simchath torah', 'simchas toire']],
  ['tisha_bav', ["tisha b'av", 'tisha bav', "tishah b'av", 'tisha beav', 'tisha bov', 'tishe bov', 'the 9th of av', 'ninth of av']],
  ['sukkot', ['sukkot', 'sukkos', 'succos', 'succot', 'sukkoth', 'sukkes', 'succoth', 'tabernacles']],
  ['pesach', ['pesach', 'pesah', 'peisach', 'peysach', 'passover', 'pesech']],
  ['shavuot', ['shavuot', 'shavuos', 'shevuos', 'shevuot', 'shavuoth', 'shvues', 'pentecost']],
  ['chanukah', ['chanukah', 'chanukkah', 'chanuka', 'hanukkah', 'hanukah', 'hanuka', 'chanukas', 'chanuke']],
  ['purim', ['purim', 'purem']],
]

/** "after the chagim" and its cousins. */
const CHAGIM_PHRASES = [
  'the chagim',
  'chagim',
  'the yomim tovim',
  'yomim tovim',
  'yamim tovim',
  'yom tovim',
  'the holidays',
  'the yom tovim',
  'the festivals',
  'the yontifs',
  'yontiffim',
]

/** Bare "yom tov" — no named chag, so: the next multi-day one. */
const YOM_TOV_PHRASES = ['yom tov', 'yomtov', 'yontif', 'yontiff', 'yom-tov']

/** What "the next chag" may be. Tisha B'Av is a fast, never a chag. */
const CHAG_KEYS: HolidayKey[] = ['purim', 'pesach', 'shavuot', 'rosh_hashana', 'yom_kippur', 'sukkot', 'chanukah']

/** Multi-day yomim tovim, for bare "after yom tov". */
const MULTI_DAY_YOM_TOV: HolidayKey[] = ['pesach', 'shavuot', 'rosh_hashana', 'sukkot']

/**
 * How far ahead of Rosh Hashanah "after the chagim" still means *this*
 * Tishrei cycle. Said in June it means something else entirely, and the spec
 * then falls back to the next chag.
 */
const CHAGIM_WINDOW_DAYS = 90

/* -------------------------------------------------------------- date utils */

/** Parse `yyyy-MM-dd` as a *local* midnight — never UTC, or dates shift a day. */
export function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const [, y, m, d] = match
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  return isValid(date) ? date : null
}

/** `yyyy-MM-dd` in local time. */
export function toCalendarDate(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

const startOfLocalDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate())

const isBusinessDay = (date: Date): boolean => {
  const day = date.getDay()
  return day >= 1 && day <= 5
}

/**
 * `n` business days after `from` (the day itself never counts). Mon–Fri per
 * 09 §2 — the resolver is a scheduling aid, not a halachic calendar.
 */
export function addBusinessDays(from: Date, n: number): Date {
  let cursor = startOfLocalDay(from)
  let left = n
  while (left > 0) {
    cursor = addDays(cursor, 1)
    if (isBusinessDay(cursor)) left -= 1
  }
  return cursor
}

/* ------------------------------------------------------------ span lookups */

interface Occurrence {
  key: HolidayKey
  span: HolidaySpan
  start: Date
  /** `end_cycle` when present (Sukkos), else `end`. */
  end: Date
}

function occurrences(key: HolidayKey): Occurrence[] {
  const spans = HOLIDAYS[key] ?? []
  const out: Occurrence[] = []
  for (const span of spans) {
    const start = parseCalendarDate(span.start)
    const end = parseCalendarDate(span.end_cycle ?? span.end)
    if (start && end) out.push({ key, span, start, end })
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime())
}

/**
 * The occurrence a user means when they say the name today: the first whose
 * *end* has not yet passed, so "after sukkos" said on chol hamoed still means
 * this year (09 §2 — always the next future occurrence).
 */
function nextOccurrence(key: HolidayKey, today: Date): Occurrence | null {
  const day = startOfLocalDay(today)
  return occurrences(key).find((o) => o.end.getTime() >= day.getTime()) ?? null
}

/** The next occurrence that has not *started* — for "before ⟨chag⟩". */
function nextUnstartedOccurrence(key: HolidayKey, today: Date): Occurrence | null {
  const day = startOfLocalDay(today)
  return occurrences(key).find((o) => o.start.getTime() > day.getTime()) ?? null
}

/** The next chag of any kind, by start date. */
function nextChag(today: Date, keys: HolidayKey[] = CHAG_KEYS): Occurrence | null {
  const day = startOfLocalDay(today)
  const all = keys.flatMap((key) => occurrences(key)).filter((o) => o.end.getTime() >= day.getTime())
  all.sort((a, b) => a.start.getTime() - b.start.getTime())
  return all[0] ?? null
}

/* --------------------------------------------------------------- matching */

interface HolidayHit {
  key: HolidayKey
  /** Where the spelling started in the normalised string. */
  index: number
}

function normalise(input: string): string {
  return input
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function findHoliday(text: string): HolidayHit | null {
  let best: HolidayHit | null = null
  let bestLength = 0
  for (const [key, spellings] of SPELLINGS) {
    for (const spelling of spellings) {
      const index = text.indexOf(spelling)
      if (index === -1) continue
      if (spelling.length > bestLength) {
        best = { key, index }
        bestLength = spelling.length
      }
    }
  }
  return best
}

function findPhrase(text: string, phrases: string[]): number {
  let best = -1
  let bestLength = 0
  for (const phrase of phrases) {
    const index = text.indexOf(phrase)
    if (index !== -1 && phrase.length > bestLength) {
      best = index
      bestLength = phrase.length
    }
  }
  return best
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  couple: 2,
  few: 3,
  fortnight: 2,
}

function toCount(word: string): number | null {
  const digits = Number.parseInt(word, 10)
  if (Number.isFinite(digits) && String(digits) === word.replace(/^0+(?=\d)/, '')) return digits
  const named = NUMBER_WORDS[word]
  return named ?? null
}

const WEEKDAYS: Array<[string, Day]> = [
  ['sunday', 0],
  ['monday', 1],
  ['tuesday', 2],
  ['wednesday', 3],
  ['thursday', 4],
  ['friday', 5],
  ['saturday', 6],
  ['sun', 0],
  ['mon', 1],
  ['tues', 2],
  ['tue', 2],
  ['weds', 3],
  ['wed', 3],
  ['thurs', 4],
  ['thur', 4],
  ['thu', 4],
  ['fri', 5],
  ['sat', 6],
]

const WEEKDAY_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/* --------------------------------------------------------------- the rules */

const result = (date: Date, label: string, confident = true): ResolvedDate => ({
  date: toCalendarDate(date),
  confident,
  label,
})

/** "after ⟨chag⟩" — 2 business days after the span end / the Tishrei cycle. */
function afterChag(occurrence: Occurrence, prefix = 'after'): ResolvedDate {
  return result(addBusinessDays(occurrence.end, 2), `${prefix} ${HOLIDAY_LABEL[occurrence.key]}`)
}

/**
 * "after the chagim" — the Tishrei cycle when we are inside its run-up
 * (Elul onwards), otherwise whichever chag comes next (09 §2).
 */
function afterTheChagim(today: Date): ResolvedDate | null {
  const day = startOfLocalDay(today)
  const sukkos = nextOccurrence('sukkot', day)

  if (sukkos) {
    // The Rosh Hashanah of the *same* Tishrei cycle — the run-up starts there.
    const rosh = occurrences('rosh_hashana')
      .filter((o) => o.start.getTime() <= sukkos.start.getTime())
      .pop()
    const windowOpens = addDays(rosh ? rosh.start : sukkos.start, -CHAGIM_WINDOW_DAYS)
    if (day.getTime() >= windowOpens.getTime()) {
      return result(addBusinessDays(sukkos.end, 2), 'after the chagim')
    }
  }

  const next = nextChag(day)
  return next ? result(addBusinessDays(next.end, 2), `after ${HOLIDAY_LABEL[next.key]}`) : null
}

function relativeExpression(text: string, today: Date): ResolvedDate | null {
  const day = startOfLocalDay(today)

  if (/\b(today|tonight|this evening|later today)\b/.test(text)) return result(day, 'today')
  if (/\btomorrow\b/.test(text)) return result(addDays(day, 1), 'tomorrow')
  if (/\b(day after tomorrow)\b/.test(text)) return result(addDays(day, 2), 'in 2 days')

  // "in three months", "in 10 days", "in a couple of weeks", "in a fortnight"
  const UNITS = '(day|days|week|weeks|month|months|year|years|fortnight)'
  const span =
    // quantified: "in a couple of weeks", "in a few days"
    new RegExp(`\\bin (?:about |around |roughly )?(?:a |an |the )?(\\w+) of ${UNITS}\\b`).exec(text) ??
    // plain: "in three months", "in 10 days", "in a month"
    new RegExp(`\\bin (?:about |around |roughly )?(?:the )?(\\w+) ${UNITS}\\b`).exec(text)
  if (span) {
    const [, amountWord, unit] = span
    const amount = toCount(amountWord as string)
    if (amount !== null) {
      if (unit?.startsWith('day')) return result(addDays(day, amount), `in ${amount} day${amount === 1 ? '' : 's'}`)
      if (unit?.startsWith('week')) return result(addWeeks(day, amount), `in ${amount} week${amount === 1 ? '' : 's'}`)
      if (unit?.startsWith('month'))
        return result(addMonths(day, amount), `in ${amount} month${amount === 1 ? '' : 's'}`)
      if (unit?.startsWith('year')) return result(addYears(day, amount), `in ${amount} year${amount === 1 ? '' : 's'}`)
      if (unit === 'fortnight') return result(addWeeks(day, 2), 'in 2 weeks')
    }
  }
  if (/\bin a fortnight\b/.test(text)) return result(addWeeks(day, 2), 'in 2 weeks')

  // "next week" / "next month" / "next year"
  if (/\bnext week\b/.test(text)) return result(addWeeks(day, 1), 'next week')
  if (/\bnext month\b/.test(text)) return result(addMonths(day, 1), 'next month')
  if (/\bnext year\b/.test(text)) return result(addYears(day, 1), 'next year')
  if (/\b(this week|end of the week|end of this week)\b/.test(text)) {
    // Friday of the current week; "this week" said on a Friday means today.
    const toFriday = (5 - day.getDay() + 7) % 7
    return result(addDays(day, toFriday), 'this week')
  }
  if (/\b(end of the month|end of this month)\b/.test(text)) {
    const endOfMonth = new Date(day.getFullYear(), day.getMonth() + 1, 0)
    return result(endOfMonth, 'end of the month')
  }

  // "next tuesday", "on tuesday", bare "tuesday"
  for (const [name, index] of WEEKDAYS) {
    if (!new RegExp(`\\b${name}\\b`).test(text)) continue
    return result(nextDay(day, index), `next ${WEEKDAY_LABEL[index]}`)
  }

  return null
}

/* ------------------------------------------------------------------ public */

/**
 * Resolve one date expression against `today`.
 *
 * Returns `null` when the phrase is not one we can map ("before the dinner",
 * "when he gets back") — the caller then shows an empty date input with the
 * expression as helper text rather than inventing a due date (09 §2).
 */
export function resolveDateExpression(expr: string, today: Date): ResolvedDate | null {
  if (typeof expr !== 'string') return null
  const text = normalise(expr)
  if (text === '') return null
  const day = startOfLocalDay(today)

  // An explicit ISO date needs no interpretation at all.
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(expr)
  if (iso) {
    const parsed = parseCalendarDate(iso[1] as string)
    if (parsed) return result(parsed, format(parsed, 'd MMM yyyy'))
  }

  const erev = /\berev\b/.test(text)
  const before = /\b(before|by|ahead of|in time for|prior to)\b/.test(text)
  const around = /\b(around|about|near|sometime|some time|roughly)\b/.test(text)

  const chagimIndex = findPhrase(text, CHAGIM_PHRASES)
  const holiday = findHoliday(text)

  // "after the chagim" — only when no specific chag was named nearer to it.
  if (chagimIndex !== -1 && (!holiday || holiday.index !== chagimIndex)) {
    if (before) {
      const rosh = nextUnstartedOccurrence('rosh_hashana', day)
      if (rosh) {
        const target = addDays(rosh.start, -7)
        return target.getTime() > day.getTime()
          ? result(target, 'before the chagim')
          : result(addDays(day, 1), 'before the chagim', false)
      }
    }
    const resolved = afterTheChagim(day)
    if (resolved) return resolved
  }

  if (holiday) {
    // "erev pesach" is the day before it starts — a real, common instruction.
    if (erev) {
      const occurrence = nextUnstartedOccurrence(holiday.key, day)
      if (occurrence) return result(addDays(occurrence.start, -1), `erev ${HOLIDAY_LABEL[holiday.key]}`)
      return null
    }
    if (around) {
      const occurrence = nextOccurrence(holiday.key, day)
      if (occurrence) {
        return result(occurrence.start, `around ${HOLIDAY_LABEL[holiday.key]}`, false)
      }
    }
    if (before) {
      const occurrence = nextUnstartedOccurrence(holiday.key, day)
      if (occurrence) {
        const target = addDays(occurrence.start, -7)
        const label = `before ${HOLIDAY_LABEL[holiday.key]}`
        // Already inside the last week: a due date in the past helps nobody,
        // so pull it to tomorrow and drop the confidence flag.
        return target.getTime() > day.getTime() ? result(target, label) : result(addDays(day, 1), label, false)
      }
      return null
    }
    // "after sukkos" — and a bare "sukkos" is read the same way, because a
    // follow-up note never means "call him on the first day of yom tov".
    const occurrence = nextOccurrence(holiday.key, day)
    if (occurrence) return afterChag(occurrence)
    return null
  }

  // Bare "after yom tov" — the next *multi-day* yom tov.
  if (findPhrase(text, YOM_TOV_PHRASES) !== -1) {
    const occurrence = nextChag(day, MULTI_DAY_YOM_TOV)
    if (occurrence) {
      if (before) {
        const target = addDays(occurrence.start, -7)
        return target.getTime() > day.getTime()
          ? result(target, `before ${HOLIDAY_LABEL[occurrence.key]}`)
          : result(addDays(day, 1), `before ${HOLIDAY_LABEL[occurrence.key]}`, false)
      }
      if (around) return result(occurrence.start, `around ${HOLIDAY_LABEL[occurrence.key]}`, false)
      return afterChag(occurrence)
    }
    return null
  }

  const relative = relativeExpression(text, day)
  if (relative) return relative

  // Unparseable. Never guess (09 §2).
  return null
}

/** `Tue 6 Oct` — the chip's rendering of a resolution. */
export function formatResolvedDate(value: string | Date): string {
  const date = typeof value === 'string' ? parseCalendarDate(value) : value
  return date ? format(date, 'EEE d MMM') : ''
}

/** True when we hold spans covering `date`; the table is a ±3-year window. */
export function isWithinCalendarTable(date: Date): boolean {
  const all = (Object.keys(HOLIDAYS) as HolidayKey[]).flatMap((key) => occurrences(key))
  if (all.length === 0) return false
  const first = all.reduce((a, b) => (a.start < b.start ? a : b)).start
  const last = all.reduce((a, b) => (a.end > b.end ? a : b)).end
  return date.getTime() >= first.getTime() && date.getTime() <= last.getTime()
}
