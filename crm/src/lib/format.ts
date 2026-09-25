import { differenceInCalendarDays, format, isValid, parseISO } from 'date-fns'

export type DateInput = Date | string | number | null | undefined

/** Coerce anything the API hands us (ISO string, epoch, Date) into a Date. */
export function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return isValid(value) ? value : null
  if (typeof value === 'number') {
    const d = new Date(value)
    return isValid(d) ? d : null
  }
  const parsed = parseISO(value)
  if (isValid(parsed)) return parsed
  const fallback = new Date(value)
  return isValid(fallback) ? fallback : null
}

const gbp = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const gbpPence = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export interface MoneyOptions {
  /** Show pence. Default: false (the wireframes show whole pounds). */
  pence?: boolean
  /** Rendered when the amount is null/undefined/NaN. Default `'—'`. */
  fallback?: string
}

/**
 * Money always renders in gold with `tabular-nums` (CLAUDE.md); this returns
 * the string — the `<Money>`/`money` class supplies the colour.
 */
export function formatMoney(amount: number | null | undefined, options: MoneyOptions = {}): string {
  const { pence = false, fallback = '—' } = options
  if (amount === null || amount === undefined || Number.isNaN(amount)) return fallback
  return pence ? gbpPence.format(amount) : gbp.format(amount)
}

/** `12,400` — a bare count with the same tabular treatment. */
export function formatNumber(value: number | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback
  return new Intl.NumberFormat('en-GB').format(value)
}

/** `11 Aug 2026` (en-GB, day first, no leading zero noise). */
export function formatDate(value: DateInput, fallback = '—'): string {
  const date = toDate(value)
  if (!date) return fallback
  return format(date, 'd MMM yyyy')
}

/** `Mon 24 Aug` — the Today header line in MobileToday.dc.html. */
export function formatDayHeading(value: DateInput, fallback = '—'): string {
  const date = toDate(value)
  if (!date) return fallback
  return format(date, 'EEE d MMM')
}

/** `14:00` — 24h, as the meeting rows render. */
export function formatTime(value: DateInput, fallback = '—'): string {
  const date = toDate(value)
  if (!date) return fallback
  return format(date, 'HH:mm')
}

/**
 * Calendar-day relative wording used in stream rows and chips:
 * `Today` · `Tomorrow` · `Yesterday` · `in 4 days` · `4 days ago`.
 * Calendar days, not 24h buckets — "due today" must mean today's date.
 */
export function formatRelativeDays(value: DateInput, from: Date = new Date(), fallback = '—'): string {
  const date = toDate(value)
  if (!date) return fallback
  const diff = differenceInCalendarDays(date, from)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff > 0) return `in ${diff} days`
  return `${Math.abs(diff)} days ago`
}

/** `63d` — the compact "days since contact" chip form. */
export function formatDayCount(days: number | null | undefined, fallback = '—'): string {
  if (days === null || days === undefined || Number.isNaN(days)) return fallback
  return `${Math.trunc(days)}d`
}

/** `DC` — up to two initials, from a name or an organisation. */
export function initialsOf(name: string | null | undefined, max = 2): string {
  if (!name) return '?'
  const parts = name
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return '?'
  const letters = parts.map((p) => p[0]).filter((c): c is string => Boolean(c))
  if (letters.length === 1) {
    const only = parts[0] as string
    return only.slice(0, max).toUpperCase()
  }
  return letters.slice(0, max).join('').toUpperCase()
}
