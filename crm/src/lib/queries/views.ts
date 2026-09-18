/**
 * Saved views — the one mechanism behind every segmentation and work queue
 * (03 §4, 06 §1). Storage is `saved_views` (02 §3.18).
 *
 * Rules this file keeps:
 * - A view never mutates data. Reading one is a query; switching views is a
 *   navigation.
 * - Derived criteria are pushed down to `contact_stats`, never recomputed
 *   (I-8/I-9). `contacts` and `contact_stats` are queried separately and
 *   intersected by id — no PostgREST embeds (`queries/contacts.ts`'s rule).
 * - Counts are a *separate, cheap* query per view (ids only, `staleTime` 60s),
 *   so a sidebar of ten views does not pull ten full row sets.
 * - RLS decides what a view returns: a viewer's LYBUNT list simply lacks the
 *   amount columns (06 §1 Permissions, 11 §2). Nothing here filters by role.
 */

import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { supabase } from '../supabase'
import { isConfigured } from '../env'
import { qk } from './keys'
import { fetchStats, selectRows, unique } from './rest'
import { toISODate } from '../dates'
import { compareByFlagThenName } from '../../features/contacts/stats'
import { fullName } from '../../features/contacts/normalise'
import {
  canonicalise,
  matchesView,
  parseFilters,
  toRestPlan,
  type RestFilter,
  type ViewEntity,
  type ViewFilters,
  type ViewLayout,
} from '../../features/views/filterModel'
import type {
  ContactListRow,
  ContactRow,
  TaggingRow,
  TagRow,
} from '../../features/contacts/types'

interface Failed {
  message: string
}

/** Rows fetched per view before ranking — well above the 10k-contact ceiling's
 * realistic view size (11 §5), and capped so a mis-seeded view cannot hang. */
const VIEW_LIMIT = 500

/* ------------------------------------------------------------------ types */

export interface SavedViewRow {
  id: string
  name: string
  entity: ViewEntity
  layout: ViewLayout
  filters: unknown
  sort: unknown
  group_by: string | null
  columns: string[] | null
  icon: string | null
  owner_id: string | null
  is_shared: boolean
  created_at: string
}

export interface SavedView {
  id: string
  name: string
  entity: ViewEntity
  layout: ViewLayout
  filters: ViewFilters
  columns: string[]
  icon: string | null
  owner_id: string | null
  is_shared: boolean
}

export function toSavedView(row: SavedViewRow): SavedView {
  return {
    id: row.id,
    name: row.name,
    entity: row.entity,
    layout: row.layout,
    filters: parseFilters(row.filters),
    columns: row.columns ?? [],
    icon: row.icon,
    owner_id: row.owner_id,
    is_shared: row.is_shared,
  }
}

/* ------------------------------------------------------------------- list */

/**
 * Every view this member may pin: the shared set plus their own private ones.
 * RLS already limits the rows to team members; the `is_shared || mine` filter
 * is presentation, not security.
 */
export function useSavedViews(memberId?: string | null): UseQueryResult<SavedView[]> {
  return useQuery<SavedView[]>({
    queryKey: qk.savedViews.list(),
    enabled: isConfigured,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const rows = await selectRows<SavedViewRow>('saved_views', (q) =>
        q.order('name', { ascending: true }),
      )
      return rows.map(toSavedView)
    },
    select: (views) =>
      views.filter((view) => view.is_shared || (memberId ? view.owner_id === memberId : false)),
  })
}

export function useSavedView(id: string | null | undefined): SavedView | null {
  const { data } = useSavedViews()
  if (!id) return null
  return (data ?? []).find((view) => view.id === id) ?? null
}

/* -------------------------------------------------------- filter push-down */

const applyRest = (query: any, filters: RestFilter[]): any =>
  filters.reduce((q, filter) => {
    switch (filter.op) {
      case 'in':
        return q.in(filter.column, filter.value as string[])
      case 'ilike':
        return q.ilike(filter.column, String(filter.value))
      case 'gt':
        return q.gt(filter.column, filter.value)
      case 'gte':
        return q.gte(filter.column, filter.value)
      case 'lt':
        return q.lt(filter.column, filter.value)
      case 'lte':
        return q.lte(filter.column, filter.value)
      default:
        return q.eq(filter.column, filter.value)
    }
  }, query)

/** Contact ids carrying *every* one of the named tags. */
async function idsForTags(names: string[]): Promise<string[] | null> {
  if (names.length === 0) return null
  const tags = await selectRows<TagRow>('tags', (q) => q.in('name', names))
  if (tags.length < names.length) return []
  const taggings = await selectRows<TaggingRow>('taggings', (q) =>
    q.in('tag_id', tags.map((tag) => tag.id)).eq('is_excluded', false),
  )
  const counts = new Map<string, Set<string>>()
  for (const row of taggings) {
    const set = counts.get(row.contact_id) ?? new Set<string>()
    set.add(row.tag_id)
    counts.set(row.contact_id, set)
  }
  return [...counts.entries()]
    .filter(([, set]) => set.size >= tags.length)
    .map(([contactId]) => contactId)
}

export interface ViewRowsResult {
  rows: ContactListRow[]
  statsError: string | null
}

/**
 * The rows behind a contacts view.
 *
 * Both halves of the predicate run: the push-down narrows the fetch, and the
 * pure matcher (`matchesView`) re-checks every row. That double-check is the
 * point — it keeps the model's semantics (a never-contacted person *is*
 * "no contact in 90 days") true even where SQL's three-valued logic would
 * silently drop the null.
 */
export async function fetchViewRows(filters: ViewFilters): Promise<ViewRowsResult> {
  const plan = toRestPlan(filters)

  const [contacts, statsIds, tagIds] = await Promise.all([
    selectRows<ContactRow>('contacts', (q) =>
      applyRest(
        q.eq('is_archived', false).is('merged_into_id', null),
        plan.contacts,
      ).limit(VIEW_LIMIT),
    ),
    plan.stats.length > 0
      ? selectRows<Record<string, unknown>>('contact_stats', (q) =>
          applyRest(q, plan.stats).limit(VIEW_LIMIT),
        ).then((rows) =>
          rows
            .map((row) => (typeof row.contact_id === 'string' ? row.contact_id : null))
            .filter((id): id is string => Boolean(id)),
        )
      : Promise.resolve(null),
    idsForTags(plan.tags),
  ])

  let candidates = contacts
  if (statsIds) {
    const allow = new Set(statsIds)
    candidates = candidates.filter((contact) => allow.has(contact.id))
  }
  if (tagIds) {
    const allow = new Set(tagIds)
    candidates = candidates.filter((contact) => allow.has(contact.id))
  }

  // `days_since_contact` is null for a contact never spoken to, so the
  // push-down cannot see them; re-widen before the client matcher decides.
  if (statsIds && filters.days_since_contact_gte !== undefined) {
    const seen = new Set(candidates.map((c) => c.id))
    for (const contact of contacts) if (!seen.has(contact.id)) candidates.push(contact)
  }

  const { stats, error } = await fetchStats(candidates.map((c) => c.id))
  const rows: ContactListRow[] = candidates
    .map((contact) => ({ contact, stats: stats[contact.id] ?? null }))
    .filter((row) => matchesView({ contact: row.contact, stats: row.stats }, filters))

  rows.sort((a, b) =>
    compareByFlagThenName(
      { stats: a.stats, name: fullName(a.contact) },
      { stats: b.stats, name: fullName(b.contact) },
    ),
  )
  return { rows, statsError: error }
}

export function useViewRows(filters: ViewFilters, enabled = true): UseQueryResult<ViewRowsResult> {
  return useQuery<ViewRowsResult>({
    queryKey: qk.savedViews.rows(canonicalise(filters)),
    enabled: isConfigured && enabled,
    placeholderData: (previous) => previous,
    queryFn: () => fetchViewRows(filters),
  })
}

/* ----------------------------------------------------------------- counts */

/**
 * One cheap count per view. Contact views resolve ids only; the two task views
 * and the two gift-side views count their own table directly, so neither
 * borrows the contacts query it does not need.
 */
export async function fetchViewCount(view: Pick<SavedView, 'entity' | 'filters'>): Promise<number> {
  const today = toISODate()

  if (view.entity === 'tasks') {
    const due = view.filters.due ?? (view.filters.flag === 'overdue' ? 'overdue' : 'today')
    const rows = await selectRows<{ id: string }>('tasks', (q) => {
      const open = q.in('status', ['todo', 'waiting'])
      return due === 'overdue' ? open.lt('due_on', today) : open.eq('due_on', today)
    })
    return rows.length
  }

  if (view.entity === 'donations') {
    const rows = await selectRows<{ id: string; thank_you_status?: string }>('donations', (q) => {
      let query = q
      if (view.filters.donated_within_days !== undefined) {
        const since = new Date()
        since.setDate(since.getDate() - view.filters.donated_within_days)
        query = query.gte('donated_on', toISODate(since))
      }
      if (view.filters.gift_aid_status) query = query.in('gift_aid_status', view.filters.gift_aid_status)
      return query
    })
    const exclude = view.filters.thank_you_status_not
    return exclude ? rows.filter((row) => !exclude.includes(row.thank_you_status ?? '')).length : rows.length
  }

  const { rows } = await fetchViewRows(view.filters)
  return rows.length
}

/** Sidebar counts — one query per view, refreshed at most once a minute. */
export function useViewCounts(views: SavedView[]): Record<string, number | undefined> {
  const results = useQueries({
    queries: views.map((view) => ({
      queryKey: qk.savedViews.count(view.id, canonicalise(view.filters)),
      enabled: isConfigured,
      staleTime: 60_000,
      queryFn: () => fetchViewCount(view),
    })),
  })

  const counts: Record<string, number | undefined> = {}
  views.forEach((view, index) => {
    counts[view.id] = results[index]?.data as number | undefined
  })
  return counts
}

/* -------------------------------------------------------------- mutations */

export interface CreateSavedViewInput {
  name: string
  filters: ViewFilters
  icon?: string | null
  /** Shared by default: a solo-to-small team wants one shared vocabulary. */
  is_shared?: boolean
  entity?: ViewEntity
}

export function useCreateSavedView() {
  const client = useQueryClient()
  return useMutation<SavedView, Error, CreateSavedViewInput>({
    mutationFn: async (input) => {
      const { data: session } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('saved_views')
        .insert({
          name: input.name.trim(),
          entity: input.entity ?? 'contacts',
          layout: 'table',
          filters: canonicalise(input.filters),
          icon: input.icon ?? null,
          is_shared: input.is_shared ?? true,
          owner_id: session?.user?.id ?? null,
        })
        .select('*')
        .single()
      if (error) throw new Error((error as Failed).message)
      return toSavedView(data as unknown as SavedViewRow)
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.savedViews.all })
    },
  })
}

export function useDeleteSavedView() {
  const client = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const { error } = await supabase.from('saved_views').delete().eq('id', id)
      if (error) throw new Error((error as Failed).message)
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.savedViews.all })
    },
  })
}

export { unique }
