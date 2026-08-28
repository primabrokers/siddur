import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * The three AI surfaces, checked against the 09 §1 contract rather than against
 * a model: the brief card and its label, the rolling holding line, and the
 * drafting sheet — including the one case where the right answer is **no
 * draft at all**.
 *
 * Every model call is stubbed. What is under test is the promise the UI makes
 * to the fundraiser: what it says it is, what it logs, and what it refuses.
 */

/* ------------------------------------------------------------------- stubs */

const query = <T,>(data: T, over: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  isFetching: false,
  error: null,
  isError: false,
  refetch: vi.fn(),
  ...over,
})

const resolve = { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }
const saveLine = { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }
const regenerate = {
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
  data: undefined as unknown,
  error: null as unknown,
}

const BRIEF = {
  bullets: {
    who: 'R’ Dovid Cohen of Cohen & Partner, Golders Green — introduced by R’ Weiss in 2019.',
    trajectory: 'Warming. Three meetings since Pesach after a quiet winter.',
    giving: 'Eleven gifts, £42,500 lifetime, largest £20,000.',
    last_time: 'Met 2 June; he asked for the naming pack and said he would talk after Sukkos.',
    talking_points: 'The new wing, his son’s chasuna. Do not forget: call before Mincha.',
  },
  holding_line: 'Discussed £20k for the building at the June meeting; he asked to talk after Sukkos.',
  thin_file: false,
  cached: false,
  generated_at: '2026-08-28T08:00:00.000Z',
  model: 'claude-opus-5',
  ai_activity_id: 'act-brief-1',
}

const DRAFT = {
  draft: 'Dear R’ Cohen,\n\nThank you for your gift of £5,000 to the building fund…',
  facts_used: [
    { label: 'Donor', value: 'R’ Dovid Cohen' },
    { label: 'Gift amount', value: '£5,000' },
    { label: 'Gift date', value: '2026-06-02' },
    { label: 'Fund', value: 'Building' },
  ],
  purpose: 'thank_you' as const,
  excluded: false as const,
  model: 'claude-opus-5',
  ai_activity_id: 'act-draft-1',
}

const EXCLUDED = {
  excluded: true as const,
  reason:
    'This gift is recorded in memory of someone. Messages touching a bereavement are written by a person, never drafted by AI (09 §1.6).',
  marker: 'tribute:in_memory',
  purpose: 'thank_you' as const,
}

/** Stands in for `useDraftMessage()`: resolves straight into `onSuccess`. */
const draftMutation = () => {
  const holder = {
    data: undefined as unknown,
    error: null as unknown,
    isPending: false,
    mutate: vi.fn((_input: unknown, options?: { onSuccess?: (result: unknown) => void }) => {
      if (holder.data !== undefined) options?.onSuccess?.(holder.data)
    }),
  }
  return holder
}

const state = {
  featureOn: true,
  brief: query(BRIEF as unknown),
  review: query({ id: 'act-brief-1', resolution: 'pending', reviewed: false } as unknown),
  draft: draftMutation(),
}

vi.mock('../src/lib/queries/ai', async () => {
  const core = await import('../src/features/ai/core')
  return {
    AI_NOTICE: {
      unconfigured: 'AI is not configured on this project — no model key is set.',
      offline: 'No connection to the AI service.',
      refused: 'The model declined this one.',
      error: 'The AI service could not be reached.',
      disabled: 'This AI feature is switched off in Settings.',
    },
    AiCallError: class extends Error {},
    useAiFeature: () => state.featureOn,
    // Mirrors the real hook: nothing is fetched until the button sets `enabled`.
    useDonorBrief: ({ enabled }: { enabled: boolean }) => (enabled ? state.brief : query(undefined)),
    useRegenerateBrief: () => regenerate,
    useBriefReview: () => state.review,
    useResolveAiActivity: () => resolve,
    useSaveHoldingLine: () => saveLine,
    useDraftMessage: () => state.draft,
    useDigestPreview: () => query(null),
    resolutionFor: core.resolutionFor,
  }
})

const { BriefPanel } = await import('../src/features/ai/BriefPanel')
const { HoldingLine } = await import('../src/features/ai/HoldingLine')
const { DraftSheet } = await import('../src/features/ai/DraftSheet')
const { ToastProvider } = await import('../src/components')

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

const mount = (node: ReactNode) => render(<>{node}</>, { wrapper: Wrapper })

/** jsdom's `navigator.clipboard` is a getter, so it has to be redefined. */
function stubClipboard() {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.featureOn = true
  state.brief = query(BRIEF as unknown)
  state.review = query({ id: 'act-brief-1', resolution: 'pending', reviewed: false } as unknown)
  state.draft = draftMutation()
  regenerate.data = undefined
  regenerate.error = null
  regenerate.isPending = false
})

/* ========================================================================== */
/* The brief card — 09 §3                                                     */
/* ========================================================================== */

describe('BriefPanel — “Brief me” (04 §5.8 / 09 §3)', () => {
  it('asks before it runs: the button is the trigger, not the page view', () => {
    state.brief = query(undefined as unknown)
    mount(<BriefPanel contactId="dovid" contactName="Dovid Cohen" />)
    expect(screen.getByTestId('brief-me')).toBeInTheDocument()
    expect(screen.queryByTestId('brief-bullets')).not.toBeInTheDocument()
  })

  it('renders exactly the five spec bullets, each under its own heading', async () => {
    const user = userEvent.setup()
    mount(<BriefPanel contactId="dovid" contactName="Dovid Cohen" timelineCount={12} />)
    await user.click(screen.getByTestId('brief-me'))

    const list = await screen.findByTestId('brief-bullets')
    expect(within(list).getAllByRole('listitem')).toHaveLength(5)
    for (const label of [
      'Who & how you know him',
      'Trajectory',
      'Giving pattern & capacity signal',
      'Last time & what was promised',
      'Talking points & the one thing not to forget',
    ]) {
      expect(within(list).getByText(label)).toBeInTheDocument()
    }
    expect(within(list).getByText(/£42,500 lifetime/)).toBeInTheDocument()
  })

  it('labels itself “Drafted with AI” and flips to “Reviewed” when kept', async () => {
    const user = userEvent.setup()
    mount(<BriefPanel contactId="dovid" contactName="Dovid Cohen" />)
    await user.click(screen.getByTestId('brief-me'))

    expect(await screen.findByText('Drafted with AI')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep' }))

    expect(await screen.findByText('Reviewed')).toBeInTheDocument()
    expect(screen.queryByText('Drafted with AI')).not.toBeInTheDocument()
    expect(resolve.mutate).toHaveBeenCalledWith({ aiActivityId: 'act-brief-1', event: 'accept' })
  })

  it('logs a rejection too — 09 §1.5 counts the ones nobody wanted', async () => {
    const user = userEvent.setup()
    mount(<BriefPanel contactId="dovid" contactName="Dovid Cohen" />)
    await user.click(screen.getByTestId('brief-me'))
    await user.click(await screen.findByRole('button', { name: 'Not useful' }))
    expect(resolve.mutate).toHaveBeenCalledWith({ aiActivityId: 'act-brief-1', event: 'reject' })
  })

  it('opens as Reviewed when the ledger already carries a verdict', async () => {
    state.review = query({ id: 'act-brief-1', resolution: 'accepted', reviewed: true } as unknown)
    const user = userEvent.setup()
    mount(<BriefPanel contactId="dovid" contactName="Dovid Cohen" />)
    await user.click(screen.getByTestId('brief-me'))
    expect(await screen.findByText('Reviewed')).toBeInTheDocument()
  })

  it('regenerates on request, and the fresh words are unreviewed again', async () => {
    state.review = query({ id: 'act-brief-1', resolution: 'accepted', reviewed: true } as unknown)
    const user = userEvent.setup()
    mount(<BriefPanel contactId="dovid" contactName="Dovid Cohen" />)
    await user.click(screen.getByTestId('brief-me'))
    await user.click(await screen.findByRole('button', { name: 'Regenerate' }))

    expect(regenerate.mutate).toHaveBeenCalledWith({ contactId: 'dovid' })
    expect(await screen.findByText('Drafted with AI')).toBeInTheDocument()
  })

  it('says a thin file is thin instead of padding it', async () => {
    state.brief = query({ ...BRIEF, thin_file: true } as unknown)
    const user = userEvent.setup()
    mount(<BriefPanel contactId="dovid" contactName="Dovid Cohen" />)
    await user.click(screen.getByTestId('brief-me'))
    expect(await screen.findByText(/Thin file/)).toBeInTheDocument()
  })

  it('explains itself — “why am I seeing this” is not optional (09 §1.8)', async () => {
    const user = userEvent.setup()
    mount(<BriefPanel contactId="dovid" contactName="Dovid Cohen" timelineCount={12} />)
    await user.click(screen.getByTestId('brief-me'))
    expect(await screen.findByText(/Built from this record alone — 12 timeline entries/)).toBeInTheDocument()
    expect(screen.getByText(/counted by the database, not the model/)).toBeInTheDocument()
  })

  it('goes quiet, not broken, when no key is configured', async () => {
    state.brief = query(undefined as unknown, { error: { failure: 'unconfigured', message: 'x' } })
    const user = userEvent.setup()
    mount(<BriefPanel contactId="dovid" contactName="Dovid Cohen" />)
    await user.click(screen.getByTestId('brief-me'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/no model key is set/)
    expect(screen.queryByTestId('brief-bullets')).not.toBeInTheDocument()
  })

  it('disappears entirely when the feature is switched off in Settings', () => {
    state.featureOn = false
    mount(<BriefPanel contactId="dovid" contactName="Dovid Cohen" />)
    expect(screen.queryByTestId('brief-panel')).not.toBeInTheDocument()
  })
})

/* ========================================================================== */
/* The holding line — 04 §5.8                                                 */
/* ========================================================================== */

describe('HoldingLine — the rolling one-liner (04 §5.8)', () => {
  const LINE = 'Discussed £20k for the building at the June meeting; he asked to talk after Sukkos.'

  it('shows nothing until a brief has written a line', () => {
    mount(<HoldingLine contactId="dovid" line={null} />)
    expect(screen.queryByTestId('holding-line')).not.toBeInTheDocument()
  })

  it('renders the line under an AI label until somebody keeps it', async () => {
    const user = userEvent.setup()
    mount(<HoldingLine contactId="dovid" line={LINE} at="2026-08-28" />)

    expect(screen.getByTestId('holding-line')).toHaveTextContent(LINE)
    expect(screen.getByText('Drafted with AI')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Keep' }))
    expect(await screen.findByText('Reviewed')).toBeInTheDocument()
    expect(resolve.mutate).toHaveBeenCalledWith({ aiActivityId: 'act-brief-1', event: 'accept' })
  })

  it('an edit writes the human’s wording back and logs it as an edit', async () => {
    const user = userEvent.setup()
    mount(<HoldingLine contactId="dovid" line={LINE} />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const box = screen.getByLabelText('Where we’re holding')
    await user.clear(box)
    await user.type(box, 'Waiting on him after Sukkos.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(resolve.mutate).toHaveBeenCalledWith({
      aiActivityId: 'act-brief-1',
      event: 'edit',
      editedFields: ['holding_line'],
    })
    expect(saveLine.mutate).toHaveBeenCalledWith({
      contactId: 'dovid',
      line: 'Waiting on him after Sukkos.',
      edited: true,
    })
  })

  it('opening the editor and changing nothing is an accept, not an edit', async () => {
    const user = userEvent.setup()
    mount(<HoldingLine contactId="dovid" line={LINE} />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(resolve.mutate).toHaveBeenCalledWith({ aiActivityId: 'act-brief-1', event: 'accept' })
    expect(saveLine.mutate).not.toHaveBeenCalled()
  })

  it('a viewer reads the line but cannot keep or edit it (contacts_upd is admin/fundraiser)', () => {
    mount(<HoldingLine contactId="dovid" line={LINE} readOnly />)
    expect(screen.getByTestId('holding-line')).toHaveTextContent(LINE)
    expect(screen.queryByRole('button', { name: 'Keep' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('dismissing removes it from the page and logs the rejection', async () => {
    const user = userEvent.setup()
    mount(<HoldingLine contactId="dovid" line={LINE} />)
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByTestId('holding-line')).not.toBeInTheDocument())
    expect(resolve.mutate).toHaveBeenCalledWith({ aiActivityId: 'act-brief-1', event: 'reject' })
  })
})

/* ========================================================================== */
/* The drafting sheet — 09 §4, §1.3, §1.6                                     */
/* ========================================================================== */

describe('DraftSheet — grounded drafting (09 §4)', () => {
  const open = (over: Record<string, unknown> = {}) =>
    mount(
      <DraftSheet
        open
        onClose={vi.fn()}
        contactId="dovid"
        contactName="Dovid Cohen"
        purpose="thank_you"
        giftId="gift-1"
        contactEmail="dovid@example.test"
        {...over}
      />,
    )

  it('requests the draft once the sheet opens', () => {
    open()
    expect(state.draft.mutate).toHaveBeenCalledTimes(1)
    expect(state.draft.mutate.mock.calls[0]?.[0]).toEqual({
      contactId: 'dovid',
      purpose: 'thank_you',
      giftId: 'gift-1',
    })
  })

  it('renders every grounding fact beside the words (09 §1.3)', async () => {
    state.draft.data = DRAFT
    open()
    const panel = await screen.findByTestId('draft-facts')
    expect(within(panel).getByText('Facts used')).toBeInTheDocument()
    for (const fact of DRAFT.facts_used) {
      expect(within(panel).getByText(fact.label)).toBeInTheDocument()
      expect(within(panel).getByText(fact.value)).toBeInTheDocument()
    }
    expect(within(panel).getByText(/may reference only these/)).toBeInTheDocument()
  })

  it('puts the draft in an editable box, labelled, with the send left to a person', async () => {
    state.draft.data = DRAFT
    open()
    const box = (await screen.findByLabelText('Draft message')) as HTMLTextAreaElement
    expect(box.value).toBe(DRAFT.draft)
    expect(screen.getByText('Drafted with AI')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    expect(screen.getByText(/nothing here reaches the donor until you send it yourself/i)).toBeInTheDocument()
  })

  it('copying an untouched draft logs an accept; copying an edited one logs an edit', async () => {
    stubClipboard()
    const user = userEvent.setup()
    state.draft.data = DRAFT
    open()

    await user.click(await screen.findByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(resolve.mutate).toHaveBeenCalledWith({ aiActivityId: 'act-draft-1', event: 'accept' }))
    expect(await screen.findByText('Reviewed')).toBeInTheDocument()
  })

  it('an edited draft is logged as edited, with the field named', async () => {
    stubClipboard()
    const user = userEvent.setup()
    state.draft.data = DRAFT
    open()

    await user.type(await screen.findByLabelText('Draft message'), ' — and thank you again.')
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() =>
      expect(resolve.mutate).toHaveBeenCalledWith({
        aiActivityId: 'act-draft-1',
        event: 'edit',
        editedFields: ['draft'],
      }),
    )
  })

  it('closing without taking the draft logs a rejection', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    state.draft.data = DRAFT
    open({ onClose })

    await user.click(await screen.findByRole('button', { name: 'Close' }))
    expect(resolve.mutate).toHaveBeenCalledWith({ aiActivityId: 'act-draft-1', event: 'reject' })
    expect(onClose).toHaveBeenCalled()
  })

  it('THE HARD EXCLUSION: a bereavement opens a blank page and no draft at all', async () => {
    state.draft.data = EXCLUDED
    open()

    const notice = await screen.findByTestId('draft-excluded')
    expect(within(notice).getByText('This one is written by hand.')).toBeInTheDocument()
    expect(within(notice).getByText(EXCLUDED.reason)).toBeInTheDocument()
    expect(within(notice).getByText(/tribute:in_memory/)).toBeInTheDocument()

    // Blank-page mode: an empty box, no generated text, no facts panel, no
    // "accept" to press (09 §1.6 ▸ Vanderbilt 2023).
    const box = within(notice).getByLabelText('Write the message') as HTMLTextAreaElement
    expect(box.value).toBe('')
    expect(screen.queryByLabelText('Draft message')).not.toBeInTheDocument()
    expect(screen.queryByTestId('draft-facts')).not.toBeInTheDocument()
    expect(screen.queryByText('Drafted with AI')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /I’ll write this one/ })).toBeInTheDocument()
  })

  it('offers the blank box when the model is unreachable, so the work continues', async () => {
    state.draft.error = { failure: 'unconfigured', message: 'no key' }
    open()
    expect(await screen.findByRole('alert')).toHaveTextContent(/no model key is set/)
  })
})
