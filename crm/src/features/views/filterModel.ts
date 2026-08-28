/**
 * The saved-view filter model (06 §1, 03 §4).
 *
 * A view is *not* a free-form query builder. It is a **typed subset** of
 * criteria — declared here once — that is:
 *
 *  1. serialisable into `saved_views.filters` (jsonb) and back, tolerantly;
 *  2. translatable to PostgREST filters over `contacts` + `contact_stats`
 *     (+ `tasks` / `donations` for the two non-contact entities);
 *  3. renderable as removable chips on the Contacts filter bar;
 *  4. testable without a database, because every predicate is also a pure
 *     client-side matcher.
 *
 * Deliberately small (I-6: a solo team configures parameters, not logic). The
 * subset is exactly what the 06 §1 seeded list needs — anything richer is a
 * code change, which is the point.
 *
 * Derived fields (`days_since_contact`, `is_lybunt`, `pledge_balance`,
 * `flag`, `donor_status`…) are read from `contact_stats`, never recomputed
 * here (I-8/I-9).
 */

import type { ContactRow, ContactStats } from '../contacts/types'

export type ViewEntity = 'contacts' | 'tasks' | 'donations' | 'opportunities'
export type ViewLayout = 'table' | 'kanban' | 'calendar'

/* ------------------------------------------------------------------ shape */

export interface ViewFilters {
  /* --- contacts table (row columns) --- */
  /** `contacts.stage in (…)`. */
  stage?: string[]
  /** `contacts.priority in (…)`. */
  priority?: string[]
  /** `contacts.tier in (…)` — A/B/C. */
  tier?: string[]
  /** Tag *names*; a contact matches when it carries every one of them. */
  tags?: string[]
  /** `contacts.city` — case-insensitive equality. */
  city?: string

  /* --- contact_stats view (derived, I-8/I-9) --- */
  /** `contact_stats.days_since_contact >= n` (also matches "never", see below). */
  days_since_contact_gte?: number
  /** `contact_stats.flag = …` — the one colour language (03 §2). */
  flag?: string
  is_lybunt?: boolean
  is_sybunt?: boolean
  /** True → gave something this year; false → nothing this year. */
  gave_this_year?: boolean
  /** `contact_stats.pledge_balance > n` (the seeded list uses 0). */
  pledge_balance_gt?: number
  /** `contact_stats.donor_status in (…)` — e.g. the pre-lapsed rescue list. */
  donor_status?: string[]

  /* --- tasks entity (kept deliberately thin — 06 §1's two task views) --- */
  /** `today` → open tasks due today; `overdue` → open tasks due before today. */
  due?: 'today' | 'overdue'

  /* --- donations entity (the two gift-side queues) --- */
  /** `donations.donated_on >= today - n`. */
  donated_within_days?: number
  /** `donations.gift_aid_status in (…)`. */
  gift_aid_status?: string[]
  /** `donations.thank_you_status not in (…)` — the stewardship queue. */
  thank_you_status_not?: string[]
}

/** Every key the model understands — the allow-list `parseFilters` enforces. */
export const FILTER_KEYS = [
  'stage',
  'priority',
  'tier',
  'tags',
  'city',
  'days_since_contact_gte',
  'flag',
  'is_lybunt',
  'is_sybunt',
  'gave_this_year',
  'pledge_balance_gt',
  'donor_status',
  'due',
  'donated_within_days',
  'gift_aid_status',
  'thank_you_status_not',
] as const

export type FilterKey = (typeof FILTER_KEYS)[number]

/** Keys evaluated against `contacts` rows. */
export const CONTACT_LEVEL_KEYS: FilterKey[] = ['stage', 'priority', 'tier', 'city']
/** Keys evaluated against `contact_stats` rows. */
export const STATS_LEVEL_KEYS: FilterKey[] = [
  'days_since_contact_gte',
  'flag',
  'is_lybunt',
  'is_sybunt',
  'gave_this_year',
  'pledge_balance_gt',
  'donor_status',
]

/* ----------------------------------------------------------------- parse */

const stringList = (value: unknown): string[] | undefined => {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const out = raw.map((v) => String(v).trim()).filter((v) => v !== '')
  return out.length > 0 ? out : undefined
}

const finite = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const boolish = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 't' || value === 1) return true
  if (value === 'false' || value === 'f' || value === 0) return false
  return undefined
}

/**
 * Read `saved_views.filters` defensively: unknown keys are dropped rather than
 * carried, so a hand-written or future-shaped row can never crash a screen —
 * it renders the criteria this build understands.
 */
export function parseFilters(raw: unknown): ViewFilters {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const source = raw as Record<string, unknown>
  const out: ViewFilters = {}

  const stage = stringList(source.stage)
  if (stage) out.stage = stage
  const priority = stringList(source.priority)
  if (priority) out.priority = priority
  const tier = stringList(source.tier)
  if (tier) out.tier = tier
  const tags = stringList(source.tags)
  if (tags) out.tags = tags
  if (typeof source.city === 'string' && source.city.trim() !== '') out.city = source.city.trim()

  const days = finite(source.days_since_contact_gte)
  if (days !== undefined) out.days_since_contact_gte = days
  if (typeof source.flag === 'string' && source.flag.trim() !== '') out.flag = source.flag.trim()
  const lybunt = boolish(source.is_lybunt)
  if (lybunt !== undefined) out.is_lybunt = lybunt
  const sybunt = boolish(source.is_sybunt)
  if (sybunt !== undefined) out.is_sybunt = sybunt
  const gave = boolish(source.gave_this_year)
  if (gave !== undefined) out.gave_this_year = gave
  const balance = finite(source.pledge_balance_gt)
  if (balance !== undefined) out.pledge_balance_gt = balance
  const status = stringList(source.donor_status)
  if (status) out.donor_status = status

  if (source.due === 'today' || source.due === 'overdue') out.due = source.due

  const within = finite(source.donated_within_days)
  if (within !== undefined) out.donated_within_days = within
  const ga = stringList(source.gift_aid_status)
  if (ga) out.gift_aid_status = ga
  const thanks = stringList(source.thank_you_status_not)
  if (thanks) out.thank_you_status_not = thanks

  return out
}

export const isEmptyFilters = (filters: ViewFilters): boolean => Object.keys(filters).length === 0

/** Stable key order, so two equal filter sets serialise identically. */
export function canonicalise(filters: ViewFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of FILTER_KEYS) {
    const value = (filters as Record<string, unknown>)[key]
    if (value === undefined) continue
    out[key] = Array.isArray(value) ? [...value].sort() : value
  }
  return out
}

export const filtersEqual = (a: ViewFilters, b: ViewFilters): boolean =>
  JSON.stringify(canonicalise(a)) === JSON.stringify(canonicalise(b))

export function withoutKey(filters: ViewFilters, key: FilterKey): ViewFilters {
  const next = { ...filters }
  delete (next as Record<string, unknown>)[key]
  return next
}

/* ------------------------------------------------------------------ chips */

export interface FilterChipModel {
  key: FilterKey
  label: string
}

const humanise = (value: string): string =>
  value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

const listOf = (values: string[], labels?: Record<string, string>): string =>
  values.map((v) => labels?.[v] ?? humanise(v)).join(' / ')

export interface ChipLabels {
  stage?: Record<string, string>
  priority?: Record<string, string>
  donorStatus?: Record<string, string>
}

/** The filter bar's removable chips, in the model's declared order (06 §1). */
export function describeFilters(filters: ViewFilters, labels: ChipLabels = {}): FilterChipModel[] {
  const chips: FilterChipModel[] = []
  const push = (key: FilterKey, label: string) => chips.push({ key, label })

  if (filters.stage) push('stage', `Stage: ${listOf(filters.stage, labels.stage)}`)
  if (filters.priority) push('priority', `Priority: ${listOf(filters.priority, labels.priority)}`)
  if (filters.tier) push('tier', `Tier: ${filters.tier.join(' / ')}`)
  if (filters.tags) push('tags', `Tagged: ${filters.tags.join(' + ')}`)
  if (filters.city) push('city', `City: ${filters.city}`)
  if (filters.days_since_contact_gte !== undefined)
    push('days_since_contact_gte', `No contact ${filters.days_since_contact_gte}+ days`)
  if (filters.flag) push('flag', `Flag: ${humanise(filters.flag)}`)
  if (filters.is_lybunt !== undefined) push('is_lybunt', filters.is_lybunt ? 'LYBUNT' : 'Not LYBUNT')
  if (filters.is_sybunt !== undefined) push('is_sybunt', filters.is_sybunt ? 'SYBUNT' : 'Not SYBUNT')
  if (filters.gave_this_year !== undefined)
    push('gave_this_year', filters.gave_this_year ? 'Gave this year' : 'Nothing this year')
  if (filters.pledge_balance_gt !== undefined)
    push('pledge_balance_gt', `Pledge balance > ${filters.pledge_balance_gt}`)
  if (filters.donor_status)
    push('donor_status', `Donor status: ${listOf(filters.donor_status, labels.donorStatus)}`)
  if (filters.due) push('due', filters.due === 'today' ? 'Due today' : 'Overdue')
  if (filters.donated_within_days !== undefined)
    push('donated_within_days', `Gifts in the last ${filters.donated_within_days} days`)
  if (filters.gift_aid_status) push('gift_aid_status', `Gift Aid: ${listOf(filters.gift_aid_status)}`)
  if (filters.thank_you_status_not)
    push('thank_you_status_not', `Not yet thanked (${listOf(filters.thank_you_status_not)})`)

  return chips
}

/* --------------------------------------------------------------- matchers */

const eqi = (a: string | null | undefined, b: string): boolean =>
  (a ?? '').trim().toLowerCase() === b.trim().toLowerCase()

/** The `contacts`-row half of the predicate. */
export function matchesContact(contact: ContactRow, filters: ViewFilters): boolean {
  if (filters.stage && !filters.stage.includes(contact.stage)) return false
  if (filters.priority && !filters.priority.includes(contact.priority)) return false
  if (filters.tier && !(contact.tier && filters.tier.includes(contact.tier))) return false
  if (filters.city && !eqi(contact.city, filters.city)) return false
  return true
}

/**
 * The `contact_stats` half.
 *
 * A contact with no stats row is only excluded when a stats-level criterion is
 * actually set; "no contact in 90 days" deliberately *includes* someone never
 * contacted at all, which is the whole point of the view (they are the most
 * neglected, not the least).
 */
export function matchesStats(stats: ContactStats | null, filters: ViewFilters): boolean {
  const days = filters.days_since_contact_gte
  if (days !== undefined) {
    const since = stats?.days_since_contact
    if (since !== null && since !== undefined && since < days) return false
  }
  if (filters.flag !== undefined && (stats?.flag ?? 'none') !== filters.flag) return false
  if (filters.is_lybunt !== undefined && (stats?.is_lybunt ?? false) !== filters.is_lybunt) return false
  if (filters.is_sybunt !== undefined && (stats?.is_sybunt ?? false) !== filters.is_sybunt) return false
  if (filters.gave_this_year !== undefined) {
    const gave = (stats?.this_year_giving ?? 0) > 0
    if (gave !== filters.gave_this_year) return false
  }
  if (filters.pledge_balance_gt !== undefined) {
    if ((stats?.pledge_balance ?? 0) <= filters.pledge_balance_gt) return false
  }
  if (filters.donor_status && !(stats?.donor_status && filters.donor_status.includes(stats.donor_status)))
    return false
  return true
}

export interface MatchInput {
  contact: ContactRow
  stats: ContactStats | null
  /** Tag names carried by this contact, lower-cased comparison. */
  tags?: string[]
}

export function matchesView(row: MatchInput, filters: ViewFilters): boolean {
  if (!matchesContact(row.contact, filters)) return false
  if (!matchesStats(row.stats, filters)) return false
  if (filters.tags) {
    const carried = (row.tags ?? []).map((t) => t.toLowerCase())
    if (!filters.tags.every((tag) => carried.includes(tag.toLowerCase()))) return false
  }
  return true
}

/* ------------------------------------------------- PostgREST translation */

export interface RestFilter {
  op: 'in' | 'eq' | 'gte' | 'gt' | 'lt' | 'lte' | 'is' | 'ilike'
  column: string
  value: unknown
}

/**
 * The server-side half of the predicate, as a description the query layer
 * applies. Split by table so `contacts` and `contact_stats` can be queried
 * independently and intersected by id — no PostgREST embeds anywhere
 * (`queries/contacts.ts`'s rule).
 */
export interface RestPlan {
  contacts: RestFilter[]
  stats: RestFilter[]
  /** Tag names to resolve through `tags` → `taggings`. */
  tags: string[]
  /** True when nothing can be pushed down and a full scan is required. */
  empty: boolean
}

export function toRestPlan(filters: ViewFilters): RestPlan {
  const contacts: RestFilter[] = []
  const stats: RestFilter[] = []

  if (filters.stage) contacts.push({ op: 'in', column: 'stage', value: filters.stage })
  if (filters.priority) contacts.push({ op: 'in', column: 'priority', value: filters.priority })
  if (filters.tier) contacts.push({ op: 'in', column: 'tier', value: filters.tier })
  if (filters.city) contacts.push({ op: 'ilike', column: 'city', value: filters.city })

  // `days_since_contact` is nullable for a contact never spoken to; the null
  // side is kept by the client matcher rather than excluded by the query.
  if (filters.days_since_contact_gte !== undefined)
    stats.push({ op: 'gte', column: 'days_since_contact', value: filters.days_since_contact_gte })
  if (filters.flag !== undefined) stats.push({ op: 'eq', column: 'flag', value: filters.flag })
  if (filters.is_lybunt !== undefined) stats.push({ op: 'eq', column: 'is_lybunt', value: filters.is_lybunt })
  if (filters.is_sybunt !== undefined) stats.push({ op: 'eq', column: 'is_sybunt', value: filters.is_sybunt })
  if (filters.pledge_balance_gt !== undefined)
    stats.push({ op: 'gt', column: 'pledge_balance', value: filters.pledge_balance_gt })
  if (filters.donor_status) stats.push({ op: 'in', column: 'donor_status', value: filters.donor_status })
  // `gave_this_year` maps onto whichever column name the view exposes, so it is
  // left to the client matcher (the stats adapter already normalises the name).

  return {
    contacts,
    stats,
    tags: filters.tags ?? [],
    empty: contacts.length === 0 && stats.length === 0 && (filters.tags ?? []).length === 0,
  }
}

/* ------------------------------------------------------------------ route */

export interface ViewRouteTarget {
  pathname: string
  search: string
}

/**
 * Where a pinned view navigates. Contact views open the Contacts route with
 * the view applied; the two task views open the task list filtered to the same
 * queue; gift-side views open the Giving screen's matching queue tab.
 */
export function routeForView(view: { id: string; entity: ViewEntity; filters: ViewFilters }): string {
  if (view.entity === 'tasks') {
    const due = view.filters.due ?? (view.filters.flag === 'overdue' ? 'overdue' : 'today')
    return `/tasks?due=${due}`
  }
  if (view.entity === 'donations') {
    const tab = view.filters.thank_you_status_not ? 'thanks' : 'gifts'
    return `/giving?tab=${tab}`
  }
  return `/contacts?view=${view.id}`
}
