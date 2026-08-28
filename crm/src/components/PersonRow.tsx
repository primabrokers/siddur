import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Avatar } from './Avatar'
import { FlagDot, type FlagVariant } from './FlagDot'

export interface PersonRowProps {
  /** Contact / household name. */
  name: string
  /** The one next-action line: "Call re proposal — was due Thu". */
  subtitle?: ReactNode
  /** Flag from `contact_stats` / the task row. Omit to render no dot. */
  flag?: FlagVariant
  /** 2–3 context chips (stage, days-since, YTD). */
  chips?: ReactNode
  /** Inline actions revealed on hover (call, WhatsApp, log, snooze). */
  actions?: ReactNode
  /** Leading slot before the avatar — e.g. a `14:00` meeting time. */
  leading?: ReactNode
  /** Hide the avatar (mobile rows lead with the flag dot only). */
  showAvatar?: boolean
  /** Class for the avatar — e.g. `max-sm:hidden` on dense mobile rows. */
  avatarClassName?: string
  /** Dashed border — the "needs a next action" treatment. */
  dashed?: boolean
  onClick?: () => void
  className?: string
}

/**
 * The list atom (03 §6): avatar · name · flag · one next-action line ·
 * context chips · hover actions. Used by the Action Stream, lists and search.
 */
export function PersonRow({
  name,
  subtitle,
  flag,
  chips,
  actions,
  leading,
  showAvatar = true,
  avatarClassName,
  dashed = false,
  onClick,
  className,
}: PersonRowProps) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'group flex w-full items-center gap-3 rounded-card bg-surface px-[14px] py-[10px] text-left',
        dashed ? 'border border-dashed border-flag-none' : 'border border-border',
        onClick && 'cursor-pointer hover:border-accent',
        className,
      )}
    >
      {leading}
      {flag ? <FlagDot variant={flag} /> : null}
      {showAvatar ? <Avatar name={name} className={avatarClassName} /> : null}
      <span className="min-w-0 grow">
        <span className="block truncate text-[13.5px] font-semibold">{name}</span>
        {subtitle ? <span className="block truncate text-[12.5px] text-muted">{subtitle}</span> : null}
      </span>
      {chips ? <span className="hidden shrink-0 items-center gap-[6px] sm:flex">{chips}</span> : null}
      {/* Touch has no hover: the actions stay visible below `lg` and reveal on
          hover/focus on the desktop rows (MobileToday.dc.html). */}
      {actions ? (
        <span className="flex shrink-0 items-center gap-2 text-faint transition-opacity focus-within:opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
          {actions}
        </span>
      ) : null}
    </Tag>
  )
}
