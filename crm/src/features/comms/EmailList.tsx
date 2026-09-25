import { format, isToday, isThisYear } from 'date-fns'
import { Link } from 'react-router'
import { EmptyState, Pill } from '../../components'
import { cn } from '../../lib/cn'
import { toDate } from '../../lib/format'
import { displayName } from '../contacts/normalise'
import type { EmailContact, EmailRow } from '../../lib/queries/comms'
import { counterpartLabel, FOLDER_LABEL, type EmailFolder, type EmailThread } from './core'

export interface EmailListProps {
  folder: EmailFolder
  threads: Array<EmailThread<EmailRow>>
  contacts: Record<string, EmailContact>
  selectedThreadKey: string | null
  onSelect: (threadKey: string) => void
  loading: boolean
  /** Set when the list is scoped to one contact — draws the filter chip. */
  contactFilter: { id: string; name: string } | null
  onClearContactFilter: () => void
}

/** Today → time; this year → "14 Mar"; older → "14 Mar 25". */
function listTime(value: string): string {
  const date = toDate(value)
  if (!date) return ''
  if (isToday(date)) return format(date, 'HH:mm')
  if (isThisYear(date)) return format(date, 'd MMM')
  return format(date, 'd MMM yy')
}

const EMPTY_HINT: Record<EmailFolder, string> = {
  inbox:
    'Received mail lands here once the provider webhook is pointed at this project. Settings ▸ Email has the URL to paste.',
  sent: 'Mail you send from here is kept in this folder, threaded onto whatever it replied to.',
  archive: 'Messages you archive move here. Nothing is deleted — Archive and Trash are both just folders.',
  trash: 'Trashed messages wait here. Restoring one puts it back where it came from.',
}

/**
 * The middle pane: one row per conversation, newest first.
 *
 * The row says the four things a fundraiser scans for — who, what, a line of
 * it, and when — and an unread conversation says so in weight rather than in
 * colour, so the flag language stays reserved for relationship state (03 §2).
 */
export function EmailList({
  folder,
  threads,
  contacts,
  selectedThreadKey,
  onSelect,
  loading,
  contactFilter,
  onClearContactFilter,
}: EmailListProps) {
  return (
    <div className="flex min-h-0 flex-col" data-testid="email-list">
      {contactFilter ? (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <span className="text-[12px] text-muted">Showing</span>
          <span className="inline-flex items-center gap-[6px] rounded-pill bg-accent-soft px-[9px] py-[3px] text-[11.5px] font-semibold text-accent-dark">
            {contactFilter.name}
            <button
              type="button"
              onClick={onClearContactFilter}
              aria-label={`Clear the ${contactFilter.name} filter`}
              className="opacity-70 hover:opacity-100"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </span>
        </div>
      ) : null}

      <div className="min-h-0 grow overflow-y-auto">
        {loading && threads.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-muted">Loading…</p>
        ) : threads.length === 0 ? (
          <div className="p-3">
            <EmptyState
              title={contactFilter ? `No email with ${contactFilter.name}` : `${FOLDER_LABEL[folder]} is empty`}
              hint={contactFilter ? 'Nothing in this folder is linked to them yet.' : EMPTY_HINT[folder]}
            />
          </div>
        ) : (
          <ul>
            {threads.map((thread) => {
              const latest = thread.latest
              const contact = thread.contact_id ? contacts[thread.contact_id] : undefined
              const unread = thread.unread > 0
              const selected = thread.thread_key === selectedThreadKey

              return (
                <li key={thread.thread_key}>
                  <button
                    type="button"
                    onClick={() => onSelect(thread.thread_key)}
                    aria-current={selected ? 'true' : undefined}
                    data-unread={unread ? 'true' : undefined}
                    className={cn(
                      'flex w-full flex-col gap-[3px] border-b border-border px-3 py-[10px] text-left transition-colors',
                      selected ? 'bg-accent-soft' : 'hover:bg-row',
                    )}
                  >
                    <div className="flex items-baseline gap-2">
                      <span
                        className={cn(
                          'min-w-0 grow truncate text-[13px]',
                          unread ? 'font-bold text-ink' : 'text-nav',
                        )}
                      >
                        {counterpartLabel(latest)}
                      </span>
                      {thread.messages.length > 1 ? (
                        <span
                          className="shrink-0 text-[11px] text-faint"
                          title={`${thread.messages.length} messages in this folder`}
                        >
                          {thread.messages.length}
                        </span>
                      ) : null}
                      <span className="shrink-0 text-[11.5px] whitespace-nowrap text-faint">
                        {listTime(latest.occurred_at)}
                      </span>
                    </div>

                    <div
                      className={cn(
                        'truncate text-[13px]',
                        unread ? 'font-semibold text-ink' : 'text-nav',
                      )}
                    >
                      {thread.subject || '(no subject)'}
                    </div>

                    <div className="truncate text-[12px] text-muted">
                      {latest.snippet || '(no preview)'}
                    </div>

                    <div className="flex items-center gap-2 pt-[2px]">
                      {contact ? (
                        <Link
                          to={`/contacts/${contact.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex items-center rounded-pill bg-row px-[8px] py-[2px] text-[11px] text-nav hover:text-accent-dark"
                        >
                          {displayName(contact) || contact.organization || 'Contact'}
                        </Link>
                      ) : (
                        <Pill variant="computed" tone="neutral">
                          Not linked
                        </Pill>
                      )}
                      {unread ? (
                        <span className="text-[11px] font-semibold text-accent-dark">
                          {thread.unread} unread
                        </span>
                      ) : null}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
