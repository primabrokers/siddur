import type { DragEvent } from 'react'
import { FlagDot } from '../../components'
import { cn } from '../../lib/cn'
import { cardSummary, compactMoney, nextMoveWhen, type PipelineCard } from './logic'

/** The next-move line's colour — the flag language in words (03 §2). */
const MOVE_TONE: Record<string, string> = {
  overdue: 'text-[#B03030]',
  today: 'text-nav',
  none: 'text-[#B08A00]',
  waiting: 'text-flag-waiting',
  future: 'text-nav',
  queued: 'text-muted',
}

export interface OpportunityCardProps {
  card: PipelineCard
  /** Drag is a pointer affordance; the sheet's stage select is the keyboard one. */
  draggable?: boolean
  onDragStart?: (event: DragEvent<HTMLElement>) => void
  onDragEnd?: () => void
  onOpen?: () => void
  /** Dimmed while it is the card being dragged. */
  dragging?: boolean
}

/**
 * One ask on the board (A5): donor, amount, probability, expected decision, the
 * flag, and the next move — the linked task (02 §3.9).
 *
 * Rotting is ambient and nothing else: a pink wash and a line of explanation,
 * no badge, no notification (06 §2 ▸ Pipedrive).
 */
export function OpportunityCard({
  card,
  draggable = true,
  onDragStart,
  onDragEnd,
  onOpen,
  dragging,
}: OpportunityCardProps) {
  const { opportunity, donor, nextMove, flag, rotting } = card

  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      data-testid={`opportunity-card-${opportunity.id}`}
      data-flag={flag}
      data-rotting={rotting ? 'true' : 'false'}
      aria-label={`${donor} — ${opportunity.name}`}
      className={cn(
        'flex w-full flex-col gap-[6px] rounded-card border p-3 text-left transition-shadow',
        rotting ? 'border-[#ECC7C7] bg-[#FDF0F0]' : 'border-border bg-surface',
        dragging ? 'opacity-40' : 'hover:shadow-[0_2px_10px_rgba(31,41,51,.10)]',
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
      )}
    >
      <span className="flex items-center gap-2">
        <FlagDot variant={flag} size={8} />
        <span className="min-w-0 truncate text-[13.5px] font-semibold">{donor}</span>
        <span className="ml-auto shrink-0 tabular text-[13px] font-bold text-gold">
          {compactMoney(card.ask)}
        </span>
      </span>

      <span className="text-[12px] text-muted">{cardSummary(opportunity)}</span>

      {rotting ? (
        <span className="text-[12px] text-[#B03030]">
          Rotting — idle {card.daysInStage} days in stage
        </span>
      ) : null}

      <span className={cn('text-[12px]', MOVE_TONE[flag] ?? 'text-nav')}>
        {nextMove === null ? (
          'No next move — decide one'
        ) : nextMove.status === 'waiting' ? (
          <>Waiting — {nextMove.title}</>
        ) : (
          <>
            Next: {nextMove.title} — {nextMoveWhen(nextMove)}
          </>
        )}
      </span>
    </button>
  )
}
