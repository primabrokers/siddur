import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Button, useToast, useUndoToast } from '../../components'
import { cn } from '../../lib/cn'
import { canEdit, useTeamMember } from '../auth/useTeamMember'
import { displayName } from '../contacts/normalise'
import { useContact } from '../../lib/queries/contacts'
import {
  useEmailFolder,
  useEmailSetupStatus,
  useEmailThread,
  useLinkEmailsToContact,
  useLogEmailToTimeline,
  useMoveEmails,
  useRestoreEmailLinks,
  useSetEmailRead,
  useUnlogEmailInteraction,
  useUnreadEmailCount,
  type ContactLink,
  type EmailRow,
  type FolderMove,
} from '../../lib/queries/comms'
import { PageHeader } from '../shell/PageHeader'
import { ComposeSheet, BLANK_DRAFT, type ComposeInitial } from './ComposeSheet'
import { ContactPickerSheet } from './ContactPickerSheet'
import { EmailList } from './EmailList'
import { EmailThreadView, type ReplyMode } from './EmailThreadView'
import { commsChannels } from './slots'
import {
  addressLabel,
  EMAIL_FOLDERS,
  FOLDER_ACTION_LABEL,
  FOLDER_LABEL,
  folderAfter,
  forwardBody,
  forwardSubject,
  replySubject,
  type EmailFolder,
  type FolderAction,
} from './core'

/* -------------------------------------------------------------- the rail */

interface RailProps {
  folder: EmailFolder
  channel: string
  unread: number | undefined
  onPickFolder: (folder: EmailFolder) => void
  onPickChannel: (id: string) => void
  onCompose: () => void
  canWrite: boolean
}

function RailButton({
  active,
  label,
  badge,
  onClick,
}: {
  active: boolean
  label: string
  badge?: number | undefined
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-input px-[10px] py-[7px] text-left text-[13px] transition-colors',
        active ? 'bg-accent-soft font-semibold text-accent-dark' : 'text-nav hover:bg-row',
      )}
    >
      <span className="min-w-0 grow truncate">{label}</span>
      {badge !== undefined && badge > 0 ? (
        <span className="shrink-0 rounded-pill bg-accent px-[7px] py-[1px] text-[11px] font-bold text-surface tabular-nums">
          {badge}
        </span>
      ) : null}
    </button>
  )
}

/** One channel's rail entry, so its `useCount` hook is called unconditionally. */
function ChannelRailEntry({
  id,
  label,
  useCount,
  active,
  onPick,
}: {
  id: string
  label: string
  useCount?: () => number | undefined
  active: boolean
  onPick: (id: string) => void
}) {
  const count = useCount ? useCount() : undefined
  return <RailButton active={active} label={label} badge={count} onClick={() => onPick(id)} />
}

function CommsRail({
  folder,
  channel,
  unread,
  onPickFolder,
  onPickChannel,
  onCompose,
  canWrite,
}: RailProps) {
  const channels = commsChannels()

  return (
    <nav className="flex shrink-0 flex-col gap-3 lg:w-[186px]" aria-label="Inbox channels">
      {canWrite ? (
        <Button size="sm" onClick={onCompose} className="w-full">
          New email
        </Button>
      ) : null}

      <div className="flex flex-col gap-[2px]">
        <p className="px-[10px] pb-1 text-[11px] font-bold tracking-[.06em] text-faint uppercase">Email</p>
        {EMAIL_FOLDERS.map((entry) => (
          <RailButton
            key={entry}
            active={channel === 'email' && folder === entry}
            label={FOLDER_LABEL[entry]}
            badge={entry === 'inbox' ? unread : undefined}
            onClick={() => onPickFolder(entry)}
          />
        ))}
      </div>

      {channels.length > 0 ? (
        <div className="flex flex-col gap-[2px]">
          <p className="px-[10px] pb-1 text-[11px] font-bold tracking-[.06em] text-faint uppercase">
            Channels
          </p>
          {channels.map((entry) => (
            <ChannelRailEntry
              key={entry.id}
              id={entry.id}
              label={entry.label}
              useCount={entry.useCount}
              active={channel === entry.id}
              onPick={onPickChannel}
            />
          ))}
        </div>
      ) : null}
    </nav>
  )
}

/* --------------------------------------------------------------- the view */

type PickerMode = 'link' | 'log' | null

/**
 * The Inbox (10 §3) — a folder-based email surface, plus whatever other
 * channels have registered themselves through `slots.ts`.
 *
 * Three panes on the desktop (rail · conversations · the one you are reading),
 * stacked on mobile: the list, and the reading pane on top of it once you pick
 * something, with a Back button. Nothing here is a second timeline — the
 * `Log to timeline` button is the only path from a message into the donor
 * record, and it writes an ordinary `interactions` row (10 §1).
 */
export function CommsView() {
  const [params, setParams] = useSearchParams()
  const contactParam = params.get('contact')

  const [channel, setChannel] = useState('email')
  const [folder, setFolder] = useState<EmailFolder>('inbox')
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(null)
  const [compose, setCompose] = useState<{ open: boolean; initial: ComposeInitial }>({
    open: false,
    initial: BLANK_DRAFT,
  })
  const [picker, setPicker] = useState<PickerMode>(null)
  const [pendingLog, setPendingLog] = useState<EmailRow | null>(null)

  const { data: member } = useTeamMember()
  const canWrite = canEdit(member)

  const list = useEmailFolder(folder, contactParam)
  const thread = useEmailThread(selectedThreadKey)
  const unread = useUnreadEmailCount()
  const setup = useEmailSetupStatus()
  const filterContact = useContact(contactParam ?? undefined)

  const move = useMoveEmails()
  const setRead = useSetEmailRead()
  const link = useLinkEmailsToContact()
  const restoreLinks = useRestoreEmailLinks()
  const log = useLogEmailToTimeline()
  const unlog = useUnlogEmailInteraction()
  const withUndo = useUndoToast()
  const toast = useToast()

  const threads = list.data?.threads ?? []
  const contacts = list.data?.contacts ?? {}
  const messages = thread.data?.messages ?? []

  const activeChannel = commsChannels().find((entry) => entry.id === channel)

  const contactFilter = useMemo(() => {
    if (!contactParam) return null
    const detail = filterContact.data?.contact
    const fromList = contacts[contactParam]
    const name = detail
      ? displayName(detail) || detail.organization || 'This contact'
      : fromList
        ? displayName(fromList) || fromList.organization || 'This contact'
        : 'This contact'
    return { id: contactParam, name }
  }, [contactParam, filterContact.data, contacts])

  /* ------------------------------------------------------------ selection */

  function openThread(threadKey: string) {
    setSelectedThreadKey(threadKey)
    if (!canWrite) return
    // Opening marks read. No toast: an undo prompt for something the reader did
    // by looking would be noise — "Mark unread" is the affordance that matters.
    const target = threads.find((entry) => entry.thread_key === threadKey)
    const unreadIds = (target?.messages ?? [])
      .filter((message) => message.read_at === null && message.direction === 'in')
      .map((message) => message.id)
    if (unreadIds.length === 0) return
    const now = new Date().toISOString()
    setRead.mutate({ changes: unreadIds.map((id) => ({ id, read_at: now })) })
  }

  /* -------------------------------------------------------- folder moves */

  async function runFolderAction(action: FolderAction) {
    if (messages.length === 0) return
    const before: FolderMove[] = messages.map((message) => ({ id: message.id, folder: message.folder }))
    const after: FolderMove[] = messages.map((message) => ({
      id: message.id,
      folder: folderAfter(action, message.folder, message.direction),
    }))
    const label = FOLDER_ACTION_LABEL[action]

    setSelectedThreadKey(null)
    await withUndo({
      message: `${label === 'Restore' ? 'Restored' : `${label}d`} ${messages.length} message${
        messages.length === 1 ? '' : 's'
      }`,
      perform: () => move.mutateAsync({ moves: after }),
      undo: () => move.mutate({ moves: before }),
    })
  }

  async function markUnread() {
    const inbound = messages.filter((message) => message.direction === 'in')
    if (inbound.length === 0) return
    const before = inbound.map((message) => ({ id: message.id, read_at: message.read_at }))
    await withUndo({
      message: 'Marked unread',
      perform: () => setRead.mutateAsync({ changes: inbound.map((m) => ({ id: m.id, read_at: null })) }),
      undo: () => setRead.mutate({ changes: before }),
    })
  }

  /* ------------------------------------------------------------- linking */

  async function linkThread(contactId: string | null) {
    if (messages.length === 0) return
    const before: ContactLink[] = messages.map((message) => ({
      id: message.id,
      contact_id: message.contact_id,
      matched_by: message.matched_by,
    }))
    await withUndo({
      message: contactId ? 'Thread linked to the contact' : 'Thread unlinked',
      perform: () => link.mutateAsync({ ids: messages.map((m) => m.id), contactId }),
      undo: () => restoreLinks.mutate({ links: before }),
    })
  }

  /* ------------------------------------------------------ log to timeline */

  async function logEmail(email: EmailRow, contactId: string) {
    await withUndo({
      message: 'Logged to the timeline',
      perform: () =>
        log.mutateAsync({ email, contactId, teamMemberId: member?.id ?? null }),
      undo: (result) => unlog.mutate({ interactionId: result.id, contactId }),
    })
  }

  function startLog(email: EmailRow) {
    const contactId = messages.find((message) => message.contact_id !== null)?.contact_id ?? null
    if (contactId) {
      void logEmail(email, contactId)
      return
    }
    // I-2/I-5: an interaction cannot exist without a contact, so an unmatched
    // message asks who it was, rather than silently refusing.
    setPendingLog(email)
    setPicker('log')
  }

  /* -------------------------------------------------------------- compose */

  function openCompose(email: EmailRow | null, mode: ReplyMode | null) {
    if (!email || !mode) {
      setCompose({ open: true, initial: BLANK_DRAFT })
      return
    }
    const replyTo = email.direction === 'in' ? email.from_addr : (email.to_addrs ?? [])[0] ?? ''
    const everyone = [...(email.to_addrs ?? []), ...(email.cc_addrs ?? [])]

    if (mode === 'forward') {
      setCompose({
        open: true,
        initial: {
          to: '',
          cc: '',
          subject: forwardSubject(email.subject),
          body: forwardBody(email),
          inReplyToEmailId: null,
        },
      })
      return
    }

    setCompose({
      open: true,
      initial: {
        to: replyTo,
        cc: mode === 'replyAll' ? everyone.filter((address) => address !== replyTo).join(', ') : '',
        subject: replySubject(email.subject),
        body: `\n\nOn ${email.occurred_at.slice(0, 10)}, ${addressLabel(email.from_addr)} wrote:\n> ${(
          email.body_text ?? ''
        )
          .split('\n')
          .join('\n> ')}`,
        inReplyToEmailId: email.id,
      },
    })
  }

  /* ----------------------------------------------------------------- view */

  const showThreadPane = selectedThreadKey !== null

  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle={
          channel === 'email'
            ? `${FOLDER_LABEL[folder]} · ${threads.length} conversation${threads.length === 1 ? '' : 's'}${
                unread.data ? ` · ${unread.data} unread` : ''
              }`
            : (activeChannel?.label ?? '')
        }
      />

      {/* The shell's <main> is a scroll container, not a flex parent, so the
          three panes are given the viewport height here and scroll inside
          themselves — a mail client that scrolls the page is a mail client you
          lose your place in. Mobile keeps the natural stacked height. */}
      <div className="flex min-h-0 grow flex-col gap-3 lg:h-[calc(100dvh-168px)] lg:flex-row lg:gap-4">
        {/* Mobile: the rail is a horizontal strip above the list. */}
        <div className="lg:hidden">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {EMAIL_FOLDERS.map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => {
                  setChannel('email')
                  setFolder(entry)
                  setSelectedThreadKey(null)
                }}
                aria-current={channel === 'email' && folder === entry ? 'true' : undefined}
                className={cn(
                  'shrink-0 rounded-pill px-[11px] py-[4px] text-[12px] whitespace-nowrap',
                  channel === 'email' && folder === entry
                    ? 'bg-accent-soft font-semibold text-accent-dark'
                    : 'border border-border text-muted',
                )}
              >
                {FOLDER_LABEL[entry]}
                {entry === 'inbox' && unread.data ? ` (${unread.data})` : ''}
              </button>
            ))}
            {commsChannels().map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  setChannel(entry.id)
                  setSelectedThreadKey(null)
                }}
                aria-current={channel === entry.id ? 'true' : undefined}
                className={cn(
                  'shrink-0 rounded-pill px-[11px] py-[4px] text-[12px] whitespace-nowrap',
                  channel === entry.id
                    ? 'bg-accent-soft font-semibold text-accent-dark'
                    : 'border border-border text-muted',
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
          {canWrite && channel === 'email' ? (
            <Button size="sm" className="mt-2 w-full" onClick={() => openCompose(null, null)}>
              New email
            </Button>
          ) : null}
        </div>

        <div className="hidden lg:block">
          <CommsRail
            folder={folder}
            channel={channel}
            unread={unread.data}
            canWrite={canWrite}
            onPickFolder={(entry) => {
              setChannel('email')
              setFolder(entry)
              setSelectedThreadKey(null)
            }}
            onPickChannel={(id) => {
              setChannel(id)
              setSelectedThreadKey(null)
            }}
            onCompose={() => openCompose(null, null)}
          />
        </div>

        {channel !== 'email' && activeChannel ? (
          <section className="min-h-0 grow overflow-hidden rounded-card border border-border bg-surface">
            <activeChannel.Pane />
          </section>
        ) : (
          <>
            <section
              className={cn(
                'min-h-0 overflow-hidden rounded-card border border-border bg-surface lg:w-[340px] lg:shrink-0',
                showThreadPane ? 'hidden lg:block' : 'grow lg:grow-0',
              )}
            >
              <EmailList
                folder={folder}
                threads={threads}
                contacts={contacts}
                selectedThreadKey={selectedThreadKey}
                onSelect={openThread}
                loading={list.isPending}
                contactFilter={contactFilter}
                onClearContactFilter={() => {
                  const next = new URLSearchParams(params)
                  next.delete('contact')
                  setParams(next, { replace: true })
                  setSelectedThreadKey(null)
                }}
              />
            </section>

            <section
              className={cn(
                'min-h-0 grow overflow-hidden rounded-card border border-border bg-surface',
                showThreadPane ? 'flex flex-col' : 'hidden lg:flex lg:flex-col',
              )}
            >
              {showThreadPane ? (
                <button
                  type="button"
                  onClick={() => setSelectedThreadKey(null)}
                  className="border-b border-border px-4 py-2 text-left text-[12.5px] font-semibold text-accent lg:hidden"
                >
                  ← Back to {FOLDER_LABEL[folder]}
                </button>
              ) : null}

              <EmailThreadView
                messages={messages}
                contacts={thread.data?.contacts ?? {}}
                attachments={thread.data?.attachments ?? {}}
                loading={thread.isPending && selectedThreadKey !== null}
                folder={folder}
                canWrite={canWrite}
                onReply={(email, mode) => openCompose(email, mode)}
                onFolderAction={(action) => void runFolderAction(action)}
                onMarkUnread={() => void markUnread()}
                onLog={startLog}
                onLink={() => setPicker('link')}
              />
            </section>
          </>
        )}
      </div>

      <ComposeSheet
        open={compose.open}
        initial={compose.initial}
        configured={setup.data?.sendConfigured ?? false}
        from={setup.data?.from ?? null}
        onClose={() => setCompose((current) => ({ ...current, open: false }))}
        onSent={(result) => {
          toast.push('Sent', { tone: 'good' })
          setChannel('email')
          setFolder('sent')
          if (result.thread_key) setSelectedThreadKey(result.thread_key)
        }}
      />

      <ContactPickerSheet
        open={picker !== null}
        title={picker === 'log' ? 'Whose timeline?' : 'Link this thread to a contact'}
        hint={
          picker === 'log'
            ? 'An interaction always belongs to somebody (I-2). Pick the donor this message is about.'
            : 'Linking sets the contact on every message in this conversation, and says a person decided it.'
        }
        onClose={() => {
          setPicker(null)
          setPendingLog(null)
        }}
        onPick={(picked) => {
          const mode = picker
          const email = pendingLog
          setPicker(null)
          setPendingLog(null)
          if (mode === 'log' && email) void logEmail(email, picked.id)
          else void linkThread(picked.id)
        }}
        {...(picker === 'link' && messages.some((message) => message.contact_id !== null)
          ? {
              onClear: () => {
                setPicker(null)
                void linkThread(null)
              },
            }
          : {})}
      />
    </>
  )
}
