import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface TimelineEntryProps {
  /** Icon by kind (meeting / call / WhatsApp / donation / document). */
  icon?: ReactNode
  /** Bold head of the meta line: `Meeting · 11 Aug 2026`. */
  title: ReactNode
  /** Rest of the meta line: author, source label, fund/appeal. */
  meta?: ReactNode
  /** The summary body. */
  children?: ReactNode
  /** Outcome / next-step line under the body. */
  outcome?: ReactNode
  /** Expandable detail slot (rendered under everything, caller controls state). */
  detail?: ReactNode
  className?: string
}

/** Profile timeline row (03 §6): icon · date · summary · outcome · source. */
export function TimelineEntry({ icon, title, meta, children, outcome, detail, className }: TimelineEntryProps) {
  return (
    <article className={cn('flex gap-3 rounded-card border border-border bg-surface px-[14px] py-3', className)}>
      {icon ? <span className="mt-[2px] shrink-0 text-accent">{icon}</span> : null}
      <div className="flex min-w-0 flex-col gap-[3px]">
        <div className="text-[12px] text-muted">
          <b className="font-semibold text-ink">{title}</b>
          {meta ? <> · {meta}</> : null}
        </div>
        {children ? <div className="text-[13.5px] leading-[1.45]">{children}</div> : null}
        {outcome ? <div className="text-[12.5px] text-muted">{outcome}</div> : null}
        {detail}
      </div>
    </article>
  )
}
