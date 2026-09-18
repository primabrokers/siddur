import { format, isToday, isYesterday } from 'date-fns'
import { Avatar, EmptyState, Pill } from '../../components'
import { cn } from '../../lib/cn'
import { displayName } from '../contacts/normalise'
import type { WaConversationItem } from './types'

export interface ConversationListProps {
  items: WaConversationItem[]
  activeId: string | null
  onOpen: (item: WaConversationItem) => void
  isLoading?: boolean
}

/** Threads are read at a glance: the hour today, the day this week, else the date. */
export function listTime(value: string | null): string {
  if (!value) return ''
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return ''
  if (isToday(at)) return format(at, 'HH:mm')
  if (isYesterday(at)) return 'Yesterday'
  return format(at, 'd MMM')
}

/**
 * The window dot. Green while free-form is permitted, grey once it is not —
 * the one thing a fundraiser must be able to see *before* they start typing,
 * because it decides whether a reply is a sentence or a template (10 §2).
 */
export function WindowDot({ open, title }: { open: boolean; title: string }) {
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={cn('inline-block h-[8px] w-[8px] shrink-0 rounded-full', open ? 'bg-good' : 'bg-faint')}
    />
  )
}

/** The name we have: the donor's, else their WhatsApp profile name, else the number. */
export function conversationTitle(item: WaConversationItem): string {
  if (item.contact) return displayName(item.contact)
  return item.conversation.profile_name?.trim() || item.conversation.wa_id
}

export function ConversationList({ items, activeId, onOpen, isLoading = false }: ConversationListProps) {
  if (isLoading) {
    return <p className="px-3 py-4 text-[12.5px] text-muted">Loading conversations…</p>
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No WhatsApp conversations"
        hint="Messages donors send to the business number land here. Until then, the wa.me link on a profile opens WhatsApp and Quick Capture logs what was said."
        className="m-3"
      />
    )
  }

  return (
    <ul className="flex flex-col" aria-label="WhatsApp conversations">
      {items.map((item) => {
        const active = item.conversation.id === activeId
        const unread = item.conversation.unread_count
        const title = conversationTitle(item)
        return (
          <li key={item.conversation.id}>
            <button
              type="button"
              onClick={() => onOpen(item)}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'flex w-full items-start gap-3 border-b border-border px-3 py-[10px] text-left transition-colors',
                active ? 'bg-accent-soft' : 'bg-surface hover:bg-ground',
              )}
            >
              <Avatar name={title} size="md" tone={item.contact ? 'accent' : 'neutral'} />
              <span className="min-w-0 grow">
                <span className="flex items-center gap-[6px]">
                  <WindowDot
                    open={item.window.open}
                    title={
                      item.window.open
                        ? 'Inside the 24-hour window — you can reply freely'
                        : '24-hour window closed — approved templates only'
                    }
                  />
                  <span className={cn('min-w-0 truncate text-[13.5px]', unread > 0 ? 'font-bold' : 'font-semibold')}>
                    {title}
                  </span>
                  {item.contact ? null : (
                    <Pill variant="computed" tone="neutral">
                      Unmatched
                    </Pill>
                  )}
                </span>
                <span className="mt-[2px] block truncate text-[12.5px] text-muted">{item.snippet}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-[4px]">
                <span className="text-[11.5px] text-faint tabular-nums">{listTime(item.at)}</span>
                {unread > 0 ? (
                  <span
                    aria-label={`${unread} unread`}
                    className="min-w-[18px] rounded-pill bg-accent px-[6px] py-[1px] text-center text-[11px] font-bold text-surface tabular-nums"
                  >
                    {unread}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
