/**
 * Campaigns & appeals (06 §3 · 05 §4).
 *
 * Each campaign is a progress bar against its goal with the pledged-but-unpaid
 * tail called out underneath — money promised is not money banked, and the two
 * must never be added together on one bar. The footer carries the appeal
 * year-on-year line ("Dinner 2026 vs Dinner 2025 ▲ 12%"), which is what the
 * year+channel columns on `appeals` buy (05 §4).
 */

import { Link } from 'react-router'
import { cn } from '../../lib/cn'
import { formatMoney, formatNumber } from '../../lib/format'
import { CHART_SERIES, appealHighlight, formatPercent, progressFraction } from './logic'
import { ChartEmpty, ReportCard } from './charts'
import type { AppealRow, CampaignRow, DrillTarget } from './types'

export interface CampaignsCardProps {
  campaigns: CampaignRow[]
  appeals: AppealRow[]
  amountsHidden: boolean
  onDrill: (target: DrillTarget) => void
}

export function CampaignsCard({ campaigns, appeals, amountsHidden, onDrill }: CampaignsCardProps) {
  const highlight = appealHighlight(appeals)

  return (
    <ReportCard
      title="Campaigns & appeals"
      action={
        <span className="text-[12px] text-faint">
          {formatNumber(campaigns.length)} active · {formatNumber(appeals.length)} appeals
        </span>
      }
    >
      {campaigns.length === 0 ? (
        <ChartEmpty>No active campaigns — add one in Settings and its progress appears here.</ChartEmpty>
      ) : (
        <div className="tabular flex flex-col gap-3">
          {campaigns.slice(0, 4).map((campaign) => (
            <div key={campaign.id} className="flex flex-col gap-[5px]">
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                <Link
                  to={`/reports/campaigns/${campaign.id}`}
                  className="font-bold text-ink hover:text-accent-dark"
                >
                  {campaign.name}
                </Link>
                <span className="text-nav">
                  {amountsHidden ? (
                    <>
                      {formatNumber(campaign.gift_count)} gifts ·{' '}
                      <b>{formatPercent(campaign.pct, '—')}</b> of goal
                    </>
                  ) : (
                    <>
                      <b className="text-gold">{formatMoney(campaign.raised)}</b> of{' '}
                      {formatMoney(campaign.goal)}
                    </>
                  )}
                </span>
              </div>
              <div
                className="h-[10px] overflow-hidden rounded-[5px] bg-row"
                role="img"
                aria-label={`${campaign.name}: ${formatPercent(campaign.pct, 'no goal set')} of goal`}
                title={`${campaign.name} — ${formatPercent(campaign.pct, 'no goal set')} of goal`}
              >
                <div
                  className="h-[10px] rounded-r-[5px]"
                  style={{
                    width: `${progressFraction(campaign.pct) * 100}%`,
                    background: CHART_SERIES,
                  }}
                />
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3 text-[11.5px] text-muted">
                {!amountsHidden && (campaign.pledged_outstanding ?? 0) > 0 ? (
                  <span>+ {formatMoney(campaign.pledged_outstanding)} pledged, not yet paid</span>
                ) : null}
                <button
                  type="button"
                  className="rounded-[6px] px-[3px] hover:bg-accent-soft hover:text-accent-dark"
                  title={`${campaign.name}: open the ${formatNumber(campaign.donor_count)} donors behind it`}
                  onClick={() =>
                    onDrill({
                      key: 'campaign',
                      title: campaign.name,
                      arg: campaign.id,
                      year: null,
                    })
                  }
                >
                  {formatNumber(campaign.donor_count)} donors
                </button>
                <Link
                  to={`/reports/campaigns/${campaign.id}`}
                  className="text-accent hover:text-accent-dark"
                >
                  campaign page →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {highlight ? (
        <div className="tabular flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-row pt-[10px] text-[12.5px] text-nav">
          <button
            type="button"
            className="rounded-[6px] px-[3px] text-left hover:bg-accent-soft hover:text-accent-dark"
            title={`${highlight.appeal.name}: open the donors who gave to it`}
            onClick={() =>
              onDrill({
                key: 'appeal',
                title: highlight.appeal.name,
                arg: highlight.appeal.id,
                year: null,
              })
            }
          >
            {highlight.appeal.name} (appeal){' '}
            {amountsHidden ? (
              <b>{formatNumber(highlight.appeal.gift_count)} gifts</b>
            ) : (
              <b className="text-gold">{formatMoney(highlight.appeal.total)}</b>
            )}
          </button>
          {highlight.appeal.prior_name ? (
            <span>
              vs {highlight.appeal.prior_name}{' '}
              {amountsHidden ? null : <b>{formatMoney(highlight.appeal.prior_total)}</b>}{' '}
              {highlight.delta ? (
                <span
                  className={cn(
                    'font-semibold',
                    highlight.tone === 'good'
                      ? 'text-good'
                      : highlight.tone === 'bad'
                        ? 'text-flag-overdue'
                        : 'text-muted',
                  )}
                >
                  {highlight.delta}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-faint">
              no prior-year twin yet — a “{highlight.appeal.name.replace(/\s*\d{4}\s*$/, '')}” appeal
              for {(highlight.appeal.year ?? new Date().getFullYear()) - 1} would compare here
            </span>
          )}
        </div>
      ) : null}
    </ReportCard>
  )
}
