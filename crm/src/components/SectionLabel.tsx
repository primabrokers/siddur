import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export type SectionLabelTone = 'muted' | 'overdue' | 'today' | 'none' | 'accent' | 'faint'

const tones: Record<SectionLabelTone, string> = {
  muted: 'text-muted',
  faint: 'text-faint',
  overdue: 'text-flag-overdue',
  today: 'text-flag-today-ink',
  none: 'text-flag-none-ink',
  accent: 'text-accent-dark',
}

export interface SectionLabelProps {
  children: ReactNode
  tone?: SectionLabelTone
  /** Right-hand affordance, e.g. "Reschedule all ▾". */
  action?: ReactNode
  className?: string
  as?: 'div' | 'h2' | 'h3'
}

/** 11.5px uppercase letterspaced group heading — `OVERDUE · 4`, `PINNED VIEWS`. */
export function SectionLabel({ children, tone = 'muted', action, className, as: Tag = 'div' }: SectionLabelProps) {
  const label = (
    <Tag className={cn('text-[11.5px] font-bold tracking-[0.07em] uppercase', tones[tone], !action && className)}>
      {children}
    </Tag>
  )

  if (!action) return label

  return (
    <div className={cn('flex items-center gap-[10px]', className)}>
      {label}
      {action}
    </div>
  )
}
