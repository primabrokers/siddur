import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

/**
 * The three panes, driven through the real components against a stubbed
 * supabase-js: what the fundraiser actually sees between speaking and done.
 */

interface Insert {
  table: string
  row: Record<string, unknown>
}

const inserts: Insert[] = []
let rows: Record<string, Array<Record<string, unknown>>> = {}
const invoke = vi.fn()

function builder(table: string) {
  const chain: Record<string, unknown> = {}
  let pending: Record<string, unknown> | null = null
  const resolve = () =>
    pending ? { data: { id: `${table}-1`, ...pending }, error: null } : { data: rows[table] ?? [], error: null }

  for (const method of ['select', 'eq', 'ilike', 'in', 'is', 'order', 'limit']) chain[method] = () => chain
  chain.insert = (row: Record<string, unknown>) => {
    pending = row
    inserts.push({ table, row })
    return chain
  }
  chain.single = () => Promise.resolve(resolve())
  chain.maybeSingle = () => Promise.resolve(resolve())
  chain.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(onFulfilled(resolve()))
  return chain
}

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => builder(table),
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
  isConfigured: true,
}))
vi.mock('../src/lib/env', () => ({ isConfigured: true, SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }))

const { QuickCaptureSheet } = await import('../src/features/capture/QuickCapture')
const { ToastProvider } = await import('../src/components')
type CaptureParseResult = import('../src/features/capture/types').CaptureParseResult

const RAW =
  'met dovid cohen in london this morning, very warm, strong interest in the building project, discussed twenty k, he wants me to call him after sukkos'

/** Far enough ahead of Sukkos 2026 that "after sukkos" resolves to 6 Oct. */
const parsedFixture = (): CaptureParseResult => ({
  contact_query: 'dovid cohen',
  confidence: 0.93,
  interaction: {
    kind: 'meeting',
    occurred_at: null,
    location: 'London',
    summary: 'Met in London. Very warm. Strong interest in the building project; discussed £20,000.',
    outcome: 'Wants to see the naming opportunities',
    ask_amount: 20000,
    is_scheduled: false,
  },
  next_action: {
    type: 'call',
    title: 'Call re building project / £20k',
    date_expression: 'after sukkos',
    resolved_due_on: null,
  },
  suggested_updates: [{ kind: 'add_tag', value: 'Building project' }],
  unparsed_remainder: null,
  model: 'claude-opus-5',
  latency_ms: 1400,
  usage: { input_tokens: 1500, output_tokens: 300 },
})

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>{children}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const open = (request: { contactId?: string; contactName?: string } = {}) =>
  render(
    <Wrapper>
      <QuickCaptureSheet open onClose={vi.fn()} request={request} />
    </Wrapper>,
  )

beforeEach(() => {
  inserts.length = 0
  invoke.mockReset()
  window.localStorage.clear()
  rows = {
    contacts: [
      {
        id: 'c1',
        first_name: 'Dovid',
        last_name: 'Cohen',
        organization: null,
        city: 'Golders Green',
        tier: 'A',
        email: null,
        phone: null,
        whatsapp: null,
      },
    ],
    lookup_options: [
      { list_name: 'interaction_kind', value: 'meeting', label: 'Meeting', sort_order: 0, color: null, meta: {}, is_active: true },
      { list_name: 'interaction_kind', value: 'call', label: 'Call', sort_order: 1, color: null, meta: {}, is_active: true },
      { list_name: 'action_type', value: 'call', label: 'Call', sort_order: 0, color: null, meta: {}, is_active: true },
    ],
    tags: [],
  }
})

describe('pane 1 — input', () => {
  it('opens on an empty box with a rotating example and Next disabled', () => {
    open()
    expect(screen.getByRole('heading', { name: 'Quick capture' })).toBeInTheDocument()
    const box = screen.getByLabelText('What happened')
    expect(box).toHaveValue('')
    expect(box).toHaveAttribute('placeholder', expect.stringContaining('dovid cohen'))
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Manual form' })).toBeInTheDocument()
  })

  it('enables Next once there is something to parse', async () => {
    const user = userEvent.setup()
    open()
    await user.type(screen.getByLabelText('What happened'), 'spoke to dovid')
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
  })
})

describe('pane 2 — confirm', () => {
  it('shows the matched contact, the chips and the resolved date chip', async () => {
    const user = userEvent.setup()
    invoke.mockResolvedValue({ data: parsedFixture(), error: null })
    open()

    await user.type(screen.getByLabelText('What happened'), RAW)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByRole('heading', { name: 'Check & save' })

    // WHO — a strong match renders as the teal ✓ chip, not a picker.
    const matched = screen.getByTestId('capture-contact-matched')
    expect(matched).toHaveTextContent('Dovid Cohen')
    expect(matched).toHaveTextContent('Golders Green')
    expect(screen.queryByTestId('capture-contact-picker')).not.toBeInTheDocument()

    // WHAT HAPPENED
    expect(screen.getByText('Meeting')).toBeInTheDocument()
    expect(screen.getByText('London')).toBeInTheDocument()
    expect(screen.getByText('Ask £20,000')).toBeInTheDocument()
    expect(screen.getByLabelText('Summary')).toHaveValue(
      'Met in London. Very warm. Strong interest in the building project; discussed £20,000.',
    )

    // WHAT HAPPENS NEXT — the signature chip.
    const dateChip = screen.getByRole('button', { name: 'Change the due date' })
    expect(dateChip).toHaveTextContent('after sukkos')
    expect(dateChip).toHaveTextContent('Tue 6 Oct')

    // Suggested updates are off until tapped.
    const tagChip = screen.getByRole('button', { name: /tag “Building project”/ })
    expect(tagChip).toHaveAttribute('aria-pressed', 'false')

    // Provenance (09 §1.3/§1.4).
    expect(screen.getByText(/Parsed from your note/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'see it' }))
    expect(screen.getByText(RAW)).toBeInTheDocument()
  })

  it('opens a date input when the resolver could not read the phrase', async () => {
    const user = userEvent.setup()
    const parsed = parsedFixture()
    parsed.next_action = { ...parsed.next_action!, date_expression: 'before the dinner' }
    invoke.mockResolvedValue({ data: parsed, error: null })
    open()

    await user.type(screen.getByLabelText('What happened'), RAW)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Check & save' })

    expect(screen.getByLabelText('Due')).toHaveValue('')
    expect(screen.getByText(/Heard “before the dinner”/)).toBeInTheDocument()
  })

  it('renders empty chips and the raw note when confidence is low (09 §2)', async () => {
    const user = userEvent.setup()
    invoke.mockResolvedValue({ data: { ...parsedFixture(), confidence: 0.31 }, error: null })
    open()

    await user.type(screen.getByLabelText('What happened'), RAW)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Check & save' })

    const notice = screen.getByTestId('capture-low-confidence')
    expect(notice).toHaveTextContent('Not confident enough to fill the chips')
    expect(notice).toHaveTextContent(RAW)
    expect(screen.getByLabelText('Summary')).toHaveValue('')
    expect(screen.queryByText('London')).not.toBeInTheDocument()
    // Matching is arithmetic, not the model — the contact chip still stands.
    expect(screen.getByTestId('capture-contact-matched')).toHaveTextContent('Dovid Cohen')
  })

  it('falls back to the manual form with the note prefilled when the AI is off', async () => {
    const user = userEvent.setup()
    invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('non-2xx'), {
        name: 'FunctionsHttpError',
        context: new Response(JSON.stringify({ error: 'ai_unconfigured' }), { status: 503 }),
      }),
    })
    open()

    await user.type(screen.getByLabelText('What happened'), RAW)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByRole('heading', { name: 'Log by hand' })
    expect(screen.getByTestId('capture-failure-notice')).toHaveTextContent('AI parsing is not switched on')
    // The dictation is never lost.
    expect(screen.getByLabelText('Summary')).toHaveValue(RAW)
    expect(screen.queryByText(/Parsed from your note/)).not.toBeInTheDocument()
  })

  it('skips matching when opened from a profile', async () => {
    const user = userEvent.setup()
    invoke.mockResolvedValue({ data: parsedFixture(), error: null })
    open({ contactId: 'c9', contactName: 'Chaim Lax' })

    await user.type(screen.getByLabelText('What happened'), RAW)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Check & save' })

    const matched = screen.getByTestId('capture-contact-matched')
    expect(matched).toHaveTextContent('Chaim Lax')
    expect(matched).toHaveTextContent('from their profile')
  })
})

describe('pane 3 — saved', () => {
  it('writes the rows and reports what happened', async () => {
    const user = userEvent.setup()
    invoke.mockResolvedValue({ data: parsedFixture(), error: null })
    open()

    await user.type(screen.getByLabelText('What happened'), RAW)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Check & save' })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByTestId('capture-saved')
    expect(screen.getByRole('heading', { name: 'Logged to Dovid Cohen' })).toBeInTheDocument()
    expect(screen.getByText(/Meeting on the timeline/)).toBeInTheDocument()
    expect(screen.getByText(/Next: Call re building project/)).toBeInTheDocument()
    expect(screen.getByText(/Mon 5 Oct|Tue 6 Oct/)).toBeInTheDocument()
    expect(screen.getByText(/Keep-in-touch clock reset/)).toBeInTheDocument()

    await waitFor(() => expect(inserts.some((i) => i.table === 'interactions')).toBe(true))
    const tables = inserts.map((i) => i.table)
    expect(tables).toContain('ai_activity_log')
    expect(tables).toContain('tasks')
    const log = inserts.find((i) => i.table === 'ai_activity_log')!.row
    expect(log.resolution).toBe('accepted')
    const task = inserts.find((i) => i.table === 'tasks')!.row
    expect(task.due_on).toBe('2026-10-06')
  })

  it('logs "edited" with the fields the user changed', async () => {
    const user = userEvent.setup()
    invoke.mockResolvedValue({ data: parsedFixture(), error: null })
    open()

    await user.type(screen.getByLabelText('What happened'), RAW)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Check & save' })

    const summary = screen.getByLabelText('Summary')
    await user.clear(summary)
    await user.type(summary, 'Met in London, warm.')
    await user.click(screen.getByRole('button', { name: /tag “Building project”/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByTestId('capture-saved')
    const log = inserts.find((i) => i.table === 'ai_activity_log')!.row
    expect(log.resolution).toBe('edited')
    expect(log.edited_fields).toEqual(expect.arrayContaining(['summary', 'suggested_updates']))
  })

  it('says "Meeting scheduled" when the note booked something ahead', async () => {
    const user = userEvent.setup()
    const parsed = parsedFixture()
    parsed.interaction.is_scheduled = true
    parsed.interaction.occurred_at = '2026-09-03T15:00'
    invoke.mockResolvedValue({ data: parsed, error: null })
    open()

    await user.type(screen.getByLabelText('What happened'), 'meeting with katz thursday 3pm')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Check & save' })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByTestId('capture-saved')
    expect(screen.getByRole('heading', { name: /Meeting scheduled with Dovid Cohen/ })).toBeInTheDocument()
    expect(inserts.find((i) => i.table === 'interactions')!.row.status).toBe('scheduled')
  })
})

describe('the offline queue (11 §6)', () => {
  it('surfaces a waiting capture on the next open, and retry restores the note', async () => {
    const user = userEvent.setup()
    const { enqueueCapture, queueNotice, readQueue } = await import('../src/features/capture/offlineQueue')

    // A capture stashed by an earlier failed write.
    enqueueCapture({ text: RAW, contactId: 'c1' })
    expect(readQueue()).toHaveLength(1)
    expect(queueNotice(1)).toBe('1 capture waiting to sync')

    open()
    expect(screen.getByTestId('capture-queue-notice')).toHaveTextContent('1 capture waiting to sync')

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    // The dictation comes back into the box, and the queue is drained.
    expect(screen.getByLabelText('What happened')).toHaveValue(RAW)
    expect(screen.queryByTestId('capture-queue-notice')).not.toBeInTheDocument()
    expect(readQueue()).toHaveLength(0)
  })

  it('discards the queue only when asked', async () => {
    const user = userEvent.setup()
    const { enqueueCapture, readQueue } = await import('../src/features/capture/offlineQueue')
    enqueueCapture({ text: RAW, contactId: null })

    open()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(readQueue()).toHaveLength(0)
    expect(screen.queryByTestId('capture-queue-notice')).not.toBeInTheDocument()
  })

  it('queues only network failures — a rejected write must stay visible', async () => {
    const { isNetworkFailure } = await import('../src/features/capture/offlineQueue')
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkFailure(new Error('NetworkError when attempting to fetch resource'))).toBe(true)
    expect(isNetworkFailure(new Error('The parse timed out.'))).toBe(true)
    expect(isNetworkFailure(new Error('new row violates row-level security policy'))).toBe(false)
    expect(isNetworkFailure(new Error('duplicate key value violates unique constraint'))).toBe(false)
  })
})
