import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Money, SectionLabel, TextInput } from '../../components'
import { cn } from '../../lib/cn'
import { formatDate } from '../../lib/format'
import { isPastDay } from '../../lib/dates'
import type { HouseholdDetail } from '../../lib/queries/contacts'
import { PledgeCard } from './GivingTab'
import { displayName } from './normalise'
import { CADENCE_PRESETS, languageLabel } from './stats'
import type { ContactGiving, ContactRow, ContactStats, GivingRefs, TagRow } from './types'

function Panel({
  title,
  children,
  className,
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn('flex flex-col gap-2 rounded-card border border-border bg-surface p-[14px]', className)}
    >
      <SectionLabel as="h2">{title}</SectionLabel>
      {children}
    </section>
  )
}

export interface BeforeYouCallProps {
  contact: ContactRow
  tags: TagRow[]
}

/** The pre-call brief block (04 §5.4, condensed for the rail). */
export function BeforeYouCall({ contact, tags }: BeforeYouCallProps) {
  const lines: Array<[string, string | null | undefined]> = [
    ['Birthday', contact.birthday ? formatDate(contact.birthday) : null],
    ['Spouse', contact.spouse_name],
    ['Family', contact.family_notes],
    ['Business', [contact.position, contact.organization].filter(Boolean).join(', ') || contact.industry],
    [
      'Best time',
      [contact.best_time_to_contact, contact.preferred_channel?.replace(/_/g, ' ')]
        .filter(Boolean)
        .join(' · '),
    ],
    ['Language', languageLabel(contact.preferred_language)],
    ['Mutual', contact.mutual_connections],
    ['Communities', tags.filter((t) => t.category === 'community').map((t) => t.name).join(', ')],
  ]
  const present = lines.filter(([, value]) => Boolean(value))

  return (
    <Panel title="Before you call">
      {present.length === 0 ? (
        <p className="text-[12.5px] text-muted">
          Nothing recorded yet. Birthday, spouse, business, best time and interests show here.
        </p>
      ) : (
        <div className="flex flex-col gap-[6px] text-[13px] text-nav">
          {present.map(([label, value]) => (
            <span key={label}>
              {label}: {value}
            </span>
          ))}
        </div>
      )}
      {contact.things_to_remember ? (
        <p className="rounded-input bg-row px-[10px] py-2 text-[12.5px] leading-[1.45]">
          {contact.things_to_remember}
        </p>
      ) : null}
      {/* "✦ Brief me" (09 §3) is its own panel above this one —
          `features/ai/BriefPanel`, mounted by ContactProfile. It stays separate
          because this block must keep working with the AI switched off. */}
    </Panel>
  )
}

export interface HouseholdPanelProps {
  household: HouseholdDetail | null | undefined
  currentContactId: string
}

/** Members, combined rollups and the greeting (04 §5.5). */
export function HouseholdPanel({ household, currentContactId }: HouseholdPanelProps) {
  if (!household) return null
  const { household: row, members, combinedLifetime } = household

  return (
    <Panel title={`Household — ${row.name ?? 'family'}`}>
      <p className="text-[13px] text-nav">
        {members.map((member, index) => (
          <span key={member.contact.id}>
            {index > 0 ? ' · ' : null}
            {member.contact.id === currentContactId ? (
              <>{displayName(member.contact)} (this record)</>
            ) : (
              <Link to={`/contacts/${member.contact.id}`} className="text-accent hover:text-accent-dark">
                {displayName(member.contact)}
              </Link>
            )}
          </span>
        ))}
      </p>
      <p className="text-[13px] text-nav">
        Combined lifetime: <Money amount={combinedLifetime} />
      </p>
      {row.formal_greeting ? (
        <p className="text-[12.5px] text-muted">
          Greeting: “{row.formal_greeting}” · {row.greeting_is_override ? 'override' : 'auto'}
        </p>
      ) : null}
    </Panel>
  )
}

export interface CadencePanelProps {
  contact: ContactRow
  stats: ContactStats | null
  onSetCadence: (days: number | null) => void
  onSetPause: (until: string | null) => void
}

/** Keep-in-touch cadence (04 §5.6): preset chips + pause, config in context (I-6). */
export function CadencePanel({ contact, stats, onSetCadence, onSetPause }: CadencePanelProps) {
  const current = contact.contact_frequency_days ?? null
  const dueOn = stats?.kit_due_on ?? null

  return (
    <Panel title="Keep in touch">
      <div className="flex flex-wrap gap-[6px] text-[12px]">
        {CADENCE_PRESETS.map((preset) => {
          const active = preset.days === current
          return (
            <button
              key={preset.label}
              type="button"
              aria-pressed={active}
              onClick={() => onSetCadence(preset.days)}
              className={cn(
                'rounded-pill px-[10px] py-[3px] transition-colors',
                active
                  ? 'bg-accent font-semibold text-surface'
                  : 'border border-border text-muted hover:text-ink',
              )}
            >
              {preset.label}
            </button>
          )
        })}
      </div>

      <p className="text-[12.5px] text-muted">
        {current === null ? (
          'No cadence set.'
        ) : dueOn ? (
          <>
            Next due:{' '}
            <b className={cn(isPastDay(dueOn) ? 'text-flag-overdue' : 'text-ink')}>{formatDate(dueOn)}</b>{' '}
            (resets on any meaningful contact)
          </>
        ) : (
          'Next due date arrives from contact_stats.'
        )}
      </p>

      <label className="flex items-center gap-2 text-[12.5px] text-muted">
        Pause until
        <TextInput
          type="date"
          value={contact.kit_paused_until ?? ''}
          onChange={(e) => onSetPause(e.target.value === '' ? null : e.target.value)}
          className="w-[150px] py-[5px] text-[12.5px]"
        />
      </label>
    </Panel>
  )
}

export interface OpenPledgePanelProps {
  giving: ContactGiving | undefined
  refs?: GivingRefs | null
}

export function OpenPledgePanel({ giving, refs }: OpenPledgePanelProps) {
  const pledge = giving?.pledges.find((p) => p.status === 'open')
  if (!giving || !pledge) return null
  return <PledgeCard pledge={pledge} giving={giving} refs={refs} />
}
