import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'

export interface CommandDialogProps {
  open: boolean
  onClose: () => void
  /** Accessible name — "Search" / "Commands". */
  title: string
  /** The single text input; owned by the caller so it can drive the list. */
  input: ReactNode
  children?: ReactNode
  footer?: ReactNode
  className?: string
}

/**
 * The overlay shell shared by global search ("/") and the command palette
 * (Cmd/Ctrl+K) — 03 §3.
 *
 * Deliberately *not* `components/Sheet`: a sheet rises from the bottom and
 * traps focus for a form. A command surface hangs from the top of the window,
 * keeps the caret in one field the whole time, and is dismissed by Escape or a
 * click outside. Arrow-key navigation stays with the caller, because the list
 * it moves through differs (people vs actions).
 */
export function CommandDialog({
  open,
  onClose,
  title,
  input,
  children,
  footer,
  className,
}: CommandDialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()

  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    },
    [onClose],
  )

  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.addEventListener('keydown', handleKey, true)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey, true)
      document.body.style.overflow = previousOverflow
      returnFocusRef.current?.focus?.()
    }
  }, [open, handleKey])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[8vh] sm:pt-[12vh]">
      <div
        className="dc-fade-enter absolute inset-0 bg-ink/35"
        onClick={onClose}
        aria-hidden="true"
        data-testid="command-backdrop"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'dc-fade-enter relative flex max-h-[76vh] w-full max-w-[640px] flex-col overflow-hidden rounded-card-lg border border-border bg-surface shadow-[0_8px_40px_rgba(31,41,51,.22)]',
          className,
        )}
      >
        <h2 id={titleId} className="sr-only">
          {title}
        </h2>
        <div className="border-b border-border px-4 py-3">{input}</div>
        <div className="min-h-0 grow overflow-y-auto p-2">{children}</div>
        {footer ? (
          <div className="border-t border-border bg-ground px-4 py-2 text-[11.5px] text-faint">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

/** `↑ ↓ to move · ↵ to open · esc to close` — the hint rail both surfaces show. */
export function KeyHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-[5px]">
      <kbd className="rounded-[4px] border border-border bg-surface px-[5px] py-[1px] font-sans text-[10.5px] text-muted">
        {keys}
      </kbd>
      {label}
    </span>
  )
}
