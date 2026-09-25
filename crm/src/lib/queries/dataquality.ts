/**
 * Data access for the duplicates queue and the merge tool (06 §5).
 *
 * The queue is `duplicates_queue`, written nightly by the `duplicate_scan`
 * rule (08 §7 / migration 003c). It is admin-readable only, and on a database
 * whose nightly has not run yet it is simply empty — so this module carries a
 * **live-scan fallback**: the same signals (02 §6) applied client-side to the
 * contacts already loaded, which keeps the screen useful on day one without
 * pretending to be the real scan.
 *
 * The merge itself is a sequence of small updates rather than one RPC. That is
 * a deliberate trade: a stored procedure would be atomic, but every step here
 * is individually visible in `audit_log` (11 §4), individually reversible by
 * hand, and needs no new database surface to review.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { isConfigured } from '../env'
import { qk } from './keys'
import { ik } from './importKeys'
import { nameSimilarity, normaliseEmail, normalisePhone, NAME_MATCH_THRESHOLD, fullName } from '../../features/contacts/normalise'
import type { ContactRow } from '../../features/contacts/types'
import { CHILD_TABLES, REFERRING_COLUMNS, type MergePlan } from '../../features/dataquality/mergePlan'

interface Failed {
  message: string
}

async function selectRows<T>(table: string, build: (q: any) => any): Promise<T[]> {
  const { data, error } = await build(supabase.from(table).select('*'))
  if (error) throw new Error((error as Failed).message)
  return (data ?? []) as unknown as T[]
}

/* ------------------------------------------------------------------ types */

export interface DuplicateQueueRow {
  id: string
  contact_a_id: string
  contact_b_id: string
  score: number | null
  reason: string
  state: 'open' | 'dismissed' | 'merged'
  created_at: string
}

export interface DuplicatePair {
  /** Null for a pair produced by the live-scan fallback. */
  id: string | null
  a: ContactRow
  b: ContactRow
  score: number | null
  reason: string
  /** True when the row came from the nightly scan rather than the fallback. */
  fromQueue: boolean
}

export interface DuplicatesResult {
  pairs: DuplicatePair[]
  /** Set when the queue itself could not be read (a viewer, or no table). */
  queueError: string | null
  /** True when the rows shown were scanned in the browser, not by the nightly. */
  usedFallback: boolean
}

/* ------------------------------------------------------- live-scan fallback */

/** The nightly's pair rule (003c), applied to a page of contacts in the client. */
export function scanPairs(contacts: ContactRow[], limit = 40): DuplicatePair[] {
  const live = contacts.filter((c) => !c.is_archived && !c.merged_into_id && !c.is_organisation_self)
  const pairs: DuplicatePair[] = []

  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const a = live[i]
      const b = live[j]

      const emailA = normaliseEmail(a.email)
      const emailB = normaliseEmail(b.email)
      const phoneA = normalisePhone(a.phone)
      const phoneB = normalisePhone(b.phone)

      let reason: string | null = null
      if (emailA && emailA === emailB) reason = 'same email'
      else if (phoneA && phoneA === phoneB) reason = 'same phone'

      const score = nameSimilarity(fullName(a), fullName(b))
      if (!reason && score >= NAME_MATCH_THRESHOLD) reason = 'similar name'
      if (!reason) continue

      pairs.push({ id: null, a, b, score: Math.round(score * 1000) / 1000, reason, fromQueue: false })
      if (pairs.length >= limit) return pairs
    }
  }
  return pairs
}

/* ------------------------------------------------------------------ queue */

/**
 * Open duplicate pairs with both contacts resolved.
 *
 * Contacts are fetched in one `in` query and joined client-side (the house
 * rule — no PostgREST embeds), and a pair whose contacts have since been
 * archived or merged is dropped rather than shown as a dead row.
 */
export function useDuplicatePairs(state: 'open' | 'dismissed' = 'open'): UseQueryResult<DuplicatesResult> {
  return useQuery<DuplicatesResult>({
    queryKey: ik.dataquality.duplicates(state),
    enabled: isConfigured,
    queryFn: async () => {
      let queue: DuplicateQueueRow[] = []
      let queueError: string | null = null

      try {
        queue = await selectRows<DuplicateQueueRow>('duplicates_queue', (q) =>
          q.eq('state', state).order('created_at', { ascending: false }).limit(60),
        )
      } catch (caught) {
        queueError = caught instanceof Error ? caught.message : 'duplicates_queue unavailable'
      }

      if (queue.length > 0) {
        const ids = Array.from(new Set(queue.flatMap((row) => [row.contact_a_id, row.contact_b_id])))
        const contacts = await selectRows<ContactRow>('contacts', (q) => q.in('id', ids))
        const byId = new Map(contacts.map((c) => [c.id, c]))
        const pairs = queue
          .map((row): DuplicatePair | null => {
            const a = byId.get(row.contact_a_id)
            const b = byId.get(row.contact_b_id)
            if (!a || !b) return null
            if (a.merged_into_id || b.merged_into_id) return null
            return { id: row.id, a, b, score: row.score, reason: row.reason, fromQueue: true }
          })
          .filter((p): p is DuplicatePair => p !== null)
        return { pairs, queueError, usedFallback: false }
      }

      // Nothing filed (or nothing readable): scan what we can see. Bounded —
      // this is a stand-in for the nightly, not a replacement for it.
      if (state === 'dismissed') return { pairs: [], queueError, usedFallback: false }
      const contacts = await selectRows<ContactRow>('contacts', (q) =>
        q.is('merged_into_id', null).eq('is_archived', false).limit(400),
      )
      return { pairs: scanPairs(contacts), queueError, usedFallback: true }
    },
  })
}

export function useDismissPair() {
  const client = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { data: session } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('duplicates_queue')
        .update({
          state: 'dismissed',
          resolved_at: new Date().toISOString(),
          resolved_by: session?.user?.id ?? null,
        })
        .eq('id', id)
      if (error) throw new Error((error as Failed).message)
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ik.dataquality.all })
    },
  })
}

/* ------------------------------------------------------------------ merge */

export interface MergeResult {
  moved: Array<{ table: string; label: string; rows: number }>
  problems: string[]
}

/**
 * Execute a merge plan: field patch → children re-parented table by table →
 * loser tombstoned → audit note on the survivor.
 *
 * `taggings` is the one table that cannot be blind-updated: it is unique on
 * (tag_id, contact_id), so a tag both records carry is *deleted* from the
 * loser rather than moved onto a row that already exists.
 */
export function useMergeContacts() {
  const client = useQueryClient()

  return useMutation<MergeResult, Error, MergePlan>({
    mutationFn: async (plan) => {
      const problems: string[] = []
      const moved: MergeResult['moved'] = []

      if (Object.keys(plan.patch).length > 0) {
        const { error } = await supabase.from('contacts').update(plan.patch).eq('id', plan.winnerId)
        if (error) throw new Error(`The surviving record could not be updated: ${(error as Failed).message}`)
      }

      for (const child of CHILD_TABLES) {
        if (child.uniqueWith) {
          // Drop the loser's rows that would collide, then move the rest. The
          // key is composite (see `ChildTable.uniqueWith`), so rows are keyed
          // on the joined tuple rather than a single column.
          const keyOf = (row: Record<string, unknown>): string =>
            (child.uniqueWith as string[]).map((column) => String(row[column] ?? '')).join(' ')

          const [winnerRows, loserRows] = await Promise.all([
            selectRows<Record<string, unknown>>(child.table, (q) => q.eq(child.column, plan.winnerId)),
            selectRows<Record<string, unknown>>(child.table, (q) => q.eq(child.column, plan.loserId)),
          ])
          const held = new Set(winnerRows.map(keyOf))
          const collisions = loserRows.filter((row) => held.has(keyOf(row))).map((row) => String(row.id))
          if (collisions.length > 0) {
            const { error } = await supabase.from(child.table).delete().in('id', collisions)
            if (error) problems.push(`Duplicate ${child.label} could not be tidied: ${(error as Failed).message}`)
          }
        }

        const { data, error } = await supabase
          .from(child.table)
          .update({ [child.column]: plan.winnerId })
          .eq(child.column, plan.loserId)
          .select('id')
        if (error) {
          problems.push(`Could not move ${child.label}: ${(error as Failed).message}`)
          continue
        }
        const rows = ((data ?? []) as unknown[]).length
        if (rows > 0) moved.push({ table: child.table, label: child.label, rows })
      }

      // Links that point *at* the loser, so nothing dangles at a tombstone.
      for (const ref of REFERRING_COLUMNS) {
        const { error } = await supabase
          .from(ref.table)
          .update({ [ref.column]: plan.winnerId })
          .eq(ref.column, plan.loserId)
        if (error) problems.push(`Could not repoint ${ref.label}: ${(error as Failed).message}`)
      }

      const { error: tombError } = await supabase
        .from('contacts')
        .update(plan.tombstone)
        .eq('id', plan.loserId)
      if (tombError) throw new Error(`The duplicate could not be tombstoned: ${(tombError as Failed).message}`)

      // The human-readable audit row 11 §4 asks a merge to leave behind. The
      // trigger-fed audit_log has the diffs; this is the sentence a person
      // reads on the profile six months from now.
      const { data: session } = await supabase.auth.getUser()
      const { error: noteError } = await supabase.from('notes').insert({
        contact_id: plan.winnerId,
        body: plan.note,
        category: 'admin',
        is_private: false,
        is_pinned: false,
        created_by: session?.user?.id ?? null,
      })
      if (noteError) problems.push(`The merge note could not be saved: ${(noteError as Failed).message}`)

      return { moved, problems }
    },

    onSuccess: (_result, plan) => {
      void client.invalidateQueries({ queryKey: qk.contacts.all })
      void client.invalidateQueries({ queryKey: qk.contacts.detail(plan.winnerId) })
      void client.invalidateQueries({ queryKey: qk.contacts.detail(plan.loserId) })
      void client.invalidateQueries({ queryKey: qk.giving.all })
      void client.invalidateQueries({ queryKey: qk.tasks.all })
      void client.invalidateQueries({ queryKey: qk.savedViews.all })
      void client.invalidateQueries({ queryKey: ik.dataquality.all })
    },
  })
}

/** Mark a queue row merged once the merge itself has succeeded. */
export function useMarkPairMerged() {
  const client = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { data: session } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('duplicates_queue')
        .update({
          state: 'merged',
          resolved_at: new Date().toISOString(),
          resolved_by: session?.user?.id ?? null,
        })
        .eq('id', id)
      if (error) throw new Error((error as Failed).message)
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ik.dataquality.all })
    },
  })
}

/* ------------------------------------------------------- merge candidates */

/** Contacts offered as the "merge with…" partner from a profile's ⋯ menu. */
export function useMergeCandidates(contact: ContactRow | null | undefined): UseQueryResult<ContactRow[]> {
  return useQuery<ContactRow[]>({
    queryKey: qk.contacts.duplicates({ merge: contact?.id ?? null }),
    enabled: isConfigured && Boolean(contact),
    queryFn: async () => {
      if (!contact) return []
      const rows = await selectRows<ContactRow>('contacts', (q) =>
        q.is('merged_into_id', null).eq('is_archived', false).limit(400),
      )
      const email = normaliseEmail(contact.email)
      const phone = normalisePhone(contact.phone)
      const scored = rows
        .filter((row) => row.id !== contact.id && !row.is_organisation_self)
        .map((row) => {
          const sameEmail = Boolean(email) && normaliseEmail(row.email) === email
          const samePhone = Boolean(phone) && normalisePhone(row.phone) === phone
          const score = nameSimilarity(fullName(contact), fullName(row))
          return { row, weight: (sameEmail ? 4 : 0) + (samePhone ? 2 : 0) + score, score, sameEmail, samePhone }
        })
        .filter((entry) => entry.sameEmail || entry.samePhone || entry.score >= NAME_MATCH_THRESHOLD)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 8)
      return scored.map((entry) => entry.row)
    },
  })
}
