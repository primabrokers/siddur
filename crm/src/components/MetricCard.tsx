import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export type MetricTone = 'ink' | 'overdue' | 'today' | 'gold' | 'good' | 'accent'

const valueTones: Record<MetricTone, string> = {
  ink: 'text-ink',
  overdue: 'text-flag-overdue',
  today: 'text-flag-today-ink',
  gold: 'text-gold',
  good: 'text-good',
  accent: 'text-accent-dark',
}

export interface MetricCardProps {
  /** `DUE TODAY` — rendered uppercase at 11.5px. */
  label: string
  value: ReactNode
  /** Small trailing note on the value baseline, e.g. `sector ≈43%`. */
  caption?: ReactNode
  tone?: MetricTone
  /** Optional leading visual (the progress ring in the wireframe). */
  leading?: ReactNode
  onClick?: () => void
  className?: string
}

/** The only dashboard-card mechanism (03 §6): a label, a number, a caption. */
export function MetricCard({ label, value, caption, tone = 'ink', leading, onClick, className }: MetricCardProps) {
  const body = (
    <>
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0">
        <div className="text-[11.5px] font-semibold text-muted uppercase">{label}</div>
        <div className="flex items-baseline gap-2">
          <span className={cn('tabular text-[26px] leading-tight font-bold', valueTones[tone])}>{value}</span>
          {caption ? <span className="text-[11.5px] font-medium text-muted">{caption}</span> : null}
        </div>
      </div>
    </>
  )

  const classes = cn(
    'flex items-center gap-3 rounded-card border border-border bg-surface px-[14px] py-3 text-left',
    onClick && 'cursor-pointer hover:border-accent',
    className,
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {body}
      </button>
    )
  }

  return <div className={classes}>{body}</div>
}
