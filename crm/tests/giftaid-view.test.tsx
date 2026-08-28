import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

/**
 * The Gift Aid workspace (05 §5, artboard A7): the three panels, the two verbs
 * on the found-money queue, the desktop-only Review & export flow with its
 * inline fixes, and the HMRC download → submit → new-rolling-claim sequence.
 *
 * The query module is mocked wholesale — the same shape `giving-view.test.tsx`
 * uses — so this file tests the screen, not the transport.
 */

const query = <T,>(data: T, over: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  error: null,
  isError: false,
  ...over,
})
const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue({}), isPending: false })

const contact = (id: string, first: string, last: string, over: Record<string, unknown> = {}) => ({
  id,
  title: 'Mr',
  first_name: first,
  last_name: last,
  hebrew_name: null,
  organization: null,
  contact_kind: 'individual',
  email: `${first.toLowerCase()}@example.com`,
  phone: '+447700900123',
  whatsapp: null,
  address_line1: '12 The Drive',
  address_line2: null,
  city: 'Golders Green',
  postcode: 'NW11 8AA',
  ga_house_no: null,
  is_archived: false,
  stage: 'active_donor',
  priority: 'medium',
  ...over,
})

const rolling = {
  claim_id: 'claim-1',
  status: 'draft-rolling',
  building_since: '2026-07-01',
  submitted_on: null,
  paid_on: null,
  hmrc_reference: null,
  donations_total: 48200,
  claimable_total: 12050,
  gasds_total: 310,
  gift_count: 142,
  donor_count: 58,
}

const filed = {
  claim_id: 'claim-0',
  status: 'paid',
  building_since: '2026-04-01',
  submitted_on: '2026-06-30',
  paid_on: '2026-07-21',
  hmrc_reference: 'CO-88214',
  donations_total: 55616,
  claimable_total: 13904,
  gasds_total: 0,
  gift_count: 168,
  donor_count: 71,
}

const declarations = [
  {
    id: 'dec-1',
    contact_id: 'cohen',
    declared_on: '2026-03-12',
    method: 'online',
    wording_version: 'HMRC 2024-04',
    covers_past: true,
    covers_future: true,
    covers_from: null,
    oral_confirmation_sent_on: null,
    cancelled_on: null,
    evidence_url: null,
  },
  {
    id: 'dec-2',
    contact_id: 'frankel',
    declared_on: '2026-08-02',
    method: 'oral',
    wording_version: 'HMRC 2024-04',
    covers_past: true,
    covers_future: true,
    covers_from: null,
    oral_confirmation_sent_on: null,
    cancelled_on: null,
    evidence_url: null,
  },
]

const board = {
  rolling,
  history: [filed],
  missing: [
    {
      contact_id: 'berger',
      gift_count: 6,
      eligible_total: 1800,
      recoverable: 450,
      eligible_total_4y: 1800,
      recoverable_4y: 450,
      first_gift_on: '2024-09-01',
      last_gift_on: '2026-05-01',
    },
    {
      contact_id: 'gross',
      gift_count: 3,
      eligible_total: 1200,
      recoverable: 300,
      eligible_total_4y: 1200,
      recoverable_4y: 300,
      first_gift_on: '2025-02-01',
      last_gift_on: '2026-04-01',
    },
  ],
  declarations,
  excluded: [],
  contacts: {
    berger: contact('berger', 'Aron', 'Berger'),
    gross: contact('gross', 'Yisroel', 'Gross'),
    cohen: contact('cohen', 'Dovid', 'Cohen'),
    frankel: contact('frankel', 'Devorah', 'Frankel'),
    blocked: contact('blocked', 'Shimon', 'Hoffman', { postcode: null, address_line1: null }),
  },
  amountsHidden: false,
}

const failures = [
  {
    donation_id: 'g-blocked',
    contact_id: 'blocked',
    donor_name: 'Mr Shimon Hoffman',
    donated_on: '2026-05-04',
    amount_gbp: 500,
    code: 'missing_postcode',
    message: 'Postcode missing — HMRC needs it to match the donor',
  },
  {
    donation_id: 'g-blocked',
    contact_id: 'blocked',
    donor_name: 'Mr Shimon Hoffman',
    donated_on: '2026-05-04',
    amount_gbp: 500,
    code: 'missing_house_no',
    message: 'House name or number missing',
  },
]

const lines = [
  {
    gift: {
      id: 'g-ok',
      contact_id: 'cohen',
      donated_on: '2026-03-04',
      amount: 250,
      currency: 'GBP',
      amount_gbp: 250,
      status: 'received',
      is_gasds: false,
      gift_aid_status: 'eligible',
      gift_aid_claim_id: 'claim-1',
    },
    contact: board.contacts.cohen,
  },
  {
    gift: {
      id: 'g-blocked',
      contact_id: 'blocked',
      donated_on: '2026-05-04',
      amount: 500,
      currency: 'GBP',
      amount_gbp: 500,
      status: 'received',
      is_gasds: false,
      gift_aid_status: 'eligible',
      gift_aid_claim_id: 'claim-1',
    },
    contact: board.contacts.blocked,
  },
]

const state = {
  member: { id: 'braun', role: 'admin', full_name: "R' Braun" } as
    | { id: string; role: string; full_name: string }
    | null,
  board: board as unknown,
  failures: failures as unknown[],
  validationLoading: false,
}

const createDeclaration = {
  ...mutation(),
  mutateAsync: vi.fn().mockResolvedValue({ declaration: { id: 'new-dec' }, taskId: 'task-1' }),
}
const confirmOral = { ...mutation(), mutateAsync: vi.fn().mockResolvedValue({ previous: null, completedTaskIds: [] }) }
const cancelDeclaration = mutation()
const fixAddress = mutation()
const setExcluded = mutation()
const submitClaim = mutation()
const markPaid = mutation()
const downloadCsv = vi.fn()

vi.mock('../src/features/giving/download', () => ({ downloadCsv }))

vi.mock('../src/lib/queries/giftaid', () => ({
  BACK_CLAIM_VIEW_NAME: 'GA: missing declarations',
  useGiftAidBoard: () => query(state.board),
  useClaimValidation: () => query(state.failures, { isLoading: state.validationLoading }),
  useClaimLines: () => query(lines),
  useBackClaimViewId: () => query('view-ga'),
  useCreateDeclaration: () => createDeclaration,
  useDeleteDeclaration: () => mutation(),
  useCancelDeclaration: () => cancelDeclaration,
  useUncancelDeclaration: () => mutation(),
  useConfirmOralDeclaration: () => confirmOral,
  useUnconfirmOralDeclaration: () => mutation(),
  useFixDonorAddress: () => fixAddress,
  useSetGiftExcluded: () => setExcluded,
  useSubmitClaim: () => submitClaim,
  useMarkClaimPaid: () => markPaid,
  useUnmarkClaimPaid: () => mutation(),
}))

vi.mock('../src/lib/queries/settings', () => ({
  useAutomationRules: () => query([{ rule_key: 'org_details', is_enabled: true, params: { name: 'Yeshivas Ohr', hmrc_reference: 'XR12345' } }]),
  readOrgDetails: (rules: Array<{ rule_key: string; params: Record<string, string> }> | undefined) => {
    const params = rules?.find((rule) => rule.rule_key === 'org_details')?.params ?? {}
    return {
      name: params.name ?? '',
      charity_number: params.charity_number ?? '',
      hmrc_reference: params.hmrc_reference ?? '',
      contact_email: params.contact_email ?? '',
    }
  },
  ORG_DETAILS_KEY: 'org_details',
}))

vi.mock('../src/features/auth/useTeamMember', () => ({
  useTeamMember: () => query(state.member),
  isAdmin: (member: { role?: string } | null) => member?.role === 'admin',
  canEdit: (member: { role?: string } | null) => member?.role === 'admin' || member?.role === 'fundraiser',
}))

vi.mock('../src/lib/queries/tasks', () => ({
  useContactSearch: () => query([]),
}))

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

async function renderWorkspace() {
  const { ToastProvider } = await import('../src/components')
  const { GiftAidView } = await import('../src/features/giftaid/GiftAidView')
  return render(
    <Providers>
      <ToastProvider>
        <GiftAidView />
      </ToastProvider>
    </Providers>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  state.member = { id: 'braun', role: 'admin', full_name: "R' Braun" }
  state.board = board
  state.failures = failures
  state.validationLoading = false
  // jsdom has no matchMedia; the workspace treats a missing one as desktop.
  // @ts-expect-error — narrow test double, only `matches` is read.
  window.matchMedia = (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })
})

/* ------------------------------------------------------------ the panels */

describe('the rolling claim hero (05 §5 panel 1)', () => {
  it('shows the eligible count, the donations, the +25% and GASDS separately', async () => {
    await renderWorkspace()
    const hero = screen.getByRole('region', { name: 'Current Gift Aid claim' })
    expect(within(hero).getByText('142')).toBeInTheDocument()
    expect(within(hero).getByText('£48,200')).toBeInTheDocument()
    expect(within(hero).getByText('£12,050')).toBeInTheDocument()
    expect(within(hero).getByText('£310')).toBeInTheDocument()
    expect(within(hero).getByText(/building since 1 Jul 2026/)).toBeInTheDocument()
  })

  it('summarises the validation pass as a chip beside the button', async () => {
    await renderWorkspace()
    // One gift, two missing fields: the chip counts rows to touch, not failures.
    expect(screen.getByText('Validation: 1 row needs a postcode')).toBeInTheDocument()
  })

  it('offers Review & export to an admin only', async () => {
    await renderWorkspace()
    expect(screen.getByRole('button', { name: /Review & export HMRC CSV/ })).toBeInTheDocument()
  })

  it('tells a fundraiser that submitting is not theirs to do (11 §1)', async () => {
    state.member = { id: 'f', role: 'fundraiser', full_name: 'Fundraiser' }
    await renderWorkspace()
    expect(screen.queryByRole('button', { name: /Review & export/ })).not.toBeInTheDocument()
    expect(screen.getByText('Submitting a claim is an admin action')).toBeInTheDocument()
  })
})

describe('the missing-declaration queue (05 §5 panel 2)', () => {
  it('sorts by recoverable value and totals the header', async () => {
    await renderWorkspace()
    const panel = screen.getByRole('region', { name: 'Missing declarations' })
    expect(within(panel).getByText('£750 recoverable from 2 donors')).toBeInTheDocument()
    const names = within(panel).getAllByRole('link').map((link) => link.textContent)
    expect(names[0]).toBe('Mr Aron Berger')
  })

  it('drafts a request the human sends — nothing leaves the app by itself', async () => {
    const user = userEvent.setup()
    await renderWorkspace()
    const panel = screen.getByRole('region', { name: 'Missing declarations' })
    await user.click(within(panel).getAllByRole('button', { name: 'Draft request' })[0] as HTMLElement)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('link', { name: 'Open in email' })).toHaveAttribute(
      'href',
      expect.stringContaining('mailto:'),
    )
    expect(within(dialog).getByRole('button', { name: 'Copy for WhatsApp' })).toBeInTheDocument()
    expect((within(dialog).getByLabelText('Draft') as HTMLTextAreaElement).value).toContain('Aron Berger')
  })

  it('"Took it orally" records an oral declaration and queues the confirmation', async () => {
    const user = userEvent.setup()
    await renderWorkspace()
    const panel = screen.getByRole('region', { name: 'Missing declarations' })
    await user.click(within(panel).getAllByRole('button', { name: 'Took it orally' })[0] as HTMLElement)

    await waitFor(() => expect(createDeclaration.mutateAsync).toHaveBeenCalled())
    expect(createDeclaration.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ contact_id: 'berger', method: 'oral', covers_future: true, covers_past: true }),
    )
    expect(await screen.findByText(/written confirmation queued/)).toBeInTheDocument()
  })
})

describe('declarations and history (05 §5 panels 2–3)', () => {
  it('flags an oral declaration as pending until the confirmation is stamped', async () => {
    await renderWorkspace()
    const table = screen.getByRole('region', { name: 'Recent declarations' })
    expect(within(table).getByText('confirmation pending')).toBeInTheDocument()
    expect(within(table).getAllByText('future + 4 back-years', { exact: false }).length).toBe(2)
    expect(within(table).getAllByText('HMRC 2024-04').length).toBeGreaterThan(0)
  })

  it('stamps the confirmation as sent', async () => {
    const user = userEvent.setup()
    await renderWorkspace()
    const table = screen.getByRole('region', { name: 'Recent declarations' })
    await user.click(within(table).getByRole('button', { name: 'Confirmation sent' }))
    await waitFor(() => expect(confirmOral.mutateAsync).toHaveBeenCalled())
  })

  it('shows a paid claim with its date and reference', async () => {
    await renderWorkspace()
    const history = screen.getByRole('region', { name: 'Claim history' })
    expect(within(history).getByText('PAID 21 Jul')).toBeInTheDocument()
    expect(within(history).getByText('CO-88214')).toBeInTheDocument()
    expect(within(history).getByText('£13,904')).toBeInTheDocument()
  })
})

describe('the four-year back-claim card (07 §10)', () => {
  it('links the saved view that feeds the declaration run', async () => {
    await renderWorkspace()
    const card = screen.getByRole('region', { name: 'Four-year back-claim' })
    expect(within(card).getByRole('link')).toHaveAttribute('href', '/contacts?view=view-ga')
    expect(within(card).getByText(/£750 recoverable/)).toBeInTheDocument()
  })
})

/* ------------------------------------------------------ review and export */

describe('Review & export (05 §5, 07 §8.2)', () => {
  it('lists each blocked gift once, with its problems and a way to fix them', async () => {
    const user = userEvent.setup()
    await renderWorkspace()
    await user.click(screen.getByRole('button', { name: /Review & export HMRC CSV/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Mr Shimon Hoffman')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Postcode')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('House name/number')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Exclude this gift' })).toBeInTheDocument()
    // Nothing exports while a row would be rejected.
    expect(within(dialog).getByRole('button', { name: /Generate HMRC CSV/ })).toBeDisabled()
    expect(within(dialog).getByText(/Fix or exclude the 1 blocked gift first/)).toBeInTheDocument()
  })

  it('writes an inline postcode fix to the donor record', async () => {
    const user = userEvent.setup()
    await renderWorkspace()
    await user.click(screen.getByRole('button', { name: /Review & export HMRC CSV/ }))
    const dialog = await screen.findByRole('dialog')

    await user.type(within(dialog).getByLabelText('Postcode'), 'N16 5RP')
    await user.click(within(dialog).getAllByRole('button', { name: 'Save' })[0] as HTMLElement)
    await waitFor(() =>
      expect(fixAddress.mutateAsync).toHaveBeenCalledWith({ contactId: 'blocked', postcode: 'N16 5RP' }),
    )
  })

  it('holds a gift back from the claim in one click', async () => {
    const user = userEvent.setup()
    await renderWorkspace()
    await user.click(screen.getByRole('button', { name: /Review & export HMRC CSV/ }))
    const dialog = await screen.findByRole('dialog')

    await user.click(within(dialog).getByRole('button', { name: 'Exclude this gift' }))
    await waitFor(() =>
      expect(setExcluded.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ giftId: 'g-blocked', contactId: 'blocked', excluded: true }),
      ),
    )
  })

  it('confirms the download, then files the claim and reports the fresh rolling claim', async () => {
    const user = userEvent.setup()
    state.failures = []
    await renderWorkspace()
    await user.click(screen.getByRole('button', { name: /Review & export HMRC CSV/ }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText(/2 rows validated/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /Generate HMRC CSV/ }))

    // The export leaves the system, so it is a confirm (I-12 / 03 §5.2).
    expect(await within(dialog).findByText(/This writes/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /^Download gift-aid-claim-/ }))
    expect(downloadCsv).toHaveBeenCalledTimes(1)
    const [filename, csv] = downloadCsv.mock.calls[0] as [string, string]
    expect(filename).toMatch(/^gift-aid-claim-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(csv.split('\r\n')[0]).toBe(
      'Title,First name,Last name,House name or number,Postcode,Aggregated donations,Sponsored event,Donation date,Amount',
    )
    expect(csv).toContain('04/03/26')

    await user.type(await within(dialog).findByLabelText('HMRC reference'), 'CO-99001')
    await user.click(within(dialog).getByRole('button', { name: 'Record submission' }))

    await waitFor(() =>
      expect(submitClaim.mutateAsync).toHaveBeenCalledWith({ claimId: 'claim-1', reference: 'CO-99001' }),
    )
    expect(await within(dialog).findByText(/a fresh rolling claim is already open/)).toBeInTheDocument()
  })
})
