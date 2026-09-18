import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Avatar,
  Button,
  Field,
  FieldGroup,
  Sheet,
  Select,
  TextArea,
  TextInput,
} from '../../components'
import {
  draftToRow,
  findDuplicates,
  useCreateContact,
  useLookupOptions,
  useTeamMembers,
  useUpdateContact,
} from '../../lib/queries/contacts'
import {
  DUPLICATE_REASON_LABEL,
  displayName,
  normaliseEmail,
  normalisePhone,
  type DuplicateMatch,
} from './normalise'
import type { ContactDraft, ContactRow, LookupOption } from './types'

const EMPTY: ContactDraft = {
  title: '',
  first_name: '',
  last_name: '',
  hebrew_name: '',
  organization: '',
  position: '',
  contact_kind: 'individual',
  email: '',
  phone: '',
  whatsapp: '',
  preferred_language: 'en',
  preferred_channel: '',
  best_time_to_contact: '',
  address_line1: '',
  address_line2: '',
  city: '',
  postcode: '',
  country: 'United Kingdom',
  spouse_name: '',
  birthday: '',
  things_to_remember: '',
  introduced_by_note: '',
  relationship_owner_id: '',
  source: '',
  stage: 'prospect',
  priority: 'medium',
  tier: '',
  contact_frequency_days: '',
}

function toDraft(contact: ContactRow): ContactDraft {
  return {
    ...EMPTY,
    title: contact.title ?? '',
    first_name: contact.first_name ?? '',
    last_name: contact.last_name ?? '',
    hebrew_name: contact.hebrew_name ?? '',
    organization: contact.organization ?? '',
    position: contact.position ?? '',
    contact_kind: contact.contact_kind ?? 'individual',
    email: contact.email ?? '',
    phone: contact.phone ?? '',
    whatsapp: contact.whatsapp ?? '',
    preferred_language: contact.preferred_language ?? 'en',
    preferred_channel: contact.preferred_channel ?? '',
    best_time_to_contact: contact.best_time_to_contact ?? '',
    address_line1: contact.address_line1 ?? '',
    address_line2: contact.address_line2 ?? '',
    city: contact.city ?? '',
    postcode: contact.postcode ?? '',
    country: contact.country ?? 'United Kingdom',
    spouse_name: contact.spouse_name ?? '',
    birthday: contact.birthday ?? '',
    things_to_remember: contact.things_to_remember ?? '',
    introduced_by_note: contact.introduced_by_note ?? '',
    relationship_owner_id: contact.relationship_owner_id ?? '',
    source: contact.source ?? '',
    stage: contact.stage ?? 'prospect',
    priority: contact.priority ?? 'medium',
    tier: contact.tier ?? '',
    contact_frequency_days:
      contact.contact_frequency_days === null || contact.contact_frequency_days === undefined
        ? ''
        : String(contact.contact_frequency_days),
  }
}

const opts = (list: LookupOption[] | undefined, fallback: Array<{ value: string; label: string }> = []) =>
  list && list.length > 0 ? list.map((o) => ({ value: o.value, label: o.label })) : fallback

export interface ContactSheetProps {
  open: boolean
  onClose: () => void
  /** Present = edit mode; absent = create, with the duplicate check at the door. */
  contact?: ContactRow | null
  onSaved?: (id: string) => void
}

/**
 * Create / edit a contact — a sensible subset of 02 §3.1 grouped the way the
 * spec groups it. Only `first_name` is required (I-5 spirit); phone and
 * WhatsApp are normalised to E.164 and email lowercased on save (02 §6).
 */
export function ContactSheet({ open, onClose, contact, onSaved }: ContactSheetProps) {
  const navigate = useNavigate()
  const editing = Boolean(contact)
  const [draft, setDraft] = useState<ContactDraft>(() => (contact ? toDraft(contact) : EMPTY))
  const [error, setError] = useState<string | null>(null)
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [skipCheck, setSkipCheck] = useState(false)

  const titles = useLookupOptions('title')
  const kinds = useLookupOptions('contact_kind')
  const languages = useLookupOptions('language')
  const channels = useLookupOptions('action_type')
  const stages = useLookupOptions('stage')
  const priorities = useLookupOptions('priority')
  const tiers = useLookupOptions('tier')
  const team = useTeamMembers()

  const create = useCreateContact()
  const update = useUpdateContact()

  const set = <K extends keyof ContactDraft>(key: K, value: ContactDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const normalisedPreview = useMemo(
    () => ({
      phone: normalisePhone(draft.phone),
      whatsapp: normalisePhone(draft.whatsapp) ?? normalisePhone(draft.phone),
      email: normaliseEmail(draft.email),
    }),
    [draft.phone, draft.whatsapp, draft.email],
  )

  function reset() {
    setDraft(contact ? toDraft(contact) : EMPTY)
    setDuplicates(null)
    setSkipCheck(false)
    setError(null)
  }

  async function persist() {
    try {
      if (contact) {
        const row = await update.mutateAsync({ id: contact.id, patch: draftToRow(draft) })
        onSaved?.(row.id)
        onClose()
        return
      }
      const row = await create.mutateAsync(draft)
      reset()
      onSaved?.(row.id)
      onClose()
      navigate(`/contacts/${row.id}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the contact.')
    }
  }

  /** Duplicate check at the door (02 §6) — before the insert, never after. */
  async function submit() {
    setError(null)
    if (draft.first_name.trim() === '') {
      setError('A first name is the one thing we need.')
      return
    }
    if (editing) {
      await persist()
      return
    }
    if (skipCheck) {
      await persist()
      return
    }
    setChecking(true)
    try {
      const matches = await findDuplicates({
        first_name: draft.first_name,
        last_name: draft.last_name,
        organization: draft.organization,
        email: normalisedPreview.email,
        phone: normalisedPreview.phone,
        whatsapp: normalisedPreview.whatsapp,
      })
      if (matches.length > 0) {
        setDuplicates(matches)
        return
      }
      await persist()
    } catch (caught) {
      // A failed check must not silently create a duplicate, and must not
      // block the user either: say so and let the next press go through.
      setSkipCheck(true)
      setError(
        `Duplicate check unavailable (${
          caught instanceof Error ? caught.message : 'unknown error'
        }). Press again to create without it.`,
      )
    } finally {
      setChecking(false)
    }
  }

  const busy = checking || create.isPending || update.isPending

  if (duplicates && duplicates.length > 0) {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title="Possible duplicate"
        width={560}
        leading={
          <button type="button" onClick={() => setDuplicates(null)} className="text-muted hover:text-ink">
            Back
          </button>
        }
        footer={
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              size="lg"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={busy}
              onClick={() => void persist()}
            >
              Create anyway
            </Button>
            <Button
              size="lg"
              variant="ghost"
              className="w-full sm:w-auto"
              onClick={() => setDuplicates(null)}
            >
              Keep editing
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-[13px] leading-[1.5] text-nav">
            Is this the same person? Opening the existing record keeps one history instead of two.
          </p>
          <ul className="flex flex-col gap-2">
            {duplicates.map((match) => (
              <li
                key={match.contact.id}
                className="flex items-center gap-3 rounded-card border border-border px-3 py-[10px]"
              >
                <Avatar name={displayName(match.contact)} size="lg" />
                <div className="min-w-0 grow">
                  <div className="truncate text-[13.5px] font-semibold">{displayName(match.contact)}</div>
                  <div className="truncate text-[12px] text-muted">
                    {[match.contact.email, match.contact.phone, match.contact.city]
                      .filter(Boolean)
                      .join(' · ') || 'no contact details'}
                  </div>
                  <div className="text-[11.5px] text-flag-today-ink">
                    Matched on {match.reasons.map((r) => DUPLICATE_REASON_LABEL[r]).join(' + ')}
                  </div>
                </div>
                <Button
                  variant="accentOutline"
                  size="sm"
                  onClick={() => {
                    onClose()
                    navigate(`/contacts/${match.contact.id}`)
                  }}
                >
                  Open
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? 'Edit contact' : 'New contact'}
      width={640}
      leading={
        <button type="button" onClick={onClose} className="text-muted hover:text-ink">
          Cancel
        </button>
      }
      footer={
        <Button size="lg" className="w-full" disabled={busy} onClick={() => void submit()}>
          {checking ? 'Checking for duplicates…' : busy ? 'Saving…' : editing ? 'Save changes' : 'Create contact'}
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <FieldGroup title="Identity">
          <Field label="Title">
            <Select
              placeholder="—"
              value={draft.title}
              onChange={(e) => set('title', e.target.value)}
              options={opts(titles.data)}
            />
          </Field>
          <Field label="First name" required>
            <TextInput
              autoFocus
              value={draft.first_name}
              onChange={(e) => set('first_name', e.target.value)}
            />
          </Field>
          <Field label="Last name">
            <TextInput value={draft.last_name} onChange={(e) => set('last_name', e.target.value)} />
          </Field>
          <Field label="Hebrew name">
            <TextInput
              lang="he"
              value={draft.hebrew_name}
              onChange={(e) => set('hebrew_name', e.target.value)}
            />
          </Field>
          <Field label="Organisation">
            <TextInput value={draft.organization} onChange={(e) => set('organization', e.target.value)} />
          </Field>
          <Field label="Position">
            <TextInput value={draft.position} onChange={(e) => set('position', e.target.value)} />
          </Field>
          <Field label="Kind">
            <Select
              value={draft.contact_kind}
              onChange={(e) => set('contact_kind', e.target.value)}
              options={opts(kinds.data, [
                { value: 'individual', label: 'Individual' },
                { value: 'business', label: 'Business' },
                { value: 'foundation', label: 'Foundation' },
                { value: 'trust', label: 'Trust' },
              ])}
            />
          </Field>
        </FieldGroup>

        <FieldGroup title="Communication">
          <Field
            label="Phone"
            hint={normalisedPreview.phone ? `Saved as ${normalisedPreview.phone}` : 'UK numbers default to +44'}
          >
            <TextInput
              type="tel"
              value={draft.phone}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="07700 900123"
            />
          </Field>
          <Field
            label="WhatsApp"
            hint={
              normalisedPreview.whatsapp && draft.whatsapp === ''
                ? 'Defaults to the phone number'
                : normalisedPreview.whatsapp
                  ? `Saved as ${normalisedPreview.whatsapp}`
                  : undefined
            }
          >
            <TextInput type="tel" value={draft.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} />
          </Field>
          <Field label="Email" hint={normalisedPreview.email ? `Saved as ${normalisedPreview.email}` : undefined}>
            <TextInput type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Preferred channel">
            <Select
              placeholder="—"
              value={draft.preferred_channel}
              onChange={(e) => set('preferred_channel', e.target.value)}
              options={opts(channels.data)}
            />
          </Field>
          <Field label="Language">
            <Select
              value={draft.preferred_language}
              onChange={(e) => set('preferred_language', e.target.value)}
              options={opts(languages.data, [
                { value: 'en', label: 'English' },
                { value: 'he', label: 'Hebrew' },
                { value: 'yi', label: 'Yiddish' },
              ])}
            />
          </Field>
          <Field label="Best time to contact">
            <TextInput
              value={draft.best_time_to_contact}
              onChange={(e) => set('best_time_to_contact', e.target.value)}
              placeholder="after 8pm"
            />
          </Field>
        </FieldGroup>

        <FieldGroup title="Address">
          <Field label="Address line 1" className="sm:col-span-2">
            <TextInput value={draft.address_line1} onChange={(e) => set('address_line1', e.target.value)} />
          </Field>
          <Field label="Address line 2" className="sm:col-span-2">
            <TextInput value={draft.address_line2} onChange={(e) => set('address_line2', e.target.value)} />
          </Field>
          <Field label="City">
            <TextInput value={draft.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field label="Postcode" hint="Needed for the HMRC Gift Aid claim">
            <TextInput value={draft.postcode} onChange={(e) => set('postcode', e.target.value)} />
          </Field>
          <Field label="Country">
            <TextInput value={draft.country} onChange={(e) => set('country', e.target.value)} />
          </Field>
        </FieldGroup>

        <FieldGroup title="Relationship">
          <Field label="Relationship owner">
            <Select
              placeholder="Unassigned"
              value={draft.relationship_owner_id}
              onChange={(e) => set('relationship_owner_id', e.target.value)}
              options={(team.data ?? []).map((m) => ({ value: m.id, label: m.full_name }))}
            />
          </Field>
          <Field label="Spouse">
            <TextInput value={draft.spouse_name} onChange={(e) => set('spouse_name', e.target.value)} />
          </Field>
          <Field label="Birthday">
            <TextInput type="date" value={draft.birthday} onChange={(e) => set('birthday', e.target.value)} />
          </Field>
          <Field label="Introduced by" hint="Free text; link a contact from the profile later">
            <TextInput
              value={draft.introduced_by_note}
              onChange={(e) => set('introduced_by_note', e.target.value)}
            />
          </Field>
          <Field label="Things to remember" className="sm:col-span-2">
            <TextArea
              rows={2}
              value={draft.things_to_remember}
              onChange={(e) => set('things_to_remember', e.target.value)}
            />
          </Field>
        </FieldGroup>

        <FieldGroup title="Classification">
          <Field label="Stage" hint="Your judgement — the donor status is computed separately (I-7)">
            <Select
              value={draft.stage}
              onChange={(e) => set('stage', e.target.value)}
              options={opts(stages.data, [{ value: 'prospect', label: 'Prospect' }])}
            />
          </Field>
          <Field label="Priority">
            <Select
              value={draft.priority}
              onChange={(e) => set('priority', e.target.value)}
              options={opts(priorities.data, [
                { value: 'high', label: 'High' },
                { value: 'medium', label: 'Medium' },
                { value: 'low', label: 'Low' },
              ])}
            />
          </Field>
          <Field label="Tier">
            <Select
              placeholder="—"
              value={draft.tier}
              onChange={(e) => set('tier', e.target.value)}
              options={opts(tiers.data, [
                { value: 'A', label: 'A' },
                { value: 'B', label: 'B' },
                { value: 'C', label: 'C' },
                { value: 'D', label: 'D' },
              ])}
            />
          </Field>
          <Field label="Keep-in-touch cadence (days)" hint="Set it from the profile's preset chips too">
            <TextInput
              type="number"
              min={1}
              value={draft.contact_frequency_days}
              onChange={(e) => set('contact_frequency_days', e.target.value)}
            />
          </Field>
          <Field label="Source" className="sm:col-span-2">
            <TextInput
              value={draft.source}
              onChange={(e) => set('source', e.target.value)}
              placeholder="Dinner 2026 · introduced at shul"
            />
          </Field>
        </FieldGroup>

        {error ? (
          <p role="alert" className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}
