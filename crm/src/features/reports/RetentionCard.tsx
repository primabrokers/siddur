/**
 * Donor retention (06 §3) — the headline of the whole screen.
 *
 * Rate = donors who gave last year *and* this year ÷ donors who gave last year.
 * Postgres computes it (`report_retention`); the card shows it beside the
 * sector benchmarks, because a retention number without one is a number no one
 * can act on (▸ Bloomerang/FEP).
 */

import { cn } from '../../lib/cn'
import { formatNumber } from '../../lib/format'
import { BenchmarkBars, ChartEmpty, DrillNumber, ReportCard } from './charts'
import {
  benchmarkBars,
  deltaTone,
  formatDeltaPoints,
  formatPercent,
  retentionCounts,
} from './logic'
import type { DrillTarget, RetentionSummary } from './types'

export interface RetentionCardProps {
  retention: RetentionSummary
  onDrill: (target: DrillTarget) => void
}

export function RetentionCard({ retention, onDrill }: RetentionCardProps) {
  const bars = benchmarkBars(retention)
  const counts = retentionCounts(retention)
  const delta = formatDeltaPoints(retention.delta_pts)
  const tone = deltaTone(retention.delta_pts)
  const year = retention.year
  const footnote =
    retention.benchmark_source && retention.benchmark_year
      ? `Benchmarks: ${retention.benchmark_source} ${retention.benchmark_year} — editable in Settings, because they age.`
      : null

  return (
    <ReportCard
      title="Donor retention"
      action={
        <button
          type="button"
          onClick={() =>
            onDrill({ key: 'retention_lapsed', title: `Lapsed donors · ${year}`, year })
          }
          className="font-semibold text-accent hover:text-accent-dark"
        >
          open lapsed list →
        </button>
      }
    >
      {retention.gave_prior === 0 ? (
        <ChartEmpty>
          Not enough history yet — retention compares {year} against {year - 1}, and nobody gave in{' '}
          {year - 1}.
        </ChartEmpty>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-[10px]">
            <button
              type="button"
              onClick={() =>
                onDrill({ key: 'retention_repeat', title: `Retained donors · ${year}`, year })
              }
              title={`${retention.retained} of ${retention.gave_prior} ${year - 1} donors gave again in ${year}`}
              className="tabular rounded-[6px] text-[34px] leading-none font-bold hover:text-accent-dark"
            >
              {formatPercent(retention.rate)}
            </button>
            {delta ? (
              <span
                className={cn(
                  'text-[13px] font-semibold',
                  tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-flag-overdue' : 'text-muted',
                )}
              >
                {delta}
              </span>
            ) : null}
            <span className="tabular ml-auto text-[12px] text-faint">
              {formatNumber(retention.retained)} of {formatNumber(retention.gave_prior)} kept
            </span>
          </div>

          <BenchmarkBars
            bars={bars}
            ariaLabel={`Donor retention ${formatPercent(retention.rate)} against sector benchmarks`}
            footnote={footnote}
          />

          <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-row pt-[10px]">
            {counts.map((count) => (
              <DrillNumber
                key={count.id}
                label={count.label}
                value={formatNumber(count.value)}
                tone={count.tone}
                title={`${count.label}: ${formatNumber(count.value)} — open the list`}
                onClick={() =>
                  onDrill({ key: count.drill, title: `${count.label} · ${year}`, year })
                }
              />
            ))}
          </div>
        </>
      )}
    </ReportCard>
  )
}
