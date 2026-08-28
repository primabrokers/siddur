import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { MAGIC_COLUMNS, type MagicColumnId } from './magicColumns'

export interface ColumnPickerProps {
  active: MagicColumnId[]
  onChange: (ids: MagicColumnId[]) => void
}

/**
 * "+ Column" (03 §4 ▸ Streak).
 *
 * A small popover of every derived field `contact_stats` exposes. Ticking one
 * adds a read-only, sortable column to the list; the choice is remembered per
 * view (`magicColumns.ts`), so a working queue keeps the numbers it is worked
 * by without imposing them on anyone else's screen.
 */
export function ColumnPicker({ active, onChange }: ColumnPickerProps) {
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

  const toggle = (id: MagicColumnId) => {
    onChange(active.includes(id) ? active.filter((c) => c !== id) : [...active, id])
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="column-picker"
        className={cn(
          'rounded-pill border border-border px-[11px] py-[5px] text-[12px] whitespace-nowrap transition-colors',
          active.length > 0 ? 'bg-accent-soft font-semibold text-accent-dark' : 'text-muted hover:text-ink',
        )}
      >
        + Column{active.length > 0 ? ` (${active.length})` : ''}
      </button>

      {open ? (
        <div className="dc-fade-enter absolute right-0 z-40 mt-1 w-[248px] overflow-hidden rounded-card border border-border bg-surface py-1 shadow-[0_3px_14px_rgba(31,41,51,.16)]">
          <p className="px-[13px] py-[6px] text-[11px] font-semibold tracking-[.04em] text-faint uppercase">
            From contact_stats — read-only
          </p>
          {MAGIC_COLUMNS.map((column) => (
            <label
              key={column.id}
              className="flex cursor-pointer items-center gap-2 px-[13px] py-[6px] text-[13px] hover:bg-row"
            >
              <input
                type="checkbox"
                checked={active.includes(column.id)}
                onChange={() => toggle(column.id)}
                className="h-[14px] w-[14px] accent-[#0E6E6B]"
              />
              {column.label}
            </label>
          ))}
          {active.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 block w-full border-t border-border px-[13px] py-[7px] text-left text-[12.5px] text-muted hover:bg-row"
            >
              Clear all columns
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
