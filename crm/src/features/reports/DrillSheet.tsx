/**
 * "…and here are the people" (06 §3).
 *
 * Every number on the Reports screen is a button that opens this sheet, and the
 * sheet is the list the number was counting — each row a link into the donor
 * profile. Nothing is recomputed here: `report_drill` returns the same set the
 * aggregate counted, from the same SQL definitions.
 */

import { Link } from 'react-router'
import { Sheet } from '../../components'
import { formatDate, formatMoney, formatNumber } from '../../lib/format'
import { useReportDrill } from '../../lib/queries/reports'
import type { ReportYear } from '../../lib/queries/reportsKeys'
import { AMOUNTS_HIDDEN_NOTE } from './logic'
import type { DrillTarget } from './types'

export interface DrillSheetProps {
  target: DrillTarget | null
  /** The screen's period; a target may override it. */
  year: ReportYear
  amountsHidden: boolean
  onClose: () => void
}

export function DrillSheet({ target, year, amountsHidden, onClose }: DrillSheetProps) {
  const effectiveYear = target?.year !== undefined ? target.year : year
  const drill = useReportDrill(target?.key ?? null, effectiveYear, target?.arg ?? null)
  const rows = drill.data ?? []

  return (
    <Sheet
      open={target !== null}
      onClose={onClose}
      title={target?.title ?? 'People'}
      width={560}
      leading={
        <button type="button" onClick={onClose} className="text-muted hover:text-ink">
          Close
        </button>
      }
    >
      {drill.isPending ? (
        <p className="py-6 text-center text-[13px] text-muted">Loading the list…</p>
      ) : drill.isError ? (
        <p className="py-6 text-center text-[13px] text-flag-overdue">
          {(drill.error as Error)?.message ?? 'Could not load the list.'}
        </p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted" data-testid="drill-empty">
          Nobody in this group yet.
        </p>
      ) : (
        <>
          <p className="mb-2 text-[12px] text-muted">
            {formatNumber(rows.length)} {rows.length === 1 ? 'person' : 'people'}
            {amountsHidden ? ` · ${AMOUNTS_HIDDEN_NOTE.toLowerCase()}` : null}
          </p>
          <ul className="flex flex-col divide-y divide-border" data-testid="drill-list">
            {rows.map((row) => (
              <li key={row.contact_id}>
                <Link
                  to={`/contacts/${row.contact_id}`}
                  className="flex items-baseline justify-between gap-3 py-[10px] hover:bg-ground"
                  onClick={onClose}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold text-ink">
                      {row.contact_name}
                    </span>
                    <span className="block truncate text-[12px] text-muted">
                      {row.secondary ?? '—'}
                      {row.last_gift_on ? ` · last gift ${formatDate(row.last_gift_on)}` : ''}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-right text-[12.5px]">
                    {amountsHidden || row.amount === null ? (
                      <span className="text-muted">
                        {formatNumber(row.gift_count)} {row.gift_count === 1 ? 'gift' : 'gifts'}
                      </span>
                    ) : (
                      <>
                        <span className="font-semibold text-gold">{formatMoney(row.amount)}</span>
                        <span className="block text-[11.5px] text-faint">
                          {formatNumber(row.gift_count)} {row.gift_count === 1 ? 'gift' : 'gifts'}
                        </span>
                      </>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  )
}
