/**
 * CSV in (06 §5, step 1).
 *
 * papaparse does the quoting/encoding work; this module only decides what a
 * *usable* result looks like: header row present, ragged rows padded rather
 * than dropped, and blank trailing rows (every export has them) discarded.
 *
 * Rows stay `string[]` — untyped and unmapped — because the mapping step has
 * not run yet. Turning cells into fields is `normalisePreview`'s job.
 */

import Papa from 'papaparse'
import type { ParsedCsv } from './types'

/** Bigger than the yeshiva's book by an order of magnitude (11 §5). */
export const MAX_ROWS = 20_000

function tidy(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value)
}

const isBlank = (row: string[]): boolean => row.every((cell) => cell === '')

/**
 * Parse a CSV string. Header cells keep their original text (the mapping
 * templates key on it) but are de-duplicated: two columns called "Notes"
 * become "Notes" and "Notes (2)" so a mapping can address them separately.
 */
export function parseCsv(text: string, filename: string): ParsedCsv {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' })
  const problems: string[] = (result.errors ?? [])
    .slice(0, 5)
    .map((e) => `Row ${(e.row ?? 0) + 1}: ${e.message}`)

  const all = (result.data ?? []).map((row) => (Array.isArray(row) ? row.map(tidy) : []))
  const headerRow = all.find((row) => !isBlank(row))
  if (!headerRow) return { filename, headers: [], rows: [], problems: ['The file has no rows.'] }

  const seen = new Map<string, number>()
  const headers = headerRow.map((cell, index) => {
    const base = cell === '' ? `Column ${index + 1}` : cell
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return count === 1 ? base : `${base} (${count})`
  })

  const body = all.slice(all.indexOf(headerRow) + 1).filter((row) => !isBlank(row))
  if (body.length > MAX_ROWS) {
    problems.push(`Only the first ${MAX_ROWS.toLocaleString('en-GB')} rows will be imported.`)
  }

  // Pad short rows rather than dropping them: a trailing empty cell that the
  // exporter omitted must not shift every later column by one.
  const rows = body.slice(0, MAX_ROWS).map((row) => {
    const padded = row.slice(0, headers.length)
    while (padded.length < headers.length) padded.push('')
    return padded
  })

  return { filename, headers, rows, problems }
}

/** Read a `File` from the picker or a drop, as UTF-8 text. */
export function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.readAsText(file, 'utf-8')
  })
}
