import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { FlagDot, IconSearch, Money, Pill } from '../../components'
import { cn } from '../../lib/cn'
import { formatDate, formatDayCount } from '../../lib/format'
import { useLookupOptions } from '../../lib/queries/contacts'
import { useContactSearch, useRecentContacts } from '../../lib/queries/search'
import { displayName } from '../contacts/normalise'
import { dueWording } from '../stream/grouping'
import { CommandDialog, KeyHint } from './CommandDialog'
import { matchReason, type SearchResult } from './searchModel'
import { rememberContact } from './recents'

/** 03 §3's budget is 300ms *perceived*; 150ms of stillness is the trigger. */
export const DEBOUNCE_MS = 150

function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return settled
}

/* ------------------------------------------------------------------- row */

interface ResultRowProps {
  result: SearchResult
  active: boolean
  stageLabel: (value: string) => string
  onPick: () => void
  onHover: () => void
}

/**
 * The result row carries brief §21's exact field list — name · stage pill ·
 * flag · last gift · last contact · next action — so the answer is usually on
 * this row and the profile is optional.
 */
function ResultRow({ result, active, stageLabel, onPick, onHover }: ResultRowProps) {
  const { contact, stats } = result
  const name = displayName(contact) || contact.organization || 'Unnamed contact'
  const reason = matchReason(result)

  const nextAction = stats?.next_action_title
    ? `${stats.next_action_title} — ${dueWording(stats.next_action_due_on)}`
    : 'No next action'

  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onPick}
      onMouseMove={onHover}
      className={cn(
        'flex w-full items-center gap-3 rounded-input px-3 py-[9px] text-left',
        active ? 'bg-accent-soft' : 'hover:bg-ground',
      )}
    >
      <FlagDot variant={stats?.flag ?? 'none'} />
      <span className="min-w-0 grow">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[13.5px] font-semibold">{name}</span>
          {reason ? <span className="truncate text-[11.5px] text-faint">{reason}</span> : null}
        </span>
        <span className="block truncate text-[12px] text-muted">
          <span className={stats?.flag === 'none' ? 'text-flag-none-ink' : undefined}>{nextAction}</span>
          {stats?.last_contact_at ? ` · last spoke ${formatDate(stats.last_contact_at)}` : ''}
        </span>
      </span>
      <span className="hidden shrink-0 items-center gap-[6px] sm:flex">
        <Pill variant="manual" tone="neutral">
          {stageLabel(contact.stage)}
        </Pill>
        {stats?.days_since_contact !== null && stats?.days_since_contact !== undefined ? (
          <Pill variant="computed" title="Days since last meaningful contact">
            {formatDayCount(stats.days_since_contact)}
          </Pill>
        ) : null}
        {stats?.last_gift_amount ? (
          <Money amount={stats.last_gift_amount} className="text-[12.5px]" />
        ) : null}
      </span>
    </button>
  )
}

/* --------------------------------------------------------------- overlay */

export interface SearchOverlayProps {
  open: boolean
  onClose: () => void
}

/**
 * Global record search (03 §3, brief §21).
 *
 * "/" from anywhere opens this. Before a keystroke it lists the eight
 * most-recently-opened profiles from `localStorage`, so the common case —
 * "back to the person I was just looking at" — costs one key and no network
 * round trip. Typing debounces 150ms, re-uses the per-term cache, and keeps
 * the previous list on screen while the next one lands.
 */
export function SearchOverlay({ open, onClose }: SearchOverlayProps) {
  const navigate = useNavigate()
  const [term, setTerm] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const debounced = useDebounced(term, DEBOUNCE_MS)
  const searching = debounced.trim().length >= 2
  const search = useContactSearch(debounced)
  const recents = useRecentContacts(open && !searching)
  const stages = useLookupOptions('stage')

  const stageLabel = useMemo(() => {
    const map = new Map((stages.data ?? []).map((option) => [option.value, option.label]))
    return (value: string) =>
      map.get(value) ?? value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
  }, [stages.data])

  const rows: SearchResult[] = searching ? (search.data?.results ?? []) : (recents.data ?? [])

  // Re-arm on every open: a stale term from last time is never what you want.
  useEffect(() => {
    if (!open) return
    setTerm('')
    setCursor(0)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    setCursor(0)
  }, [debounced])

  useEffect(() => {
    // Optional chaining on the call too: jsdom (and some older engines) have
    // no `scrollIntoView`, and keeping the highlight in view is a nicety.
    const node = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    node?.scrollIntoView?.({ block: 'nearest' })
  }, [cursor, rows.length])

  function pick(result: SearchResult | undefined) {
    if (!result) return
    rememberContact(result.contact.id, displayName(result.contact))
    onClose()
    navigate(`/contacts/${result.contact.id}`)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((value) => (rows.length === 0 ? 0 : (value + 1) % rows.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((value) => (rows.length === 0 ? 0 : (value - 1 + rows.length) % rows.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      pick(rows[cursor])
    }
  }

  const heading = searching
    ? search.isFetching && rows.length === 0
      ? 'Searching…'
      : `${rows.length} ${rows.length === 1 ? 'match' : 'matches'}`
    : 'Recently viewed'

  return (
    <CommandDialog
      open={open}
      onClose={onClose}
      title="Search people"
      input={
        <div className="flex items-center gap-2">
          <IconSearch size={15} className="shrink-0 text-faint" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls="search-results"
            aria-autocomplete="list"
            aria-label="Search people, phones, cities"
            placeholder="Search people, phones, cities…"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={onKeyDown}
            className="w-full bg-transparent text-[15px] placeholder:text-faint focus:outline-none"
          />
        </div>
      }
      footer={
        <span className="flex flex-wrap items-center gap-4">
          <KeyHint keys="↑ ↓" label="move" />
          <KeyHint keys="↵" label="open profile" />
          <KeyHint keys="esc" label="close" />
          <span className="ml-auto hidden sm:inline">
            <KeyHint keys="⌘K" label="commands" />
          </span>
        </span>
      }
    >
      <div className="px-2 pt-1 pb-[6px] text-[10.5px] font-semibold tracking-[0.08em] text-faint uppercase">
        {heading}
      </div>

      <div ref={listRef} id="search-results" role="listbox" aria-label="Search results">
        {rows.map((result, index) => (
          <ResultRow
            key={result.contact.id}
            result={result}
            active={index === cursor}
            stageLabel={stageLabel}
            onPick={() => pick(result)}
            onHover={() => setCursor(index)}
          />
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-[13px] text-muted">
          {searching
            ? search.isFetching
              ? 'Looking…'
              : `Nothing matches “${debounced.trim()}”. Try part of a name, a phone number, an organisation or a city.`
            : 'Open a profile and it will wait for you here. Or type a name, number, organisation or city.'}
        </p>
      ) : null}

      {search.data?.statsError ? (
        <p className="px-3 pt-1 pb-2 text-[11.5px] text-flag-today-ink">
          Derived numbers unavailable — flags and giving will fill in once contact_stats is live.
        </p>
      ) : null}
    </CommandDialog>
  )
}
