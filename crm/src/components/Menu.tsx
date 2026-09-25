import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface MenuItem {
  id: string
  label: string
  onSelect: () => void
  tone?: 'default' | 'danger'
  disabled?: boolean
}

export interface MenuProps {
  /** The trigger's content — usually `⋯`. */
  trigger: ReactNode
  label: string
  items: MenuItem[]
  className?: string
  triggerClassName?: string
}

/**
 * Small overflow menu (the profile header's `⋯`). Closes on Esc, on outside
 * click and after a selection.
 */
export function Menu({ trigger, label, items, className, triggerClassName }: MenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex min-h-[36px] items-center justify-center rounded-input border border-border bg-surface px-[11px] text-[12.5px] font-bold text-nav hover:border-faint',
          triggerClassName,
        )}
      >
        {trigger}
      </button>
      {open ? (
        <div
          role="menu"
          className="dc-fade-enter absolute right-0 z-40 mt-1 min-w-[190px] overflow-hidden rounded-card border border-border bg-surface py-1 shadow-[0_3px_14px_rgba(31,41,51,.16)]"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className={cn(
                'block w-full px-[14px] py-[9px] text-left text-[13px] hover:bg-row disabled:cursor-not-allowed disabled:opacity-50',
                item.tone === 'danger' ? 'text-flag-overdue' : 'text-nav',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
