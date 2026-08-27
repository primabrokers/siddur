import { useState, type ReactNode } from 'react'
import {
  Button,
  EmptyState,
  Field,
  Pill,
  SectionLabel,
  Select,
  TextArea,
  TextInput,
} from '../../components'
import { cn } from '../../lib/cn'
import { formatDate } from '../../lib/format'
import {
  useCreateDocument,
  useCreateNote,
  useLookupOptions,
} from '../../lib/queries/contacts'
import { languageLabel } from './stats'
import type { ContactRow, DocumentRow, NoteRow, TagRow, TeamMemberLite } from './types'

export interface DetailsTabProps {
  contact: ContactRow
  tags: TagRow[]
  notes: NoteRow[]
  documents: DocumentRow[]
  team: TeamMemberLite[]
  onPinNote: (noteId: string | null) => void
}

/** 04 §5.4 — workaday facts only; anything sensitive lives in a private note. */
export function DetailsTab({ contact, tags, notes, documents, team, onPinNote }: DetailsTabProps) {
  return (
    <div className="flex flex-col gap-5">
      <RelationshipIntelligence contact={contact} tags={tags} />
      <NotesPanel contactId={contact.id} notes={notes} team={team} onPinNote={onPinNote} />
      <DocumentsPanel contactId={contact.id} documents={documents} />
    </div>
  )
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="text-[11.5px] font-semibold text-muted">{label}</span>
      <span className="text-[13px]">{value}</span>
    </div>
  )
}

export function RelationshipIntelligence({ contact, tags }: { contact: ContactRow; tags: TagRow[] }) {
  const interests = tags.filter((t) => t.category === 'interest' || t.category === 'cause')
  const communities = tags.filter((t) => t.category === 'community')
  const other = tags.filter((t) => !['interest', 'cause', 'community'].includes(t.category))

  return (
    <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-[14px]">
      <SectionLabel as="h2">Relationship intelligence</SectionLabel>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Birthday" value={contact.birthday ? formatDate(contact.birthday) : null} />
        <Fact label="Spouse" value={contact.spouse_name} />
        <Fact label="Family" value={contact.family_notes} />
        <Fact
          label="Occupation"
          value={[contact.position, contact.organization].filter(Boolean).join(', ') || contact.industry}
        />
        <Fact label="Best time to contact" value={contact.best_time_to_contact} />
        <Fact
          label="Preferred channel"
          value={contact.preferred_channel?.replace(/_/g, ' ')}
        />
        <Fact label="Language" value={languageLabel(contact.preferred_language)} />
        <Fact label="Mutual connections" value={contact.mutual_connections} />
        <Fact label="Known since" value={contact.known_since ? formatDate(contact.known_since) : null} />
        <Fact label="Assistant" value={contact.assistant_name} />
        <Fact
          label="Address"
          value={[contact.address_line1, contact.city, contact.postcode].filter(Boolean).join(', ')}
        />
        <Fact label="Source" value={contact.source} />
      </div>

      {contact.things_to_remember ? (
        <p className="rounded-input bg-row px-3 py-2 text-[13px] leading-[1.45]">
          <b>Remember:</b> {contact.things_to_remember}
        </p>
      ) : null}

      {tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-[6px]">
          {[...interests, ...communities, ...other].map((tag) => (
            <Pill key={tag.id} variant="manual" tone="neutral">
              {tag.name}
            </Pill>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function NotesPanel({
  contactId,
  notes,
  team,
  onPinNote,
}: {
  contactId: string
  notes: NoteRow[]
  team: TeamMemberLite[]
  onPinNote: (noteId: string | null) => void
}) {
  const categories = useLookupOptions('note_category')
  const create = useCreateNote()
  const [body, setBody] = useState('')
  const [category, setCategory] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const memberName = new Map(team.map((m) => [m.id, m.full_name]))

  async function add() {
    if (body.trim() === '') return
    try {
      await create.mutateAsync({
        contact_id: contactId,
        body: body.trim(),
        category: category === '' ? null : category,
        is_private: isPrivate,
      })
      setBody('')
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the note.')
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-[14px]">
      <SectionLabel as="h2">Notes</SectionLabel>

      <div className="flex flex-col gap-[10px]">
        <TextArea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Prefers calls after 8pm · ask about his son's chabura in Gateshead"
        />
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Category" className="w-[180px]">
            <Select
              placeholder="General"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={(categories.data ?? []).map((o) => ({ value: o.value, label: o.label }))}
            />
          </Field>
          <label className="flex min-h-[36px] items-center gap-2 text-[12.5px] text-nav">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="h-4 w-4 accent-[#0E6E6B]"
            />
            Private note
          </label>
          <Button className="ml-auto" disabled={create.isPending || body.trim() === ''} onClick={() => void add()}>
            {create.isPending ? 'Saving…' : 'Add note'}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-[12.5px] text-flag-overdue">
            {error}
          </p>
        ) : null}
      </div>

      {notes.length === 0 ? (
        <p className="text-[12.5px] text-muted">No notes yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.map((note) => (
            <li
              key={note.id}
              className={cn(
                'flex items-start gap-3 rounded-card border px-3 py-[10px]',
                note.is_pinned ? 'border-[#EADFB8] bg-[#FFF9E8]' : 'border-border',
              )}
            >
              <div className="min-w-0 grow">
                <div className="text-[11.5px] text-muted">
                  {formatDate(note.created_at)}
                  {note.created_by && memberName.get(note.created_by)
                    ? ` · ${memberName.get(note.created_by)}`
                    : ''}
                  {note.category ? ` · ${note.category}` : ''}
                  {note.is_private ? ' · private' : ''}
                </div>
                <p className="text-[13px] leading-[1.45] whitespace-pre-wrap">{note.body}</p>
              </div>
              <button
                type="button"
                onClick={() => onPinNote(note.is_pinned ? null : note.id)}
                className="shrink-0 text-[11.5px] font-semibold text-accent hover:text-accent-dark"
              >
                {note.is_pinned ? 'Unpin' : 'Pin'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function DocumentsPanel({ contactId, documents }: { contactId: string; documents: DocumentRow[] }) {
  const kinds = useLookupOptions('document_kind')
  const create = useCreateDocument()
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function add() {
    if (title.trim() === '' || url.trim() === '') {
      setError('A document needs a title and a link.')
      return
    }
    try {
      await create.mutateAsync({
        contact_id: contactId,
        title: title.trim(),
        url: url.trim(),
        kind: kind === '' ? null : kind,
      })
      setTitle('')
      setUrl('')
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the document.')
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-[14px]">
      <SectionLabel as="h2">Documents</SectionLabel>
      {documents.length === 0 ? (
        <EmptyState
          title="No documents linked"
          hint="Link a proposal, agreement or letter held in Drive. File uploads to Supabase Storage arrive later."
        />
      ) : (
        <ul className="flex flex-col gap-1">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-baseline gap-2 text-[13px]">
              <a
                href={doc.url ?? '#'}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-accent hover:text-accent-dark"
              >
                {doc.title}
              </a>
              <span className="text-[11.5px] text-muted">
                {doc.kind ? `${doc.kind} · ` : ''}
                {formatDate(doc.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_140px_auto]">
        <Field label="Title">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Building proposal" />
        </Field>
        <Field label="Link">
          <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Kind">
          <Select
            placeholder="—"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            options={(kinds.data ?? []).map((o) => ({ value: o.value, label: o.label }))}
          />
        </Field>
        <Button variant="outline" disabled={create.isPending} onClick={() => void add()}>
          Add link
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-[12.5px] text-flag-overdue">
          {error}
        </p>
      ) : null}
    </section>
  )
}
