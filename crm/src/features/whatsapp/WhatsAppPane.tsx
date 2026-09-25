import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Button, Pill, Sheet, TextInput } from '../../components'
import { cn } from '../../lib/cn'
import {
  useMarkWaConversationRead,
  useSendWaMessage,
  useWaConversations,
  useWaTemplates,
  useWaThread,
  WA_NOTICE,
  type SendWaInput,
  type WaCallError,
} from '../../lib/queries/wa'
import { Composer, type ComposerSend } from './Composer'
import { ConversationList, WindowDot, conversationTitle } from './ConversationList'
import { LinkContactSheet } from './LinkContactSheet'
import { LogToTimelineSheet } from './LogToTimelineSheet'
import { Thread } from './Thread'
import { windowRemainingLabel } from './core'
import type { WaConversationItem } from './types'

/**
 * The WhatsApp pane (10 §2 Tier 2) — rendered by the Comms shell through
 * `registerCommsChannel`, and standalone in the fixture harness.
 *
 * Three things it is careful about:
 *
 * 1. **The window is visible before it matters.** Every list row carries a
 *    green/grey dot and the thread header carries the countdown, so the
 *    fundraiser knows what kind of reply is possible before they start typing.
 * 2. **Opening clears the badge.** Reading is the act that marks read; there is
 *    no "mark as read" button to remember (I-12).
 * 3. **The transcript is not the record.** "Log to timeline" is the first
 *    action in the header, because the summary is what the CRM is for (10 §2).
 */
export function WhatsAppPane() {
  const conversations = useWaConversations()
  const templates = useWaTemplates()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [logging, setLogging] = useState(false)
  const [linking, setLinking] = useState(false)
  const [starting, setStarting] = useState(false)

  const markRead = useMarkWaConversationRead()
  const send = useSendWaMessage()
  const thread = useWaThread(activeId)

  const items = useMemo(() => conversations.data ?? [], [conversations.data])
  const active = items.find((item) => item.conversation.id === activeId) ?? null

  // Open the first thread on a desktop-sized first load so the pane never
  // greets a fundraiser with an empty right-hand column.
  useEffect(() => {
    if (activeId === null && items.length > 0) setActiveId(items[0].conversation.id)
  }, [activeId, items])

  const open = (item: WaConversationItem) => {
    setActiveId(item.conversation.id)
    if (item.conversation.unread_count > 0) markRead.mutate(item.conversation.id)
  }

  const sendFrom = (payload: ComposerSend, extra: Partial<SendWaInput> = {}) => {
    send.mutate({
      conversationId: active?.conversation.id ?? null,
      body: payload.body,
      templateName: payload.templateName,
      language: payload.language,
      params: payload.params,
      ...extra,
    })
  }

  const sendError = send.error ? ((send.error as WaCallError).message ?? WA_NOTICE.error) : null
  const messages = thread.data ?? []

  return (
    <div className="flex min-h-0 grow flex-col lg:flex-row">
      {/* --------------------------------------------------------- the list */}
      <div className="flex min-h-0 shrink-0 flex-col border-border lg:w-[320px] lg:border-r">
        <div className="flex items-center justify-between border-b border-border px-3 py-[10px]">
          <h2 className="text-[13px] font-bold">Conversations</h2>
          <Button size="sm" variant="accentOutline" onClick={() => setStarting(true)}>
            New…
          </Button>
        </div>
        <div className="min-h-0 grow overflow-y-auto">
          <ConversationList
            items={items}
            activeId={activeId}
            onOpen={open}
            isLoading={conversations.isLoading}
          />
        </div>
      </div>

      {/* ------------------------------------------------------- the thread */}
      <div className="flex min-h-0 grow flex-col">
        {active ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface px-4 py-3">
              <div className="min-w-0 grow">
                <div className="flex items-center gap-2">
                  <WindowDot
                    open={active.window.open}
                    title={active.window.open ? 'Window open' : 'Window closed'}
                  />
                  <h3 className="truncate text-[14.5px] font-bold">{conversationTitle(active)}</h3>
                  {active.contact ? (
                    <Link
                      to={`/contacts/${active.contact.id}`}
                      className="shrink-0 rounded-pill bg-accent-soft px-[8px] py-[2px] text-[11.5px] font-semibold text-accent-dark"
                    >
                      Open profile
                    </Link>
                  ) : (
                    <Pill variant="computed" tone="neutral">
                      Unmatched
                    </Pill>
                  )}
                </div>
                <p className="mt-[2px] text-[12px] text-muted">
                  {active.conversation.wa_id}
                  {active.conversation.matched_by ? ` · matched by ${active.conversation.matched_by}` : ''}
                  {' · '}
                  <span className={cn(active.window.open ? 'text-good' : 'text-muted')}>
                    {active.window.open
                      ? `24-hour window ${windowRemainingLabel(active.window)}`
                      : active.window.neverInbound
                        ? 'never messaged us — templates only'
                        : '24-hour window closed'}
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setLogging(true)}>
                  Log to timeline
                </Button>
                {active.contact ? null : (
                  <Button size="sm" variant="outline" onClick={() => setLinking(true)}>
                    Link to contact
                  </Button>
                )}
              </div>
            </div>

            <div className="min-h-0 grow overflow-y-auto bg-ground">
              <Thread messages={messages} isLoading={thread.isLoading} />
            </div>

            <Composer
              hasConversation
              lastInboundAt={active.conversation.last_inbound_at}
              templates={templates.data ?? []}
              onSend={(payload) => sendFrom(payload)}
              sending={send.isPending}
              error={sendError}
            />
          </>
        ) : (
          <div className="flex grow items-center justify-center px-6 py-10 text-center">
            <p className="max-w-[46ch] text-[12.5px] leading-[1.6] text-muted">
              Pick a conversation on the left. Inbound WhatsApp messages arrive here by webhook; nothing is
              ever sent automatically — a person presses send (I-10).
            </p>
          </div>
        )}
      </div>

      <LogToTimelineSheet
        open={logging}
        onClose={() => setLogging(false)}
        contact={active?.contact ?? null}
        messages={messages}
      />
      <LinkContactSheet
        open={linking}
        onClose={() => setLinking(false)}
        conversationId={active?.conversation.id ?? null}
        waId={active?.conversation.wa_id ?? ''}
      />
      <NewConversationSheet
        open={starting}
        onClose={() => setStarting(false)}
        templates={templates.data ?? []}
        sending={send.isPending}
        error={sendError}
        onSend={(payload, toWaId) => sendFrom(payload, { conversationId: null, toWaId })}
      />
    </div>
  )
}

interface NewConversationSheetProps {
  open: boolean
  onClose: () => void
  templates: WaConversationSheetTemplates
  sending: boolean
  error: string | null
  onSend: (payload: ComposerSend, toWaId: string) => void
}

type WaConversationSheetTemplates = Parameters<typeof Composer>[0]['templates']

/**
 * Starting a conversation. **Template only** — there has never been an inbound
 * message from this number, so the 24-hour window has never opened and
 * free-form is not a thing WhatsApp will carry. The composer is handed a null
 * `lastInboundAt`, which puts it in exactly that state rather than special-
 * casing it here.
 */
function NewConversationSheet({ open, onClose, templates, sending, error, onSend }: NewConversationSheetProps) {
  const [number, setNumber] = useState('')

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New WhatsApp conversation"
      leading={
        <button type="button" onClick={onClose} className="text-[13px] text-muted">
          Cancel
        </button>
      }
    >
      <div className="flex flex-col gap-3 px-4 py-4">
        <label className="flex flex-col gap-[6px]">
          <span className="text-[12px] font-semibold text-muted">WhatsApp number</span>
          <TextInput
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            placeholder="+44 7700 900123"
            aria-label="WhatsApp number"
          />
        </label>
        <p className="text-[11.5px] leading-[1.5] text-faint">
          A conversation nobody has written to us from can only be opened with an approved template, and the
          donor must have opted in to hear from the yeshiva on WhatsApp.
        </p>
      </div>
      <Composer
        hasConversation
        lastInboundAt={null}
        templates={templates}
        sending={sending}
        error={error}
        onSend={(payload) => {
          if (number.trim() === '') return
          onSend(payload, number.trim())
          onClose()
        }}
      />
    </Sheet>
  )
}
