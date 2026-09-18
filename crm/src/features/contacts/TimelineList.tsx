import type { ReactNode } from 'react'
import {
  EmptyState,
  IconCheck,
  IconContacts,
  IconGiving,
  IconNote,
  IconPhone,
  IconWhatsApp,
  Money,
  TimelineEntry,
} from '../../components'
import { cn } from '../../lib/cn'
import { formatDate, formatDayHeading, formatTime, toDate } from '../../lib/format'
import { isPastDay } from '../../lib/dates'
import type { TimelineItem, UpcomingItem } from './timeline'

const ICONS: Record<TimelineItem['icon'], (props: { size?: number }) => ReactNode> = {
  meeting: (props) => <IconContacts {...props} />,
  call: (props) => <IconPhone {...props} />,
  whatsapp: (props) => <IconWhatsApp {...props} />,
  giving: (props) => <IconGiving {...props} />,
  note: (props) => <IconNote {...props} />,
  task: (props) => <IconCheck {...props} size={16} />,
}

const ICON_TONE: Record<TimelineItem['icon'], string> = {
  meeting: 'text-accent',
  call: 'text-accent',
  whatsapp: 'text-accent',
  giving: 'text-gold',
  note: 'text-nav',
  task: 'text-good',
}

export interface UpcomingBlockProps {
  items: UpcomingItem[]
}

/** The slim "Upcoming" block above the past (04 §5.2). */
export function UpcomingBlock({ items }: UpcomingBlockProps) {
  if (items.length === 0) return null
  return (
    <div
      data-testid="upcoming-block"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-card border border-dashed border-[#C6D2DE] bg-[#F0F4F8] px-[14px] py-2 text-[12.5px] text-[#3E5A75]"
    >
      <b>Upcoming:</b>
      {items.map((item, index) => {
        const date = toDate(item.at)
        const overdue = item.tone === 'overdue' || (date ? isPastDay(date) : false)
        return (
          <span key={item.id} className="flex items-center gap-2">
            {index > 0 ? <span aria-hidden="true">·</span> : null}
            <span className={cn(overdue && 'font-semibold text-flag-overdue')}>
              {item.label}
              {date ? (
                <>
                  {' — '}
                  {overdue ? 'overdue, was ' : ''}
                  {formatDayHeading(date)}
                  {formatTime(date) !== '00:00' ? ` ${formatTime(date)}` : ''}
                </>
              ) : null}
            </span>
          </span>
        )
      })}
    </div>
  )
}

export interface TimelineListProps {
  items: TimelineItem[]
  /** Rendered when there is nothing in the filtered feed. */
  emptyHint?: ReactNode
}

/** The merged reverse-chron feed (04 §5.2). */
export function TimelineList({ items, emptyHint }: TimelineListProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing here yet"
        hint={
          emptyHint ??
          'Conversations, gifts, notes and Gift Aid declarations appear here in one reverse-chronological feed.'
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-[10px]">
      {items.map((item) => {
        const Icon = ICONS[item.icon]
        return (
          <TimelineEntry
            key={item.id}
            className={item.isPrivate ? 'border-l-[3px] border-l-flag-waiting' : undefined}
            icon={<span className={ICON_TONE[item.icon]}>{Icon({ size: 18 })}</span>}
            title={`${item.kindLabel} · ${formatDate(item.at)}`}
            meta={
              <>
                {item.metaParts.join(' · ')}
                {item.sourceLabel ? (
                  <>
                    {item.metaParts.length > 0 ? ' · ' : null}
                    <span className="rounded-[4px] border border-[#C9BC96] px-[5px] text-[10px] font-bold text-[#6B5A26]">
                      {item.sourceLabel}
                    </span>
                  </>
                ) : null}
              </>
            }
            outcome={item.outcome}
          >
            {item.amount !== null && item.amount !== undefined ? (
              <>
                <Money amount={item.amount} /> {item.body}
              </>
            ) : (
              item.body
            )}
          </TimelineEntry>
        )
      })}
    </div>
  )
}
