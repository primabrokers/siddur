import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { addDays, format, subDays } from 'date-fns'
import { ProfileHeader } from '../src/features/contacts/ProfileHeader'
import { mapContactStats } from '../src/features/contacts/stats'
import { buildTimeline, filterTimeline } from '../src/features/contacts/timeline'
import type { ContactRow, ContactStats, TagRow } from '../src/features/contacts/types'

/* The A2 wireframe's donor, as the database would hand him over. */
const DOVID: ContactRow = {
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
  household_id: 'house-cohen',
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
  introduced_by_id: 'weiss',
  introduced_by_note: null,
  relationship_owner_id: 'braun',
  relationship_strength: 8,
  known_since: null,
  mutual_connections: "R' Weiss, the Feld brothers",
  birthday: '1975-11-14',
  spouse_name: 'Rivky',
  family_notes: '5 children, eldest in Gateshead yeshiva',
  things_to_remember: 'Never solicit at shul',
  stage: 'in_discussion',
  priority: 'high',
  tier: 'A',
  estimated_capacity: null,
  contact_frequency_days: 60,
  kit_paused_until: null,
  engagement_score: 88,
  engagement_tier: 'hot',
  pinned_note_id: 'note-1',
  is_archived: false,
  merged_into_id: null,
}

const overdueOn = format(subDays(new Date(), 4), 'yyyy-MM-dd')

const STATS = mapContactStats({
  contact_id: 'dovid',
  lifetime_giving: 65000,
  this_year_giving: 15000,
  last_year_giving: 20000,
  soft_credit_lifetime: 6500,
  gift_count: 7,
  largest_gift: 20000,
  average_gift: 9285,
  last_gift_on: '2026-03-12',
  last_gift_amount: 15000,
  pledge_balance: 15000,
  days_since_contact: 12,
  last_contact_kind: 'meeting',
  kit_due_on: '2026-10-11',
  next_action_id: 'task-1',
  next_action_title: 'Call re proposal',
  next_action_due_on: overdueOn,
  next_action_type: 'call',
  flag: 'overdue',
  donor_status: 'active',
  has_ga_declaration: true,
}) as ContactStats

const TAGS: TagRow[] = [
  { id: 't1', name: 'Building project', category: 'interest', color: null },
  { id: 't2', name: 'Golders Green', category: 'community', color: null },
]

function renderHeader(props: Partial<Parameters<typeof ProfileHeader>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ProfileHeader
        contact={DOVID}
        stats={STATS}
        householdName="Cohen Family"
        ownerName="R' Braun"
        introducedBy={{ id: 'weiss', name: "R' Weiss" }}
        tags={TAGS}
        giftAid={{ onFile: true, enduring: true }}
        stageOptions={[{ value: 'in_discussion', label: 'In discussion', sort_order: 1, color: null, meta: null }]}
        onStageChange={() => undefined}
        {...props}
      />
    </MemoryRouter>,
  )
}

describe('ProfileHeader — the at-a-glance band (04 §5.1)', () => {
  it('names the donor, the Hebrew name and the household', () => {
    renderHeader()
    expect(screen.getByRole('heading', { name: 'Dovid Cohen' })).toBeInTheDocument()
    expect(screen.getByText('דוד הכהן')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cohen Family' })).toHaveAttribute(
      'href',
      '/contacts?household=house-cohen',
    )
  })

  it('renders the flag from contact_stats, never recomputed (I-8)', () => {
    renderHeader()
    expect(screen.getByRole('img', { name: 'Next action overdue' })).toHaveAttribute('data-flag', 'overdue')
  })

  it('shows the manual stage filled and the computed donor status outlined (I-7)', () => {
    renderHeader()
    const stage = screen.getByTitle('Relationship stage — click to change')
    expect(stage).toHaveTextContent('In discussion')
    expect(screen.getByText(/Active donor · computed/)).toBeInTheDocument()
  })

  it('renders the five-segment engagement meter with the tier named', () => {
    renderHeader()
    const meter = screen.getByTestId('engagement-meter')
    expect(meter).toHaveAttribute('data-tier', 'hot')
    expect(meter).toHaveTextContent('Hot')
  })

  it('says "Not enough history yet" instead of faking an unknown score', () => {
    renderHeader({ contact: { ...DOVID, engagement_tier: 'unknown' } })
    const meter = screen.getByTestId('engagement-meter')
    expect(meter).toHaveAttribute('data-tier', 'unknown')
    expect(meter).toHaveTextContent('Not enough history yet')
  })

  it('renders every number from the stats fixture', () => {
    renderHeader()
    const header = screen.getByTestId('profile-header')
    expect(within(header).getByText('£65,000')).toBeInTheDocument()
    expect(within(header).getByText('£15,000')).toBeInTheDocument()
    expect(within(header).getByText(/Mar 2026/)).toBeInTheDocument()
    expect(within(header).getByText('12 days ago')).toBeInTheDocument()
    expect(within(header).getByText(/\(meeting\)/)).toBeInTheDocument()
    expect(within(header).getByText(/every 2 months/)).toBeInTheDocument()
    expect(within(header).getByText(/✓ enduring/)).toBeInTheDocument()
  })

  it('renders an overdue next action in flag red', () => {
    renderHeader()
    const next = screen.getByText(/Call re proposal — was due/)
    expect(next.className).toContain('text-flag-overdue')
  })

  it('renders a future next action without the overdue colour', () => {
    const future = mapContactStats({
      contact_id: 'dovid',
      flag: 'future',
      next_action_title: 'Send the update',
      next_action_due_on: format(addDays(new Date(), 9), 'yyyy-MM-dd'),
    }) as ContactStats
    renderHeader({ stats: future })
    const next = screen.getByText(/Send the update —/)
    expect(next.className).not.toContain('text-flag-overdue')
  })

  it('surfaces the I-3 gap when no next action exists', () => {
    const noAction = mapContactStats({ contact_id: 'dovid', flag: 'none' }) as ContactStats
    renderHeader({ stats: noAction })
    const gap = screen.getByText('none — add one')
    expect(gap.className).toContain('text-flag-none-ink')
  })

  it('shows tags and the introducer on the third line', () => {
    renderHeader()
    expect(screen.getByText('Building project')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: "R' Weiss" })).toHaveAttribute('href', '/contacts/weiss')
  })

  it('degrades honestly when the derived view is unavailable', () => {
    renderHeader({ stats: null, statsError: 'relation "contact_stats" does not exist' })
    expect(screen.getByText(/Derived numbers unavailable/)).toBeInTheDocument()
    expect(screen.getByText('none — add one')).toBeInTheDocument()
  })

  it('marks Gift Aid missing when there is no declaration', () => {
    renderHeader({ giftAid: { onFile: false, enduring: false } })
    expect(screen.getByText('✗ none')).toBeInTheDocument()
  })
})

describe('buildTimeline — the merged feed (04 §5.2)', () => {
  const now = new Date('2026-08-25T09:00:00Z')

  const feed = buildTimeline({
    now,
    interactions: [
      {
        id: 'i1',
        contact_id: 'dovid',
        occurred_at: '2026-08-11T10:00:00Z',
        kind: 'meeting',
        status: 'logged',
        team_member_id: 'braun',
        summary: 'Met in London. Very warm.',
        outcome: 'wants to see the naming opportunities',
        is_meaningful: true,
        location: null,
        attendees: null,
        purpose: null,
        ask_amount: 20000,
        source: 'quick_capture_ai',
      },
      {
        id: 'i2',
        contact_id: 'dovid',
        occurred_at: '2026-09-04T14:00:00Z',
        kind: 'meeting',
        status: 'scheduled',
        team_member_id: 'braun',
        summary: 'Follow-up meeting',
        outcome: null,
        is_meaningful: false,
        location: 'His office',
        attendees: null,
        purpose: 'Naming opportunities',
        ask_amount: null,
        source: 'manual',
      },
      {
        id: 'i3',
        contact_id: 'dovid',
        occurred_at: '2026-07-01T10:00:00Z',
        kind: 'call',
        status: 'cancelled',
        team_member_id: null,
        summary: 'Cancelled',
        outcome: null,
        is_meaningful: false,
        location: null,
        attendees: null,
        purpose: null,
        ask_amount: null,
        source: 'manual',
      },
    ],
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
        pledge_id: null,
        installment_id: null,
        receipt_status: 'sent',
        thank_you_status: 'done',
        gift_aid_status: 'claimed',
        is_gasds: false,
        notes: null,
      },
    ],
    declarations: [
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
    ],
    notes: [
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
    ],
    tasks: [
      {
        id: 't-done',
        contact_id: 'dovid',
        title: 'Send the proposal',
        action_type: 'send_proposal',
        details: null,
        assigned_to: 'braun',
        due_on: '2026-07-10',
        priority: 'high',
        status: 'done',
        waiting_for: null,
        completed_at: '2026-07-10T12:00:00Z',
        origin: 'manual',
      },
      {
        id: 't-open',
        contact_id: 'dovid',
        title: 'Call re proposal',
        action_type: 'call',
        details: null,
        assigned_to: 'braun',
        due_on: '2026-08-20',
        priority: 'high',
        status: 'todo',
        waiting_for: null,
        completed_at: null,
        origin: 'manual',
      },
    ],
    installments: [
      { id: 'inst1', pledge_id: 'p1', due_on: '2026-09-15', amount: 5000, status: 'expected' },
    ],
    refs: { funds: { f1: 'Scholarships' }, campaigns: {}, appeals: { a1: 'Purim appeal' } },
    team: [{ id: 'braun', full_name: "R' Braun" }],
    kindLabels: { meeting: 'Meeting', call: 'Call' },
  })

  it('merges the sources in reverse-chronological order', () => {
    expect(feed.past.map((item) => item.id)).toEqual([
      'interaction-i1',
      'task-t-done',
      'note-n1',
      'donation-d1',
      'declaration-g1',
    ])
  })

  it('keeps scheduled meetings and the next installment in Upcoming, not the past', () => {
    expect(feed.upcoming.map((item) => item.id)).toEqual(['interaction-i2', 'installment-inst1'])
    expect(feed.past.some((item) => item.id === 'interaction-i2')).toBe(false)
  })

  it('drops cancelled interactions and still-open tasks', () => {
    expect(feed.past.some((item) => item.id === 'interaction-i3')).toBe(false)
    expect(feed.past.some((item) => item.id === 'task-t-open')).toBe(false)
  })

  it('labels the AI provenance and carries the ask amount into the outcome', () => {
    const meeting = feed.past.find((item) => item.id === 'interaction-i1')
    expect(meeting?.sourceLabel).toBe('via quick capture')
    expect(meeting?.metaParts).toContain("logged by R' Braun")
    expect(meeting?.outcome).toContain('Ask discussed: £20,000')
  })

  it('codes the gift on all three axes with its receipt/thank-you/GA state', () => {
    const gift = feed.past.find((item) => item.id === 'donation-d1')
    expect(gift?.amount).toBe(15000)
    expect(gift?.metaParts).toEqual(['Scholarships fund', 'Purim appeal'])
    expect(gift?.body).toContain('receipt sent ✓')
    expect(gift?.body).toContain('Gift Aid claimed ✓')
  })

  it('filters by chip category', () => {
    expect(filterTimeline(feed.past, 'giving').map((i) => i.kind)).toEqual(['donation', 'gift_aid'])
    expect(filterTimeline(feed.past, 'notes').map((i) => i.kind)).toEqual(['note'])
    expect(filterTimeline(feed.past, 'conversations').map((i) => i.kind)).toEqual(['interaction'])
    expect(filterTimeline(feed.past, 'all')).toHaveLength(feed.past.length)
  })
})
