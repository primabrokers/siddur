import { useState } from 'react'
import { Avatar, TextInput } from '../../components'
import { useContactSearch } from '../../lib/queries/tasks'
import { displayName } from '../contacts/normalise'
import type { ContactRow } from '../contacts/types'

export interface ContactPickerProps {
  onPick: (contact: ContactRow) => void
  /** Shown above the field — "Who is this task for?". */
  label?: string
  autoFocus?: boolean
}

/**
 * A new task always starts with a person (I-2). Search by name, Hebrew name or
 * organisation; the organisation-self record is the escape hatch for admin work
 * and appears in the list like any other contact.
 */
export function ContactPicker({ onPick, label = 'Who is this for?', autoFocus = true }: ContactPickerProps) {
  const [term, setTerm] = useState('')
  const { data, isLoading } = useContactSearch(term)
  const rows = data ?? []

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-[6px]">
        <span className="text-[12px] font-semibold text-muted">{label}</span>
        <TextInput
          autoFocus={autoFocus}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search people, families, organisations…"
          aria-label="Search contacts"
        />
      </label>

      <div className="flex max-h-[320px] flex-col gap-1 overflow-y-auto">
        {isLoading ? <p className="px-1 py-3 text-[12.5px] text-muted">Searching…</p> : null}
        {!isLoading && rows.length === 0 ? (
          <p className="px-1 py-3 text-[12.5px] text-muted">
            No contact matches “{term}”. Every task needs a person (I-2) — create the contact first.
          </p>
        ) : null}
        {rows.map((contact) => (
          <button
            key={contact.id}
            type="button"
            onClick={() => onPick(contact)}
            className="flex items-center gap-3 rounded-input px-2 py-2 text-left hover:bg-ground"
          >
            <Avatar name={displayName(contact)} size="sm" />
            <span className="min-w-0">
              <span className="block truncate text-[13.5px] font-semibold">{displayName(contact)}</span>
              {contact.city || contact.organization ? (
                <span className="block truncate text-[12px] text-muted">
                  {[contact.organization, contact.city].filter(Boolean).join(' · ')}
                </span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
