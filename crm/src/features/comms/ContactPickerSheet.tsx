import { useEffect, useState } from 'react'
import { Field, Sheet, TextInput } from '../../components'
import { displayName } from '../contacts/normalise'
import { useContactSearch } from '../../lib/queries/search'

export interface ContactPickerSheetProps {
  open: boolean
  onClose: () => void
  title: string
  hint?: string
  onPick: (contact: { id: string; name: string }) => void
  /** Offered as a one-tap row above the search — usually the matched donor. */
  suggestion?: { id: string; name: string } | null
  /** Shown when a thread already has a contact and can be unlinked. */
  onClear?: () => void
}

/**
 * Pick a contact.
 *
 * Two jobs, one sheet: *linking* a thread whose address the matcher could not
 * place, and *logging* a message whose contact is not known. Both are the same
 * question — "who is this?" — and answering it should never mean leaving the
 * inbox and losing the message you were reading.
 *
 * The search is the app's own contact search (03 §3), debounced the same way,
 * so what it finds here is what the ⌘K palette finds.
 */
export function ContactPickerSheet({
  open,
  onClose,
  title,
  hint,
  onPick,
  suggestion,
  onClear,
}: ContactPickerSheetProps) {
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    if (!open) setTerm('')
  }, [open])

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 150)
    return () => clearTimeout(timer)
  }, [term])

  const search = useContactSearch(debounced)
  const results = search.data?.results ?? []

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      width={460}
      leading={
        <button type="button" onClick={onClose} className="text-muted hover:text-ink">
          Cancel
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        {hint ? <p className="text-[12.5px] text-muted">{hint}</p> : null}

        {suggestion ? (
          <button
            type="button"
            onClick={() => onPick(suggestion)}
            className="flex items-center justify-between rounded-card border border-accent bg-accent-soft px-3 py-2 text-left"
          >
            <span className="text-[13px] font-semibold text-accent-dark">{suggestion.name}</span>
            <span className="text-[11.5px] text-accent-dark">already matched</span>
          </button>
        ) : null}

        <Field label="Search contacts">
          <TextInput
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Name, organisation or email"
          />
        </Field>

        {debounced.trim().length < 2 ? (
          <p className="text-[12px] text-faint">Type at least two characters.</p>
        ) : search.isFetching && results.length === 0 ? (
          <p className="text-[12px] text-muted">Searching…</p>
        ) : results.length === 0 ? (
          <p className="text-[12px] text-muted">
            No contact matches “{debounced}”. Create them from Contacts first, then come back.
          </p>
        ) : (
          <ul className="flex flex-col">
            {results.map((result) => {
              const name = displayName(result.contact) || result.contact.organization || 'Unnamed contact'
              return (
                <li key={result.contact.id}>
                  <button
                    type="button"
                    onClick={() => onPick({ id: result.contact.id, name })}
                    className="flex w-full flex-col border-b border-border px-1 py-2 text-left hover:bg-row"
                  >
                    <span className="text-[13px] font-semibold">{name}</span>
                    <span className="text-[11.5px] text-muted">
                      {[result.contact.email, result.contact.city].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="self-start text-[12px] font-semibold text-flag-overdue hover:opacity-80"
          >
            Unlink this thread
          </button>
        ) : null}
      </div>
    </Sheet>
  )
}
