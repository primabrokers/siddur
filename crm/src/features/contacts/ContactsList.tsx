import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Button, EmptyState, Money, PersonRow, Pill, TextInput } from '../../components'
import { cn } from '../../lib/cn'
import { formatDayCount } from '../../lib/format'
import { useContactsList, useLookupOptions } from '../../lib/queries/contacts'
import { useTeamMember } from '../auth/useTeamMember'
import {
  BulkActionSheet,
  ColumnPicker,
  MAGIC_COLUMN_BY_ID,
  loadColumns,
  renderColumn,
  saveColumns,
  sortByColumn,
  type MagicColumnId,
} from '../dataquality'
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

/** Rows supplied by a saved view instead of the full contacts query (06 §1). */
export interface ContactsSource {
  rows: ContactListRow[]
  isLoading: boolean
  error: unknown
  statsError: string | null
}

export interface ContactsListProps {
  /** When present the list renders these rows and skips its own query. */
  source?: ContactsSource
  /** The active view's name; defaults to "Contacts". */
  title?: string
  /** The views bar (06 §1), rendered between the header and the rows. */
  toolbar?: ReactNode
  /** Shown under the count — the active view's own empty-state sentence. */
  emptyHint?: string
  /** Controlled create sheet, so the command palette can open it. */
  createOpen?: boolean
  onCreateOpenChange?: (open: boolean) => void
}

/**
 * The contacts list (06 §1, person-row layout). Rows carry the flag, the one
 * next-action line and 2–3 context chips (03 §6); the sort is flag severity
 * then name, so yellow "no next action" ranks above grey futures (I-3).
 *
 * The same component renders a saved view: a view is a different *row source*,
 * not a different screen (03 §4 — one dataset, many lenses).
 */
export function ContactsList({
  source,
  title = 'Contacts',
  toolbar,
  emptyHint,
  createOpen,
  onCreateOpenChange,
}: ContactsListProps = {}) {
  const navigate = useNavigate()
  const [term, setTerm] = useState('')
  const [ownSheetOpen, setOwnSheetOpen] = useState(false)
  const stages = useLookupOptions('stage')
  const own = useContactsList({ enabled: source === undefined })
  const member = useTeamMember()

  // Magic columns (03 §4) and the selection they get bulk-acted on (06 §1).
  // Both are keyed by the *view's* title, so switching lens keeps each queue's
  // own columns and never carries a stale selection across.
  const [columns, setColumns] = useState<MagicColumnId[]>(() => loadColumns(title))
  const [sort, setSort] = useState<{ id: MagicColumnId; direction: 'asc' | 'desc' } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  const sheetOpen = createOpen ?? ownSheetOpen
  const setSheetOpen = (open: boolean) => {
    if (onCreateOpenChange) onCreateOpenChange(open)
    else setOwnSheetOpen(open)
  }

  const { rows, isLoading, error, statsError } = source ?? {
    rows: own.data?.rows ?? [],
    isLoading: own.isLoading,
    error: own.error,
    statsError: own.data?.statsError ?? null,
  }

  // A new lens starts with a clean quick-filter; the previous term would
  // silently hide rows the view is meant to show.
  useEffect(() => {
    setTerm('')
    setSelected(new Set())
    setSort(null)
    setColumns(loadColumns(title))
  }, [title])

  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase()
    const matched = rows.filter((row) => matches(row, needle))
    // The default order is flag severity then name (I-3), set by the query.
    // A magic-column sort is an explicit override of that, never a silent one.
    if (!sort) return matched
    const column = MAGIC_COLUMN_BY_ID[sort.id]
    return column ? sortByColumn(matched, column, sort.direction) : matched
  }, [rows, term, sort])

  const selectedRows = useMemo(
    () => filtered.filter((row) => selected.has(row.contact.id)),
    [filtered, selected],
  )

  const toggleRow = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allShownSelected = filtered.length > 0 && filtered.every((row) => selected.has(row.contact.id))

  return (
    <>
      <PageHeader
        title={title}
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
            <ColumnPicker
              active={columns}
              onChange={(ids) => {
                setColumns(ids)
                saveColumns(title, ids)
                if (sort && !ids.includes(sort.id)) setSort(null)
              }}
            />
            <Button onClick={() => setSheetOpen(true)}>New contact</Button>
          </div>
        }
      />

      {toolbar}

      {error ? (
        <p role="alert" className="mb-3 rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
          {error instanceof Error ? error.message : 'Could not load contacts.'}
        </p>
      ) : null}

      {statsError ? (
        <p className="mb-3 rounded-input bg-[#FCF0E3] px-3 py-2 text-[12px] text-flag-today-ink">
          Derived numbers unavailable ({statsError}) — flags, giving and next actions will fill in once
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
          title={rows.length === 0 ? (emptyHint ? 'Nobody here — which is the point' : 'No contacts yet') : 'Nothing matches that filter'}
          hint={
            rows.length === 0
              ? (emptyHint ??
                'Every person, household and organisation lives here, each carrying one visible next action.')
              : 'Try part of a name, an organisation or a city.'
          }
          action={
            rows.length === 0 && !emptyHint ? (
              <Button onClick={() => setSheetOpen(true)}>New contact</Button>
            ) : null
          }
        />
      ) : (
        <>
          {/* The select-all / column header strip. It only earns its row when
              there is a selection to manage or a column to sort by. */}
          {columns.length > 0 || selected.size > 0 ? (
            <div className="mb-2 flex items-center gap-3 px-1 text-[11.5px] text-muted">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allShownSelected}
                  aria-label="Select every contact shown"
                  onChange={() =>
                    setSelected(allShownSelected ? new Set() : new Set(filtered.map((r) => r.contact.id)))
                  }
                  className="h-[15px] w-[15px] accent-[#0E6E6B]"
                />
                Select all
              </label>
              <div className="ml-auto flex items-center gap-2">
                {columns.map((id) => {
                  const column = MAGIC_COLUMN_BY_ID[id]
                  if (!column) return null
                  const active = sort?.id === id
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() =>
                        setSort(
                          active
                            ? sort.direction === 'desc'
                              ? { id, direction: 'asc' }
                              : null
                            : { id, direction: 'desc' },
                        )
                      }
                      className={cn(
                        'w-[104px] text-right transition-colors',
                        active ? 'font-semibold text-accent-dark' : 'hover:text-ink',
                      )}
                    >
                      {column.label}
                      {active ? (sort.direction === 'desc' ? ' ↓' : ' ↑') : ''}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          <ul className="flex flex-col gap-2">
            {filtered.map((row) => {
            const { contact, stats } = row
            const next = nextActionPhrase(stats?.next_action_due_on)
            const ytd = stats?.this_year_giving ?? null
            return (
              <li key={contact.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.has(contact.id)}
                  onChange={() => toggleRow(contact.id)}
                  aria-label={`Select ${displayName(contact) || contact.organization || 'contact'}`}
                  className="h-[15px] w-[15px] shrink-0 accent-[#0E6E6B]"
                />
                <PersonRow
                  className="min-h-[52px] grow"
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
                {/* Magic columns (03 §4): read-only projections of
                    `contact_stats`, never recomputed here (I-8). */}
                {columns.map((id) => {
                  const column = MAGIC_COLUMN_BY_ID[id]
                  if (!column) return null
                  const value = renderColumn(column, row)
                  return (
                    <span
                      key={id}
                      title={column.label}
                      className={cn(
                        'w-[104px] shrink-0 text-right text-[12.5px] tabular-nums',
                        column.money ? 'text-gold' : 'text-muted',
                      )}
                    >
                      {value === '' ? <span className="text-faint">—</span> : value}
                    </span>
                  )
                })}
              </li>
            )
          })}
          </ul>
        </>
      )}

      <BulkActionSheet
        rows={selectedRows}
        onClear={() => setSelected(new Set())}
        isAdmin={member.data?.role === 'admin'}
      />

      <ContactSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  )
}
