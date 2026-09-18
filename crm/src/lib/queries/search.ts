/**
 * Global search data access (03 §3, brief §21).
 *
 * Shape of the read: **one narrowing query** over the indexed contact columns
 * (`or=(…ilike…)`), then one `contact_stats` read for the ids that came back —
 * because a result row must show stage · flag · last gift · last contact ·
 * next action, and every one of those is derived (I-8/I-9).
 *
 * The <300ms budget (11 §5) is met by three things together, none of which is
 * a faster network: a 150ms debounce upstream, TanStack Query's per-term cache
 * (a repeated term paints from memory), and `placeholderData` so the previous
 * result list stays on screen while the next one loads instead of flashing
 * empty. Stale requests are dropped by the query key changing — the older
 * promise resolves into a cache entry nobody is rendering.
 *
 * Spec deviation, recorded deliberately: 03 §3 asks for Postgres FTS +
 * `pg_trgm` behind one endpoint. At the yeshiva's scale (~10k contacts,
 * 11 §5) `ilike` over the existing indexes is inside budget and needs no new
 * database object, so the RPC is deferred — see TODO(search-rpc) below.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { isConfigured } from '../env'
import { qk } from './keys'
import { fetchStats, selectRows, unique } from './rest'
import { phoneKeys, rankResults, type SearchResult } from '../../features/search/searchModel'
import { readRecents } from '../../features/search/recents'
import type { ContactRow } from '../../features/contacts/types'

/** Candidates pulled before ranking. Generous: the ranking is client-side. */
const CANDIDATE_LIMIT = 120
export const RESULT_LIMIT = 12

/**
 * PostgREST's `or=(…)` is a comma/parenthesis-delimited grammar, so those
 * characters — and the `*` wildcard — are stripped from the term rather than
 * escaped. A name containing them is still reachable by its other words.
 */
export function sanitiseTerm(term: string): string {
  return term
    .replace(/[(),*"'\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Digit forms worth pushing down to `ilike` — the same keys the client-side
 * ranker compares on, so what the query finds and what the ranker scores agree.
 */
export const phoneVariants = (term: string): string[] => phoneKeys(term)

/** The `or=(…)` clause: name, Hebrew name, organisation, email, city, phones. */
export function buildOrClause(term: string): string {
  const safe = sanitiseTerm(term)
  const like = `*${safe}*`
  const clauses = [
    `first_name.ilike.${like}`,
    `last_name.ilike.${like}`,
    `hebrew_name.ilike.${like}`,
    `organization.ilike.${like}`,
    `email.ilike.${like}`,
    `city.ilike.${like}`,
  ]
  for (const variant of phoneVariants(safe)) {
    clauses.push(`phone.ilike.*${variant}*`, `whatsapp.ilike.*${variant}*`)
  }
  return clauses.join(',')
}

export interface SearchResults {
  results: SearchResult[]
  statsError: string | null
}

const EMPTY: SearchResults = { results: [], statsError: null }

/**
 * TODO(search-rpc): if the contact set ever outgrows `ilike` (11 §5's ceiling
 * is ~10k), replace this with a single `search_contacts(term)` RPC over an FTS
 * column + `pg_trgm` similarity, keeping this module's signature.
 */
async function fetchSearch(term: string): Promise<SearchResults> {
  const safe = sanitiseTerm(term)
  if (safe.length < 2) return EMPTY

  const contacts = await selectRows<ContactRow>('contacts', (q) =>
    q.eq('is_archived', false).is('merged_into_id', null).or(buildOrClause(safe)).limit(CANDIDATE_LIMIT),
  )
  if (contacts.length === 0) return EMPTY

  // Rank first, then fetch stats only for what will be shown — the derived
  // read is the expensive half and the ranking does not depend on it.
  const ranked = rankResults(
    contacts.map((contact) => ({ contact, stats: null })),
    safe,
    RESULT_LIMIT,
  )
  const { stats, error } = await fetchStats(ranked.map((row) => row.contact.id))

  return {
    results: ranked.map((row) => ({ ...row, stats: stats[row.contact.id] ?? null })),
    statsError: error,
  }
}

/**
 * Results for one term. Callers debounce (150ms) before changing `term`, so
 * every key here is a term a human paused on.
 */
export function useContactSearch(term: string): UseQueryResult<SearchResults> {
  const safe = sanitiseTerm(term).toLowerCase()
  return useQuery<SearchResults>({
    queryKey: qk.search.contacts(safe),
    enabled: isConfigured && safe.length >= 2,
    // A term typed twice in a session must paint instantly (03 §3's
    // "recent-records cache serves instantly while the query runs").
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    placeholderData: (previous) => previous,
    queryFn: () => fetchSearch(safe),
  })
}

/* ---------------------------------------------------------------- recents */

/**
 * The list shown before a keystroke: the eight most recently opened profiles,
 * re-read from the database so their flag and next action are current (the
 * localStorage half stores only id + name + when).
 */
export function useRecentContacts(enabled: boolean): UseQueryResult<SearchResult[]> {
  const recents = enabled ? readRecents() : []
  const ids = unique(recents.map((row) => row.id))

  return useQuery<SearchResult[]>({
    queryKey: qk.search.contacts(`recents:${ids.join(',')}`),
    enabled: isConfigured && enabled && ids.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const rows = await selectRows<ContactRow>('contacts', (q) => q.in('id', ids))
      const { stats } = await fetchStats(rows.map((row) => row.id))
      const byId = new Map(rows.map((row) => [row.id, row]))
      // localStorage order is the recency order; the query returns whatever
      // order Postgres likes, so re-apply it here.
      return ids
        .map((id) => byId.get(id))
        .filter((contact): contact is ContactRow => Boolean(contact))
        .map((contact) => ({
          contact,
          stats: stats[contact.id] ?? null,
          field: 'name' as const,
          kind: 'exact' as const,
          score: 0,
        }))
    },
  })
}
