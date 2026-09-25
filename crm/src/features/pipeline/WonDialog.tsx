import { Button, Sheet } from '../../components'
import { formatMoney } from '../../lib/format'
import type { PipelineCard } from './logic'

export interface WonDialogProps {
  card: PipelineCard | null
  onClose: () => void
  /** Deep links into the Giving screen's entry sheets (05 §1/§2). */
  onRecord: (what: 'gift' | 'pledge') => void
}

/**
 * Won → "prompts pledge or gift entry" (06 §2 · 07 §9.4).
 *
 * The pipeline's job ends at the decision; the money is the ledger's (05). The
 * prompt is a fork, not a form — it hands over to the gift or pledge sheet
 * rather than duplicating either of them here.
 */
export function WonDialog({ card, onClose, onRecord }: WonDialogProps) {
  if (!card) return null

  return (
    <Sheet
      open
      onClose={onClose}
      width={440}
      title="Won — now record it"
      leading={
        <button type="button" onClick={onClose} className="text-muted hover:text-ink">
          Later
        </button>
      }
      footer={
        <div className="flex gap-2">
          <Button variant="outline" className="grow" onClick={() => onRecord('pledge')}>
            Record a pledge
          </Button>
          <Button className="grow" onClick={() => onRecord('gift')}>
            Record the gift
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-[13px] leading-[1.5] text-nav">
        <p>
          <b>{card.donor}</b> said yes to {card.opportunity.name} — {formatMoney(card.ask)}.
        </p>
        <p className="text-muted">
          A gift if the money has arrived, a pledge if it is promised over time. The ask stays on the
          board as won either way; the thank-you and the receipt follow the gift automatically (05 §3).
        </p>
      </div>
    </Sheet>
  )
}
