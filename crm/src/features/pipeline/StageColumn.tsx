import type { DragEvent, ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { compactMoney, type PipelineColumn } from './logic'

export interface StageColumnProps {
  column: PipelineColumn
  /** True while a card is in flight anywhere on the board. */
  dragging: boolean
  /** True while a card is hovering this column. */
  over: boolean
  onDragOver: (event: DragEvent<HTMLDivElement>) => void
  onDragLeave: () => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
  children: ReactNode
}

/**
 * One stage column (A5). The header carries the two things that make the board
 * a moves-management tool rather than a list: the stage's **exit criteria** —
 * what must be true to advance — and its rot threshold, both from
 * `lookup_options('opportunity_stage').meta` so an admin can retune them
 * without a deploy (I-6).
 */
export function StageColumn({
  column,
  dragging,
  over,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: StageColumnProps) {
  const { stage, cards, total } = column
  const criteria = [
    stage.exitCriteria ? `exit: ${stage.exitCriteria}` : null,
    stage.rotDays === null ? null : `rot ${stage.rotDays}d`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section
      aria-label={`${stage.label} — ${cards.length} ${cards.length === 1 ? 'ask' : 'asks'}`}
      className="flex w-[228px] shrink-0 flex-col gap-[10px]"
    >
      <header className="flex flex-col gap-[2px] px-[2px]">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-bold">{stage.label}</h2>
          <span className="tabular text-[12px] text-muted">{total > 0 ? compactMoney(total) : '—'}</span>
        </div>
        {criteria ? (
          <p className="line-clamp-2 text-[11px] leading-[1.35] text-faint" title={criteria}>
            {criteria}
          </p>
        ) : null}
      </header>

      <div
        data-testid={`stage-dropzone-${stage.value}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          'flex min-h-[120px] grow flex-col gap-[10px] rounded-card border border-transparent p-[2px] transition-colors',
          dragging && 'border-dashed border-border bg-surface/40',
          over && 'border-accent bg-accent-soft/60',
        )}
      >
        {children}
        {cards.length === 0 && !dragging ? (
          <p className="px-1 py-3 text-[11.5px] text-faint">Nothing here yet.</p>
        ) : null}
      </div>
    </section>
  )
}
