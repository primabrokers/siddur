import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { addDays, format, subDays } from 'date-fns'
import type { ReactNode } from 'react'
import { ToastProvider } from '../src/components'

/**
 * The Pipeline board (06 §2 · artboard A5): the columns and their exit
 * criteria, the card language, the urgency order, the header's weighted
 * totals, the stale panel — and the three drag outcomes (stage, won, lost)
 * with the prompts each one owes the fundraiser.
 */

const iso = (date: Date) => format(date, 'yyyy-MM-dd')
const stamp = (daysAgo: number) => subDays(new Date(), daysAgo).toISOString()
const NOW = new Date()

const query = <T,>(data: T) => ({ data, isLoading: false, error: null, isError: false })
const mutation = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue({ id: 'new-task' }),
  isPending: false,
})

const contact = (id: string, first: string, last: string, ownerId: string) => ({
  id,
  title: null,
  first_name: first,
  last_name: last,
  hebrew_name: null,
  organization: null,
  contact_kind: 'individual',
  relationship_owner_id: ownerId,
  is_archived: false,
  stage: 'in_discussion',
})

const opportunity = (over: Record<string, unknown>) => ({
  id: 'o',
  contact_id: 'katz',
  name: 'Kollel wing naming',
  campaign_id: null,
  fund_id: null,
  ask_amount: 40000,
  ask_date: null,
  projection_high: null,
  projection_low: null,
  probability_pct: 40,
  expected_amount: null,
  stage: 'qualified',
  stage_entered_at: stamp(5),
  last_moved_forward_at: stamp(5),
  expected_decision_on: iso(addDays(NOW, 84)),
  motivation: null,
  restrictions: null,
  status: 'open',
  opened_on: iso(subDays(NOW, 120)),
  closed_on: null,
  lost_reason: null,
  notes: null,
  ...over,
})

const task = (over: Record<string, unknown>) => ({
  id: 't',
  contact_id: 'katz',
  opportunity_id: 'katz-ask',
  title: 'Lunch after yomim noraim',
  action_type: 'meeting',
  details: null,
  assigned_to: null,
  due_on: iso(NOW),
  priority: 'medium',
  status: 'todo',
  waiting_for: null,
  queue_order: null,
  completed_at: null,
  origin: 'manual',
  ...over,
})

const board = {
  opportunities: [
    opportunity({ id: 'katz-ask', contact_id: 'katz' }),
    opportunity({
      id: 'feld-ask',
      contact_id: 'feld',
      name: 'Dinner sponsorship',
      ask_amount: 12000,
      probability_pct: 20,
      expected_decision_on: null,
      // 38 days in `qualified` (rot 30) and 96 days without forward motion.
      stage_entered_at: stamp(38),
      last_moved_forward_at: stamp(96),
    }),
    opportunity({
      id: 'cohen-ask',
      contact_id: 'cohen',
      name: 'Building campaign',
      stage: 'cultivating',
      ask_amount: 20000,
      probability_pct: 70,
      expected_decision_on: iso(addDays(NOW, 45)),
    }),
    opportunity({
      id: 'halberstam-ask',
      contact_id: 'halberstam',
      name: 'Legacy discussion',
      stage: 'cultivating',
      ask_amount: 80000,
      probability_pct: 30,
      expected_decision_on: null,
    }),
    opportunity({
      id: 'adler-ask',
      contact_id: 'adler',
      name: 'Proposal sent',
      stage: 'solicited',
      ask_amount: 35000,
      probability_pct: 60,
      expected_decision_on: iso(addDays(NOW, 21)),
      stage_entered_at: stamp(4),
      last_moved_forward_at: stamp(4),
    }),
  ],
  contacts: {
    katz: contact('katz', 'Naftoli', 'Katz', 'braun'),
    feld: contact('feld', 'Feld Brothers', 'Ltd', 'braun'),
    cohen: contact('cohen', 'Dovid', 'Cohen', 'braun'),
    halberstam: contact('halberstam', 'Bina', 'Halberstam', 'klein'),
    adler: contact('adler', 'Reuven', 'Adler', 'braun'),
  },
  tasks: [
    task({ id: 'katz-task', opportunity_id: 'katz-ask', due_on: iso(NOW) }),
    task({
      id: 'cohen-task',
      opportunity_id: 'cohen-ask',
      contact_id: 'cohen',
      title: 'Call re proposal',
      due_on: iso(subDays(NOW, 3)),
    }),
    task({
      id: 'halberstam-task',
      opportunity_id: 'halberstam-ask',
      contact_id: 'halberstam',
      title: 'Home visit',
      due_on: iso(addDays(NOW, 6)),
    }),
    task({
      id: 'adler-task',
      opportunity_id: 'adler-ask',
      contact_id: 'adler',
      title: 'Auto follow-up',
      status: 'waiting',
      due_on: iso(addDays(NOW, 2)),
    }),
  ],
}

const STAGES = [
  { value: 'identified', label: 'Identified', sort_order: 10, color: null, meta: { exit_criteria: 'We know who they are', rot_days: 45 } },
  { value: 'qualified', label: 'Qualified', sort_order: 20, color: null, meta: { exit_criteria: 'Capacity confirmed', rot_days: 30 } },
  { value: 'cultivating', label: 'Cultivating', sort_order: 30, color: null, meta: { exit_criteria: 'Ready to be asked', rot_days: 45 } },
  { value: 'solicited', label: 'Solicited', sort_order: 40, color: null, meta: { exit_criteria: 'Answer received', rot_days: 14 } },
  { value: 'pledged', label: 'Pledged', sort_order: 50, color: null, meta: { exit_criteria: 'Paid in full' } },
]

const LOST_REASONS = [
  { value: 'no_capacity', label: 'No capacity right now', sort_order: 10, color: null, meta: {} },
  { value: 'gave_elsewhere', label: 'Gave elsewhere', sort_order: 20, color: null, meta: {} },
]

const update = mutation()
const save = mutation()
const remove = mutation()
const createNextMove = mutation()
const deleteNextMove = mutation()
const navigate = vi.fn()
const state = { member: { id: 'braun', role: 'admin', full_name: "R' Braun" } as unknown }

vi.mock('../src/lib/queries/pipeline', () => ({
  usePipelineBoard: () => query(board),
  useUpdateOpportunity: () => update,
  useSaveOpportunity: () => save,
  useDeleteOpportunity: () => remove,
  useCreateNextMove: () => createNextMove,
  useDeleteNextMove: () => deleteNextMove,
}))

vi.mock('../src/lib/queries/contacts', () => ({
  useLookupOptions: (list: string) =>
    query(
      list === 'opportunity_stage'
        ? STAGES
        : list === 'opportunity_lost_reason'
          ? LOST_REASONS
          : [{ value: 'call', label: 'Call', sort_order: 10, color: null, meta: {} }],
    ),
}))

vi.mock('../src/lib/queries/settings', () => ({
  useAutomationRules: () => query([{ rule_key: 'stale_prospects', is_enabled: true, params: { days: 90 } }]),
}))

vi.mock('../src/lib/queries/giving', () => ({
  useGivingSelects: () => query({ funds: [], campaigns: [], appeals: [] }),
}))

vi.mock('../src/features/auth/useTeamMember', () => ({
  useTeamMember: () => query(state.member),
  canEdit: () => true,
  isAdmin: () => true,
}))

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => navigate,
}))

import { PipelineView } from '../src/features/pipeline'

function mount(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

/** A drag from `card` onto `target`, the way the browser sequences it. */
function drag(card: HTMLElement, target: HTMLElement, id: string) {
  const dataTransfer = {
    setData: vi.fn(),
    getData: () => id,
    effectAllowed: '',
    dropEffect: '',
  }
  fireEvent.dragStart(card, { dataTransfer })
  fireEvent.dragOver(target, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.member = { id: 'braun', role: 'admin', full_name: "R' Braun" }
})

describe('the board', () => {
  it('renders a column per stage with its exit criteria, rot threshold and Σ ask', () => {
    mount(<PipelineView />)

    const qualified = screen.getByRole('region', { name: /^Qualified/ })
    expect(within(qualified).getByText(/exit: Capacity confirmed · rot 30d/)).toBeInTheDocument()
    expect(within(qualified).getByText('£52k')).toBeInTheDocument()

    const pledged = screen.getByRole('region', { name: /^Pledged/ })
    // No rot threshold on the stage → the header simply omits the clause.
    expect(within(pledged).getByText('exit: Paid in full')).toBeInTheDocument()
  })

  it('carries donor, ask, probability, decision and the next move on each card', () => {
    mount(<PipelineView />)

    const card = screen.getByTestId('opportunity-card-cohen-ask')
    expect(within(card).getByText('Dovid Cohen')).toBeInTheDocument()
    expect(within(card).getByText('£20k')).toBeInTheDocument()
    expect(within(card).getByText(/Building campaign · 70% · decide/)).toBeInTheDocument()
    expect(within(card).getByText('Next: Call re proposal — overdue')).toBeInTheDocument()
    expect(card).toHaveAttribute('data-flag', 'overdue')
  })

  it('shades a rotting card and says why, without a badge or a notification', () => {
    mount(<PipelineView />)

    const feld = screen.getByTestId('opportunity-card-feld-ask')
    expect(feld).toHaveAttribute('data-rotting', 'true')
    expect(within(feld).getByText('Rotting — idle 38 days in stage')).toBeInTheDocument()
    expect(within(feld).getByText('No next move — decide one')).toBeInTheDocument()
    expect(feld).toHaveAttribute('data-flag', 'none')
  })

  it('sorts by urgency inside a column, not by value', () => {
    mount(<PipelineView />)

    const qualified = screen.getByRole('region', { name: /^Qualified/ })
    const order = within(qualified)
      .getAllByRole('button')
      .map((node) => node.getAttribute('data-testid'))
      .filter((id): id is string => Boolean(id))
    // Katz is due today (orange); Feld has no next move (yellow) — yellow sorts
    // worse than a future grey but better than nothing above it.
    expect(order).toEqual(['opportunity-card-katz-ask', 'opportunity-card-feld-ask'])
  })

  it('shows Σ ask, Σ weighted, the open count and the no-next-move count', () => {
    mount(<PipelineView />)

    // Mine (Braun owns everyone but Halberstam): 40k + 12k + 20k + 35k.
    expect(screen.getByText('£107,000')).toBeInTheDocument()
    expect(screen.getByText('£53,400')).toBeInTheDocument()
    expect(screen.getByText(/4 open · 1 needs a next move/)).toBeInTheDocument()
  })

  it('widens to the whole portfolio on Everyone', async () => {
    const user = userEvent.setup()
    mount(<PipelineView />)

    await user.click(screen.getByRole('button', { name: 'Everyone' }))

    expect(screen.getByText('£187,000')).toBeInTheDocument()
    expect(screen.getByText(/5 open · 1 needs a next move/)).toBeInTheDocument()
    expect(screen.getByTestId('opportunity-card-halberstam-ask')).toBeInTheDocument()
  })

  it('lists the asks with no forward move in the stale panel', () => {
    mount(<PipelineView />)

    const panel = screen.getByRole('complementary', { name: 'Stale prospects' })
    expect(within(panel).getByText('Feld Brothers Ltd')).toBeInTheDocument()
    expect(within(panel).getByText('no forward move in 96 days')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Review' })).toBeInTheDocument()
  })
})

describe('dragging a card', () => {
  it('reveals the outcome zones only while a card is in flight', () => {
    mount(<PipelineView />)

    expect(screen.queryByTestId('outcome-dropzone-won')).not.toBeInTheDocument()

    fireEvent.dragStart(screen.getByTestId('opportunity-card-katz-ask'), {
      dataTransfer: { setData: vi.fn(), getData: () => 'katz-ask' },
    })

    expect(screen.getByTestId('outcome-dropzone-won')).toBeInTheDocument()
    expect(screen.getByTestId('outcome-dropzone-lost')).toBeInTheDocument()
    expect(screen.getByTestId('outcome-dropzone-on_hold')).toBeInTheDocument()
  })

  it('advances the stage and stamps both clocks on a forward move', async () => {
    mount(<PipelineView />)

    drag(
      screen.getByTestId('opportunity-card-feld-ask'),
      screen.getByTestId('stage-dropzone-solicited'),
      'feld-ask',
    )

    await waitFor(() => expect(update.mutateAsync).toHaveBeenCalled())
    const [call] = update.mutateAsync.mock.calls[0] as [
      { id: string; patch: Record<string, string> },
    ]
    expect(call.id).toBe('feld-ask')
    expect(call.patch.stage).toBe('solicited')
    expect(call.patch.stage_entered_at).toBeTruthy()
    expect(call.patch.last_moved_forward_at).toBeTruthy()
  })

  it('leaves the forward clock alone when a card moves back', async () => {
    mount(<PipelineView />)

    drag(
      screen.getByTestId('opportunity-card-adler-ask'),
      screen.getByTestId('stage-dropzone-qualified'),
      'adler-ask',
    )

    await waitFor(() => expect(update.mutateAsync).toHaveBeenCalled())
    const [call] = update.mutateAsync.mock.calls[0] as [{ patch: Record<string, string> }]
    expect(call.patch.stage).toBe('qualified')
    expect(call.patch).not.toHaveProperty('last_moved_forward_at')
  })

  it('asks for the next move when an advance leaves the card with none (I-3)', async () => {
    const user = userEvent.setup()
    mount(<PipelineView />)

    drag(
      screen.getByTestId('opportunity-card-feld-ask'),
      screen.getByTestId('stage-dropzone-cultivating'),
      'feld-ask',
    )

    const dialog = await screen.findByRole('dialog', { name: 'Moved to Cultivating' })
    await user.type(within(dialog).getByLabelText(/Next move/), 'Call the finance director')
    await user.click(within(dialog).getByRole('button', { name: 'Save the next move' }))

    await waitFor(() => expect(createNextMove.mutateAsync).toHaveBeenCalled())
    expect(createNextMove.mutateAsync.mock.calls[0]?.[0]).toMatchObject({
      opportunityId: 'feld-ask',
      contactId: 'feld',
      title: 'Call the finance director',
    })
  })

  it('does not ask for a next move when the card already has one', async () => {
    mount(<PipelineView />)

    drag(
      screen.getByTestId('opportunity-card-katz-ask'),
      screen.getByTestId('stage-dropzone-solicited'),
      'katz-ask',
    )

    await waitFor(() => expect(update.mutateAsync).toHaveBeenCalled())
    expect(screen.queryByRole('dialog', { name: /^Moved to/ })).not.toBeInTheDocument()
  })
})

describe('the outcome zones', () => {
  it('records a win, then offers the gift or the pledge (05)', async () => {
    const user = userEvent.setup()
    mount(<PipelineView />)

    const dataTransfer = { setData: vi.fn(), getData: () => 'adler-ask' }
    fireEvent.dragStart(screen.getByTestId('opportunity-card-adler-ask'), { dataTransfer })
    fireEvent.drop(screen.getByTestId('outcome-dropzone-won'), { dataTransfer })

    await waitFor(() => expect(update.mutateAsync).toHaveBeenCalled())
    expect(update.mutateAsync.mock.calls[0]?.[0]).toMatchObject({
      id: 'adler-ask',
      patch: { status: 'won', lost_reason: null },
    })

    const dialog = await screen.findByRole('dialog', { name: 'Won — now record it' })
    await user.click(within(dialog).getByRole('button', { name: 'Record the gift' }))
    expect(navigate).toHaveBeenCalledWith('/giving?new=gift')
  })

  it('takes the reason before it writes the loss', async () => {
    const user = userEvent.setup()
    mount(<PipelineView />)

    const dataTransfer = { setData: vi.fn(), getData: () => 'cohen-ask' }
    fireEvent.dragStart(screen.getByTestId('opportunity-card-cohen-ask'), { dataTransfer })
    fireEvent.drop(screen.getByTestId('outcome-dropzone-lost'), { dataTransfer })

    const dialog = await screen.findByRole('dialog', { name: 'Record the loss' })
    expect(update.mutateAsync).not.toHaveBeenCalled()

    // The reason is the point of the dialog — nothing is written without it.
    await user.click(within(dialog).getByRole('button', { name: 'Record it as lost' }))
    expect(update.mutateAsync).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('alert')).toBeInTheDocument()

    await user.selectOptions(within(dialog).getByLabelText(/Why was it lost/), 'gave_elsewhere')
    await user.click(within(dialog).getByRole('button', { name: 'Record it as lost' }))

    await waitFor(() => expect(update.mutateAsync).toHaveBeenCalled())
    expect(update.mutateAsync.mock.calls[0]?.[0]).toMatchObject({
      id: 'cohen-ask',
      patch: { status: 'lost', lost_reason: 'gave_elsewhere' },
    })
  })

  it('parks an ask on hold without closing it', async () => {
    mount(<PipelineView />)

    const dataTransfer = { setData: vi.fn(), getData: () => 'katz-ask' }
    fireEvent.dragStart(screen.getByTestId('opportunity-card-katz-ask'), { dataTransfer })
    fireEvent.drop(screen.getByTestId('outcome-dropzone-on_hold'), { dataTransfer })

    await waitFor(() => expect(update.mutateAsync).toHaveBeenCalled())
    expect(update.mutateAsync.mock.calls[0]?.[0]).toMatchObject({
      patch: { status: 'on_hold', closed_on: null },
    })
  })
})

describe('the opportunity sheet', () => {
  it('opens on a card and defaults expected to ask × probability', async () => {
    const user = userEvent.setup()
    mount(<PipelineView />)

    await user.click(screen.getByTestId('opportunity-card-cohen-ask'))

    const dialog = await screen.findByRole('dialog', { name: 'Edit ask' })
    expect(within(dialog).getByLabelText(/What are we asking for/)).toHaveValue('Building campaign')
    expect(within(dialog).getByLabelText(/Ask amount/)).toHaveValue('20000')
    expect(within(dialog).getByLabelText(/Expected \(weighted\)/)).toHaveValue('14000')
  })

  it('moves a card by stage select — the keyboard path through the same patch', async () => {
    const user = userEvent.setup()
    mount(<PipelineView />)

    await user.click(screen.getByTestId('opportunity-card-cohen-ask'))
    const dialog = await screen.findByRole('dialog', { name: 'Edit ask' })
    await user.selectOptions(within(dialog).getByLabelText('Stage'), 'solicited')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(save.mutateAsync).toHaveBeenCalled())
    const [call] = save.mutateAsync.mock.calls[0] as [{ draft: Record<string, unknown> }]
    expect(call.draft).toMatchObject({ stage: 'solicited' })
    expect(call.draft.last_moved_forward_at).toBeTruthy()
  })
})

describe('permissions', () => {
  it('gives a viewer the board without the writes (11 §1)', async () => {
    const user = userEvent.setup()
    state.member = { id: 'shaindy', role: 'viewer', full_name: 'Shaindy Viewer' }
    mount(<PipelineView />)

    expect(screen.queryByRole('button', { name: 'New opportunity' })).not.toBeInTheDocument()
    // Nothing is theirs, so Mine is empty and the panel says which door to try.
    expect(screen.getByText('No open asks are yours')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Everyone' }))
    expect(screen.getByTestId('opportunity-card-katz-ask')).toHaveAttribute('draggable', 'false')
  })
})
