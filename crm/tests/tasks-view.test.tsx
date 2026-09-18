import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { addDays, format, subDays } from 'date-fns'
import type { ReactNode } from 'react'

/** The Tasks view (04 §3): status groups, inline edits, filters, the picker. */

const iso = (date: Date) => format(date, 'yyyy-MM-dd')
const NOW = new Date()

const query = <T,>(data: T) => ({ data, isLoading: false, error: null, isError: false })
const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue({}), isPending: false })

const contact = (id: string, first: string, last: string) => ({
  id,
  title: null,
  first_name: first,
  last_name: last,
  hebrew_name: null,
  organization: null,
  position: null,
  industry: null,
  contact_kind: 'individual',
  is_organisation_self: false,
  photo_url: null,
  household_id: null,
  email: null,
  phone: null,
  whatsapp: null,
  preferred_language: 'en',
  preferred_channel: null,
  best_time_to_contact: null,
  assistant_name: null,
  assistant_contact: null,
  linkedin_url: null,
  website_url: null,
  address_line1: null,
  address_line2: null,
  city: 'Hendon',
  postcode: null,
  country: 'United Kingdom',
  source: null,
  introduced_by_id: null,
  introduced_by_note: null,
  relationship_owner_id: null,
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
})

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
    { ...taskBase, id: 'today-1', contact_id: 'cohen', title: 'Call about the dinner', action_type: 'call', due_on: iso(NOW) },
    { ...taskBase, id: 'overdue-1', contact_id: 'feld', title: 'Send the proposal', action_type: 'send_proposal', due_on: iso(subDays(NOW, 3)), origin: 'quick_capture_ai' },
    { ...taskBase, id: 'upcoming-1', contact_id: 'cohen', title: 'Dinner invite', action_type: 'invite_event', due_on: iso(addDays(NOW, 6)) },
    { ...taskBase, id: 'waiting-1', contact_id: 'katz', title: 'Gift Aid form', action_type: 'other', status: 'waiting', due_on: iso(NOW), waiting_for: 'GA form sent 12 May — awaiting return' },
    { ...taskBase, id: 'queued-1', contact_id: 'cohen', title: 'Send the naming brochure', action_type: 'send_proposal', status: 'queued', due_on: null, queue_order: 1 },
    { ...taskBase, id: 'queued-2', contact_id: 'cohen', title: 'Invite to the siyum', action_type: 'invite_event', status: 'queued', due_on: null, queue_order: 2 },
    { ...taskBase, id: 'kit-1', contact_id: 'katz', title: 'Keep in touch', action_type: 'keep_in_touch', origin: 'auto:kit', due_on: iso(NOW) },
  ],
  doneToday: [
    { ...taskBase, id: 'done-1', contact_id: 'feld', title: 'Thank-you call', action_type: 'call', due_on: iso(NOW), status: 'done', completed_at: NOW.toISOString() },
  ],
  meetings: [],
  contacts: {
    cohen: contact('cohen', 'Dovid', 'Cohen'),
    feld: contact('feld', 'Shmuel', 'Feld'),
    katz: contact('katz', 'Yanky', 'Katz'),
  },
  stats: {},
  statsError: null,
  needsActionIds: [],
}

const state = { member: { id: 'braun', role: 'admin', full_name: "R' Braun" } as unknown }
const update = mutation()
const reorder = mutation()
const completeAsync = vi.fn().mockResolvedValue({})

vi.mock('../src/lib/queries/tasks', () => ({
  useTaskBoard: () => query(board),
  useMonthGiving: () => query({ total: 0, giftCount: 0, month: '2026-08-01' }),
  useUpdateTask: () => update,
  useRescheduleTasks: () => mutation(),
  useCompleteTask: () => ({ ...mutation(), completeAsync }),
  useReopenTask: () => vi.fn().mockResolvedValue({}),
  useCreateTask: () => mutation(),
  useActivateQueued: () => vi.fn().mockResolvedValue({}),
  useReorderQueued: () => reorder,
  useQueuedTasks: () => query([]),
  useContactSearch: () => query([contact('cohen', 'Dovid', 'Cohen'), contact('feld', 'Shmuel', 'Feld')]),
  useTeamMemberOptions: () => query([{ id: 'braun', full_name: "R' Braun" }, { id: 'other', full_name: 'Mrs Klein' }]),
  useDeleteTask: () => mutation(),
}))

vi.mock('../src/lib/queries/contacts', () => ({
  useLookupOptions: (list: string) =>
    query(
      list === 'action_type'
        ? [
            { value: 'call', label: 'Call', sort_order: 0, color: null, meta: null },
            { value: 'send_proposal', label: 'Send proposal', sort_order: 1, color: null, meta: null },
          ]
        : list === 'priority'
          ? [
              { value: 'high', label: 'High', sort_order: 0, color: null, meta: null },
              { value: 'medium', label: 'Medium', sort_order: 1, color: null, meta: null },
              { value: 'low', label: 'Low', sort_order: 2, color: null, meta: null },
            ]
          : [],
    ),
  useCreateTask: () => mutation(),
  useTeamMembers: () => query([]),
}))

vi.mock('../src/features/auth/useTeamMember', () => ({
  useTeamMember: () => query(state.member),
  isAdmin: () => true,
  canEdit: () => true,
}))

const { TasksRoute } = await import('../src/routes/Tasks')
const { ToastProvider } = await import('../src/components')

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/tasks']}>
        <ToastProvider>{children}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const renderTasks = () => render(<TasksRoute />, { wrapper: Wrapper })

beforeEach(() => {
  state.member = { id: 'braun', role: 'admin', full_name: "R' Braun" }
  vi.clearAllMocks()
})

describe('Tasks view (04 §3)', () => {
  it('groups by status in the spec order', () => {
    renderTasks()
    const headings = screen
      .getAllByText(/^(TODAY|OVERDUE|UPCOMING|WAITING|QUEUED|DONE TODAY) · \d+$/)
      .map((node) => node.textContent)
    expect(headings).toEqual([
      'TODAY · 2',
      'OVERDUE · 1',
      'UPCOMING · 1',
      'WAITING · 1',
      'QUEUED · 2',
      'DONE TODAY · 1',
    ])
  })

  it('always shows the contact (I-2) and badges automation / AI origins', () => {
    renderTasks()
    expect(screen.getAllByRole('link', { name: 'Dovid Cohen' }).length).toBeGreaterThan(0)
    // "AI capture" also names an origin filter option, so match the badge only.
    const badges = screen.getAllByText(/AI capture|Keep in touch/).map((n) => n.textContent)
    expect(badges).toContain('AI capture')
    expect(badges).toContain('Keep in touch')
  })

  it('shows waiting_for inline on waiting rows', () => {
    renderTasks()
    expect(screen.getByText('Waiting — GA form sent 12 May — awaiting return')).toBeInTheDocument()
  })

  it('edits due, priority and assignee inline', async () => {
    const user = userEvent.setup()
    renderTasks()

    await user.selectOptions(screen.getByLabelText('Priority for Call about the dinner'), 'high')
    await waitFor(() => expect(update.mutateAsync).toHaveBeenCalled())
    expect(update.mutateAsync.mock.calls[0]?.[0]).toMatchObject({
      id: 'today-1',
      patch: { priority: 'high' },
    })

    await user.selectOptions(screen.getByLabelText('Assignee for Dinner invite'), 'other')
    await waitFor(() => expect(update.mutateAsync).toHaveBeenCalledTimes(2))
    expect(update.mutateAsync.mock.calls[1]?.[0]).toMatchObject({
      id: 'upcoming-1',
      patch: { assigned_to: 'other' },
    })
  })

  it('orders the queue and moves rows with arrows (drag disabled)', async () => {
    const user = userEvent.setup()
    renderTasks()
    expect(screen.getByLabelText('Move Send the naming brochure up')).toBeDisabled()
    await user.click(screen.getByLabelText('Move Send the naming brochure down'))
    await waitFor(() => expect(reorder.mutateAsync).toHaveBeenCalled())
    expect(reorder.mutateAsync.mock.calls[0]?.[0]).toEqual([
      { id: 'queued-1', queue_order: 2 },
      { id: 'queued-2', queue_order: 1 },
    ])
  })

  it('filters by action type and by origin', async () => {
    const user = userEvent.setup()
    renderTasks()
    await user.selectOptions(screen.getByLabelText('Filter by action type'), 'call')
    expect(screen.getByText('TODAY · 1')).toBeInTheDocument()
    expect(screen.queryByText('QUEUED · 2')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Filter by action type'), '')
    await user.selectOptions(screen.getByLabelText('Filter by origin'), 'auto')
    expect(screen.getByText('TODAY · 1')).toBeInTheDocument()
    expect(screen.getAllByText('Keep in touch').length).toBeGreaterThan(0)
  })

  it('starts a new task with the contact picker (I-2)', async () => {
    const user = userEvent.setup()
    renderTasks()
    await user.click(screen.getByRole('button', { name: /New task/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Search contacts')).toBeInTheDocument()
    // No title field until a person is chosen.
    expect(within(dialog).queryByLabelText('What needs doing')).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /Dovid Cohen/ }))
    expect(within(dialog).getByText(/every task belongs to a person/)).toBeInTheDocument()
  })

  it('runs close-the-loop on completion here too (I-4)', async () => {
    const user = userEvent.setup()
    renderTasks()
    const row = screen.getByText('Call about the dinner').closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(completeAsync).toHaveBeenCalled())
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/What.s next for Dovid Cohen/)).toBeInTheDocument()
  })

  it('is read-only for a viewer (11 §2)', () => {
    state.member = { id: 'v', role: 'viewer', full_name: 'Viewer' }
    renderTasks()
    expect(screen.queryByRole('button', { name: /New task/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Priority for Call about the dinner')).toBeDisabled()
    expect(screen.queryAllByRole('button', { name: 'Done' })).toHaveLength(0)
  })
})
