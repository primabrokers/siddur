import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/cn'

/** Undo, not confirm: single-record mutations get 6 seconds (I-12, 03 §5.2). */
export const UNDO_MS = 6000

export type ToastTone = 'neutral' | 'good' | 'overdue'

export interface Toast {
  id: string
  message: ReactNode
  tone: ToastTone
  /** Present on undo toasts; the label is always "Undo". */
  onUndo?: () => void
  durationMs: number
}

export interface ToastApi {
  /** Plain notice; returns the toast id so callers can dismiss early. */
  push: (message: ReactNode, options?: { tone?: ToastTone; durationMs?: number }) => string
  dismiss: (id: string) => void
  toasts: Toast[]
}

const ToastContext = createContext<ToastApi | null>(null)

let counter = 0
const nextId = () => `t${++counter}`

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const add = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = nextId()
      setToasts((current) => [...current, { ...toast, id }])
      const timer = setTimeout(() => {
        timers.current.delete(id)
        setToasts((current) => current.filter((t) => t.id !== id))
      }, toast.durationMs)
      timers.current.set(id, timer)
      return id
    },
    [],
  )

  const push = useCallback<ToastApi['push']>(
    (message, options) =>
      add({ message, tone: options?.tone ?? 'neutral', durationMs: options?.durationMs ?? 4000 }),
    [add],
  )

  useEffect(() => {
    const map = timers.current
    return () => {
      map.forEach(clearTimeout)
      map.clear()
    }
  }, [])

  const api = useMemo<ToastApi & { add: typeof add }>(
    () => ({ push, dismiss, toasts, add }),
    [push, dismiss, toasts, add],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

function useToastInternal(): ToastApi & { add: (toast: Omit<Toast, 'id'>) => string } {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx as ToastApi & { add: (toast: Omit<Toast, 'id'>) => string }
}

export function useToast(): ToastApi {
  return useToastInternal()
}

export interface UndoAction<T> {
  /** What the toast says: "Task completed", "Gift Aid claimed". */
  message: ReactNode
  /** The optimistic mutation. Runs immediately. */
  perform: () => T | Promise<T>
  /** Reverses `perform`. Runs only if the user taps Undo within the window. */
  undo: (result: Awaited<T>) => void | Promise<void>
  /** Fires when the window closes without an undo — settle/flush point. */
  onCommit?: (result: Awaited<T>) => void
  tone?: ToastTone
  durationMs?: number
}

/**
 * The one mutation affordance (CLAUDE.md rule 4 / I-12): run the action now,
 * show a 6-second Undo toast, reverse it if the user taps Undo.
 *
 * ```ts
 * const withUndo = useUndoToast()
 * await withUndo({
 *   message: 'Task completed',
 *   perform: () => completeTask(id),
 *   undo: () => reopenTask(id),
 * })
 * ```
 */
export function useUndoToast() {
  const { add, dismiss } = useToastInternal()

  return useCallback(
    async function withUndo<T>(action: UndoAction<T>): Promise<Awaited<T>> {
      const result = (await action.perform()) as Awaited<T>
      let undone = false
      let toastId = ''

      toastId = add({
        message: action.message,
        tone: action.tone ?? 'neutral',
        durationMs: action.durationMs ?? UNDO_MS,
        onUndo: () => {
          if (undone) return
          undone = true
          dismiss(toastId)
          void action.undo(result)
        },
      })

      if (action.onCommit) {
        setTimeout(() => {
          if (!undone) action.onCommit?.(result)
        }, action.durationMs ?? UNDO_MS)
      }

      return result
    },
    [add, dismiss],
  )
}

const toneStyles: Record<ToastTone, string> = {
  neutral: 'bg-ink text-surface',
  good: 'bg-good text-surface',
  overdue: 'bg-flag-overdue text-surface',
}

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4 pb-[92px] lg:items-start lg:px-6 lg:pb-6"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-testid="toast"
          className={cn(
            'dc-fade-enter pointer-events-auto flex w-full max-w-[420px] items-center gap-4 rounded-card px-4 py-3 text-[13px] shadow-[0_3px_14px_rgba(31,41,51,.22)]',
            toneStyles[toast.tone],
          )}
        >
          <span className="min-w-0 grow">{toast.message}</span>
          {toast.onUndo ? (
            <button
              type="button"
              onClick={toast.onUndo}
              className="shrink-0 text-[13px] font-bold text-accent-soft underline underline-offset-2"
            >
              Undo
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss"
              className="shrink-0 opacity-70 hover:opacity-100"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body,
  )
}
