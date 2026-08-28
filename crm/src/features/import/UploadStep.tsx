import { useRef, useState, type DragEvent } from 'react'
import { Button } from '../../components'
import { cn } from '../../lib/cn'
import { parseCsv, readFile } from './csv'
import type { ParsedCsv } from './types'

export interface UploadStepProps {
  parsed: ParsedCsv | null
  onParsed: (parsed: ParsedCsv) => void
}

/**
 * Step 1 — the file (06 §5).
 *
 * Drop or pick; nothing is uploaded anywhere. The CSV is read in the browser
 * and every later step runs on that in-memory copy, so an abandoned import
 * leaves no trace on the server and a mistake costs nothing but a re-drop.
 */
export function UploadStep({ parsed, onParsed }: UploadStepProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [over, setOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const take = async (file: File | null | undefined) => {
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const text = await readFile(file)
      const result = parseCsv(text, file.name)
      if (result.headers.length === 0) {
        setError('That file has no readable header row.')
        return
      }
      onParsed(result)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read that file.')
    } finally {
      setBusy(false)
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setOver(false)
    void take(event.dataTransfer.files?.[0])
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        data-testid="import-dropzone"
        className={cn(
          'flex flex-col items-center gap-3 rounded-card border-2 border-dashed px-6 py-12 text-center transition-colors',
          over ? 'border-accent bg-accent-soft' : 'border-border bg-surface',
        )}
      >
        <p className="text-[15px] font-bold">Drop the spreadsheet here</p>
        <p className="max-w-[440px] text-[13px] leading-[1.5] text-muted">
          A CSV export of the yeshiva's book. Contacts on their own are fine; if the sheet also carries
          gifts, map those columns in the next step and they come across too.
        </p>
        <Button onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Reading…' : 'Choose a file'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          aria-label="CSV file"
          onChange={(e) => void take(e.target.files?.[0])}
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
          {error}
        </p>
      ) : null}

      {parsed ? (
        <div className="rounded-card border border-border bg-surface p-4" data-testid="import-file-summary">
          <p className="text-[13.5px] font-semibold">{parsed.filename}</p>
          <p className="mt-1 text-[12.5px] text-muted">
            {parsed.rows.length.toLocaleString('en-GB')} {parsed.rows.length === 1 ? 'row' : 'rows'} ·{' '}
            {parsed.headers.length} columns
          </p>
          {parsed.problems.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1 text-[12px] text-flag-today-ink">
              {parsed.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-[12px]">
              <thead>
                <tr>
                  {parsed.headers.map((header) => (
                    <th key={header} className="border-b border-border px-2 py-1 text-left font-semibold whitespace-nowrap">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 3).map((row, index) => (
                  <tr key={index}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="border-b border-border px-2 py-1 text-muted whitespace-nowrap">
                        {cell || <span className="text-faint">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
