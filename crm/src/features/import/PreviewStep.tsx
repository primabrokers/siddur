import { useMemo, useState } from 'react'
import { FilterChip, Pill } from '../../components'
import { FIELD_LABEL } from './mapping'
import { countChanges, isBlocked } from './normalisePreview'
import type { NormalisedRow } from './types'

export interface PreviewStepProps {
  rows: NormalisedRow[]
}

type Lens = 'changed' | 'issues' | 'all'

/**
 * Step 3 — normalisation preview (06 §5).
 *
 * The wizard has already rewritten phones to E.164, dates to ISO and titles to
 * their canonical spelling. This screen exists so nobody has to take that on
 * trust: the default lens is **what changed**, one line per rewrite, with the
 * original still visible beside it.
 *
 * Rows the wizard cannot use at all (no name, an amount that is not a number)
 * are separated out rather than mixed in — they are a different kind of
 * problem, and the person needs to know they will simply not be written.
 */
export function PreviewStep({ rows }: PreviewStepProps) {
  const [lens, setLens] = useState<Lens>('changed')

  const changed = useMemo(() => rows.filter((row) => row.changes.length > 0), [rows])
  const flagged = useMemo(() => rows.filter((row) => row.issues.length > 0), [rows])
  const blocked = useMemo(() => rows.filter(isBlocked), [rows])
  const ruleCounts = useMemo(() => countChanges(rows), [rows])

  const shown = lens === 'changed' ? changed : lens === 'issues' ? flagged : rows

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-surface p-3">
        <span className="text-[13px] font-semibold">
          {rows.length.toLocaleString('en-GB')} rows read
        </span>
        <span className="text-faint">·</span>
        {Object.keys(ruleCounts).length === 0 ? (
          <span className="text-[12.5px] text-muted">nothing needed tidying</span>
        ) : (
          Object.entries(ruleCounts).map(([rule, count]) => (
            <Pill key={rule} variant="computed">
              {count} × {rule}
            </Pill>
          ))
        )}
        {blocked.length > 0 ? (
          <Pill variant="manual" tone="overdue">
            {blocked.length} unusable
          </Pill>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <FilterChip active={lens === 'changed'} onClick={() => setLens('changed')}>
          Changed ({changed.length})
        </FilterChip>
        <FilterChip active={lens === 'issues'} onClick={() => setLens('issues')}>
          Needs a look ({flagged.length})
        </FilterChip>
        <FilterChip active={lens === 'all'} onClick={() => setLens('all')}>
          All rows ({rows.length})
        </FilterChip>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-card border border-border bg-surface px-4 py-6 text-center text-[13px] text-muted">
          {lens === 'changed'
            ? 'Nothing was rewritten — the sheet is already in the shape the CRM wants.'
            : 'No rows need a second look.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface" data-testid="import-preview-table">
          <table className="w-full min-w-[680px] border-collapse text-[13px]">
            <thead>
              <tr className="bg-row">
                <th className="w-[52px] px-3 py-2 text-left font-semibold">Row</th>
                <th className="px-3 py-2 text-left font-semibold">Who</th>
                <th className="px-3 py-2 text-left font-semibold">Tidied</th>
                <th className="px-3 py-2 text-left font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 200).map((row) => (
                <tr key={row.line} className="border-t border-border align-top">
                  <td className="px-3 py-2 tabular-nums text-muted">{row.line}</td>
                  <td className="px-3 py-2 font-semibold whitespace-nowrap">
                    {row.displayName}
                    {row.gift ? (
                      <span className="ml-2 font-normal text-gold tabular-nums">£{row.gift.amount.toLocaleString('en-GB')}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {row.changes.length === 0 ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <ul className="flex flex-col gap-[3px]">
                        {row.changes.map((change) => (
                          <li key={`${row.line}-${change.field}`} className="text-[12px]">
                            <span className="text-muted">{FIELD_LABEL[change.field]}: </span>
                            <span className="text-faint line-through">{change.from}</span>
                            <span className="mx-1 text-faint">→</span>
                            <span className="font-semibold">{change.to}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.issues.length === 0 ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <ul className="flex flex-col gap-[3px]">
                        {row.issues.map((issue, index) => (
                          <li
                            key={`${row.line}-${index}`}
                            className={
                              issue.level === 'block'
                                ? 'text-[12px] text-flag-overdue'
                                : 'text-[12px] text-flag-today-ink'
                            }
                          >
                            {issue.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > 200 ? (
            <p className="border-t border-border px-3 py-2 text-[12px] text-muted">
              Showing the first 200 of {shown.length.toLocaleString('en-GB')}.
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}
