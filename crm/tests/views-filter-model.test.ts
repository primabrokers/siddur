import { describe, expect, it } from 'vitest'
import {
  canonicalise,
  describeFilters,
  filtersEqual,
  isEmptyFilters,
  matchesView,
  parseFilters,
  routeForView,
  toRestPlan,
  withoutKey,
} from '../src/features/views/filterModel'
import { isUrgentView } from '../src/features/shell/navigation'
import type { ContactRow, ContactStats } from '../src/features/contacts/types'

const contact = (over: Partial<ContactRow>): ContactRow =>
  ({
    id: 'c1',
    first_name: 'Dovid',
    last_name: 'Cohen',
    stage: 'cultivation',
    priority: 'medium',
    tier: null,
    city: null,
    is_archived: false,
    merged_into_id: null,
    ...over,
  }) as ContactRow

const stats = (over: Partial<ContactStats>): ContactStats =>
  ({
    contact_id: 'c1',
    lifetime_giving: null,
    this_year_giving: null,
    last_year_giving: null,
    soft_credit_lifetime: null,
    soft_credit_this_year: null,
    gift_count: null,
    largest_gift: null,
    average_gift: null,
    first_gift_on: null,
    first_gift_amount: null,
    last_gift_on: null,
    last_gift_amount: null,
    is_lybunt: false,
    is_sybunt: false,
    pledge_balance: null,
    last_contact_at: null,
    last_contact_kind: null,
    days_since_contact: null,
    kit_due_on: null,
    open_task_count: null,
    next_action_id: null,
    next_action_title: null,
    next_action_due_on: null,
    next_action_type: null,
    flag: 'none',
    donor_status: null,
    has_ga_declaration: null,
    household_id: null,
    household_lifetime_giving: null,
    household_gift_count: null,
    ...over,
  }) as ContactStats

describe('view filters: parsing saved_views.filters', () => {
  it('reads every key the model declares', () => {
    const parsed = parseFilters({
      stage: ['prospect', 'cultivation'],
      priority: ['high'],
      tier: ['A'],
      tags: ['VIP'],
      city: ' Golders Green ',
      days_since_contact_gte: '60',
      flag: 'overdue',
      is_lybunt: true,
      is_sybunt: 'false',
      gave_this_year: false,
      pledge_balance_gt: 0,
      donor_status: ['pre_lapsed'],
    })
    expect(parsed).toEqual({
      stage: ['prospect', 'cultivation'],
      priority: ['high'],
      tier: ['A'],
      tags: ['VIP'],
      city: 'Golders Green',
      days_since_contact_gte: 60,
      flag: 'overdue',
      is_lybunt: true,
      is_sybunt: false,
      gave_this_year: false,
      pledge_balance_gt: 0,
      donor_status: ['pre_lapsed'],
    })
  })

  it('drops keys it does not understand instead of carrying them', () => {
    expect(parseFilters({ is_lybunt: true, wealth_screen: true, nonsense: { a: 1 } })).toEqual({
      is_lybunt: true,
    })
  })

  it('survives a null, a string and an array where an object was expected', () => {
    expect(parseFilters(null)).toEqual({})
    expect(parseFilters('{}')).toEqual({})
    expect(parseFilters([1, 2])).toEqual({})
  })

  it('canonicalises so two equal filter sets compare equal', () => {
    expect(filtersEqual({ stage: ['b', 'a'] }, { stage: ['a', 'b'] })).toBe(true)
    expect(filtersEqual({ stage: ['a'] }, { stage: ['a'], priority: ['high'] })).toBe(false)
    expect(canonicalise({ priority: ['high'], stage: ['a'] })).toEqual({ stage: ['a'], priority: ['high'] })
  })

  it('removes one criterion at a time (the chip’s ×)', () => {
    const next = withoutKey({ stage: ['a'], is_lybunt: true }, 'stage')
    expect(next).toEqual({ is_lybunt: true })
    expect(isEmptyFilters(withoutKey(next, 'is_lybunt'))).toBe(true)
  })
})

describe('view filters: the chips a person sees', () => {
  it('describes every criterion in plain words, using lookup labels', () => {
    const chips = describeFilters(
      { stage: ['prospect'], priority: ['high'], days_since_contact_gte: 90, is_lybunt: true },
      { stage: { prospect: 'Prospect' }, priority: { high: 'High' } },
    )
    expect(chips.map((chip) => chip.label)).toEqual([
      'Stage: Prospect',
      'Priority: High',
      'No contact 90+ days',
      'LYBUNT',
    ])
  })

  it('gives every chip the key that removes it', () => {
    const chips = describeFilters({ pledge_balance_gt: 0, city: 'Hendon' })
    expect(chips.map((chip) => chip.key).sort()).toEqual(['city', 'pledge_balance_gt'])
  })
})

describe('view filters: matching (06 §1’s seeded list)', () => {
  it('LYBUNT: gave last year, nothing this year', () => {
    const filters = { is_lybunt: true }
    expect(matchesView({ contact: contact({}), stats: stats({ is_lybunt: true }) }, filters)).toBe(true)
    expect(matchesView({ contact: contact({}), stats: stats({ is_lybunt: false }) }, filters)).toBe(false)
  })

  it('No contact 90+ days includes someone never contacted at all', () => {
    const filters = { days_since_contact_gte: 90 }
    expect(matchesView({ contact: contact({}), stats: stats({ days_since_contact: 104 }) }, filters)).toBe(true)
    expect(matchesView({ contact: contact({}), stats: stats({ days_since_contact: 12 }) }, filters)).toBe(false)
    // The whole point of the queue: the most neglected person has no last
    // contact date at all, and must not fall through the SQL null.
    expect(matchesView({ contact: contact({}), stats: stats({ days_since_contact: null }) }, filters)).toBe(true)
    expect(matchesView({ contact: contact({}), stats: null }, filters)).toBe(true)
  })

  it('High-priority prospects needs both halves', () => {
    const filters = { stage: ['prospect', 'cultivation'], priority: ['high'] }
    expect(
      matchesView({ contact: contact({ stage: 'cultivation', priority: 'high' }), stats: null }, filters),
    ).toBe(true)
    expect(
      matchesView({ contact: contact({ stage: 'cultivation', priority: 'low' }), stats: null }, filters),
    ).toBe(false)
    expect(
      matchesView({ contact: contact({ stage: 'stewardship', priority: 'high' }), stats: null }, filters),
    ).toBe(false)
  })

  it('Pledges outstanding is a balance strictly above zero', () => {
    const filters = { pledge_balance_gt: 0 }
    expect(matchesView({ contact: contact({}), stats: stats({ pledge_balance: 15000 }) }, filters)).toBe(true)
    expect(matchesView({ contact: contact({}), stats: stats({ pledge_balance: 0 }) }, filters)).toBe(false)
    expect(matchesView({ contact: contact({}), stats: stats({ pledge_balance: null }) }, filters)).toBe(false)
  })

  it('Pre-lapsed rescue list reads donor_status from the view', () => {
    const filters = { donor_status: ['pre_lapsed'] }
    expect(matchesView({ contact: contact({}), stats: stats({ donor_status: 'pre_lapsed' }) }, filters)).toBe(true)
    expect(matchesView({ contact: contact({}), stats: stats({ donor_status: 'active' }) }, filters)).toBe(false)
  })

  it('gave_this_year distinguishes a gift from a zero', () => {
    expect(
      matchesView({ contact: contact({}), stats: stats({ this_year_giving: 500 }) }, { gave_this_year: true }),
    ).toBe(true)
    expect(
      matchesView({ contact: contact({}), stats: stats({ this_year_giving: 0 }) }, { gave_this_year: true }),
    ).toBe(false)
    expect(
      matchesView({ contact: contact({}), stats: stats({ this_year_giving: 0 }) }, { gave_this_year: false }),
    ).toBe(true)
  })

  it('city matches case-insensitively; tags must all be present', () => {
    expect(matchesView({ contact: contact({ city: 'golders green' }), stats: null }, { city: 'Golders Green' })).toBe(
      true,
    )
    expect(
      matchesView({ contact: contact({}), stats: null, tags: ['VIP', 'Building'] }, { tags: ['vip'] }),
    ).toBe(true)
    expect(
      matchesView({ contact: contact({}), stats: null, tags: ['VIP'] }, { tags: ['VIP', 'Building'] }),
    ).toBe(false)
  })

  it('the yellow flag is expressible as a view (I-3)', () => {
    expect(matchesView({ contact: contact({}), stats: stats({ flag: 'none' }) }, { flag: 'none' })).toBe(true)
    expect(matchesView({ contact: contact({}), stats: stats({ flag: 'future' }) }, { flag: 'none' })).toBe(false)
  })
})

describe('view filters: the PostgREST plan', () => {
  it('splits criteria between contacts and contact_stats', () => {
    const plan = toRestPlan({
      stage: ['prospect'],
      city: 'Hendon',
      days_since_contact_gte: 60,
      pledge_balance_gt: 0,
      tags: ['VIP'],
    })
    expect(plan.contacts.map((f) => f.column).sort()).toEqual(['city', 'stage'])
    expect(plan.stats.map((f) => f.column).sort()).toEqual(['days_since_contact', 'pledge_balance'])
    expect(plan.tags).toEqual(['VIP'])
    expect(plan.empty).toBe(false)
  })

  it('reports an empty plan when nothing can be pushed down', () => {
    expect(toRestPlan({}).empty).toBe(true)
    // `gave_this_year` maps onto a column whose name varies between view
    // revisions, so it is matched client-side only.
    expect(toRestPlan({ gave_this_year: true }).stats).toEqual([])
  })

  it('uses gt (not gte) for a pledge balance', () => {
    expect(toRestPlan({ pledge_balance_gt: 0 }).stats[0]).toEqual({
      op: 'gt',
      column: 'pledge_balance',
      value: 0,
    })
  })
})

describe('view routing', () => {
  it('sends contact views to the contacts route carrying their id', () => {
    expect(routeForView({ id: 'v1', entity: 'contacts', filters: { is_lybunt: true } })).toBe('/contacts?view=v1')
  })

  it('sends the two task views to the task list, filtered to that queue', () => {
    expect(routeForView({ id: 'v2', entity: 'tasks', filters: { due: 'overdue' } })).toBe('/tasks?due=overdue')
    expect(routeForView({ id: 'v3', entity: 'tasks', filters: { due: 'today' } })).toBe('/tasks?due=today')
    // The M0 seed spelled the overdue queue as a flag; both spellings route.
    expect(routeForView({ id: 'v4', entity: 'tasks', filters: { flag: 'overdue' } })).toBe('/tasks?due=overdue')
  })

  it('sends gift-side views to the Giving screen’s matching queue', () => {
    expect(
      routeForView({ id: 'v5', entity: 'donations', filters: { thank_you_status_not: ['done'] } }),
    ).toBe('/giving?tab=thanks')
    expect(routeForView({ id: 'v6', entity: 'donations', filters: { gift_aid_status: ['pending_declaration'] } })).toBe(
      '/giving?tab=gifts',
    )
  })

  it('marks the late queues urgent, by criteria rather than by name', () => {
    expect(isUrgentView({ due: 'overdue' })).toBe(true)
    expect(isUrgentView({ flag: 'overdue' })).toBe(true)
    expect(isUrgentView({ donor_status: ['pre_lapsed'] })).toBe(true)
    expect(isUrgentView({ due: 'today' })).toBe(false)
  })
})
