import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface EmptyStateProps {
  title: string
  /** Say what *would* appear here (03 §5.6). */
  hint?: ReactNode
  /** The creating action. */
  action?: ReactNode
  icon?: ReactNode
  className?: string
}

/** List empty state: what would be here, plus the action that creates it. */
export function EmptyState({ title, hint, action, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? <span className="text-faint">{icon}</span> : null}
      <h2 className="text-[15px] font-bold">{title}</h2>
      {hint ? <p className="max-w-[46ch] text-[13px] leading-[1.5] text-muted">{hint}</p> : null}
      {action ? <div className="mt-1 flex items-center gap-2">{action}</div> : null}
    </div>
  )
}

export interface RewardStateProps {
  /** Default: "Everyone's taken care of today". */
  title?: string
  hint?: ReactNode
  action?: ReactNode
  className?: string
}

/**
 * The done-for-today moment (03 §5.6) — a *reward*, not a blank. Quiet
 * visual, no confetti: the accent check mark from QuickCapture.dc.html.
 */
export function RewardState({
  title = "Everyone's taken care of today",
  hint = 'Nothing is due and nothing is overdue. Anything you add now lands in Upcoming.',
  action,
  className,
}: RewardStateProps) {
  return (
    <div
      className={cn(
        'flex grow flex-col items-center justify-center gap-[18px] rounded-card border border-border bg-surface px-8 py-16 text-center',
        className,
      )}
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft">
        <svg
          width="30"
          height="30"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#0E6E6B"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4.5 12.5 10 18 19.5 7" />
        </svg>
      </span>
      <h2 className="text-[18px] font-bold">{title}</h2>
      {hint ? <p className="max-w-[42ch] text-[13.5px] leading-[1.5] text-muted">{hint}</p> : null}
      {action ? <div className="flex items-center gap-[10px]">{action}</div> : null}
    </div>
  )
}
