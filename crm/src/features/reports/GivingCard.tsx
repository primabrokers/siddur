/**
 * Giving over time (06 §3) — months of the selected year, or one bar per year
 * for all time. The bars are hard-credit gifts only; soft credit is a separate
 * column in the ledger and is deliberately not blended in here (▸ NPSP).
 *
 * The current month renders in the muted step: it is a period still filling up,
 * and drawing it in the full series hue would read as a slump.
 */

import { formatMoney, formatNumber } from '../../lib/format'
import { BarChart, ChartEmpty, ReportCard } from './charts'
import {
  AMOUNTS_HIDDEN_NOTE,
  givingBarPoints,
  hasEnoughHistory,
  layoutBars,
  peakLabel,
} from './logic'
import type { DrillTarget, GivingSummary } from './types'

export interface GivingCardProps {
  giving: GivingSummary
  granularity: 'month' | 'year'
  /** The period label — "2026" or "All time". */
  periodLabel: string
  amountsHidden: boolean
  onDrill: (target: DrillTarget) => void
}

export function GivingCard({
  giving,
  granularity,
  periodLabel,
  amountsHidden,
  onDrill,
}: GivingCardProps) {
  const points = givingBarPoints(giving, amountsHidden)
  const layout = layoutBars(points)
  const enough = hasEnoughHistory(points)
  const title = granularity === 'month' ? `Giving by month — ${periodLabel}` : 'Giving by year — all time'
  const total = amountsHidden
    ? `${formatNumber(giving.gift_count)} gifts`
    : `${formatMoney(giving.total)}`

  return (
    <ReportCard
      title={title}
      action={
        <span className="tabular text-[12.5px] text-nav">
          {granularity === 'month' ? 'Total ' : 'All time '}
          {amountsHidden ? (
            <b>{total}</b>
          ) : (
            <b className="text-gold">{total}</b>
          )}
        </span>
      }
    >
      {!enough ? (
        <ChartEmpty>
          Not enough history yet — one period of giving does not make a trend. Record a few more
          gifts and the shape of the year appears here.
        </ChartEmpty>
      ) : (
        <>
          <BarChart
            layout={layout}
            peakLabel={peakLabel(layout, amountsHidden)}
            ariaLabel={
              amountsHidden
                ? `Gifts recorded per ${granularity}, ${periodLabel}. ${AMOUNTS_HIDDEN_NOTE}.`
                : `Giving per ${granularity}, ${periodLabel}. Total ${formatMoney(giving.total)} across ${formatNumber(giving.gift_count)} gifts.`
            }
            onSelect={(mark) =>
              onDrill({
                key: 'bucket',
                title: `Gave in ${mark.label}${granularity === 'month' ? ` ${periodLabel}` : ''}`,
                arg: mark.key,
              })
            }
          />
          <p className="text-[11px] text-faint">
            {amountsHidden
              ? `Bars show gift counts — ${AMOUNTS_HIDDEN_NOTE.toLowerCase()}.`
              : 'Hard-credit gifts received. The current period is shown muted; click a bar for its donors.'}
          </p>
        </>
      )}
    </ReportCard>
  )
}
