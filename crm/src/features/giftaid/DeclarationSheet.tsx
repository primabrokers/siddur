import { useEffect, useState } from 'react'
import { Button, Field, Select, Sheet, TextInput } from '../../components'
import { toISODate } from '../../lib/dates'
import { formatDate } from '../../lib/format'
import { ContactPicker } from '../tasks/ContactPicker'
import { displayName } from '../contacts/normalise'
import { BACK_YEARS, coversLabel, GA_WORDING_VERSION } from './logic'
import { emptyDeclarationDraft, type DeclarationDraft, type DeclarationMethod } from './types'

export interface DeclarationSheetProps {
  open: boolean
  onClose: () => void
  /** Prefilled donor; omit to pick one inside the sheet. */
  contactId?: string
  contactName?: string
  onSave: (draft: DeclarationDraft) => void | Promise<void>
  pending?: boolean
}

const METHODS: Array<{ value: DeclarationMethod; label: string }> = [
  { value: 'written', label: 'Written — signed form or letter' },
  { value: 'oral', label: 'Oral — taken by phone or in person' },
  { value: 'online', label: 'Online — web form or email' },
]

/**
 * Record a Gift Aid declaration (02 §3.7, 05 §5).
 *
 * Two things this sheet is careful about:
 *
 * - **Wording version is displayed, never chosen.** HMRC's model declaration is
 *   locked per version (▸ Beacon); what the donor saw is what gets stamped, so
 *   offering a picker would only let someone record a fiction.
 * - **Oral declarations are honest about being incomplete.** The sheet says so
 *   before saving, because the gifts stay unclaimable until the written
 *   confirmation is sent — a rule the database enforces either way.
 */
export function DeclarationSheet({
  open,
  onClose,
  contactId,
  contactName,
  onSave,
  pending,
}: DeclarationSheetProps) {
  const today = toISODate(new Date())
  const [draft, setDraft] = useState<DeclarationDraft>(() => emptyDeclarationDraft(today, contactId ?? ''))
  const [pickedName, setPickedName] = useState(contactName ?? '')

  useEffect(() => {
    if (!open) return
    setDraft(emptyDeclarationDraft(toISODate(new Date()), contactId ?? ''))
    setPickedName(contactName ?? '')
  }, [open, contactId, contactName])

  const set = <K extends keyof DeclarationDraft>(key: K, value: DeclarationDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const ready = draft.contact_id !== '' && draft.declared_on !== ''
  const preview = coversLabel(
    {
      id: 'preview',
      contact_id: draft.contact_id,
      declared_on: draft.declared_on,
      method: draft.method,
      wording_version: GA_WORDING_VERSION,
      covers_past: draft.covers_past,
      covers_future: draft.covers_future,
      covers_from: draft.covers_from || null,
      oral_confirmation_sent_on: null,
      cancelled_on: null,
      evidence_url: draft.evidence_url || null,
    },
    BACK_YEARS,
  )

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Gift Aid declaration"
      width={520}
      leading={
        <button type="button" onClick={onClose} className="text-muted hover:text-ink">
          Cancel
        </button>
      }
      footer={
        <Button size="lg" className="w-full" disabled={!ready || pending} onClick={() => void onSave(draft)}>
          {pending ? 'Saving…' : 'Record declaration'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {draft.contact_id === '' ? (
          <ContactPicker
            label="Whose declaration is this?"
            onPick={(contact) => {
              set('contact_id', contact.id)
              setPickedName(displayName(contact))
            }}
          />
        ) : (
          <div className="rounded-input bg-row px-3 py-2 text-[13px]">
            <span className="text-muted">Donor: </span>
            <b>{pickedName || 'Selected contact'}</b>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Declared on" required>
            <TextInput
              type="date"
              value={draft.declared_on}
              onChange={(event) => set('declared_on', event.target.value)}
            />
          </Field>
          <Field label="Method" hint="How the donor gave it (02 §3.7).">
            <Select
              value={draft.method}
              options={METHODS}
              onChange={(event) => set('method', event.target.value as DeclarationMethod)}
            />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2 rounded-input border border-border px-3 py-[10px]">
          <legend className="px-1 text-[12px] font-semibold text-muted">What it covers</legend>
          <label className="flex items-start gap-[10px] text-[13px]">
            <input
              type="checkbox"
              className="mt-[3px]"
              checked={draft.covers_future}
              onChange={(event) => set('covers_future', event.target.checked)}
            />
            <span>
              <b>All future gifts</b> — an enduring declaration; every later gift joins the claim automatically.
            </span>
          </label>
          <label className="flex items-start gap-[10px] text-[13px]">
            <input
              type="checkbox"
              className="mt-[3px]"
              checked={draft.covers_past}
              onChange={(event) => set('covers_past', event.target.checked)}
            />
            <span>
              <b>The last {BACK_YEARS} years</b> — HMRC's back-claim window; earlier gifts sweep into the rolling claim.
            </span>
          </label>
          <Field
            label="Covers from (optional)"
            hint="Anchor the window on a date the donor named, rather than on the declaration date."
          >
            <TextInput
              type="date"
              value={draft.covers_from}
              onChange={(event) => set('covers_from', event.target.value)}
            />
          </Field>
          <p className="text-[12px] text-muted">
            Coverage: <b>{preview}</b>
            {draft.covers_from ? ` from ${formatDate(draft.covers_from)}` : ` from ${formatDate(draft.declared_on)}`}
          </p>
        </fieldset>

        <Field
          label="Evidence link (optional)"
          hint="Where the signed form or the recording lives — HMRC can ask to see it."
        >
          <TextInput
            value={draft.evidence_url}
            placeholder="https://…"
            onChange={(event) => set('evidence_url', event.target.value)}
          />
        </Field>

        <div className="rounded-input bg-row px-3 py-2 text-[12px] text-muted">
          Wording version: <b className="text-ink">{GA_WORDING_VERSION}</b> — stamped as recorded, not chosen.
        </div>

        {draft.method === 'oral' ? (
          <p className="rounded-input bg-[#FFF4E3] px-3 py-2 text-[12.5px] text-[#B4650F]">
            HMRC requires a <b>written confirmation</b> of an oral declaration. Saving queues that letter as a task, and
            the donor's gifts stay unclaimable until it is marked sent.
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}
