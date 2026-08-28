import type { ReactNode } from 'react'
import { Menu } from '../../components'
import { cn } from '../../lib/cn'
import { normalisePhone, waNumber } from './normalise'
import type { ContactRow } from './types'

const base =
  'inline-flex min-h-[44px] items-center justify-center gap-[6px] rounded-input px-[13px] text-[12.5px] font-semibold leading-none transition-colors lg:min-h-[36px]'
const primary = `${base} bg-accent text-surface hover:bg-accent-dark`
const accentOutline = `${base} border border-accent text-accent hover:bg-accent-soft`
const outline = `${base} border border-border text-nav hover:border-faint`
const disabled = `${base} border border-border text-faint cursor-not-allowed`

function ActionLink({
  href,
  className,
  children,
  title,
}: {
  href: string | null
  className: string
  children: ReactNode
  title?: string
}) {
  if (!href) {
    return (
      <span className={disabled} title={title ?? 'Not available — no number or address on file'}>
        {children}
      </span>
    )
  }
  return (
    <a href={href} className={className} title={title}>
      {children}
    </a>
  )
}

export interface ProfileActionBarProps {
  contact: ContactRow
  /** Quick Capture, pre-filled with this contact where the API allows it. */
  onLog: () => void
  onTask: () => void
  onMeet: () => void
  onArchive: () => void
  /** Opens the merge tool for this contact (06 §5). Admin-only. */
  onMerge?: () => void
  /** Merge is admin + confirm (11 §1); the item stays visible but disabled. */
  canMerge?: boolean
  className?: string
}

/**
 * Act from the record (04 §5.7). Call/WhatsApp/Email leave through the OS;
 * Log/Task/Meet open sheets; the ⋯ menu carries archive (gift, pledge,
 * document and merge arrive with their own milestones).
 */
export function ProfileActionBar({
  contact,
  onLog,
  onTask,
  onMeet,
  onArchive,
  onMerge,
  canMerge = false,
  className,
}: ProfileActionBarProps) {
  const phone = normalisePhone(contact.phone)
  const wa = waNumber(contact.whatsapp ?? contact.phone)
  const email = contact.email?.trim() ? contact.email.trim() : null

  return (
    <div className={cn('flex flex-wrap items-center gap-2 lg:flex-nowrap', className)}>
      <ActionLink href={phone ? `tel:${phone}` : null} className={primary}>
        Call
      </ActionLink>
      <ActionLink href={wa ? `https://wa.me/${wa}` : null} className={accentOutline}>
        WhatsApp
      </ActionLink>
      <ActionLink href={email ? `mailto:${email}` : null} className={outline}>
        Email
      </ActionLink>
      <button type="button" onClick={onLog} className={outline}>
        Log
      </button>
      <button type="button" onClick={onTask} className={outline}>
        Task
      </button>
      <button type="button" onClick={onMeet} className={outline}>
        Meet
      </button>
      <Menu
        label="More actions"
        trigger="⋯"
        triggerClassName="min-h-[44px] lg:min-h-[36px]"
        items={[
          {
            id: 'gift',
            label: 'Record gift — M4',
            onSelect: () => undefined,
            disabled: true,
          },
          {
            id: 'merge',
            // Shown to everyone, enabled for admins only — hiding it would
            // hide the capability rather than the permission (11 §1).
            label: 'Merge with a duplicate…',
            onSelect: () => onMerge?.(),
            disabled: !canMerge || !onMerge || Boolean(contact.is_organisation_self),
          },
          { id: 'archive', label: 'Archive contact', onSelect: onArchive, tone: 'danger' },
        ]}
      />
    </div>
  )
}
