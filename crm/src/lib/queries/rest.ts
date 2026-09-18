/**
 * The three lines every query module repeats: `select('*')` with a builder, the
 * single-row variant, and `contact_stats` with its degradation rule.
 *
 * No PostgREST embeds anywhere (same rule as `queries/contacts.ts`): reference
 * tables are tiny and joined client-side, so the queries stay independent of FK
 * constraint names.
 */

import { supabase } from '../supabase'
import { mapContactStats, type StatsRecord } from '../../features/contacts/stats'
import type { ContactStats } from '../../features/contacts/types'

interface Failed {
  message: string
}

export async function selectRows<T>(table: string, build: (q: any) => any): Promise<T[]> {
  const { data, error } = await build(supabase.from(table).select('*'))
  if (error) throw new Error((error as Failed).message)
  return (data ?? []) as unknown as T[]
}

export async function selectMaybe<T>(table: string, build: (q: any) => any): Promise<T | null> {
  const { data, error } = await build(supabase.from(table).select('*'))
  if (error) throw new Error((error as Failed).message)
  return (data ?? null) as unknown as T | null
}

/** De-duplicate id lists before an `in` filter. */
export const unique = <T,>(values: T[]): T[] => Array.from(new Set(values))

export interface StatsResult {
  stats: Record<string, ContactStats>
  /** Set when the view is missing/unreadable — the UI degrades, never breaks. */
  error: string | null
}

const collect = (rows: StatsRecord[]): Record<string, ContactStats> => {
  const stats: Record<string, ContactStats> = {}
  for (const row of rows) {
    const mapped = mapContactStats(row)
    if (mapped) stats[mapped.contact_id] = mapped
  }
  return stats
}

/**
 * `contact_stats` for a set of contacts (I-8/I-9: the only source of derived
 * numbers). The view is owned by the migrations; until it exists the error is
 * carried alongside the empty result so the screen renders with a stale-stats
 * notice instead of failing.
 */
export async function fetchStats(contactIds: string[]): Promise<StatsResult> {
  const ids = unique(contactIds)
  if (ids.length === 0) return { stats: {}, error: null }

  try {
    return { stats: collect(await selectRows('contact_stats', (q) => q.in('contact_id', ids))), error: null }
  } catch (caught) {
    // The view may key on `id` rather than `contact_id` — try once before
    // reporting, so a naming difference degrades to slower, not broken.
    try {
      return { stats: collect(await selectRows('contact_stats', (q) => q.in('id', ids))), error: null }
    } catch {
      return { stats: {}, error: caught instanceof Error ? caught.message : 'contact_stats unavailable' }
    }
  }
}

/** Every spelling the view might use for the yellow "no next action" flag. */
export const FLAG_NONE_VALUES = ['none', 'yellow', 'no_action', 'no_next_action'] as const

/**
 * The I-3 surfacing set: contacts whose `contact_stats.flag` is yellow. Stage
 * filtering happens on the contacts rows (the view carries no stage), so this
 * returns candidate ids only.
 */
export async function fetchYellowFlaggedIds(): Promise<{ ids: string[]; error: string | null }> {
  try {
    const rows = await selectRows<StatsRecord>('contact_stats', (q) =>
      q.in('flag', [...FLAG_NONE_VALUES]).limit(200),
    )
    const ids = rows
      .map((row) => (typeof row.contact_id === 'string' ? row.contact_id : typeof row.id === 'string' ? row.id : null))
      .filter((id): id is string => Boolean(id))
    return { ids: unique(ids), error: null }
  } catch (caught) {
    return { ids: [], error: caught instanceof Error ? caught.message : 'contact_stats unavailable' }
  }
}
