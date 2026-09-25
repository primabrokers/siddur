import { Button } from '../../components'
import { formatDate, formatMoney, formatNumber } from '../../lib/format'
import type { ClaimTotalsRow } from './types'

export interface ClaimHistoryTableProps {
  claims: ClaimTotalsRow[]
  /** Recording HMRC's payment is admin (11 §1). */
  canMarkPaid: boolean
  onMarkPaid: (claim: ClaimTotalsRow) => void
  amountsHidden: boolean
}

/** `PAID 21 Jul` — the wireframe's green pill; the date only when we have one. */
const PaidPill = ({ on }: { on: string | null }) => (
  <span className="rounded-pill bg-good-bg px-[9px] py-[2px] text-[11px] font-bold text-good">
    PAID{on ? ` ${formatDate(on).replace(/ \d{4}$/, '')}` : ''}
  </span>
)

/**
 * Claim history (05 §5 panel 3): what was filed, what it was worth, whether
 * HMRC has paid. The one verb here is "mark paid" — the last state in a claim's
 * life (07 §8.3).
 */
export function ClaimHistoryTable({ claims, canMarkPaid, onMarkPaid, amountsHidden }: ClaimHistoryTableProps) {
  const money = (amount: number | null | undefined) =>
    amountsHidden ? '—' : formatMoney(amount === null || amount === undefined ? null : Number(amount))

  return (
    <section
      aria-label="Claim history"
      className="flex min-h-0 flex-col rounded-card-lg border border-border bg-surface pt-[14px] pb-1"
    >
      <h2 className="px-5 pb-2 text-[12px] font-bold tracking-[0.06em] text-muted uppercase">Claim history</h2>

      {claims.length === 0 ? (
        <p className="px-5 pb-4 text-[12.5px] text-faint">
          No claim has been filed yet. The rolling claim above becomes the first one.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="tabular w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="text-[11px] font-bold tracking-[0.06em] text-muted uppercase">
                <th className="border-b border-row px-3 py-[9px] pl-5 text-left font-bold">Submitted</th>
                <th className="border-b border-row px-3 py-[9px] text-left font-bold">Gifts</th>
                <th className="border-b border-row px-3 py-[9px] text-left font-bold">Claimed</th>
                <th className="border-b border-row px-3 py-[9px] text-left font-bold">Status</th>
                <th className="border-b border-row px-3 py-[9px] text-left font-bold">HMRC ref</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((claim) => (
                <tr key={claim.claim_id}>
                  <td className="border-b border-row px-3 py-[9px] pl-5">{formatDate(claim.submitted_on)}</td>
                  <td className="border-b border-row px-3 py-[9px]">{formatNumber(Number(claim.gift_count ?? 0))}</td>
                  <td className="border-b border-row px-3 py-[9px] font-semibold text-gold">
                    {money(claim.claimable_total)}
                  </td>
                  <td className="border-b border-row px-3 py-[9px]">
                    {claim.status === 'paid' ? (
                      <PaidPill on={claim.paid_on} />
                    ) : canMarkPaid ? (
                      <Button variant="outline" size="sm" onClick={() => onMarkPaid(claim)}>
                        Mark paid
                      </Button>
                    ) : (
                      <span className="text-muted">Submitted</span>
                    )}
                  </td>
                  <td className="border-b border-row px-3 py-[9px] text-muted">{claim.hmrc_reference ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
