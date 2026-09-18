/**
 * Gift Aid (06 §3, feeding 05 §5): claimed in the period, recoverable
 * outstanding, declaration coverage.
 *
 * "Recoverable" is 25% of the eligible-but-unclaimed gifts — real money sitting
 * on the table, so it gets the gold treatment and a route into the workspace.
 * Coverage is the lever that grows it, and the missing-declaration count is one
 * click from the people to chase.
 */

import { Link } from 'react-router'
import { formatMoney, formatNumber } from '../../lib/format'
import { CHART_SERIES, formatPercent } from './logic'
import { DrillNumber, ReportCard } from './charts'
import type { DrillTarget, GiftAidSummary } from './types'

export interface GiftAidCardProps {
  giftAid: GiftAidSummary
  amountsHidden: boolean
  onDrill: (target: DrillTarget) => void
}

export function GiftAidCard({ giftAid, amountsHidden, onDrill }: GiftAidCardProps) {
  const coverage = giftAid.coverage_pct ?? 0

  return (
    <ReportCard
      title="Gift Aid"
      action={
        <Link to="/gift-aid" className="font-semibold text-accent hover:text-accent-dark">
          open the workspace →
        </Link>
      }
    >
      <div className="tabular grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-[2px]">
          <span className="text-[11.5px] text-muted">Claimed this period</span>
          <span className="text-[22px] leading-tight font-bold text-gold">
            {amountsHidden ? '—' : formatMoney(giftAid.claimed)}
          </span>
        </div>
        <div className="flex flex-col gap-[2px]">
          <span className="text-[11.5px] text-muted">Recoverable outstanding</span>
          <span className="text-[22px] leading-tight font-bold text-gold">
            {amountsHidden ? '—' : formatMoney(giftAid.recoverable)}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-[6px]">
        <div className="flex items-baseline justify-between text-[12px] text-nav">
          <span>Declaration coverage</span>
          <span className="tabular font-semibold">{formatPercent(giftAid.coverage_pct)}</span>
        </div>
        <div
          className="h-[10px] overflow-hidden rounded-[5px] bg-row"
          role="img"
          aria-label={`Declaration coverage ${formatPercent(giftAid.coverage_pct)} — ${formatNumber(giftAid.donors_with_declaration)} of ${formatNumber(giftAid.donor_count)} eligible donors`}
          title={`${formatNumber(giftAid.donors_with_declaration)} of ${formatNumber(giftAid.donor_count)} eligible donors have a declaration on file`}
        >
          <div
            className="h-[10px] rounded-r-[5px]"
            style={{ width: `${Math.max(0, Math.min(100, coverage))}%`, background: CHART_SERIES }}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-row pt-[10px]">
        <DrillNumber
          label="Missing declarations"
          value={formatNumber(giftAid.pending_gift_count)}
          title={`Missing declarations: ${formatNumber(giftAid.pending_gift_count)} received gifts are waiting on one — open the donors to chase`}
          onClick={() =>
            onDrill({ key: 'gift_aid_pending', title: 'Waiting on a declaration', year: null })
          }
        />
        <DrillNumber
          label="Eligible, unclaimed"
          value={formatNumber(giftAid.eligible_gift_count)}
          title={`Eligible, unclaimed: ${formatNumber(giftAid.eligible_gift_count)} gifts are not yet on a claim — open the donors`}
          onClick={() =>
            onDrill({ key: 'gift_aid_eligible', title: 'Eligible, not yet claimed', year: null })
          }
        />
        <span className="tabular px-[3px] text-[12.5px] text-muted">
          Declarations on file{' '}
          <b>
            {formatNumber(giftAid.donors_with_declaration)}/{formatNumber(giftAid.donor_count)}
          </b>
        </span>
      </div>
    </ReportCard>
  )
}
