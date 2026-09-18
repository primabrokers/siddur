import { useEffect, useMemo, useState } from 'react'
import { Button, Field, Sheet, TextArea, TextInput } from '../../components'
import { cn } from '../../lib/cn'
import { displayName } from '../contacts/normalise'
import {
  EMAIL_NOTICE,
  useEmailAddressBook,
  useSendEmail,
  type EmailContact,
  type EmailSendError,
} from '../../lib/queries/comms'
import { splitAddresses, validateCompose, type ComposeDraft } from './core'

export interface ComposeInitial extends ComposeDraft {
  /** Set on a reply; the send function threads the Sent row onto it. */
  inReplyToEmailId?: string | null
}

export const BLANK_DRAFT: ComposeInitial = {
  to: '',
  cc: '',
  subject: '',
  body: '',
  inReplyToEmailId: null,
}

export interface ComposeSheetProps {
  open: boolean
  onClose: () => void
  initial: ComposeInitial
  /** False when the provider keys are missing — Send is disabled, not hidden. */
  configured: boolean
  /** The address outbound mail leaves from, when configured. */
  from: string | null
  onSent: (result: { thread_key: string | null }) => void
}

interface Suggestion {
  address: string
  label: string
}

function suggestionsFor(contacts: EmailContact[], term: string): Suggestion[] {
  const needle = term.trim().toLowerCase()
  if (needle.length < 2) return []
  const out: Suggestion[] = []
  for (const contact of contacts) {
    const address = (contact.email ?? '').toLowerCase()
    if (address === '') continue
    const name = displayName(contact) || contact.organization || address
    if (address.includes(needle) || name.toLowerCase().includes(needle)) {
      out.push({ address, label: name })
      if (out.length >= 6) break
    }
  }
  return out
}

/**
 * Compose (I-10: nothing sends without a human — this sheet *is* the human).
 *
 * The To box takes contacts and free addresses in the same field, because that
 * is how a fundraiser thinks about it: most recipients are on file, some are a
 * solicitor or an accountant who never will be. Suggestions come from the
 * contacts that have an email; anything typed that looks like an address is
 * equally valid.
 *
 * With no provider keys the sheet still opens and still drafts — only Send is
 * disabled, under a plain sentence saying what an admin has to do. A dead
 * button with no explanation would be the worst of both.
 */
export function ComposeSheet({ open, onClose, initial, configured, from, onSent }: ComposeSheetProps) {
  const [draft, setDraft] = useState<ComposeInitial>(initial)
  const [touched, setTouched] = useState(false)
  const [activeField, setActiveField] = useState<'to' | 'cc' | null>(null)
  const addressBook = useEmailAddressBook()
  const send = useSendEmail()

  // Re-seed whenever the sheet is opened with a different prefill (Reply,
  // Reply all, Forward all arrive this way).
  useEffect(() => {
    if (!open) return
    setDraft(initial)
    setTouched(false)
    setActiveField(null)
    send.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const check = useMemo(
    () => validateCompose({ to: draft.to, cc: draft.cc, subject: draft.subject, body: draft.body }),
    [draft.to, draft.cc, draft.subject, draft.body],
  )

  const contacts = addressBook.data ?? []
  const lastTerm = (value: string): string => {
    const parts = value.split(/[,;]/)
    return parts[parts.length - 1] ?? ''
  }
  const suggestions =
    activeField === null ? [] : suggestionsFor(contacts, lastTerm(activeField === 'to' ? draft.to : draft.cc))

  const applySuggestion = (field: 'to' | 'cc', address: string) => {
    setDraft((current) => {
      const value = current[field]
      const parts = value.split(/[,;]/)
      parts[parts.length - 1] = ` ${address}`
      return { ...current, [field]: `${parts.join(',').replace(/^\s+/, '')}, ` }
    })
    setActiveField(null)
  }

  async function submit() {
    setTouched(true)
    if (!check.ok || !configured) return
    try {
      const result = await send.mutateAsync({
        to: check.to,
        cc: check.cc,
        subject: draft.subject.trim(),
        body_text: draft.body,
        in_reply_to_email_id: draft.inReplyToEmailId ?? null,
      })
      onSent({ thread_key: result.thread_key })
      onClose()
    } catch {
      // The error is rendered from `send.error` below; the sheet stays open so
      // the draft is never lost.
    }
  }

  const failure = send.error as EmailSendError | null
  const showErrors = touched

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={draft.inReplyToEmailId ? 'Reply' : 'New email'}
      width={560}
      leading={
        <button type="button" onClick={onClose} className="text-muted hover:text-ink">
          Cancel
        </button>
      }
      footer={
        <div className="flex flex-col gap-2">
          {!configured ? (
            <p className="rounded-input bg-row px-3 py-2 text-[12.5px] text-muted" role="note">
              Sending is not set up yet. An admin needs to verify a domain with the mail provider and set{' '}
              <code>RESEND_API_KEY</code> and <code>EMAIL_FROM</code> on the Supabase project. You can still
              write the draft — nothing here is lost.
            </p>
          ) : null}
          {failure ? (
            <p role="alert" className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
              {EMAIL_NOTICE[failure.failure] ?? failure.message}
            </p>
          ) : null}
          <Button
            size="lg"
            className="w-full"
            disabled={!configured || send.isPending}
            onClick={() => void submit()}
          >
            {send.isPending ? 'Sending…' : 'Send'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {configured && from ? (
          <p className="text-[12px] text-faint">
            From <span className="text-nav">{from}</span>
          </p>
        ) : null}

        <div className="relative">
          <Field label="To" required hint="Contacts on file, or any address — comma-separated.">
            <TextInput
              value={draft.to}
              autoComplete="off"
              onFocus={() => setActiveField('to')}
              onChange={(event) => {
                setDraft((current) => ({ ...current, to: event.target.value }))
                setActiveField('to')
              }}
              placeholder="dovid.cohen@example.com"
            />
          </Field>
          {activeField === 'to' && suggestions.length > 0 ? (
            <SuggestionList suggestions={suggestions} onPick={(address) => applySuggestion('to', address)} />
          ) : null}
          {showErrors && check.errors.to ? (
            <p role="alert" className="mt-1 text-[11.5px] text-flag-overdue">
              {check.errors.to}
            </p>
          ) : null}
        </div>

        <div className="relative">
          <Field label="Cc">
            <TextInput
              value={draft.cc}
              autoComplete="off"
              onFocus={() => setActiveField('cc')}
              onChange={(event) => {
                setDraft((current) => ({ ...current, cc: event.target.value }))
                setActiveField('cc')
              }}
            />
          </Field>
          {activeField === 'cc' && suggestions.length > 0 ? (
            <SuggestionList suggestions={suggestions} onPick={(address) => applySuggestion('cc', address)} />
          ) : null}
          {showErrors && check.errors.cc ? (
            <p role="alert" className="mt-1 text-[11.5px] text-flag-overdue">
              {check.errors.cc}
            </p>
          ) : null}
        </div>

        <Field label="Subject">
          <TextInput
            value={draft.subject}
            onChange={(event) => setDraft((current) => ({ ...current, subject: event.target.value }))}
          />
        </Field>

        <Field label="Message" required>
          <TextArea
            rows={12}
            value={draft.body}
            onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
          />
        </Field>
        {showErrors && check.errors.body ? (
          <p role="alert" className="text-[11.5px] text-flag-overdue">
            {check.errors.body}
          </p>
        ) : null}

        {check.to.length + check.cc.length > 0 ? (
          <p className="text-[11.5px] text-faint">
            {check.to.length} recipient{check.to.length === 1 ? '' : 's'}
            {check.cc.length > 0 ? `, ${check.cc.length} on cc` : ''}
            {splitAddresses(draft.to).length !== check.to.length ? ' (duplicates removed)' : ''}
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}

function SuggestionList({
  suggestions,
  onPick,
}: {
  suggestions: Suggestion[]
  onPick: (address: string) => void
}) {
  return (
    <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-input border border-border bg-surface shadow-[0_3px_14px_rgba(31,41,51,.14)]">
      {suggestions.map((suggestion) => (
        <li key={suggestion.address}>
          <button
            type="button"
            // onMouseDown, not onClick: the input's blur would otherwise close
            // the list before the click ever lands.
            onMouseDown={(event) => {
              event.preventDefault()
              onPick(suggestion.address)
            }}
            className={cn(
              'flex w-full flex-col px-3 py-2 text-left text-[12.5px] hover:bg-row',
            )}
          >
            <span className="font-semibold">{suggestion.label}</span>
            <span className="text-[11.5px] text-muted">{suggestion.address}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
