import { format } from 'date-fns'
import { MetricCard } from '../../components'
import { formatMoney } from '../../lib/format'
import type { StreamMetrics } from './grouping'

export type MetricFocus = 'all' | 'due' | 'overdue' | 'meetings'

export interface MetricStripProps {
  metrics: StreamMetrics
  /** Gifts received this calendar month; `null` hides the money card (11 §2). */
  monthGiving: number | null
  focus: MetricFocus
  onFocus: (focus: MetricFocus) => void
  loading?: boolean
}

/**
 * The four live saved-filters at the top of the stream (04 §1). Clicking a card
 * filters the stream to that section — the card *is* the filter, there is no
 * stored dashboard state (I-9).
 *
 * Donor retention is `[P2]` and deliberately absent; the money card is hidden
 * for roles that cannot see amounts.
 */
export function MetricStrip({ metrics, monthGiving, focus, onFocus, loading = false }: MetricStripProps) {
  const toggle = (next: MetricFocus) => () => onFocus(focus === next ? 'all' : next)
  const selected = (value: MetricFocus) =>
    focus === value ? 'border-accent ring-1 ring-accent/40' : undefined

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[72px] animate-pulse rounded-card border border-border bg-surface" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="metric-strip">
      <MetricCard
        label="Due today"
        value={metrics.dueToday}
        onClick={toggle('due')}
        className={selected('due')}
      />
      <MetricCard
        label="Overdue"
        value={metrics.overdue}
        tone="overdue"
        onClick={toggle('overdue')}
        className={selected('overdue')}
      />
      <MetricCard
        label="Meetings today"
        value={metrics.meetings}
        onClick={toggle('meetings')}
        className={selected('meetings')}
      />
      {monthGiving === null ? null : (
        <MetricCard
          label={`${format(new Date(), 'MMMM')} giving`}
          value={<span className="text-[20px]">{formatMoney(monthGiving)}</span>}
          tone="gold"
          caption="received"
        />
      )}
    </div>
  )
}
