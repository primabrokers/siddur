/**
 * RFM personas (02 §4.5, 06 §3) ▸ Keela/Donorfy.
 *
 * `run_rfm()` scores recency, frequency and value into quintiles every night at
 * 05:30 and maintains exactly one persona tag per donor in category
 * `rfm_auto`. This card is the read side: six tiles, each a live headcount with
 * its movement since the previous recompute, each a click through to the tag's
 * contact list.
 *
 * At-Risk and Can't Lose Them read alert-red — they are the two segments where
 * doing nothing costs money.
 */

import { cn } from '../../lib/cn'
import { formatDate, formatNumber } from '../../lib/format'
import { ChartEmpty, ReportCard } from './charts'
import { rfmHasSegmentation, segmentMovement } from './logic'
import type { DrillTarget, RfmSummary } from './types'

export interface RfmCardProps {
  rfm: RfmSummary
  onDrill: (target: DrillTarget) => void
}

export function RfmCard({ rfm, onDrill }: RfmCardProps) {
  const segments = rfm.segments ?? []
  const segmented = rfmHasSegmentation(segments, rfm.computed_at)

  return (
    <ReportCard
      title="Donor segments — RFM, recomputed nightly"
      action={
        <span className="text-[12px] text-faint">
          {rfm.computed_at ? `last run ${formatDate(rfm.computed_at)} · ` : ''}click a tile for the list
        </span>
      }
    >
      {!segmented ? (
        <ChartEmpty>
          Not enough history yet — RFM needs at least five donors with gifts before quintiles mean
          anything, so the nightly run has left the tags alone.
        </ChartEmpty>
      ) : (
        <div className="tabular grid grid-cols-2 gap-[10px] sm:grid-cols-3">
          {segments.map((segment) => {
            const movement = segmentMovement(segment)
            return (
              <button
                key={segment.segment}
                type="button"
                data-testid="rfm-tile"
                data-segment={segment.segment}
                data-alert={segment.is_alert ? 'true' : 'false'}
                onClick={() =>
                  onDrill({ key: 'rfm', title: segment.segment, arg: segment.segment, year: null })
                }
                title={`${segment.segment}: ${formatNumber(segment.headcount)} donors — open the list`}
                className={cn(
                  'flex flex-col gap-[2px] rounded-card border px-3 py-3 text-left transition-colors',
                  segment.is_alert
                    ? 'border-[#ECC7C7] bg-[#FDF7F7] hover:border-flag-overdue'
                    : 'border-border bg-surface hover:border-accent',
                )}
              >
                <span
                  className={cn(
                    'text-[12px] font-bold',
                    segment.is_alert ? 'text-[#B03030]' : 'text-ink',
                  )}
                >
                  {segment.segment}
                </span>
                <span className="text-[22px] leading-tight font-bold">
                  {formatNumber(segment.headcount)}
                </span>
                <span
                  className={cn(
                    'text-[11.5px]',
                    movement.tone === 'good'
                      ? 'text-good'
                      : movement.tone === 'alert'
                        ? 'text-[#B03030]'
                        : 'text-muted',
                  )}
                >
                  {movement.text}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </ReportCard>
  )
}
