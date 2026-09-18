import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { addDays, format, subDays } from 'date-fns'
import type { ReactNode } from 'react'

/**
 * The Action Stream rendered from fixtures shaped like the live rows: the
 * sections in the spec's order, the yellow I-3 section, the nudge rail, the
 * reward state, and the close-the-loop dialog every completion opens (I-4).
 */

const iso = (date: Date) => format(date, 'yyyy-MM-dd')
const NOW = new Date()

const query = <T,>(data: T) => ({ data, isLoading: false, error: null, isError: false })
const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue({}), isPending: false })

const contactBase = {
  title: null,
  hebrew_name: null,
  organization: null,
  position: null,
  industry: null,
  contact_kind: 'individual',
  is_organisation_self: false,
  photo_url: null,
  household_id: null,
  email: null,
  phone: '+447700900123',
  whatsapp: '+447700900123',
  preferred_language: 'en',
  preferred_channel: null,
  best_time_to_contact: null,
  assistant_name: null,
  assistant_contact: null,
  linkedin_url: null,
  website_url: null,
  address_line1: null,
  address_line2: null,
  city: null,
  postcode: null,
  country: 'United Kingdom',
  source: null,
  introduced_by_id: null,
  introduced_by_note: null,
  relationship_owner_id: 'braun',
  relationship_strength: null,
  known_since: null,
  mutual_connections: null,
  birthday: null,
  spouse_name: null,
  family_notes: null,
  things_to_remember: null,
  stage: 'cultivation',
  priority: 'medium',
  tier: null,
  estimated_capacity: null,
  contact_frequency_days: null,
  kit_paused_until: null,
  engagement_score: null,
  engagement_tier: 'unknown',
  pinned_note_id: null,
  is_archived: false,
  merged_into_id: null,
}

const taskBase = {
  details: null,
  assigned_to: 'braun',
  priority: 'medium',
  status: 'todo',
  waiting_for: null,
  completed_at: null,
  origin: 'manual',
  queue_order: null,
  opportunity_id: null,
}

const board = {
  tasks: [
    {
      ...taskBase,
      id: 'overdue-1',
      contact_id: 'cohen',
      title: 'Call re proposal',
      action_type: 'call',
      due_on: iso(subDays(NOW, 4)),
      priority: 'high',
    },
    {
      ...taskBase,
      id: 'overdue-2',
      contact_id: 'feld',
      title: 'WhatsApp — dinner journal ad',
      action_type: 'whatsapp',
      due_on: iso(subDays(NOW, 1)),
    },
    {
      ...taskBase,
      id: 'call-today',
      contact_id: 'frankel',
      title: 'Call about the dinner',
      action_type: 'call',
      due_on: iso(NOW),
    },
    {
      ...taskBase,
      id: 'kit-today',
      contact_id: 'goldstein',
      title: 'Keep in touch — every 2 months',
      action_type: 'keep_in_touch',
      origin: 'auto:kit',
      due_on: iso(NOW),
    },
    {
      ...taskBase,
      id: 'queued-cohen',
      contact_id: 'cohen',
      title: 'Send the naming brochure',
      action_type: 'send_proposal',
      status: 'queued',
      due_on: null,
      queue_order: 1,
    },
    {
      ...taskBase,
      id: 'future-1',
      contact_id: 'lax',
      title: 'Dinner invite',
      action_type: 'invite_event',
      due_on: iso(addDays(NOW, 3)),
    },
  ],
  doneToday: [
    {
      ...taskBase,
      id: 'done-1',
      contact_id: 'weiss',
      title: 'Thank-you call',
      action_type: 'call',
      due_on: iso(NOW),
      status: 'done',
      completed_at: NOW.toISOString(),
    },
  ],
  meetings: [
    {
      id: 'm1',
      contact_id: 'adler',
      occurred_at: new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 14, 0, 0).toISOString(),
      kind: 'meeting',
      status: 'scheduled',
      team_member_id: 'braun',
      summary: 'Office visit',
      outcome: null,
      is_meaningful: false,
      location: 'office',
      attendees: null,
      purpose: 'Building campaign proposal',
      ask_amount: null,
      source: 'manual',
    },
  ],
  contacts: {
    cohen: { ...contactBase, id: 'cohen', first_name: 'Dovid', last_name: 'Cohen', stage: 'in_discussion' },
    feld: { ...contactBase, id: 'feld', first_name: 'Shmuel', last_name: 'Feld' },
    frankel: { ...contactBase, id: 'frankel', first_name: 'Devorah', last_name: 'Frankel' },
    goldstein: { ...contactBase, id: 'goldstein', first_name: 'Moshe', last_name: 'Goldstein' },
    adler: { ...contactBase, id: 'adler', first_name: 'Reuven', last_name: 'Adler' },
    lax: { ...contactBase, id: 'lax', first_name: 'Chaim', last_name: 'Lax' },
    weiss: { ...contactBase, id: 'weiss', first_name: 'Yaakov', last_name: 'Weiss' },
    reich: { ...contactBase, id: 'reich', first_name: 'Baruch', last_name: 'Reich', stage: 'active_donor' },
  },
  stats: {
    cohen: { contact_id: 'cohen', flag: 'overdue', days_since_contact: 12, kit_due_on: null },
    reich: { contact_id: 'reich', flag: 'none', days_since_contact: 40, kit_due_on: null },
  },
  statsError: null,
  needsActionIds: ['reich'],
}

const emptyBoard = {
  tasks: [],
  doneToday: [],
  meetings: [],
  contacts: {},
  stats: {},
  statsError: null,
  needsActionIds: [],
}

const signals = {
  items: [
    {
      signal: {
        id: 's1',
        contact_id: 'cohen',
        rule_key: 'first_gift_call',
        reason: 'gave £180 on Sunday — a thank-you call within 48h is the strongest retention move',
        state: 'open',
        snoozed_until: null,
        dedupe_key: 'first_gift:cohen',
        created_at: NOW.toISOString(),
        resolved_at: null,
      },
      contact: { ...contactBase, id: 'cohen', first_name: 'Dovid', last_name: 'Cohen' },
      contactName: 'Dovid Cohen',
    },
    {
      signal: {
        id: 's2',
        contact_id: 'adler',
        rule_key: 'recurring_failing',
        reason: "£150/month payment is 9 days late. Call — don't email",
        state: 'open',
        snoozed_until: null,
        dedupe_key: 'recurring:adler',
        created_at: NOW.toISOString(),
        resolved_at: null,
      },
      contact: { ...contactBase, id: 'adler', first_name: 'Reuven', last_name: 'Adler' },
      contactName: 'Reuven Adler',
    },
  ],
  error: null,
}

/** Mutable so a test can swap in the empty board / a viewer role. */
const state = {
  board: board as unknown,
  member: { id: 'braun', role: 'admin', full_name: "R' Braun" } as unknown,
}

const completeAsync = vi.fn().mockResolvedValue({})
const createTask = { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }
const updateSignal = mutation()
const reschedule = mutation()

vi.mock('../src/lib/queries/tasks', () => ({
  useTaskBoard: () => query(state.board),
  useMonthGiving: () => query({ total: 8400, giftCount: 3, month: '2026-08-01' }),
  useUpdateTask: () => mutation(),
  useRescheduleTasks: () => reschedule,
  useCompleteTask: () => ({ ...mutation(), completeAsync }),
  useReopenTask: () => vi.fn().mockResolvedValue({}),
  useCreateTask: () => createTask,
  useActivateQueued: () => vi.fn().mockResolvedValue({}),
  useReorderQueued: () => mutation(),
  useQueuedTasks: () => query([]),
  useContactSearch: () => query([]),
  useTeamMemberOptions: () => query([{ id: 'braun', full_name: "R' Braun" }]),
  useDeleteTask: () => mutation(),
}))

vi.mock('../src/lib/queries/signals', () => ({
  useSignals: () => query(signals),
  usePledgeSummary: () => query({ overdueCount: 3, outstanding: 2400 }),
  useUpdateSignal: () => updateSignal,
  isVisibleSignal: () => true,
}))

vi.mock('../src/lib/queries/contacts', () => ({
  useLookupOptions: (list: string) =>
    query(
      list === 'stage'
        ? [
            { value: 'in_discussion', label: 'In discussion', sort_order: 0, color: null, meta: null },
            { value: 'active_donor', label: 'Active donor', sort_order: 1, color: null, meta: null },
          ]
        : list === 'action_type'
          ? [
              { value: 'call', label: 'Call', sort_order: 0, color: null, meta: null },
              { value: 'whatsapp', label: 'WhatsApp', sort_order: 1, color: null, meta: null },
            ]
          : [],
    ),
  useCreateTask: () => createTask,
  useTeamMembers: () => query([{ id: 'braun', full_name: "R' Braun" }]),
}))

vi.mock('../src/features/auth/useTeamMember', () => ({
  useTeamMember: () => query(state.member),
  isAdmin: () => true,
  canEdit: () => true,
}))

const { TodayRoute } = await import('../src/routes/Today')
const { ToastProvider } = await import('../src/components')
const { CaptureProvider } = await import('../src/features/capture/QuickCapture')

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <ToastProvider>
          <CaptureProvider>{children}</CaptureProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const renderToday = () => render(<TodayRoute />, { wrapper: Wrapper })

beforeEach(() => {
  state.board = board
  state.member = { id: 'braun', role: 'admin', full_name: "R' Braun" }
  vi.clearAllMocks()
})

describe('Action Stream — Today', () => {
  it('shows the metric strip: due today, overdue, meetings and the month money', () => {
    renderToday()
    const strip = screen.getByTestId('metric-strip')
    expect(within(strip).getByText('Due today').parentElement).toHaveTextContent('2')
    expect(within(strip).getByText('Overdue').parentElement).toHaveTextContent('2')
    expect(within(strip).getByText('Meetings today').parentElement).toHaveTextContent('1')
    expect(within(strip).getByText('£8,400')).toBeInTheDocument()
  })

  it('renders the sections in the spec order with their counts', () => {
    renderToday()
    const labels = ['MEETINGS TODAY', 'OVERDUE · 2', 'CALLS DUE · 1', 'KEEP IN TOUCH DUE · 1', 'NEEDS A NEXT ACTION · 1']
    for (const label of labels) expect(screen.getByText(label)).toBeInTheDocument()

    const rendered = screen.getAllByText(/MEETINGS TODAY|OVERDUE · 2|CALLS DUE · 1|KEEP IN TOUCH DUE · 1|NEEDS A NEXT ACTION · 1/)
    expect(rendered.map((node) => node.textContent)).toEqual(labels)
  })

  it('shows a person row per actionable item with its line and chips', () => {
    renderToday()
    // The rail renders twice (mobile fold + desktop column), so names repeat.
    expect(screen.getAllByText('Dovid Cohen').length).toBeGreaterThan(0)
    expect(screen.getByText(/Call re proposal — was due/)).toBeInTheDocument()
    expect(screen.getByText('In discussion')).toBeInTheDocument()
    expect(screen.getAllByText('12d since contact').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Call Dovid Cohen')).toHaveAttribute('href', 'tel:+447700900123')
    expect(screen.getByLabelText('WhatsApp Dovid Cohen')).toHaveAttribute(
      'href',
      'https://wa.me/447700900123',
    )
  })

  it('offers Reschedule all on the overdue header and moves them to today', async () => {
    const user = userEvent.setup()
    renderToday()
    await user.click(screen.getByRole('button', { name: 'Reschedule all overdue' }))
    await user.click(screen.getByRole('menuitem', { name: 'Move all to today' }))
    await waitFor(() => expect(reschedule.mutateAsync).toHaveBeenCalled())
    const changes = reschedule.mutateAsync.mock.calls[0]?.[0] as Array<{ due_on: string }>
    expect(changes).toHaveLength(2)
    expect(new Set(changes.map((c) => c.due_on))).toEqual(new Set([iso(NOW)]))
  })

  it('surfaces contacts with no next action as a yellow dashed section (I-3)', () => {
    renderToday()
    expect(screen.getByText('Baruch Reich')).toBeInTheDocument()
    expect(screen.getByText(/no open action — decide the next move/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Next action/ })).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: 'No next action' }).length).toBeGreaterThan(0)
  })

  it('disables Brief me on the meeting row (P2)', () => {
    renderToday()
    const brief = screen.getByRole('button', { name: 'Brief me' })
    expect(brief).toBeDisabled()
    expect(brief).toHaveAttribute('title', expect.stringContaining('phase-2'))
  })

  it('renders the nudge rail from signals, plus the pledge summary', () => {
    renderToday()
    expect(screen.getAllByText('FIRST GIFT THIS WEEK').length).toBeGreaterThan(0)
    expect(screen.getAllByText('STANDING ORDER FAILED').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/3 installments overdue/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/£2,400 outstanding/).length).toBeGreaterThan(0)
  })

  it('dismisses a nudge optimistically with an undo toast', async () => {
    const user = userEvent.setup()
    renderToday()
    await user.click(screen.getAllByRole('button', { name: 'Dismiss' })[0] as HTMLElement)
    await waitFor(() => expect(updateSignal.mutateAsync).toHaveBeenCalled())
    expect(updateSignal.mutateAsync.mock.calls[0]?.[0]).toMatchObject({
      patch: { state: 'dismissed' },
    })
    expect((await screen.findAllByTestId('toast'))[0]).toHaveTextContent('Nudge dismissed')
  })

  it('switches to Upcoming and Done tabs', async () => {
    const user = userEvent.setup()
    renderToday()
    await user.click(screen.getByRole('tab', { name: 'Upcoming' }))
    expect(screen.getByText('Dinner invite — due ' + format(addDays(NOW, 3), 'EEE d MMM'))).toBeInTheDocument()
    expect(screen.getByText('QUEUED · 1')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /^Done/ }))
    expect(screen.getByText('DONE TODAY · 1')).toBeInTheDocument()
    expect(screen.getByText('Yaakov Weiss')).toBeInTheDocument()
  })

  it('shows the reward state when nothing is due (03 §5.6)', () => {
    state.board = emptyBoard
    renderToday()
    expect(screen.getByText("Everyone's taken care of today")).toBeInTheDocument()
  })

  it('is read-only for a viewer: no money card, no completing, no rescheduling (11 §2)', () => {
    state.member = { id: 'v', role: 'viewer', full_name: 'Viewer' }
    renderToday()
    expect(screen.queryByText('£8,400')).not.toBeInTheDocument()
    expect(screen.getByText('Due today')).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /^Complete / })).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Reschedule all overdue' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Next action/ })).not.toBeInTheDocument()
    // The stream itself still reads.
    expect(screen.getByText(/Call re proposal — was due/)).toBeInTheDocument()
  })

  it('degrades with a notice when contact_stats is unavailable', () => {
    state.board = { ...board, statsError: 'relation "contact_stats" does not exist' }
    renderToday()
    expect(screen.getByText(/Derived numbers are unavailable/)).toBeInTheDocument()
    expect(screen.getAllByText('Dovid Cohen').length).toBeGreaterThan(0)
  })
})

describe('close the loop (I-4)', () => {
  it('completing a row writes the completion and opens the follow-up dialog', async () => {
    const user = userEvent.setup()
    renderToday()

    await user.click(screen.getByRole('button', { name: 'Complete Call about the dinner' }))
    await waitFor(() => expect(completeAsync).toHaveBeenCalled())

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/What.s next for Devorah Frankel/)).toBeInTheDocument()
    // Prefilled: same title, same action type, +7 days by default.
    expect(within(dialog).getByDisplayValue('Call about the dinner')).toBeInTheDocument()
    expect(within(dialog).getByDisplayValue(iso(addDays(NOW, 7)))).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }))
    await waitFor(() => expect(createTask.mutateAsync).toHaveBeenCalled())
    expect(createTask.mutateAsync.mock.calls[0]?.[0]).toMatchObject({
      contact_id: 'frankel',
      action_type: 'call',
      due_on: iso(addDays(NOW, 7)),
    })
  })

  it('offers the queued action instead when the contact has one', async () => {
    const user = userEvent.setup()
    renderToday()

    await user.click(screen.getByRole('button', { name: 'Complete Call re proposal' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Activate next queued/)).toBeInTheDocument()
    expect(within(dialog).getByText('Send the naming brochure')).toBeInTheDocument()
    expect(within(dialog).getByDisplayValue(iso(addDays(NOW, 3)))).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Activate it' })).toBeInTheDocument()
  })

  it('allows an explicit decline — the contact goes yellow, nothing is written', async () => {
    const user = userEvent.setup()
    renderToday()

    await user.click(screen.getByRole('button', { name: 'Complete Call about the dinner' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'No next action' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(createTask.mutateAsync).not.toHaveBeenCalled()
    const toasts = screen.getAllByTestId('toast')
    expect(toasts[toasts.length - 1]).toHaveTextContent('No next action for Devorah Frankel')
  })
})
