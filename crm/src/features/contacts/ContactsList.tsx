import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Button, EmptyState, Money, PersonRow, Pill, TextInput } from '../../components'
import { formatDayCount } from '../../lib/format'
import { useContactsList, useLookupOptions } from '../../lib/queries/contacts'
import { PageHeader } from '../shell/PageHeader'
import { ContactSheet } from './ContactSheet'
import { displayName, fullName } from './normalise'
import { nextActionPhrase } from './ProfileHeader'
import type { ContactListRow, LookupOption } from './types'

function stageLabel(options: LookupOption[] | undefined, value: string): string {
  const match = options?.find((o) => o.value === value)
  return match?.label ?? value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

function matches(row: ContactListRow, term: string): boolean {
  if (term === '') return true
  const haystack = [
    fullName(row.contact),
    row.contact.organization,
    row.contact.hebrew_name,
    row.contact.city,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(term)
}

/**
 * The contacts list (06 §1, person-row layout). Rows carry the flag, the one
 * next-action line and 2–3 context chips (03 §6); the sort is flag severity
 * then name, so yellow "no next action" ranks above grey futures (I-3).
 */
export function ContactsList() {
  const navigate = useNavigate()
  const [term, setTerm] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const stages = useLookupOptions('stage')
  const { data, isLoading, error } = useContactsList()

  const rows = data?.rows ?? []
  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase()
    return rows.filter((row) => matches(row, needle))
  }, [rows, term])

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle={
          isLoading
            ? 'Loading…'
            : `${filtered.length} ${filtered.length === 1 ? 'person' : 'people'}${
                term.trim() ? ` matching “${term.trim()}”` : ''
              }`
        }
        actions={
          <div className="flex items-center gap-2">
            <TextInput
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Filter by name or city"
              aria-label="Filter contacts by name or city"
              className="w-[200px] py-[7px] text-[13px] sm:w-[240px]"
            />
            <Button onClick={() => setSheetOpen(true)}>New contact</Button>
          </div>
        }
      />

      {error ? (
        <p role="alert" className="mb-3 rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
          {error instanceof Error ? error.message : 'Could not load contacts.'}
        </p>
      ) : null}

      {data?.statsError ? (
        <p className="mb-3 rounded-input bg-[#FCF0E3] px-3 py-2 text-[12px] text-flag-today-ink">
          Derived numbers unavailable ({data.statsError}) — flags, giving and next actions will fill in once
          <code> contact_stats</code> is live.
        </p>
      ) : null}

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-[58px] animate-pulse rounded-card border border-border bg-surface" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? 'No contacts yet' : 'Nothing matches that filter'}
          hint={
            rows.length === 0
              ? 'Every person, household and organisation lives here, each carrying one visible next action.'
              : 'Try part of a name, an organisation or a city.'
          }
          action={
            rows.length === 0 ? <Button onClick={() => setSheetOpen(true)}>New contact</Button> : null
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map(({ contact, stats }) => {
            const next = nextActionPhrase(stats?.next_action_due_on)
            const ytd = stats?.this_year_giving ?? null
            return (
              <li key={contact.id}>
                <PersonRow
                  className="min-h-[52px]"
                  name={displayName(contact) || contact.organization || 'Unnamed contact'}
                  flag={stats?.flag ?? 'none'}
                  dashed={(stats?.flag ?? 'none') === 'none'}
                  onClick={() => navigate(`/contacts/${contact.id}`)}
                  subtitle={
                    <>
                      {contact.city ? <span>{contact.city}</span> : null}
                      {contact.city ? ' · ' : null}
                      {stats?.next_action_title ? (
                        <span
                          className={
                            next.tone === 'overdue'
                              ? 'text-flag-overdue'
                              : next.tone === 'today'
                                ? 'text-flag-today-ink'
                                : undefined
                          }
                        >
                          {stats.next_action_title}
                          {next.text ? ` — ${next.text}` : ''}
                        </span>
                      ) : (
                        <span className="text-flag-none-ink">none — add one</span>
                      )}
                    </>
                  }
                  chips={
                    <>
                      <Pill variant="manual" tone="neutral">
                        {stageLabel(stages.data, contact.stage)}
                      </Pill>
                      {stats?.days_since_contact !== null && stats?.days_since_contact !== undefined ? (
                        <Pill variant="computed" title="Days since last meaningful contact">
                          {formatDayCount(stats.days_since_contact)}
                        </Pill>
                      ) : null}
                      {/* Gold YTD, hidden when there is nothing to say. */}
                      {ytd ? <Money amount={ytd} className="text-[12.5px]" /> : null}
                    </>
                  }
                />
              </li>
            )
          })}
        </ul>
      )}

      <ContactSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  )
}
