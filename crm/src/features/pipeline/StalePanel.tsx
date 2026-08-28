import { formatDate } from '../../lib/format'
import { compactMoney, STATUS_LABEL, type PipelineCard } from './logic'

export interface StalePanelProps {
  stale: PipelineCard[]
  /** The `stale_prospects` window in days (08 §7) — shown in the footnote. */
  days: number
  history: PipelineCard[]
  historyOpen: boolean
  onToggleHistory: () => void
  onReview: (card: PipelineCard) => void
}

/**
 * "Stale — advance or decide" (06 §2 behaviour 3 ▸ MarketSmart).
 *
 * The quarterly-movement covenant, adapted: a visible list, never a hard rule.
 * Nothing is blocked, nothing is auto-closed — the panel just refuses to let an
 * ask sit unmoved without being seen.
 *
 * Underneath, the same rail carries the won/lost history behind a toggle, so
 * the board itself stays about live asks.
 */
export function StalePanel({
  stale,
  days,
  history,
  historyOpen,
  onToggleHistory,
  onReview,
}: StalePanelProps) {
  return (
    <aside
      aria-label="Stale prospects"
      className="flex w-full shrink-0 flex-col gap-[10px] lg:w-[236px]"
    >
      <h2 className="px-[2px] text-[13px] font-bold">Stale — advance or decide</h2>

      {stale.length === 0 ? (
        <p className="rounded-card border border-border bg-surface px-[14px] py-3 text-[12.5px] text-muted">
          Everything has moved inside {days} days. Nothing to chase.
        </p>
      ) : (
        <div className="flex flex-col gap-[10px] rounded-card border border-border bg-surface px-[14px] py-3 text-[12.5px]">
          {stale.map((card, index) => (
            <div key={card.opportunity.id} className="flex flex-col gap-[10px]">
              {index > 0 ? <div className="border-t border-row" /> : null}
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <b className="block truncate">{card.donor}</b>
                  <span className="text-muted">no forward move in {card.idleDays} days</span>
                </span>
                <button
                  type="button"
                  onClick={() => onReview(card)}
                  className="shrink-0 font-semibold text-accent hover:text-accent-dark"
                >
                  Review
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="px-[2px] text-[11.5px] text-faint">
        Every ask should advance a stage — or get a decision — each quarter.
      </p>

      <div className="flex flex-col gap-[10px]">
        <button
          type="button"
          onClick={onToggleHistory}
          aria-expanded={historyOpen}
          className="flex items-center justify-between px-[2px] text-[13px] font-bold hover:text-accent"
        >
          <span>Won &amp; lost</span>
          <span className="tabular text-[12px] font-semibold text-muted">
            {historyOpen ? 'Hide' : `${history.length}`}
          </span>
        </button>

        {historyOpen ? (
          history.length === 0 ? (
            <p className="rounded-card border border-border bg-surface px-[14px] py-3 text-[12.5px] text-muted">
              No decided asks yet.
            </p>
          ) : (
            <div className="flex flex-col gap-[10px] rounded-card border border-border bg-surface px-[14px] py-3 text-[12.5px]">
              {history.map((card, index) => (
                <div key={card.opportunity.id} className="flex flex-col gap-[10px]">
                  {index > 0 ? <div className="border-t border-row" /> : null}
                  <button
                    type="button"
                    onClick={() => onReview(card)}
                    className="flex items-start justify-between gap-2 text-left"
                  >
                    <span className="min-w-0">
                      <b className="block truncate">{card.donor}</b>
                      <span className="text-muted">
                        {STATUS_LABEL[card.opportunity.status]}
                        {card.opportunity.closed_on ? ` · ${formatDate(card.opportunity.closed_on)}` : ''}
                        {card.opportunity.status === 'lost' && card.opportunity.lost_reason
                          ? ` · ${card.opportunity.lost_reason.replace(/_/g, ' ')}`
                          : ''}
                      </span>
                    </span>
                    <span className="tabular shrink-0 font-semibold text-gold">
                      {compactMoney(card.ask)}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          )
        ) : null}
      </div>
    </aside>
  )
}
