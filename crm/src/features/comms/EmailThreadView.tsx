import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Link } from 'react-router'
import { Button, EmptyState, Pill } from '../../components'
import { cn } from '../../lib/cn'
import { toDate } from '../../lib/format'
import { displayName } from '../contacts/normalise'
import type { EmailAttachmentRow, EmailContact, EmailRow } from '../../lib/queries/comms'
import {
  actionsFor,
  addressLabel,
  FOLDER_ACTION_LABEL,
  textFromHtml,
  type EmailFolder,
  type FolderAction,
} from './core'

export type ReplyMode = 'reply' | 'replyAll' | 'forward'

export interface EmailThreadViewProps {
  /** Oldest first. */
  messages: EmailRow[]
  contacts: Record<string, EmailContact>
  attachments: Record<string, EmailAttachmentRow[]>
  loading: boolean
  /** The folder the list is showing — decides which folder actions are offered. */
  folder: EmailFolder
  onReply: (email: EmailRow, mode: ReplyMode) => void
  onFolderAction: (action: FolderAction) => void
  onMarkUnread: () => void
  onLog: (email: EmailRow) => void
  onLink: () => void
  /** Hidden for viewers: the write policies are the real gate (11 §1). */
  canWrite: boolean
}

function stamp(value: string): string {
  const date = toDate(value)
  return date ? format(date, 'EEE d MMM yyyy, HH:mm') : ''
}

function bodyOf(email: EmailRow): string {
  const text = (email.body_text ?? '').trim()
  if (text !== '') return text
  return textFromHtml(email.body_html)
}

function AttachmentLine({ attachment }: { attachment: EmailAttachmentRow }) {
  const size =
    typeof attachment.size_bytes === 'number' && attachment.size_bytes > 0
      ? `${Math.max(1, Math.round(attachment.size_bytes / 1024))} KB`
      : null
  const stored = attachment.storage_path !== null || attachment.external_url !== null

  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-muted">
      <span className="text-nav">{attachment.filename}</span>
      {size ? <span className="text-faint">{size}</span> : null}
      {attachment.external_url ? (
        <a
          href={attachment.external_url}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-accent hover:text-accent-dark"
        >
          Open
        </a>
      ) : null}
      {!stored ? <span className="text-faint">too large to store — kept by name only</span> : null}
    </li>
  )
}

/**
 * The reading pane: one conversation, oldest first, latest expanded.
 *
 * The two actions that matter are not the mail ones. **Log to timeline** is
 * what turns a message into a CRM record (10 §1 — the integration writes
 * through `interactions` like everything else), and **Link to contact** is what
 * makes an unmatched address part of a relationship. Archive, Trash and Mark
 * unread are housekeeping and behave like every other mutation here:
 * immediate, with six seconds to undo (I-12).
 */
export function EmailThreadView({
  messages,
  contacts,
  attachments,
  loading,
  folder,
  onReply,
  onFolderAction,
  onMarkUnread,
  onLog,
  onLink,
  canWrite,
}: EmailThreadViewProps) {
  const latest = messages.length > 0 ? (messages[messages.length - 1] as EmailRow) : null
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // A newly opened thread starts with only its latest message open.
  useEffect(() => {
    setExpanded(latest ? { [latest.id]: true } : {})
  }, [latest?.id])

  if (loading && messages.length === 0) {
    return <p className="px-5 py-6 text-[13px] text-muted">Loading…</p>
  }

  if (!latest) {
    return (
      <div className="p-4">
        <EmptyState
          title="Nothing selected"
          hint="Pick a conversation on the left to read it, reply to it, or log it to a donor's timeline."
        />
      </div>
    )
  }

  const contactId = messages.find((message) => message.contact_id !== null)?.contact_id ?? null
  const contact = contactId ? contacts[contactId] : undefined
  const subject = messages.find((message) => (message.subject ?? '').trim() !== '')?.subject ?? ''
  const matchedBy = messages.find((message) => message.matched_by !== null)?.matched_by ?? null

  return (
    <div className="flex min-h-0 flex-col" data-testid="email-thread">
      <header className="flex flex-col gap-2 border-b border-border px-4 py-3 lg:px-5">
        <h2 className="text-[16px] leading-tight font-bold">{subject || '(no subject)'}</h2>

        <div className="flex flex-wrap items-center gap-2">
          {contact ? (
            <>
              <Link
                to={`/contacts/${contact.id}`}
                className="inline-flex items-center rounded-pill bg-accent-soft px-[9px] py-[3px] text-[11.5px] font-semibold text-accent-dark hover:opacity-85"
              >
                {displayName(contact) || contact.organization || 'Contact'}
              </Link>
              <span className="text-[11.5px] text-faint">
                {matchedBy === 'manual' ? 'linked by hand' : 'matched on the address'}
              </span>
            </>
          ) : (
            <Pill variant="computed" tone="neutral">
              Not linked to a contact
            </Pill>
          )}
          {canWrite ? (
            <button
              type="button"
              onClick={onLink}
              className="text-[12px] font-semibold text-accent hover:text-accent-dark"
            >
              {contact ? 'Change contact' : 'Link to contact'}
            </button>
          ) : null}
        </div>

        {canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="accentOutline" onClick={() => onLog(latest)}>
              Log to timeline
            </Button>
            {actionsFor(folder).map((action) => (
              <Button key={action} size="sm" variant="outline" onClick={() => onFolderAction(action)}>
                {FOLDER_ACTION_LABEL[action]}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={onMarkUnread}>
              Mark unread
            </Button>
          </div>
        ) : null}
      </header>

      <div className="min-h-0 grow overflow-y-auto px-4 py-3 lg:px-5">
        <ol className="flex flex-col gap-3">
          {messages.map((message) => {
            const open = expanded[message.id] === true
            const files = attachments[message.id] ?? []
            return (
              <li
                key={message.id}
                className={cn(
                  'rounded-card border border-border bg-surface',
                  message.direction === 'out' && 'border-accent-soft bg-[#FBFDFD]',
                )}
              >
                <button
                  type="button"
                  onClick={() => setExpanded((current) => ({ ...current, [message.id]: !open }))}
                  aria-expanded={open}
                  className="flex w-full flex-col gap-[2px] px-4 py-[10px] text-left"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[13px] font-semibold">{addressLabel(message.from_addr)}</span>
                    {message.direction === 'out' ? (
                      <span className="text-[11px] font-semibold text-accent-dark">sent</span>
                    ) : null}
                    <span className="ml-auto text-[11.5px] whitespace-nowrap text-faint">
                      {stamp(message.occurred_at)}
                    </span>
                  </div>
                  <div className="truncate text-[12px] text-muted">
                    to {(message.to_addrs ?? []).map(addressLabel).join(', ') || '—'}
                    {(message.cc_addrs ?? []).length > 0
                      ? ` · cc ${(message.cc_addrs ?? []).map(addressLabel).join(', ')}`
                      : ''}
                  </div>
                  {!open ? (
                    <div className="truncate text-[12.5px] text-muted">{message.snippet ?? ''}</div>
                  ) : null}
                </button>

                {open ? (
                  <div className="border-t border-border px-4 py-3">
                    <p className="text-[13.5px] leading-[1.55] whitespace-pre-wrap text-nav">
                      {bodyOf(message) || '(this message has no text)'}
                    </p>
                    {files.length > 0 ? (
                      <ul className="mt-3 flex flex-col gap-1 border-t border-border pt-2">
                        {files.map((file) => (
                          <AttachmentLine key={file.id} attachment={file} />
                        ))}
                      </ul>
                    ) : null}
                    {canWrite ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => onReply(message, 'reply')}>
                          Reply
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => onReply(message, 'replyAll')}>
                          Reply all
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => onReply(message, 'forward')}>
                          Forward
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
