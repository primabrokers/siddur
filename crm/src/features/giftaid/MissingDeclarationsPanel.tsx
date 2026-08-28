import { Link } from 'react-router'
import { Button, EmptyState } from '../../components'
import { formatDate, formatMoney, formatNumber } from '../../lib/format'
import { displayName } from '../contacts/normalise'
import type { MissingQueueRow, MissingQueueSummary } from './logic'

export interface MissingDeclarationsPanelProps {
  summary: MissingQueueSummary
  /** Chasing declarations is fundraiser-and-up (05 §5 permissions). */
  canChase: boolean
  onDraftRequest: (row: MissingQueueRow) => void
  onTookOrally: (row: MissingQueueRow) => void
  amountsHidden: boolean
  loading?: boolean
}

/** How many donors the panel lists before it stops being a queue. */
const VISIBLE = 12

/**
 * Missing declarations — found money (05 §5 panel 2, wireframe A7).
 *
 * Sorted by what a declaration would recover, because that is the order in
 * which the work pays. Two verbs per row, both of which leave the sending to a
 * person: **Draft request** writes the message, **Took it orally** records the
 * declaration and queues the written confirmation HMRC requires (02 §3.7).
 */
export function MissingDeclarationsPanel({
  summary,
  canChase,
  onDraftRequest,
  onTookOrally,
  amountsHidden,
  loading,
}: MissingDeclarationsPanelProps) {
  const money = (amount: number | null | undefined) =>
    amountsHidden ? '—' : formatMoney(amount === null || amount === undefined ? null : Number(amount))

  const visible = summary.rows.slice(0, VISIBLE)
  const rest = summary.rows.length - visible.length

  return (
    <section
      aria-label="Missing declarations"
      className="flex min-h-0 grow flex-col gap-3 rounded-card-lg border border-border bg-surface px-5 py-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-bold tracking-[0.05em] text-muted uppercase">
          Missing declarations — found money
        </h2>
        <span className="tabular text-[13px] font-bold text-gold">
          {money(summary.recoverableTotal)} recoverable from {formatNumber(summary.donorCount)} donor
          {summary.donorCount === 1 ? '' : 's'}
        </span>
      </div>

      {loading && summary.rows.length === 0 ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[54px] animate-pulse rounded-card border border-row bg-ground" />
          ))}
        </div>
      ) : summary.rows.length === 0 ? (
        <EmptyState
          title="Every eligible gift has a declaration"
          hint="Nothing is waiting to be reclaimed. New gifts without a declaration appear here automatically."
        />
      ) : (
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
          {visible.map((row) => {
            const name = displayName(row.contact) || 'Unknown donor'
            return (
              <div
                key={row.contact_id}
                className="flex flex-wrap items-center gap-3 rounded-card border border-row px-3 py-[10px]"
              >
                <div className="min-w-[190px] grow">
                  <div className="text-[13px] font-semibold">
                    <Link to={`/contacts/${row.contact_id}`} className="text-ink hover:text-accent">
                      {name}
                    </Link>
                  </div>
                  <div className="text-[12px] text-muted">
                    {money(row.eligible_total)} in eligible gifts
                    {row.gift_count ? ` · ${formatNumber(Number(row.gift_count))} gifts` : ''}
                    {row.first_gift_on ? ` since ${formatDate(row.first_gift_on)}` : ''} ·{' '}
                    <b className="text-gold">{money(row.recoverable)} recoverable</b>
                  </div>
                </div>
                {canChase ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="accentOutline" size="sm" onClick={() => onDraftRequest(row)}>
                      Draft request
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onTookOrally(row)}>
                      Took it orally
                    </Button>
                  </div>
                ) : null}
              </div>
            )
          })}
          {rest > 0 ? (
            <p className="px-1 text-[12px] text-faint">
              {formatNumber(rest)} more donor{rest === 1 ? '' : 's'} below the top {VISIBLE} — work the list from the
              top; it re-sorts as declarations land.
            </p>
          ) : null}
        </div>
      )}

      <p className="text-[12px] text-faint">
        Requests are drafted for you — you send them. Oral declarations queue the required written confirmation
        automatically.
      </p>
    </section>
  )
}
