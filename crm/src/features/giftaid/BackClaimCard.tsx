import { Link } from 'react-router'
import { formatMoney, formatNumber } from '../../lib/format'
import { BACK_CLAIM_VIEW_NAME } from '../../lib/queries/giftaid'

export interface BackClaimCardProps {
  /** What a declaration would still recover inside HMRC's four-year window. */
  recoverable4y: number
  eligible4y: number
  donorCount: number
  /** The seeded saved view's id; null degrades the card to the plain list. */
  viewId: string | null
  amountsHidden: boolean
}

/**
 * The four-year back-claim (05 §5, 07 §10).
 *
 * HMRC accepts a declaration that reaches four years back, so every undeclared
 * gift inside that window is money still on the table — once. The card names
 * the figure and hands off to the saved view that feeds the annual
 * declaration-request run; it deliberately starts nothing by itself.
 */
export function BackClaimCard({
  recoverable4y,
  eligible4y,
  donorCount,
  viewId,
  amountsHidden,
}: BackClaimCardProps) {
  const money = (amount: number) => (amountsHidden ? '—' : formatMoney(amount))
  const href = viewId ? `/contacts?view=${viewId}` : '/contacts'

  return (
    <section
      aria-label="Four-year back-claim"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card-lg border border-border bg-surface px-5 py-4"
    >
      <div className="min-w-[220px] grow">
        <h2 className="text-[12px] font-bold tracking-[0.06em] text-muted uppercase">Four-year back-claim</h2>
        <p className="mt-1 text-[12.5px] text-muted">
          HMRC still accepts a declaration reaching four years back. {money(eligible4y)} of undeclared giving from{' '}
          {formatNumber(donorCount)} donor{donorCount === 1 ? '' : 's'} sits inside that window —{' '}
          <b className="text-gold">{money(recoverable4y)} recoverable</b>, once.
        </p>
      </div>
      <Link
        to={href}
        className="rounded-input border border-accent px-[14px] py-2 text-[13px] font-semibold text-accent hover:bg-accent-soft"
      >
        Open “{BACK_CLAIM_VIEW_NAME}” →
      </Link>
    </section>
  )
}
