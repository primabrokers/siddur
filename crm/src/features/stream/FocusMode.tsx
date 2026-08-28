import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'
import { Avatar, Button, Menu, Pill } from '../../components'
import { formatDayCount, formatDate } from '../../lib/format'
import { useCapture } from '../capture/QuickCapture'
import { waNumber } from '../contacts/normalise'
import type { StreamRowModel } from './grouping'

export interface FocusModeProps {
  /** The queue: the current Today sections, in their stream order. */
  rows: StreamRowModel[]
  stageLabels?: Record<string, string>
  onComplete: (row: StreamRowModel) => void
  onSnooze: (row: StreamRowModel, days: number) => void
  onClose: () => void
}

/**
 * "Start my day" (04 §2) — one person at a time, full context, no navigation.
 * Done runs close-the-loop and advances; Skip leaves the task untouched.
 * Keyboard: D done · S snooze a week · K skip · Esc exits.
 */
export function FocusMode({ rows, stageLabels = {}, onComplete, onSnooze, onClose }: FocusModeProps) {
  const [index, setIndex] = useState(0)
  const { openCapture } = useCapture()
  const row = rows[index]

  const advance = useCallback(() => {
    setIndex((current) => {
      const next = current + 1
      if (next >= rows.length) {
        onClose()
        return current
      }
      return next
    })
  }, [rows.length, onClose])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return onClose()
      if (!row) return
      const key = event.key.toLowerCase()
      if (key === 'd') {
        onComplete(row)
        advance()
      } else if (key === 'k') {
        advance()
      } else if (key === 's') {
        onSnooze(row, 7)
        advance()
      } else if (key === 'q') {
        openCapture()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [row, advance, onClose, onComplete, onSnooze, openCapture])

  if (typeof document === 'undefined' || !row) return null

  const contact = row.contact
  const wa = waNumber(contact?.whatsapp ?? contact?.phone)

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Focus mode"
      className="fixed inset-0 z-50 flex flex-col bg-ground"
      data-testid="focus-mode"
    >
      <header className="flex items-center justify-between border-b border-border bg-surface px-5 py-3">
        <span className="tabular text-[13px] font-semibold text-muted">
          {index + 1} of {rows.length}
        </span>
        <span className="text-[13px] font-bold">Start my day</span>
        <button type="button" onClick={onClose} className="text-[13px] text-muted hover:text-ink">
          Esc — exit
        </button>
      </header>

      <div className="flex min-h-0 grow flex-col gap-5 overflow-y-auto p-5 lg:flex-row lg:p-8">
        <section className="flex min-w-0 grow flex-col gap-3">
          <div className="flex items-center gap-3">
            <Avatar name={row.name} size="xl" />
            <div className="min-w-0">
              <Link to={`/contacts/${row.contactId}`} className="text-[20px] font-bold text-ink hover:underline">
                {row.name}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-[6px]">
                {contact?.stage ? (
                  <Pill variant="manual" tone="accent">
                    {stageLabels[contact.stage] ?? contact.stage.replace(/_/g, ' ')}
                  </Pill>
                ) : null}
                {row.stats?.days_since_contact !== null && row.stats?.days_since_contact !== undefined ? (
                  <Pill>{formatDayCount(row.stats.days_since_contact)} since contact</Pill>
                ) : null}
                {row.stats?.last_gift_on ? <Pill>Last gift {formatDate(row.stats.last_gift_on)}</Pill> : null}
              </div>
            </div>
          </div>

          {contact?.things_to_remember ? (
            <p className="rounded-card border border-border bg-accent-soft px-[14px] py-3 text-[13px] text-accent-dark">
              {contact.things_to_remember}
            </p>
          ) : null}

          {contact?.best_time_to_contact ? (
            <p className="text-[13px] text-muted">Best time: {contact.best_time_to_contact}</p>
          ) : null}
        </section>

        <section className="flex w-full shrink-0 flex-col gap-3 lg:w-[360px]">
          <div className="rounded-card border border-border bg-surface px-[14px] py-3">
            <div className="text-[11.5px] font-bold tracking-[0.07em] text-muted uppercase">The task</div>
            <p className="mt-1 text-[14px] font-semibold">{row.task?.title ?? row.line}</p>
            <p className="text-[12.5px] text-muted">{row.line}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {contact?.phone ? (
              <a
                href={`tel:${contact.phone}`}
                className="inline-flex items-center justify-center rounded-input bg-accent px-[14px] py-3 text-[14px] font-semibold text-surface"
              >
                Call
              </a>
            ) : null}
            {wa ? (
              <a
                href={`https://wa.me/${wa}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center rounded-input border border-accent px-[14px] py-3 text-[14px] font-semibold text-accent"
              >
                WhatsApp
              </a>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => {
                onComplete(row)
                advance()
              }}
            >
              Done (D)
            </Button>
            <Button variant="outline" onClick={advance}>
              Skip (K)
            </Button>
            <Menu
              label="Snooze this task"
              trigger="Snooze (S)"
              items={[
                { id: 'tomorrow', label: 'Tomorrow', onSelect: () => { onSnooze(row, 1); advance() } },
                { id: 'week', label: 'Next week', onSelect: () => { onSnooze(row, 7); advance() } },
              ]}
            />
            <Button variant="ghost" onClick={openCapture}>
              Log it (Q)
            </Button>
          </div>
        </section>
      </div>
    </div>,
    document.body,
  )
}
