import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export type NudgeAccent = 'accent' | 'overdue' | 'today' | 'gold' | 'none'

const borders: Record<NudgeAccent, string> = {
  accent: 'border-l-[3px] border-l-accent',
  overdue: 'border-l-[3px] border-l-flag-overdue',
  today: 'border-l-[3px] border-l-flag-today',
  gold: 'border-l-[3px] border-l-gold',
  none: '',
}

const titleTones: Record<NudgeAccent, string> = {
  accent: 'text-accent-dark',
  overdue: 'text-flag-overdue',
  today: 'text-flag-today-ink',
  gold: 'text-gold',
  none: 'text-muted',
}

export interface NudgeCardProps {
  /** `FIRST GIFT THIS WEEK` — reason headline, uppercase 12px. */
  title: string
  /** The reason in words ("No contact in 92 days — VIP"). */
  children: ReactNode
  accent?: NudgeAccent
  /** Two buttons (act / snooze) plus dismiss — supplied by the caller. */
  actions?: ReactNode
  /** "Why am I seeing this" copy, shown on hover (03 §5.7). */
  why?: string
  className?: string
}

/** Action Stream rail card (03 §6). Nothing auto-dismisses (03 §5.3). */
export function NudgeCard({ title, children, accent = 'accent', actions, why, className }: NudgeCardProps) {
  return (
    <section
      title={why}
      className={cn(
        'flex flex-col gap-2 rounded-card border border-border bg-surface px-[14px] py-3',
        borders[accent],
        className,
      )}
    >
      <h3 className={cn('text-[12px] font-bold tracking-[0.03em] uppercase', titleTones[accent])}>{title}</h3>
      <div className="text-[13px] leading-[1.45]">{children}</div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </section>
  )
}
