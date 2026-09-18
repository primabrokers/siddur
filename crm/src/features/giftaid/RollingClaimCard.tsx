import { Button } from '../../components'
import { cn } from '../../lib/cn'
import { formatDate, formatMoney, formatNumber } from '../../lib/format'
import type { ClaimTotalsRow } from './types'

export interface RollingClaimCardProps {
  claim: ClaimTotalsRow | null
  /** `validationChip(summary)` — null while the pass has not run. */
  validation: string | null
  validationBlocking: boolean
  /** Submit/export is admin (05 §5 permissions, 11 §1). */
  canReview: boolean
  onReview: () => void
  /** 11 §2: the ledger arrived redacted, so no money is rendered. */
  amountsHidden: boolean
  loading?: boolean
}

const Figure = ({
  label,
  value,
  gold,
}: {
  label: string
  value: string
  gold?: boolean
}) => (
  <div>
    <div className="text-[11.5px] font-semibold text-muted">{label}</div>
    <div className={cn('tabular text-[24px] leading-tight font-bold', gold ? 'text-gold' : 'text-ink')}>{value}</div>
  </div>
)

/**
 * The rolling claim (05 §5 panel 1, wireframe A7) — the "+25%" screen.
 *
 * Every figure here is read from `gift_aid_claim_totals`; nothing is summed in
 * the client (I-8/I-9). GASDS is shown *beside* the claim totals, never inside
 * them: it is a separate HMRC scheme with its own limit.
 */
export function RollingClaimCard({
  claim,
  validation,
  validationBlocking,
  canReview,
  onReview,
  amountsHidden,
  loading,
}: RollingClaimCardProps) {
  const money = (amount: number | null | undefined) =>
    amountsHidden ? '—' : formatMoney(amount === null || amount === undefined ? null : Number(amount))

  if (loading && !claim) {
    return <div className="h-[196px] animate-pulse rounded-card-lg border border-border bg-surface" />
  }

  return (
    <section
      aria-label="Current Gift Aid claim"
      className="flex flex-col gap-[14px] rounded-card-lg border border-border border-t-[3px] border-t-gold bg-surface px-5 py-[18px]"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-bold tracking-[0.05em] text-muted uppercase">Current claim — rolling</h2>
        {claim?.building_since ? (
          <span className="rounded-pill bg-[#F3F0E8] px-[10px] py-[3px] text-[11.5px] font-bold text-[#6B5A26]">
            building since {formatDate(claim.building_since)}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Figure label="ELIGIBLE GIFTS" value={formatNumber(claim ? Number(claim.gift_count ?? 0) : 0)} />
        <Figure label="DONATIONS" value={money(claim?.donations_total ?? 0)} />
        <Figure label="CLAIMABLE +25%" value={money(claim?.claimable_total ?? 0)} gold />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
        <span>
          GASDS (small cash): <b className="tabular text-ink">{money(claim?.gasds_total ?? 0)}</b>
        </span>
        <span>· every new eligible gift joins automatically</span>
      </div>

      <div className="flex flex-wrap items-center gap-[10px]">
        {canReview ? (
          <Button onClick={onReview} disabled={!claim} className="font-bold">
            Review &amp; export HMRC CSV
          </Button>
        ) : (
          <span className="rounded-input bg-row px-[14px] py-2 text-[12.5px] text-muted">
            Submitting a claim is an admin action
          </span>
        )}
        {validation ? (
          <span
            className={cn(
              'rounded-input border px-[14px] py-2 text-[13px] font-semibold',
              validationBlocking ? 'border-flag-today text-flag-today-ink' : 'border-good text-good',
            )}
          >
            {validation}
          </span>
        ) : null}
      </div>
    </section>
  )
}
