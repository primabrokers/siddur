import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { format, subDays } from 'date-fns'

/**
 * Composition test for the whole donor profile: every panel rendered from
 * fixtures shaped like the live rows, so a missing null-guard fails here
 * rather than in front of the fundraiser.
 */

const query = <T,>(data: T) => ({ data, isLoading: false, error: null, isError: false })
const mutation = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue({}),
  isPending: false,
})

const overdueOn = format(subDays(new Date(), 3), 'yyyy-MM-dd')

const contact = {
  id: 'dovid',
  title: null,
  first_name: 'Dovid',
  last_name: 'Cohen',
  hebrew_name: 'דוד הכהן',
  organization: null,
  position: 'Director',
  industry: 'Property',
  contact_kind: 'individual',
  is_organisation_self: false,
  photo_url: null,
  household_id: 'house',
  email: 'dovid@example.com',
  phone: '+447700900123',
  whatsapp: '+447700900123',
  preferred_language: 'en',
  preferred_channel: 'call',
  best_time_to_contact: 'after 8pm',
  assistant_name: null,
  assistant_contact: null,
  linkedin_url: null,
  website_url: null,
  address_line1: '12 The Drive',
  address_line2: null,
  city: 'Golders Green',
  postcode: 'NW11 8AA',
  country: 'United Kingdom',
  source: null,
  introduced_by_id: null,
  introduced_by_note: null,
  relationship_owner_id: 'braun',
  relationship_strength: 8,
  known_since: null,
  mutual_connections: "R' Weiss",
  birthday: '1975-11-14',
  spouse_name: 'Rivky',
  family_notes: '5 children',
  things_to_remember: 'Never solicit at shul',
  stage: 'in_discussion',
  priority: 'high',
  tier: 'A',
  estimated_capacity: null,
  contact_frequency_days: 60,
  kit_paused_until: null,
  engagement_score: 88,
  engagement_tier: 'hot',
  pinned_note_id: 'n1',
  is_archived: false,
  merged_into_id: null,
}

const stats = {
  contact_id: 'dovid',
  lifetime_giving: 65000,
  this_year_giving: 15000,
  last_year_giving: 20000,
  soft_credit_lifetime: 6500,
  soft_credit_this_year: 0,
  gift_count: 7,
  largest_gift: 20000,
  average_gift: 9285,
  first_gift_on: '2019-05-02',
  first_gift_amount: 1000,
  last_gift_on: '2026-03-12',
  last_gift_amount: 15000,
  is_lybunt: false,
  is_sybunt: false,
  pledge_balance: 15000,
  last_contact_at: '2026-08-11T10:00:00Z',
  last_contact_kind: 'meeting',
  days_since_contact: 12,
  kit_due_on: '2026-10-11',
  open_task_count: 1,
  next_action_id: 't1',
  next_action_title: 'Call re proposal',
  next_action_due_on: overdueOn,
  next_action_type: 'call',
  flag: 'overdue' as const,
  donor_status: 'active' as const,
  has_ga_declaration: true,
}

const giving = {
  donations: [
    {
      id: 'd1',
      contact_id: 'dovid',
      donated_on: '2026-03-12',
      amount: 15000,
      currency: 'GBP',
      amount_gbp: 15000,
      fund_id: 'f1',
      campaign_id: null,
      appeal_id: 'a1',
      payment_method: 'bank_transfer',
      status: 'received',
      pledge_id: 'p1',
      installment_id: null,
      recurring_agreement_id: null,
      receipt_status: 'sent',
      receipt_pref: null,
      thank_you_status: 'done',
      gift_aid_status: 'claimed',
      gift_aid_claim_id: null,
      is_gasds: false,
      notes: null,
    },
  ],
  pledges: [
    {
      id: 'p1',
      contact_id: 'dovid',
      total_amount: 25000,
      amount_gbp: 25000,
      currency: 'GBP',
      fund_id: 'f1',
      campaign_id: 'c1',
      appeal_id: null,
      pledged_on: '2026-02-01',
      status: 'open',
      write_off_amount: null,
      notes: null,
    },
  ],
  installments: [
    { id: 'i1', pledge_id: 'p1', due_on: '2026-09-15', amount: 5000, status: 'expected' },
  ],
  amountsHidden: false,
  recurring: [
    {
      id: 'r1',
      contact_id: 'dovid',
      amount: 100,
      currency: 'GBP',
      frequency: 'monthly',
      payment_method: 'standing_order',
      fund_id: 'f1',
      starts_on: '2025-01-01',
      ends_on: null,
      status: 'failing',
      last_payment_on: '2026-06-01',
      missed_count: 2,
    },
  ],
}

const timeline = {
  past: [
    {
      id: 'interaction-i1',
      kind: 'interaction' as const,
      category: 'conversations' as const,
      at: '2026-08-11T10:00:00Z',
      kindLabel: 'Meeting',
      metaParts: ["logged by R' Braun"],
      sourceLabel: 'via quick capture',
      body: 'Met in London. Very warm.',
      outcome: 'Outcome: wants the naming opportunities',
      icon: 'meeting' as const,
    },
    {
      id: 'donation-d1',
      kind: 'donation' as const,
      category: 'giving' as const,
      at: '2026-03-12',
      kindLabel: 'Donation',
      metaParts: ['Scholarships fund', 'Purim appeal'],
      amount: 15000,
      body: 'received — bank transfer · receipt sent ✓',
      icon: 'giving' as const,
    },
  ],
  upcoming: [
    { id: 'installment-i1', label: 'Pledge installment £5,000', at: '2026-09-15', tone: 'neutral' as const },
  ],
  scheduled: [],
}

const notes = [
  {
    id: 'n1',
    contact_id: 'dovid',
    category: 'personal',
    body: 'Prefers calls after 8pm',
    is_private: false,
    is_pinned: true,
    created_by: 'braun',
    created_at: '2026-06-20T08:00:00Z',
  },
]

const household = {
  household: {
    id: 'house',
    name: 'Cohen Family',
    formal_greeting: 'Rabbi & Mrs. Cohen',
    informal_greeting: null,
    hebrew_greeting: null,
    greeting_is_override: false,
    primary_contact_id: 'dovid',
  },
  members: [
    { contact, stats },
    { contact: { ...contact, id: 'rivky', first_name: 'Rivky' }, stats: null },
  ],
  combinedLifetime: 71500,
  combinedThisYear: 15000,
}

// The profile asks the auth feature whether this member may create gifts
// (11 §1); the profile's own behaviour is what is under test here.
vi.mock('../src/features/auth/useTeamMember', () => ({
  useTeamMember: () => ({
    data: { id: 'braun', role: 'admin', full_name: "R' Braun" },
    isLoading: false,
    error: null,
  }),
  canEdit: () => true,
  isAdmin: () => true,
}))

vi.mock('../src/lib/queries/contacts', () => ({
  useContact: () => query({ contact, stats, statsError: null, introducedBy: null }),
  useContactTimeline: () => query(timeline),
  useContactGiving: () => query(giving),
  useContactNotes: () => query(notes),
  useContactDocuments: () => query([]),
  useContactTags: () => query([{ id: 't1', name: 'Building project', category: 'interest', color: null }]),
  useContactDeclarations: () =>
    query([
      {
        id: 'g1',
        contact_id: 'dovid',
        declared_on: '2026-03-12',
        method: 'online',
        covers_past: true,
        covers_future: true,
        covers_from: null,
        cancelled_on: null,
        evidence_url: null,
      },
    ]),
  useHousehold: () => query(household),
  useTeamMembers: () => query([{ id: 'braun', full_name: "R' Braun" }]),
  useGivingRefs: () => query({ funds: { f1: 'Scholarships' }, campaigns: { c1: 'Building campaign' }, appeals: { a1: 'Purim appeal' } }),
  useLookupOptions: (list: string) =>
    query(
      list === 'stage'
        ? [{ value: 'in_discussion', label: 'In discussion', sort_order: 1, color: null, meta: null }]
        : [],
    ),
  useUpdateContact: mutation,
  useSetArchived: mutation,
  useSetPinnedNote: mutation,
  useCreateNote: mutation,
  useCreateDocument: mutation,
  useCreateTask: mutation,
  useScheduleMeeting: mutation,
  useCreateContact: mutation,
  findDuplicates: vi.fn().mockResolvedValue([]),
  draftToRow: (draft: unknown) => draft,
}))

const { ContactProfile } = await import('../src/features/contacts/ContactProfile')
const { ToastProvider } = await import('../src/components')
const { CaptureProvider } = await import('../src/features/capture/QuickCapture')

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/contacts/dovid']}>
        <ToastProvider>
          <CaptureProvider>{children}</CaptureProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const renderProfile = () =>
  render(
    <Wrapper>
      <ContactProfile id="dovid" />
    </Wrapper>,
  )

describe('ContactProfile — the whole record (04 §5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the header, the pinned note and the upcoming block', () => {
    renderProfile()
    expect(screen.getByTestId('profile-header')).toHaveTextContent('Dovid Cohen')
    expect(screen.getByTestId('pinned-note')).toHaveTextContent('Prefers calls after 8pm')
    expect(screen.getByTestId('upcoming-block')).toHaveTextContent('Call re proposal')
    expect(screen.getByTestId('upcoming-block')).toHaveTextContent('Pledge installment £5,000')
  })

  it('offers every act-from-the-record channel with working deep links (04 §5.7)', () => {
    renderProfile()
    expect(screen.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+447700900123')
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
      'href',
      'https://wa.me/447700900123',
    )
    expect(screen.getByRole('link', { name: 'Email' })).toHaveAttribute('href', 'mailto:dovid@example.com')
    for (const label of ['Log', 'Task', 'Meet']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('shows the merged timeline and filters it by chip', async () => {
    const user = userEvent.setup()
    renderProfile()
    expect(screen.getByText('Met in London. Very warm.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Giving' }))
    expect(screen.queryByText('Met in London. Very warm.')).not.toBeInTheDocument()
    expect(screen.getByText(/receipt sent ✓/)).toBeInTheDocument()
  })

  it('switches to the Giving tab: gifts table, pledge progress and the failing standing order', async () => {
    const user = userEvent.setup()
    renderProfile()
    await user.click(screen.getByRole('tab', { name: 'Giving' }))
    expect(screen.getByRole('table')).toBeInTheDocument()
    // Two pledge cards (the tab and the rail) share one progress mechanism.
    expect(screen.getAllByRole('progressbar')[0]).toHaveAttribute('aria-valuenow', '60')
    expect(screen.getByText(/Standing order failing/)).toBeInTheDocument()
    // Gift entry arrived with M4; the profile passes the donor through to it.
    expect(screen.getByRole('button', { name: 'Record gift' })).toBeEnabled()
    expect(screen.getByText('Soft credit — lifetime')).toBeInTheDocument()
  })

  it('switches to the Details tab: relationship intelligence, notes and documents', async () => {
    const user = userEvent.setup()
    renderProfile()
    await user.click(screen.getByRole('tab', { name: 'Details' }))
    expect(screen.getByRole('heading', { name: 'Relationship intelligence' })).toBeInTheDocument()
    expect(screen.getByText('Rivky')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument()
  })

  it('renders the right rail: before-you-call, household, cadence and the open pledge', () => {
    renderProfile()
    expect(screen.getByRole('heading', { name: 'Before you call' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Household — Cohen Family/ })).toBeInTheDocument()
    expect(screen.getByText('£71,500')).toBeInTheDocument()
    const kit = screen.getByRole('heading', { name: 'Keep in touch' }).parentElement as HTMLElement
    expect(within(kit).getByRole('button', { name: '2 months' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByText('Open pledge').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Next installment £5,000/).length).toBeGreaterThan(0)
  })

  it('opens the task sheet from the action bar with the contact fixed (I-2)', async () => {
    const user = userEvent.setup()
    renderProfile()
    await user.click(screen.getByRole('button', { name: 'Task' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/every task belongs to a person/i)).toBeInTheDocument()
    expect(within(dialog).getByText('Dovid Cohen')).toBeInTheDocument()
  })
})
