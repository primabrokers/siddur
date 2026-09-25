import { cn } from '../lib/cn'

/**
 * The one flag language (03 §2). Every surface that shows relationship/task
 * health uses these six values and nothing else.
 *
 * The variant must come from `contact_stats` / the task row — never recomputed
 * in the client (I-8/I-9).
 */
export type FlagVariant = 'overdue' | 'today' | 'none' | 'waiting' | 'future' | 'queued'

/** Sort order wherever flags sort a list: red → orange → yellow → blue → grey.
 *  Yellow ranks *worse* than grey — Pipedrive's insight, kept intact (I-3). */
export const FLAG_ORDER: Record<FlagVariant, number> = {
  overdue: 0,
  today: 1,
  none: 2,
  waiting: 3,
  future: 4,
  queued: 5,
}

export const FLAG_LABEL: Record<FlagVariant, string> = {
  overdue: 'Next action overdue',
  today: 'Next action due today',
  none: 'No next action',
  waiting: 'Waiting on them',
  future: 'Future action scheduled',
  queued: 'Queued action only',
}

const fills: Record<FlagVariant, string> = {
  overdue: 'bg-flag-overdue',
  today: 'bg-flag-today',
  none: 'bg-flag-none',
  waiting: 'bg-flag-waiting',
  future: 'bg-flag-future',
  // Queued = dateless behind the current one: a dashed ring, no fill.
  queued: 'bg-transparent border border-dashed border-flag-future',
}

export interface FlagDotProps {
  variant: FlagVariant
  /** 9px on desktop rows, 8px on mobile rows — both from the wireframes. */
  size?: 8 | 9 | 10
  className?: string
  /** Suppress the tooltip/label when a nearby caption already says it. */
  labelled?: boolean
}

export function FlagDot({ variant, size = 9, className, labelled = true }: FlagDotProps) {
  const px = variant === 'queued' ? size + 2 : size
  return (
    <span
      role="img"
      aria-label={labelled ? FLAG_LABEL[variant] : undefined}
      aria-hidden={labelled ? undefined : true}
      title={labelled ? FLAG_LABEL[variant] : undefined}
      data-flag={variant}
      style={{ width: px, height: px }}
      className={cn('inline-block shrink-0 rounded-full', fills[variant], className)}
    />
  )
}
