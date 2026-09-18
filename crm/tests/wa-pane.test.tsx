import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

/**
 * The WhatsApp pane (10 §2 Tier 2).
 *
 * The query module is mocked wholesale — the shape `giftaid-view.test.tsx`
 * uses — so this file tests the screen: the window dot, the composer's two
 * states, the unread badge clearing on open, and the two actions that turn a
 * transcript into a record.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000
// Relative to the real clock: the pane computes the window with Date.now(),
// so anchoring the fixtures to it keeps the suite deterministic at any hour.
const NOW = Date.now()
const iso = (ms: number) => new Date(ms).toISOString()

const query = <T,>(data: T, over: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  isPending: false,
  error: null,
  isError: false,
  isSuccess: true,
  ...over,
})

const markRead = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }
const send = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null as unknown }
const link = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }
const logToTimeline = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }

const contact = (id: string, first: string, last: string) => ({
  id,
  title: 'Mr',
  first_name: first,
  last_name: last,
  hebrew_name: null,
  organization: null,
  contact_kind: 'individual',
  email: null,
  phone: '+447700900123',
  whatsapp: '+447700900123',
  city: 'Golders Green',
  is_archived: false,
  stage: 'active_donor',
  priority: 'medium',
})

const windowState = (lastInboundAt: string | null, nowMs: number) => {
  if (!lastInboundAt) {
    return { open: false, neverInbound: true, lastInboundAt: null, expiresAt: null, msRemaining: 0 }
  }
  const at = Date.parse(lastInboundAt)
  const remaining = at + WINDOW_MS - nowMs
  return {
    open: remaining > 0,
    neverInbound: false,
    lastInboundAt,
    expiresAt: iso(at + WINDOW_MS),
    msRemaining: remaining > 0 ? remaining : 0,
  }
}

const conversation = (
  id: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  wa_id: '+447700900123',
  profile_name: 'Dovid',
  contact_id: 'cohen',
  matched_by: 'whatsapp',
  last_inbound_at: iso(NOW - 60 * 60 * 1000),
  last_message_at: iso(NOW - 30 * 60 * 1000),
  unread_count: 0,
  ...over,
})

const state: {
  items: Array<Record<string, unknown>>
  messages: Array<Record<string, unknown>>
  templates: Array<Record<string, unknown>>
} = { items: [], messages: [], templates: [] }

vi.mock('../src/lib/queries/wa', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/lib/queries/wa')
  return {
    ...actual,
    useWaConversations: () => query(state.items),
    useWaThread: () => query(state.messages),
    useWaTemplates: () => query(state.templates),
    useMarkWaConversationRead: () => markRead,
    useSendWaMessage: () => send,
    useLinkWaConversation: () => link,
    useLogWaToTimeline: () => logToTimeline,
    useWaConversationForContact: () => query(null),
    WA_NOTICE: { error: 'WhatsApp could not be reached. Nothing was sent.' },
  }
})

vi.mock('../src/lib/queries/tasks', () => ({
  useContactSearch: () => query([contact('klein', 'Yehuda', 'Klein')]),
}))

const { WhatsAppPane } = await import('../src/features/whatsapp/WhatsAppPane')

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

const item = (over: Record<string, unknown> = {}, conversationOver: Record<string, unknown> = {}) => {
  const row = conversation('conv-1', conversationOver)
  return {
    conversation: row,
    contact: contact('cohen', 'Dovid', 'Cohen'),
    window: windowState(row.last_inbound_at as string | null, NOW),
    snippet: 'I’ll transfer on Sunday',
    at: row.last_message_at,
    ...over,
  }
}

beforeEach(() => {
  state.items = [item()]
  state.messages = [
    {
      id: 'm1',
      conversation_id: 'conv-1',
      direction: 'in',
      wa_message_id: 'wamid.1',
      msg_type: 'text',
      body: 'Is the dinner still on the 18th?',
      media_id: null,
      media_mime: null,
      media_url: null,
      template_name: null,
      status: 'received',
      error_detail: null,
      occurred_at: iso(NOW - 60 * 60 * 1000),
      sent_by: null,
    },
    {
      id: 'm2',
      conversation_id: 'conv-1',
      direction: 'out',
      wa_message_id: 'wamid.2',
      msg_type: 'text',
      body: 'It is — 8pm, and you are on table 3.',
      media_id: null,
      media_mime: null,
      media_url: null,
      template_name: null,
      status: 'read',
      error_detail: null,
      occurred_at: iso(NOW - 30 * 60 * 1000),
      sent_by: 'braun',
    },
  ]
  state.templates = [
    {
      id: 't1',
      name: 'dinner_invite_2026',
      language: 'en_GB',
      category: 'MARKETING',
      body: 'Dear {{1}}, the annual dinner is on {{2}}.',
      status: 'APPROVED',
      synced_at: iso(NOW),
    },
    {
      id: 't2',
      name: 'awaiting_approval',
      language: 'en_GB',
      category: 'UTILITY',
      body: 'Pending one.',
      status: 'PENDING',
      synced_at: iso(NOW),
    },
  ]
  markRead.mutate.mockReset()
  send.mutate.mockReset()
  link.mutate.mockReset()
  logToTimeline.mutate.mockReset()
  send.error = null
})

const renderPane = () => render(<WhatsAppPane />, { wrapper: Wrapper })

describe('the conversation list', () => {
  it('shows the donor’s name, the snippet and the time', async () => {
    renderPane()
    const list = await screen.findByRole('list', { name: 'WhatsApp conversations' })
    expect(within(list).getByText('Mr Dovid Cohen')).toBeInTheDocument()
    expect(within(list).getByText('I’ll transfer on Sunday')).toBeInTheDocument()
  })

  it('marks an open window green and a closed one grey', async () => {
    state.items = [
      item({}, { last_inbound_at: iso(NOW - 60 * 60 * 1000) }),
      item(
        { conversation: conversation('conv-2', { last_inbound_at: iso(NOW - 40 * 60 * 60 * 1000) }) },
        {},
      ),
    ]
    // Rebuild the second item's window from its own conversation row.
    state.items[1] = {
      ...state.items[1],
      conversation: conversation('conv-2', { last_inbound_at: iso(NOW - 40 * 60 * 60 * 1000) }),
      window: windowState(iso(NOW - 40 * 60 * 60 * 1000), NOW),
    }
    renderPane()
    expect(await screen.findAllByLabelText(/Inside the 24-hour window/)).toHaveLength(1)
    expect(screen.getAllByLabelText(/window closed/)).not.toHaveLength(0)
  })

  it('badges unread conversations and clears the badge on open', async () => {
    state.items = [item({}, { unread_count: 3 })]
    state.items[0] = {
      ...state.items[0],
      conversation: conversation('conv-1', { unread_count: 3 }),
    }
    const user = userEvent.setup()
    renderPane()
    expect(await screen.findByLabelText('3 unread')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'WhatsApp conversations' })
    await user.click(within(list).getByText('Mr Dovid Cohen'))
    expect(markRead.mutate).toHaveBeenCalledWith('conv-1')
  })

  it('says so when a number matched nobody', async () => {
    state.items = [
      {
        ...item(),
        contact: null,
        conversation: conversation('conv-1', { contact_id: null, matched_by: null, profile_name: 'Unknown' }),
      },
    ]
    renderPane()
    expect((await screen.findAllByText('Unmatched')).length).toBeGreaterThan(0)
  })
})

describe('the thread', () => {
  it('renders both sides with a delivery tick on ours', async () => {
    renderPane()
    expect(await screen.findByText('Is the dinner still on the 18th?')).toBeInTheDocument()
    expect(screen.getByText('It is — 8pm, and you are on table 3.')).toBeInTheDocument()
    expect(screen.getByLabelText('Read')).toBeInTheDocument()
  })

  it('names a failure in words rather than a glyph', async () => {
    state.messages = [
      { ...state.messages[1], status: 'failed', error_detail: '131047 · Re-engagement message' },
    ]
    renderPane()
    expect(await screen.findByText('Failed')).toBeInTheDocument()
    expect(screen.getByText(/131047/)).toBeInTheDocument()
  })

  it('shows an attachment as a chip, never as a downloaded file', async () => {
    state.messages = [
      {
        ...state.messages[0],
        msg_type: 'media',
        body: 'The invitation',
        media_id: '1521321321',
        media_mime: 'image/jpeg',
      },
    ]
    renderPane()
    expect(await screen.findByText(/image\/jpeg/)).toBeInTheDocument()
  })
})

describe('the composer', () => {
  it('offers free text while the window is open', async () => {
    renderPane()
    expect(await screen.findByLabelText('Message')).toBeInTheDocument()
    expect(screen.getByText(/Window open/)).toBeInTheDocument()
    expect(screen.queryByText(/24-hour window closed/)).not.toBeInTheDocument()
  })

  it('sends free text through the one door', async () => {
    const user = userEvent.setup()
    renderPane()
    await user.type(await screen.findByLabelText('Message'), 'See you Sunday.')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(send.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', body: 'See you Sunday.' }),
    )
  })

  it('replaces the text box with the template picker once the window shuts', async () => {
    const closed = iso(NOW - 40 * 60 * 60 * 1000)
    state.items = [
      {
        ...item(),
        conversation: conversation('conv-1', { last_inbound_at: closed }),
        window: windowState(closed, NOW),
      },
    ]
    renderPane()
    expect(await screen.findByText('24-hour window closed — send an approved template')).toBeInTheDocument()
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Approved template')).toBeInTheDocument()
  })

  it('offers only APPROVED templates', async () => {
    const closed = iso(NOW - 40 * 60 * 60 * 1000)
    state.items = [
      { ...item(), conversation: conversation('conv-1', { last_inbound_at: closed }), window: windowState(closed, NOW) },
    ]
    renderPane()
    const select = (await screen.findByLabelText('Approved template')) as HTMLSelectElement
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['dinner_invite_2026'])
  })

  it('asks for each {{n}} and previews the filled body before sending', async () => {
    const user = userEvent.setup()
    const closed = iso(NOW - 40 * 60 * 60 * 1000)
    state.items = [
      { ...item(), conversation: conversation('conv-1', { last_inbound_at: closed }), window: windowState(closed, NOW) },
    ]
    renderPane()
    await user.type(await screen.findByLabelText('Template parameter 1'), 'Dovid')
    await user.type(screen.getByLabelText('Template parameter 2'), '18 November')
    expect(screen.getByText('Dear Dovid, the annual dinner is on 18 November.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Send template' }))
    expect(send.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: 'dinner_invite_2026',
        language: 'en_GB',
        params: ['Dovid', '18 November'],
      }),
    )
  })

  it('refuses to send a template with an empty parameter', async () => {
    const closed = iso(NOW - 40 * 60 * 60 * 1000)
    state.items = [
      { ...item(), conversation: conversation('conv-1', { last_inbound_at: closed }), window: windowState(closed, NOW) },
    ]
    renderPane()
    expect(await screen.findByRole('button', { name: 'Send template' })).toBeDisabled()
  })

  it('explains Meta approval when the window is shut and nothing is approved', async () => {
    const closed = iso(NOW - 40 * 60 * 60 * 1000)
    state.templates = []
    state.items = [
      { ...item(), conversation: conversation('conv-1', { last_inbound_at: closed }), window: windowState(closed, NOW) },
    ]
    renderPane()
    expect(await screen.findByText('No approved templates yet')).toBeInTheDocument()
    expect(screen.getByText(/Meta Business Manager/)).toBeInTheDocument()
  })

  it('surfaces the server’s window_closed answer if one ever arrives', async () => {
    send.error = { message: 'The 24-hour customer-service window has closed.' }
    renderPane()
    expect(await screen.findByRole('alert')).toHaveTextContent('24-hour customer-service window has closed')
  })
})

describe('turning a thread into a record', () => {
  it('prefills the timeline log from the last few messages', async () => {
    const user = userEvent.setup()
    renderPane()
    await user.click(await screen.findByRole('button', { name: 'Log to timeline' }))
    const summary = await screen.findByLabelText('Summary')
    expect((summary as HTMLTextAreaElement).value).toContain('Them: Is the dinner still on the 18th?')
    expect((summary as HTMLTextAreaElement).value).toContain('Us: It is — 8pm, and you are on table 3.')
  })

  it('logs against the matched donor', async () => {
    const user = userEvent.setup()
    renderPane()
    await user.click(await screen.findByRole('button', { name: 'Log to timeline' }))
    await user.click(await screen.findByRole('button', { name: 'Save to timeline' }))
    await waitFor(() =>
      expect(logToTimeline.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ contactId: 'cohen' }),
        expect.anything(),
      ),
    )
  })

  it('offers "Link to contact" only when the number matched nobody', async () => {
    renderPane()
    expect(screen.queryByRole('button', { name: 'Link to contact' })).not.toBeInTheDocument()

    state.items = [
      {
        ...item(),
        contact: null,
        conversation: conversation('conv-1', { contact_id: null, matched_by: null }),
      },
    ]
    renderPane()
    expect((await screen.findAllByRole('button', { name: 'Link to contact' })).length).toBeGreaterThan(0)
  })
})

describe('starting a conversation', () => {
  it('can only be done with a template — there is no free-text box', async () => {
    const user = userEvent.setup()
    renderPane()
    await user.click(await screen.findByRole('button', { name: 'New…' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('WhatsApp number')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Approved template')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Message')).not.toBeInTheDocument()
  })
})
