import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  IconCheck,
  IconPhone,
  IconWhatsApp,
  Menu,
  PersonRow,
  Pill,
  type MenuItem,
} from '../../components'
import { cn } from '../../lib/cn'
import { formatDayCount } from '../../lib/format'
import { waNumber } from '../contacts/normalise'
import { originLabel } from '../tasks/logic'
import type { StreamRowModel } from './grouping'

export interface StreamRowProps {
  row: StreamRowModel
  /** Stage labels from `lookup_options('stage')`. */
  stageLabels?: Record<string, string>
  /** Completing a task always runs close-the-loop (I-4). */
  onComplete?: (row: StreamRowModel) => void
  /** Snooze presets — a due-date shift on the task (03 §5.3). */
  onSnooze?: (row: StreamRowModel, days: number) => void
  /** "+ Next action" on a yellow row; "Brief me" on a meeting row. */
  trailing?: ReactNode
  dashed?: boolean
  className?: string
}

const iconAction =
  'rounded-input p-1 text-faint hover:bg-accent-soft hover:text-accent-dark focus-visible:text-accent-dark'

/**
 * One Action Stream row (03 §6): flag dot · name · the single next-action line ·
 * context chips (stage, days-since) · inline channel launches on hover · the
 * done affordance. The card is clickable with a pointer; the arrow link is the
 * keyboard/assistive path to the profile (no interactive nesting).
 */
export function StreamRow({
  row,
  stageLabels = {},
  onComplete,
  onSnooze,
  trailing,
  dashed = false,
  className,
}: StreamRowProps) {
  const navigate = useNavigate()
  const contact = row.contact
  const phone = contact?.phone ?? null
  const wa = waNumber(contact?.whatsapp ?? contact?.phone)
  const daysSince = row.stats?.days_since_contact ?? null
  const origin = row.task ? originLabel(row.task.origin) : null
  const profileHref = `/contacts/${row.contactId}`

  const snoozeItems: MenuItem[] = onSnooze
    ? [
        { id: 'tomorrow', label: 'Tomorrow', onSelect: () => onSnooze(row, 1) },
        { id: 'next-week', label: 'Next week', onSelect: () => onSnooze(row, 7) },
        { id: 'two-weeks', label: 'In two weeks', onSelect: () => onSnooze(row, 14) },
      ]
    : []

  const chips = (
    <>
      {contact?.stage ? (
        <Pill tone="neutral" variant="manual">
          {stageLabels[contact.stage] ?? contact.stage.replace(/_/g, ' ')}
        </Pill>
      ) : null}
      {daysSince !== null ? <Pill>{formatDayCount(daysSince)} since contact</Pill> : null}
      {row.task?.status === 'waiting' ? (
        <Pill tone="waiting" variant="manual">
          Waiting on them
        </Pill>
      ) : null}
      {origin ? <Pill tone="accent">{origin}</Pill> : null}
    </>
  )

  const actions = (
    <>
      {phone ? (
        <a href={`tel:${phone}`} aria-label={`Call ${row.name}`} className={iconAction}>
          <IconPhone />
        </a>
      ) : null}
      {wa ? (
        <a
          href={`https://wa.me/${wa}`}
          target="_blank"
          rel="noreferrer"
          aria-label={`WhatsApp ${row.name}`}
          className={iconAction}
        >
          <IconWhatsApp />
        </a>
      ) : null}
      {snoozeItems.length > 0 && row.task ? (
        <Menu
          label={`Snooze ${row.task.title}`}
          trigger="⋯"
          items={snoozeItems}
          triggerClassName="min-h-[28px] border-none px-[6px] py-0 text-muted"
        />
      ) : null}
      <Link to={profileHref} aria-label={`Open ${row.name}`} className={cn(iconAction, 'hidden sm:inline-flex')}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
      </Link>
    </>
  )

  return (
    <div
      className={cn('flex items-center gap-2', className)}
      onClick={(event) => {
        // Let the inline links and menu handle their own clicks.
        if ((event.target as HTMLElement).closest('a,button')) return
        navigate(profileHref)
      }}
    >
      {row.task && onComplete ? (
        <button
          type="button"
          aria-label={`Complete ${row.task.title}`}
          onClick={() => onComplete(row)}
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-border text-transparent transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent-dark focus-visible:text-accent-dark"
        >
          <IconCheck size={13} />
        </button>
      ) : null}

      <PersonRow
        name={row.name}
        subtitle={row.line}
        // The meeting row leads with its time; a grey dot would say nothing.
        flag={row.kind === 'meeting' ? undefined : row.flag}
        avatarClassName="max-sm:hidden"
        leading={
          row.time ? (
            <span className="tabular text-[13px] font-bold text-accent-dark">{row.time}</span>
          ) : undefined
        }
        chips={chips}
        actions={actions}
        dashed={dashed}
        className="min-w-0 grow cursor-pointer hover:border-accent"
      />

      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  )
}
