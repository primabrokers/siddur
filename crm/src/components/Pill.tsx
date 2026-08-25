import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

/**
 * Status pills (03 §2, I-7).
 *
 * - `manual` (stage, priority, pledge state) — **filled**, editable in place.
 * - `computed` (donor status, engagement tier, days-since) — **outlined**,
 *   read-only, with a lock glyph on hover so the difference is legible.
 */
export type PillVariant = 'manual' | 'computed'
export type PillTone = 'neutral' | 'accent' | 'waiting' | 'gold' | 'good' | 'overdue' | 'today'

const manualTones: Record<PillTone, string> = {
  neutral: 'bg-row text-nav',
  accent: 'bg-accent-soft text-accent-dark',
  waiting: 'bg-flag-waiting-bg text-flag-waiting',
  gold: 'bg-[#F7F1E2] text-gold',
  good: 'bg-good-bg text-good',
  overdue: 'bg-[#FBECEC] text-flag-overdue',
  today: 'bg-[#FCF0E3] text-flag-today-ink',
}

const computedTones: Record<PillTone, string> = {
  neutral: 'border border-chip-border text-muted',
  accent: 'border border-accent text-accent-dark',
  waiting: 'border border-flag-waiting text-flag-waiting',
  gold: 'border border-[#C9BC96] text-gold',
  good: 'border border-good text-good',
  overdue: 'border border-flag-overdue text-flag-overdue',
  today: 'border border-flag-today text-flag-today-ink',
}

export interface PillProps {
  children: ReactNode
  /** Default `computed` — read-only is the safe assumption (I-7). */
  variant?: PillVariant
  tone?: PillTone
  /** Only meaningful for `manual` pills; makes the pill a button. */
  onClick?: () => void
  title?: string
  className?: string
}

export function Pill({ children, variant = 'computed', tone = 'neutral', onClick, title, className }: PillProps) {
  const isComputed = variant === 'computed'
  const base = cn(
    'group inline-flex items-center gap-1 rounded-pill px-[9px] py-[3px] text-[11.5px] leading-[1.35] whitespace-nowrap',
    isComputed ? computedTones[tone] : cn(manualTones[tone], 'font-semibold'),
    className,
  )

  const lock = isComputed ? (
    <svg
      width="9"
      height="9"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="opacity-0 transition-opacity group-hover:opacity-70"
    >
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" />
    </svg>
  ) : null

  if (onClick && !isComputed) {
    return (
      <button type="button" onClick={onClick} title={title} className={cn(base, 'cursor-pointer hover:opacity-85')}>
        {children}
      </button>
    )
  }

  return (
    <span
      title={title ?? (isComputed ? 'Computed — read-only' : undefined)}
      data-pill={variant}
      className={base}
    >
      {children}
      {lock}
    </span>
  )
}
