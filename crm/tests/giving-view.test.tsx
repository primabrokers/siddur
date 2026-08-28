import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { addDays, format, subDays } from 'date-fns'
import type { ReactNode } from 'react'

/**
 * The Giving screen and the gift-entry sheet (05 §1–§4): metric cards, the two
 * queues and their one-tap verbs, the CSV export confirm, and every inline
 * assist in the sheet — ask chips, applies-to, the Gift Aid line, GASDS and the
 * tribute block.
 */

const iso = (date: Date) => format(date, 'yyyy-MM-dd')
const NOW = new Date()

const query = <T,>(data: T) => ({ data, isLoading: false, error: null, isError: false })
const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue({}), isPending: false })

const contact = (id: string, first: string, last: string, over: Record<string, unknown> = {}) => ({
  id,
  title: null,
  first_name: first,
  last_name: last,
  hebrew_name: null,
  organization: null,
  contact_kind: 'individual',
  is_archived: false,
  address_line1: '12 The Drive',
  address_line2: null,
  city: 'Golders Green',
  postcode: 'NW11 8AA',
  introduced_by_id: null,
  stage: 'active_donor',
  ...over,
})

const gift = (over: Record<string, unknown>) => ({
  id: 'g',
  contact_id: 'dovid',
  donated_on: iso(NOW),
  amount: 100,
  currency: 'GBP',
  amount_gbp: 100,
  fund_id: 'f1',
  campaign_id: null,
  appeal_id: null,
  payment_method: 'bank_transfer',
  status: 'received',
  pledge_id: null,
  installment_id: null,
  recurring_agreement_id: null,
  receipt_status: 'not_sent',
  receipt_pref: null,
  thank_you_status: 'not_done',
  gift_aid_status: 'pending_declaration',
  gift_aid_claim_id: null,
  is_gasds: false,
  notes: null,
  ...over,
})

const board = {
  gifts: [
    gift({ id: 'big', donated_on: iso(subDays(NOW, 6)), amount: 5000, amount_gbp: 5000, gift_aid_status: 'eligible' }),
    gift({ id: 'small', contact_id: 'klein', amount: 180, amount_gbp: 180, receipt_status: 'queued' }),
    gift({
      id: 'done',
      donated_on: iso(subDays(NOW, 3)),
      thank_you_status: 'done',
      receipt_status: 'sent',
      gift_aid_status: 'claimed',
    }),
  ],
  pledges: [
    {
      id: 'pl-1',
      contact_id: 'dovid',
      total_amount: 25000,
      amount_gbp: 25000,
      currency: 'GBP',
      fund_id: 'f2',
      campaign_id: null,
      appeal_id: null,
      pledged_on: '2025-10-01',
      status: 'open',
      write_off_amount: null,
      notes: null,
    },
  ],
  installments: [
    { id: 'ins-overdue', pledge_id: 'pl-1', due_on: iso(subDays(NOW, 20)), amount: 5000, status: 'expected' },
    { id: 'ins-next', pledge_id: 'pl-1', due_on: iso(addDays(NOW, 19)), amount: 5000, status: 'expected' },
  ],
  recurring: [
    {
      id: 'rec-1',
      contact_id: 'klein',
      amount: 150,
      currency: 'GBP',
      frequency: 'monthly',
      payment_method: 'standing_order',
      fund_id: 'f1',
      starts_on: '2025-01-01',
      ends_on: null,
      status: 'failing',
      last_payment_on: iso(subDays(NOW, 40)),
      missed_count: 2,
      expected_day: 1,
    },
  ],
  contacts: {
    dovid: contact('dovid', 'Dovid', 'Cohen'),
    klein: contact('klein', 'Klein', 'Family'),
  },
  yearGifts: [gift({ id: 'big', amount_gbp: 5000 }), gift({ id: 'small', amount_gbp: 180 })],
  monthGifts: [gift({ id: 'small', amount_gbp: 180 })],
  amountsHidden: false,
}

const state = {
  member: { id: 'braun', role: 'admin', full_name: "R' Braun" } as unknown,
  introducedBy: null as { id: string; name: string } | null,
  declarations: [] as unknown[],
  stats: { last_gift_amount: 1000, largest_gift: 5000 } as unknown,
  contactGiving: {
    donations: [],
    pledges: board.pledges,
    installments: board.installments,
    recurring: [],
    amountsHidden: false,
  },
}

const markThanked = mutation()
const setReceipt = mutation()
const setPledgeStatus = mutation()
const setRecurringStatus = mutation()
const createGift = { ...mutation(), mutateAsync: vi.fn().mockResolvedValue({ donation: { id: 'new', contact_id: 'dovid' } }) }
const downloadCsv = vi.fn()

vi.mock('../src/features/giving/download', () => ({ downloadCsv }))

vi.mock('../src/lib/queries/giving', () => ({
  useGivingBoard: () => query(board),
  useGivingSelects: () =>
    query({
      funds: [
        { id: 'f1', name: 'General', is_active: true },
        { id: 'f2', name: 'Building', is_active: true },
      ],
      campaigns: [{ id: 'c1', name: 'Building campaign', is_active: true }],
      appeals: [{ id: 'a1', name: 'Dinner 2026', is_active: true }],
    }),
  useMarkThanked: () => markThanked,
  useUnmarkThanked: () => mutation(),
  useSetReceiptStatus: () => setReceipt,
  useSetPledgeStatus: () => setPledgeStatus,
  useSetRecurringStatus: () => setRecurringStatus,
  useCreateGift: () => createGift,
  useDeleteGift: () => mutation(),
  useCreatePledge: () => mutation(),
  useDeletePledge: () => mutation(),
  useCreateRecurring: () => mutation(),
  useDeleteRecurring: () => mutation(),
}))

vi.mock('../src/lib/queries/contacts', () => ({
  useGivingRefs: () =>
    query({ funds: { f1: 'General', f2: 'Building' }, campaigns: { c1: 'Building campaign' }, appeals: {} }),
  useContact: () =>
    query({
      contact: contact('dovid', 'Dovid', 'Cohen'),
      stats: state.stats,
      statsError: null,
      introducedBy: state.introducedBy,
    }),
  useContactDeclarations: () => query(state.declarations),
  useContactGiving: () => query(state.contactGiving),
  useLookupOptions: () => query([]),
}))

vi.mock('../src/lib/queries/tasks', () => ({
  useContactSearch: () => query([contact('dovid', 'Dovid', 'Cohen')]),
}))

vi.mock('../src/features/auth/useTeamMember', () => ({
  useTeamMember: () => query(state.member),
  isAdmin: () => true,
  canEdit: () => true,
}))

const { GivingRoute } = await import('../src/routes/Giving')
const { ToastProvider } = await import('../src/components')

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/giving']}>
        <ToastProvider>{children}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const renderGiving = () => render(<GivingRoute />, { wrapper: Wrapper })

/** Open the gift sheet from the header and get past the contact picker. */
async function openGiftSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Record gift/ }))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: /Dovid Cohen/ }))
  return dialog
}

beforeEach(() => {
  state.member = { id: 'braun', role: 'admin', full_name: "R' Braun" }
  state.introducedBy = null
  state.declarations = []
  state.stats = { last_gift_amount: 1000, largest_gift: 5000 }
  vi.clearAllMocks()
})

describe('Giving screen (05 §4)', () => {
  it('heads with the four metric cards, flagging failing recurring in red', () => {
    renderGiving()
    // The labels render uppercase in CSS; the DOM keeps sentence case.
    expect(screen.getByText('This month').parentElement).toHaveTextContent('£180')
    expect(screen.getByText('This year').parentElement).toHaveTextContent('£5,180')
    expect(screen.getByText('Pledges outstanding').parentElement).toHaveTextContent('£25,000')
    const failing = screen.getByText('Failing recurring').parentElement as HTMLElement
    expect(failing).toHaveTextContent('1')
    expect(failing).toHaveTextContent('call, don’t email')
    expect(within(failing).getByText('1')).toHaveClass('text-flag-overdue')
  })

  it('lists recent gifts with the donor link, gold amount and status pills', () => {
    renderGiving()
    const row = screen.getByText('£5,000').closest('tr') as HTMLElement
    expect(within(row).getByRole('link', { name: 'Dovid Cohen' })).toHaveAttribute('href', '/contacts/dovid')
    expect(within(row).getByText('£5,000')).toHaveClass('text-gold')
    expect(within(row).getByText('Eligible')).toBeInTheDocument()
    expect(within(row).getByText('Not sent')).toBeInTheDocument()
  })

  it('queues unthanked gifts with the 48h norm and a big-gift flag', async () => {
    const user = userEvent.setup()
    renderGiving()
    await user.click(screen.getByRole('tab', { name: /Needs thanks · 2/ }))
    expect(screen.getByText(/48h/)).toBeInTheDocument()
    const big = screen.getByText('£5,000').closest('tr') as HTMLElement
    expect(within(big).getByText('Big gift')).toBeInTheDocument()
    expect(within(big).getByText('6d')).toHaveClass('text-flag-overdue')

    await user.click(within(big).getByRole('button', { name: 'Mark thanked' }))
    await waitFor(() => expect(markThanked.mutateAsync).toHaveBeenCalled())
    expect(markThanked.mutateAsync.mock.calls[0]?.[0]).toMatchObject({ gift: { id: 'big' } })
    expect(await screen.findByTestId('toast')).toHaveTextContent('Thanked')
  })

  it('marks receipts sent and exports the queue behind a confirm (03 §5.2)', async () => {
    const user = userEvent.setup()
    renderGiving()
    await user.click(screen.getByRole('tab', { name: /Needs receipts · 2/ }))

    const queue = screen.getByRole('table')
    const row = within(queue).getByText('£180').closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Mark sent' }))
    await waitFor(() => expect(setReceipt.mutateAsync).toHaveBeenCalled())
    expect(setReceipt.mutateAsync.mock.calls[0]?.[0]).toMatchObject({ status: 'sent' })

    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/Data leaves the system/)
    expect(downloadCsv).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: /Export 2 rows/ }))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalled())
    const [filename, csv] = downloadCsv.mock.calls[0] as [string, string]
    expect(filename).toMatch(/^receipts-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(csv.split('\r\n')).toHaveLength(3)
    expect(csv).toContain('Gift ID,Donor,Address,Postcode')
  })

  it('shows the pledge with its overdue installment and a write-off confirm (admin)', async () => {
    const user = userEvent.setup()
    renderGiving()
    await user.click(screen.getByRole('tab', { name: /Pledges · 1/ }))
    expect(screen.getByText(/1 overdue installment/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Write off' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/cannot be undone/)
    await user.clear(within(dialog).getByLabelText('Amount written off'))
    await user.type(within(dialog).getByLabelText('Amount written off'), '15000')
    await user.type(within(dialog).getByLabelText('Write-off reason'), 'business failed')
    await user.click(within(dialog).getByRole('button', { name: 'Write it off' }))
    await waitFor(() => expect(setPledgeStatus.mutateAsync).toHaveBeenCalled())
    expect(setPledgeStatus.mutateAsync.mock.calls[0]?.[0]).toMatchObject({
      status: 'written_off',
      writeOffAmount: 15000,
      reason: 'business failed',
    })
  })

  it('shows the failing standing order in red with the call-don’t-email hint', async () => {
    const user = userEvent.setup()
    renderGiving()
    await user.click(screen.getByRole('tab', { name: /Recurring · 1/ }))
    expect(screen.getByText(/Standing order failing — 2 missed/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(setRecurringStatus.mutateAsync).toHaveBeenCalled())
    expect(setRecurringStatus.mutateAsync.mock.calls[0]?.[0]).toMatchObject({ status: 'paused' })
  })

  it('is read-only for a viewer (11 §1)', () => {
    state.member = { id: 'v', role: 'viewer', full_name: 'Viewer' }
    renderGiving()
    expect(screen.queryByRole('button', { name: /Record gift/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record pledge' })).not.toBeInTheDocument()
  })
})

describe('Gift entry sheet (05 §1)', () => {
  it('offers the ask array from contact_stats and fills the amount', async () => {
    const user = userEvent.setup()
    renderGiving()
    const dialog = await openGiftSheet(user)

    const chips = within(dialog).getByTestId('ask-array')
    expect(within(chips).getByRole('button', { name: 'Last £1,000' })).toBeInTheDocument()
    expect(within(chips).getByRole('button', { name: 'Highest £5,000' })).toBeInTheDocument()

    await user.click(within(chips).getByRole('button', { name: /Highest \+25%/ }))
    expect(within(dialog).getByLabelText('Amount')).toHaveValue('6300')
  })

  it('previews Gift Aid live and only offers GASDS for small cash gifts', async () => {
    const user = userEvent.setup()
    renderGiving()
    const dialog = await openGiftSheet(user)

    // No declaration on file → the chase chip, disabled until M7.
    const line = within(dialog).getByTestId('gift-aid-line')
    expect(line).toHaveTextContent(/No declaration on file/)
    expect(within(line).getByRole('button', { name: /Request a declaration/ })).toBeDisabled()

    // Non-GBP is ineligible whatever the declarations say.
    await user.selectOptions(within(dialog).getByLabelText('Currency'), 'USD')
    expect(within(dialog).getByTestId('gift-aid-line')).toHaveTextContent(/Ineligible/)
    expect(within(dialog).getByLabelText('Sterling value')).toBeInTheDocument()
    await user.selectOptions(within(dialog).getByLabelText('Currency'), 'GBP')

    // GASDS appears only for cash/contactless ≤ £30.
    expect(within(dialog).queryByLabelText(/GASDS/)).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Amount'), '20')
    await user.selectOptions(within(dialog).getByLabelText('Payment method'), 'cash')
    expect(within(dialog).getByText(/Claim under GASDS/)).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('Amount'))
    await user.type(within(dialog).getByLabelText('Amount'), '45')
    expect(within(dialog).queryByText(/Claim under GASDS/)).not.toBeInTheDocument()
  })

  it('shows the eligible line when a declaration covers the date', async () => {
    state.declarations = [
      {
        id: 'ga1',
        contact_id: 'dovid',
        declared_on: '2026-01-10',
        method: 'written',
        covers_past: true,
        covers_future: true,
        covers_from: null,
        cancelled_on: null,
        evidence_url: null,
      },
    ]
    const user = userEvent.setup()
    renderGiving()
    const dialog = await openGiftSheet(user)
    expect(within(dialog).getByTestId('gift-aid-line')).toHaveTextContent(/Eligible — declaration on file/)
  })

  it('links the gift to an overdue installment through the applies-to banner', async () => {
    const user = userEvent.setup()
    renderGiving()
    const dialog = await openGiftSheet(user)

    const banner = within(dialog).getByTestId('applies-to')
    const overdue = within(banner).getByRole('button', { name: /overdue/ })
    await user.click(overdue)
    expect(overdue).toHaveAttribute('aria-pressed', 'true')
    // A one-tap link also fills the amount the schedule expects.
    expect(within(dialog).getByLabelText('Amount')).toHaveValue('5000')

    await user.click(within(dialog).getByRole('button', { name: 'Save gift' }))
    await waitFor(() => expect(createGift.mutateAsync).toHaveBeenCalled())
    expect(createGift.mutateAsync.mock.calls[0]?.[0]).toMatchObject({
      donation: {
        contact_id: 'dovid',
        amount: 5000,
        amount_gbp: 5000,
        currency: 'GBP',
        status: 'received',
        pledge_id: 'pl-1',
        installment_id: 'ins-overdue',
        fund_id: 'f1',
      },
      softCredit: null,
      tribute: null,
    })
  })

  it('offers the influencer soft credit and writes a tribute row', async () => {
    state.introducedBy = { id: 'weiss', name: "R' Weiss" }
    const user = userEvent.setup()
    renderGiving()
    const dialog = await openGiftSheet(user)

    await user.type(within(dialog).getByLabelText('Amount'), '360')
    await user.click(within(dialog).getByRole('button', { name: /Credit R' Weiss as influencer/ }))
    await user.click(within(dialog).getByLabelText(/in honour \/ in memory/i))
    const tribute = within(dialog).getByTestId('tribute-fields')
    await user.selectOptions(within(tribute).getByLabelText('Tribute type'), 'yahrzeit')
    await user.type(within(tribute).getByLabelText('Honoree'), 'R’ Moshe Cohen')
    await user.type(within(tribute).getByLabelText('Acknowledgee'), 'Mrs R. Cohen')
    await user.click(within(tribute).getByLabelText(/Notify the acknowledgee/))

    await user.click(within(dialog).getByRole('button', { name: 'Save gift' }))
    await waitFor(() => expect(createGift.mutateAsync).toHaveBeenCalled())
    const input = createGift.mutateAsync.mock.calls[0]?.[0] as {
      softCredit: Record<string, unknown> | null
      tribute: Record<string, unknown> | null
    }
    expect(input.softCredit).toMatchObject({ contact_id: 'weiss', role: 'influencer', amount: 360 })
    expect(input.tribute).toMatchObject({
      tribute_type: 'yahrzeit',
      honoree_name: 'R’ Moshe Cohen',
      acknowledgee_name: 'Mrs R. Cohen',
      notify: true,
    })
  })

  it('refuses to save without an amount', async () => {
    const user = userEvent.setup()
    renderGiving()
    const dialog = await openGiftSheet(user)
    await user.click(within(dialog).getByRole('button', { name: 'Save gift' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Enter the amount received/)
    expect(createGift.mutateAsync).not.toHaveBeenCalled()
  })
})
