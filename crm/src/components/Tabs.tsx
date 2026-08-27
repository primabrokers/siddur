import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface TabItem<T extends string = string> {
  id: T
  label: string
}

export interface TabsProps<T extends string = string> {
  items: Array<TabItem<T>>
  active: T
  onChange: (id: T) => void
  /** Right-aligned slot on the tab rail — the timeline's filter chips. */
  trailing?: ReactNode
  className?: string
  'aria-label'?: string
}

/** The underlined tab rail from `DonorProfile.dc.html` (Timeline/Giving/Details). */
export function Tabs<T extends string = string>({
  items,
  active,
  onChange,
  trailing,
  className,
  'aria-label': ariaLabel,
}: TabsProps<T>) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1 border-b border-border', className)}>
      <div role="tablist" aria-label={ariaLabel} className="flex min-w-0 items-center">
        {items.map((item) => {
          const selected = item.id === active
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(item.id)}
              className={cn(
                'min-h-[44px] px-[14px] py-2 text-[13.5px] transition-colors',
                selected
                  ? 'border-b-2 border-accent font-semibold text-accent-dark'
                  : 'border-b-2 border-transparent text-muted hover:text-ink',
              )}
            >
              {item.label}
            </button>
          )
        })}
      </div>
      {trailing ? <div className="ml-auto flex items-center gap-[6px] py-1">{trailing}</div> : null}
    </div>
  )
}

export interface FilterChipProps {
  active?: boolean
  onClick: () => void
  children: ReactNode
  className?: string
}

/** The `All · Conversations · Giving · Notes` chips. */
export function FilterChip({ active = false, onClick, children, className }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-pill px-[10px] py-[3px] text-[12px] whitespace-nowrap transition-colors',
        active
          ? 'bg-accent-soft font-semibold text-accent-dark'
          : 'border border-border text-muted hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  )
}
