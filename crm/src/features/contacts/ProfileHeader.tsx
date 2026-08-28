import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { differenceInCalendarDays, format } from 'date-fns'
import { Avatar, FlagDot, Money, Pill, Select } from '../../components'
import { cn } from '../../lib/cn'
import { formatDate, formatDayCount, toDate } from '../../lib/format'
import { EngagementMeter } from './EngagementMeter'
import { displayName } from './normalise'
import { DONOR_STATUS_LABEL, cadenceLabel } from './stats'
import type { ContactRow, ContactStats, LookupOption, TagRow } from './types'

export interface GiftAidState {
  onFile: boolean
  enduring: boolean
}

export interface ProfileHeaderProps {
  contact: ContactRow
  stats: ContactStats | null
  /** Shown as a quiet caption when the derived view cannot be read. */
  statsError?: string | null
  householdName?: string | null
  ownerName?: string | null
  introducedBy?: { id: string; name: string } | null
  tags?: TagRow[]
  giftAid?: GiftAidState | null
  /**
   * Opens the declaration sheet for this donor (05 §5 / 02 §3.7). Omitted for
   * roles that may not record one, which hides the affordance entirely.
   */
  onNewDeclaration?: () => void
  /** `lookup_options` list `stage` — the pill edits in place (I-7 manual). */
  stageOptions?: LookupOption[]
  onStageChange?: (value: string) => void
  /** The Call/WhatsApp/Email/Log/Task/Meet/⋯ bar. */
  actions?: ReactNode
}

const PRIORITY_LABEL: Record<string, string> = {
  high: 'High priority',
  medium: 'Medium priority',
  low: 'Low priority',
}

function labelFor(options: LookupOption[] | undefined, value: string | null): string {
  if (!value) return '—'
  const match = options?.find((o) => o.value === value)
  if (match) return match.label
  return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/** "was due Thu" / "today" / "22 Aug" plus the tone the wording carries. */
export function nextActionPhrase(dueOn: string | null | undefined): {
  text: string
  tone: 'overdue' | 'today' | 'future'
} {
  const date = toDate(dueOn)
  if (!date) return { text: '', tone: 'future' }
  const diff = differenceInCalendarDays(date, new Date())
  if (diff < 0) {
    return {
      text: diff >= -6 ? `was due ${format(date, 'EEE')}` : `was due ${format(date, 'd MMM')}`,
      tone: 'overdue',
    }
  }
  if (diff === 0) return { text: 'today', tone: 'today' }
  if (diff === 1) return { text: 'tomorrow', tone: 'future' }
  return { text: format(date, 'd MMM'), tone: 'future' }
}

/**
 * The at-a-glance header (04 §5.1). Everything numeric comes from
 * `contact_stats`; manual pills are filled and editable, computed pills are
 * outlined and read-only (I-7).
 *
 * Mobile condenses to name · flag · two key numbers · action bar (03 §7).
 */
export function ProfileHeader({
  contact,
  stats,
  statsError,
  householdName,
  ownerName,
  introducedBy,
  tags = [],
  giftAid,
  onNewDeclaration,
  stageOptions,
  onStageChange,
  actions,
}: ProfileHeaderProps) {
  const [editingStage, setEditingStage] = useState(false)
  const name = displayName(contact) || contact.organization || 'Unnamed contact'
  const next = nextActionPhrase(stats?.next_action_due_on)
  const lastGiftDate = toDate(stats?.last_gift_on)
  const gaOnFile = giftAid?.onFile ?? stats?.has_ga_declaration ?? null
  const daysSince = stats?.days_since_contact ?? null

  return (
    <header
      data-testid="profile-header"
      className="flex flex-col gap-3 rounded-card border border-border bg-surface px-4 py-4 lg:px-6"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-[14px]">
        <div className="flex min-w-0 items-center gap-3 lg:gap-[14px]">
          <Avatar name={name} size="xl" tone="accent" />
          <div className="flex min-w-0 flex-col gap-[3px]">
            <div className="flex flex-wrap items-baseline gap-x-[10px] gap-y-1">
              <h1 className="text-[19px] leading-tight font-bold lg:text-[21px]">{name}</h1>
              <span className="text-[13px] text-muted">
                {contact.hebrew_name ? <span lang="he">{contact.hebrew_name}</span> : null}
                {contact.hebrew_name && householdName && contact.household_id ? ' · ' : null}
                {householdName && contact.household_id ? (
                  <Link
                    to={`/contacts?household=${contact.household_id}`}
                    className="text-accent hover:text-accent-dark"
                  >
                    {householdName}
                  </Link>
                ) : null}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <FlagDot variant={stats?.flag ?? 'none'} />

              {editingStage && stageOptions ? (
                <Select
                  autoFocus
                  aria-label="Relationship stage"
                  className="max-w-[210px] py-[3px] text-[12px]"
                  value={contact.stage}
                  options={stageOptions.map((o) => ({ value: o.value, label: o.label }))}
                  onBlur={() => setEditingStage(false)}
                  onChange={(event) => {
                    setEditingStage(false)
                    if (event.target.value !== contact.stage) onStageChange?.(event.target.value)
                  }}
                />
              ) : (
                <Pill
                  variant="manual"
                  tone="accentSolid"
                  title={onStageChange ? 'Relationship stage — click to change' : undefined}
                  {...(onStageChange && stageOptions ? { onClick: () => setEditingStage(true) } : {})}
                >
                  {labelFor(stageOptions, contact.stage)}
                </Pill>
              )}

              {/* Wrappers, not `hidden` on the pills themselves: a pill carries
                  its own `inline-flex`, which would win the display race. */}
              <span className="hidden items-center gap-2 sm:flex">
                <Pill variant="computed">
                  {stats?.donor_status ? DONOR_STATUS_LABEL[stats.donor_status] : 'No donor status'} ·
                  computed
                </Pill>
                <EngagementMeter tier={contact.engagement_tier} />
              </span>

              <span className="hidden items-center gap-2 md:flex">
                <Pill variant="manual" tone={contact.priority === 'high' ? 'overdue' : 'neutral'}>
                  {PRIORITY_LABEL[contact.priority] ?? contact.priority}
                </Pill>
                {contact.tier ? (
                  <Pill variant="manual" tone="neutral">
                    Tier {contact.tier}
                  </Pill>
                ) : null}
                {ownerName ? <span className="text-[12px] text-muted">Owner: {ownerName}</span> : null}
              </span>
            </div>
          </div>
        </div>

        {actions ? <div className="shrink-0 lg:ml-auto">{actions}</div> : null}
      </div>

      {/* The numbers line — every figure from contact_stats (I-8/I-9). */}
      <dl className="tabular flex flex-wrap gap-x-[26px] gap-y-1 text-[13px] text-nav">
        <div className="flex gap-[6px]">
          <dt>Lifetime</dt>
          <dd>
            <Money amount={stats?.lifetime_giving ?? null} />
          </dd>
        </div>

        <div className="hidden gap-[6px] sm:flex">
          <dt>Last gift</dt>
          <dd>
            {stats?.last_gift_amount ? (
              <>
                <Money amount={stats.last_gift_amount} />
                {lastGiftDate ? <span className="text-muted"> · {format(lastGiftDate, 'MMM yyyy')}</span> : null}
              </>
            ) : (
              <span className="text-faint">none yet</span>
            )}
          </dd>
        </div>

        <div className="hidden gap-[6px] sm:flex">
          <dt>Last contact</dt>
          <dd>
            {daysSince === null ? (
              <span className="text-faint">never</span>
            ) : (
              <>
                <b>{daysSince} days ago</b>
                {stats?.last_contact_kind ? (
                  <span className="text-muted"> ({stats.last_contact_kind.replace(/_/g, ' ')})</span>
                ) : null}
              </>
            )}
          </dd>
        </div>

        <div className="flex gap-[6px]">
          <dt>Next:</dt>
          <dd>
            {stats?.next_action_title ? (
              <b
                className={cn(
                  next.tone === 'overdue' && 'text-flag-overdue',
                  next.tone === 'today' && 'text-flag-today-ink',
                )}
              >
                {stats.next_action_title}
                {next.text ? ` — ${next.text}` : null}
              </b>
            ) : (
              <b className="text-flag-none-ink">none — add one</b>
            )}
          </dd>
        </div>

        <div className="hidden gap-[6px] lg:flex">
          <dt>KIT</dt>
          <dd>
            <b>{cadenceLabel(contact.contact_frequency_days)}</b>
            {contact.kit_paused_until ? (
              <span className="text-muted"> · paused to {formatDate(contact.kit_paused_until)}</span>
            ) : null}
          </dd>
        </div>

        <div className="hidden gap-[6px] lg:flex">
          <dt>Gift Aid</dt>
          <dd className="flex items-center gap-2">
            {gaOnFile ? (
              <b className="text-good">✓ {giftAid?.enduring ? 'enduring' : 'on file'}</b>
            ) : (
              <b className="text-muted">✗ none</b>
            )}
            {/* Recording a declaration is the +25% moment (05 §5, M7). */}
            {onNewDeclaration ? (
              <button
                type="button"
                onClick={onNewDeclaration}
                className="text-[12px] font-semibold text-accent hover:text-accent-dark"
              >
                New declaration
              </button>
            ) : null}
          </dd>
        </div>

        {daysSince !== null ? (
          <div className="flex gap-[6px] sm:hidden">
            <dt className="sr-only">Days since contact</dt>
            <dd className="text-muted">{formatDayCount(daysSince)} since contact</dd>
          </div>
        ) : null}
      </dl>

      {statsError ? (
        <p className="text-[11.5px] text-flag-today-ink">
          Derived numbers unavailable ({statsError}) — the record below is unaffected.
        </p>
      ) : null}

      {/* Third line: tags · introduced by. Hidden on the condensed header. */}
      {tags.length > 0 || introducedBy || contact.introduced_by_note ? (
        <div className="hidden flex-wrap items-center gap-2 text-[12.5px] text-nav lg:flex">
          {tags.map((tag) => (
            <span key={tag.id} className="rounded-pill bg-row px-[9px] py-[2px]">
              {tag.name}
            </span>
          ))}
          {introducedBy ? (
            <span>
              Introduced by{' '}
              <Link to={`/contacts/${introducedBy.id}`} className="text-accent hover:text-accent-dark">
                {introducedBy.name}
              </Link>
            </span>
          ) : contact.introduced_by_note ? (
            <span>Introduced by {contact.introduced_by_note}</span>
          ) : null}
        </div>
      ) : null}
    </header>
  )
}
