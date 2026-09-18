import { Fragment } from 'react'
import { format, isSameDay, isToday, isYesterday } from 'date-fns'
import { cn } from '../../lib/cn'
import { WA_STATUS_LABEL } from './core'
import type { WaMessageRow } from './types'

export interface ThreadProps {
  messages: WaMessageRow[]
  isLoading?: boolean
}

/** Day separators: "Today", "Yesterday", then the written date. */
export function daySeparatorLabel(value: string): string {
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return ''
  if (isToday(at)) return 'Today'
  if (isYesterday(at)) return 'Yesterday'
  return format(at, 'EEEE d MMMM')
}

/**
 * Delivery ticks. One for sent, two for delivered, two accent-coloured for
 * read — the convention every WhatsApp user already knows, so it needs no
 * legend. A failure is words, not a glyph: it needs to be read.
 */
export function Ticks({ status }: { status: WaMessageRow['status'] }) {
  if (status === 'failed') {
    return <span className="text-[11px] font-semibold text-flag-overdue">Failed</span>
  }
  const doubled = status === 'delivered' || status === 'read'
  return (
    <span
      aria-label={WA_STATUS_LABEL[status]}
      title={WA_STATUS_LABEL[status]}
      className={cn('text-[11px] leading-none', status === 'read' ? 'text-accent' : 'text-faint')}
    >
      {doubled ? '✓✓' : '✓'}
    </span>
  )
}

function MediaLine({ message }: { message: WaMessageRow }) {
  const label = message.media_mime ?? 'attachment'
  // Media is held by reference (012): we store Meta's media id, never the file.
  // A resolved URL is rendered as a link when one exists; otherwise the chip is
  // honest that the file lives in WhatsApp.
  if (message.media_url) {
    return (
      <a
        href={message.media_url}
        target="_blank"
        rel="noreferrer"
        className="mt-1 inline-flex items-center gap-[6px] rounded-input border border-border bg-surface px-2 py-1 text-[12px] font-semibold text-accent"
      >
        📎 {label}
      </a>
    )
  }
  return (
    <span className="mt-1 inline-flex items-center gap-[6px] rounded-input border border-dashed border-border px-2 py-1 text-[11.5px] text-muted">
      📎 {label} · open in WhatsApp
    </span>
  )
}

export function Thread({ messages, isLoading = false }: ThreadProps) {
  if (isLoading) return <p className="px-4 py-6 text-[12.5px] text-muted">Loading messages…</p>
  if (messages.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[12.5px] text-muted">
        No messages in this conversation yet.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-[6px] px-4 py-4" aria-label="WhatsApp messages">
      {messages.map((message, index) => {
        const previous = messages[index - 1]
        const newDay =
          !previous || !isSameDay(new Date(previous.occurred_at), new Date(message.occurred_at))
        const outbound = message.direction === 'out'
        return (
          <Fragment key={message.id}>
            {newDay ? (
              <div className="my-2 flex items-center justify-center">
                <span className="rounded-pill bg-row px-[10px] py-[3px] text-[11px] font-semibold text-muted">
                  {daySeparatorLabel(message.occurred_at)}
                </span>
              </div>
            ) : null}
            <div className={cn('flex', outbound ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[78%] rounded-card px-3 py-2 text-[13px] leading-[1.45]',
                  outbound ? 'bg-accent-soft text-ink' : 'border border-border bg-surface text-ink',
                )}
              >
                {message.msg_type === 'template' ? (
                  <span className="mb-[3px] block text-[11px] font-bold uppercase tracking-[0.04em] text-accent-dark">
                    Template · {message.template_name ?? 'approved'}
                  </span>
                ) : null}
                {message.body ? <span className="whitespace-pre-wrap">{message.body}</span> : null}
                {message.msg_type === 'media' ? <MediaLine message={message} /> : null}
                {message.error_detail ? (
                  <span className="mt-1 block text-[11.5px] text-flag-overdue">{message.error_detail}</span>
                ) : null}
                <span className="mt-[3px] flex items-center justify-end gap-[6px] text-[11px] text-faint">
                  <span className="tabular-nums">{format(new Date(message.occurred_at), 'HH:mm')}</span>
                  {outbound ? <Ticks status={message.status} /> : null}
                </span>
              </div>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
