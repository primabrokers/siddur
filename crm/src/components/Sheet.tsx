import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/cn'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface SheetProps {
  open: boolean
  onClose: () => void
  /** Rendered in the header centre; also labels the dialog for assistive tech. */
  title: ReactNode
  /** Header left slot — usually "Cancel"/"Back". */
  leading?: ReactNode
  /** Header right slot. */
  trailing?: ReactNode
  /** Pinned footer (the big primary action in QuickCapture.dc.html). */
  footer?: ReactNode
  children?: ReactNode
  /** Desktop modal width. Default 480px. */
  width?: number
  className?: string
}

/**
 * One dialog surface: a bottom sheet under `lg`, a centred modal at `lg`+.
 * Esc closes, the backdrop closes, focus is trapped inside and restored on
 * close. Confirm dialogs are rare by design (I-12) — this mostly carries
 * capture, follow-up prompts and pickers.
 */
export function Sheet({
  open,
  onClose,
  title,
  leading,
  trailing,
  footer,
  children,
  width = 480,
  className,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  // The trap effect must run only on open/close: an inline onClose changes
  // identity on every parent render, and re-running the effect steals focus
  // from whatever field the user is typing in.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const focusables = useCallback((): HTMLElement[] => {
    const panel = panelRef.current
    if (!panel) return []
    return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    )
  }, [])

  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const panel = panelRef.current
    const first = focusables()[0]
    ;(first ?? panel)?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        event.preventDefault()
        panelRef.current?.focus()
        return
      }
      const firstItem = items[0] as HTMLElement
      const lastItem = items[items.length - 1] as HTMLElement
      const active = document.activeElement
      if (event.shiftKey && (active === firstItem || active === panelRef.current)) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      returnFocusRef.current?.focus?.()
    }
  }, [open, focusables])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center">
      <div
        className="dc-fade-enter absolute inset-0 bg-ink/35"
        onClick={onClose}
        aria-hidden="true"
        data-testid="sheet-backdrop"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ maxWidth: width }}
        className={cn(
          'dc-sheet-enter relative flex max-h-[92vh] w-full flex-col overflow-hidden bg-surface shadow-[0_2px_20px_rgba(31,41,51,.18)]',
          'rounded-t-sheet lg:rounded-sheet',
          className,
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 pt-[18px] pb-3">
          <span className="min-w-[56px] text-[14px] text-muted">{leading}</span>
          <h2 id={titleId} className="text-[15px] font-bold">
            {title}
          </h2>
          <span className="flex min-w-[56px] justify-end text-[14px] text-faint">
            {trailing ?? (
              <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-ink">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            )}
          </span>
        </header>

        <div className="min-h-0 grow overflow-y-auto px-5 py-4">{children}</div>

        {footer ? <footer className="border-t border-border px-5 py-4 pb-safe lg:pb-4">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  )
}
