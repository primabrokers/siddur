import { cn } from '../lib/cn'
import { formatMoney, type MoneyOptions } from '../lib/format'

export interface MoneyProps extends MoneyOptions {
  amount: number | null | undefined
  /** Bold is the default in the wireframes' number lines. */
  bold?: boolean
  /** Render in ink rather than gold — for a muted secondary figure. */
  muted?: boolean
  className?: string
}

/** Amounts always render gold with `tabular-nums` (CLAUDE.md tokens). */
export function Money({ amount, bold = true, muted = false, className, ...options }: MoneyProps) {
  return (
    <span
      className={cn('tabular', muted ? 'text-muted' : 'text-gold', bold && 'font-semibold', className)}
    >
      {formatMoney(amount, options)}
    </span>
  )
}
