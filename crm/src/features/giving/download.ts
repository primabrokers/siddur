/**
 * Client-side file download for the receipt CSV (05 §3: no built-in mail merge
 * in P1 — the queue exports for Word). Kept out of `logic.ts` so the CSV
 * *shape* stays a pure, testable function and only the delivery touches the DOM.
 */

export function downloadCsv(filename: string, csv: string): void {
  if (typeof document === 'undefined') return
  // The BOM keeps Excel from mangling "£" and Hebrew names.
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
