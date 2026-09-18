import { addDays, isSameDay, startOfDay, startOfToday } from 'date-fns'
import { toDate, type DateInput } from './format'

/** Local midnight today. All "due today / overdue" comparisons are calendar-day. */
export const today = (): Date => startOfToday()

/** `2026-08-25` — the wire format Postgres `date` columns expect. */
export function toISODate(value: DateInput = new Date()): string {
  const date = toDate(value) ?? new Date()
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function isToday(value: DateInput): boolean {
  const date = toDate(value)
  return date ? isSameDay(date, new Date()) : false
}

export function isPastDay(value: DateInput): boolean {
  const date = toDate(value)
  return date ? startOfDay(date).getTime() < startOfToday().getTime() : false
}

/** Snooze presets — snooze is a first-class verb on every task (03 §5.3). */
export const snoozePresets = () => [
  { id: 'tomorrow', label: 'Tomorrow', date: addDays(startOfToday(), 1) },
  { id: 'next-week', label: 'Next week', date: addDays(startOfToday(), 7) },
  { id: 'two-weeks', label: 'In two weeks', date: addDays(startOfToday(), 14) },
]
