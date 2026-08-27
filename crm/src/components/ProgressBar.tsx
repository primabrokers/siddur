import { cn } from '../lib/cn'

export interface ProgressBarProps {
  /** 0…1; values outside the range are clamped. */
  value: number
  /** Accessible description, e.g. "£10,000 of £25,000 paid". */
  label: string
  className?: string
}

/** The pledge-progress bar from `DonorProfile.dc.html` — 6px, accent fill. */
export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct * 100)}
      aria-label={label}
      className={cn('h-[6px] w-full overflow-hidden rounded-[3px] bg-border', className)}
    >
      <div className="h-full rounded-[3px] bg-accent" style={{ width: `${pct * 100}%` }} />
    </div>
  )
}
