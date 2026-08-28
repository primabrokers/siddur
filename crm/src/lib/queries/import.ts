/**
 * Data access for the CSV import wizard (06 §5).
 *
 * Three jobs, in the order the wizard needs them:
 *
 *   1. **candidates** — a narrow fetch of the existing contacts the dedupe
 *      pass could possibly match, so the scoring stays client-side and pure;
 *   2. **commit** — a batch row, then chunked inserts stamped with its id;
 *   3. **undo** — read back what the batch made, decide what is still safe to
 *      remove (`features/import/plan.ts`), delete that, mark the batch undone.
 *
 * No PostgREST embeds anywhere, same as the rest of `lib/queries` — funds and
 * team members are tiny and joined client-side.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { isConfigured } from '../env'
import { qk } from './keys'
import { ik } from './importKeys'
import { normaliseEmail, normalisePhone } from '../../features/contacts/normalise'
import type { ContactRow } from '../../features/contacts/types'
import {
  buildCommitPlan,
  fillBlanksPatch,
  matchFund,
  planBatchUndo,
  type PlanInput,
  type UndoCandidate,
  type UndoPlan,
} from '../../features/import/plan'
import type { CommitPlan, FundRow, ImportBatchRow, NormalisedRow } from '../../features/import/types'

interface Failed {
  message: string
}

async function selectRows<T>(table: string, build: (q: any) => any): Promise<T[]> {
  const { data, error } = await build(supabase.from(table).select('*'))
  if (error) throw new Error((error as Failed).message)
  return (data ?? []) as unknown as T[]
}

const unique = <T,>(values: T[]): T[] => Array.from(new Set(values))

/** PostgREST `in.(…)` lists get long fast; 200 keys per request stays safe. */
const CHUNK = 200

function chunk<T>(values: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

/* ------------------------------------------------------------------ funds */

export function useFunds(): UseQueryResult<FundRow[]> {
  return useQuery<FundRow[]>({
    queryKey: ik.imports.funds(),
    enabled: isConfigured,
    staleTime: 5 * 60_000,
    queryFn: () => selectRows<FundRow>('funds', (q) => q.order('name', { ascending: true })),
  })
}

export function useCreateFund() {
  const client = useQueryClient()
  return useMutation<FundRow, Error, { name: string }>({
    mutationFn: async ({ name }) => {
      const { data, error } = await supabase
        .from('funds')
        .insert({ name: name.trim(), is_active: true, is_restricted: false })
        .select('*')
        .single()
      if (error) throw new Error((error as Failed).message)
      return data as unknown as FundRow
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ik.imports.funds() })
      void client.invalidateQueries({ queryKey: qk.giving.selects() })
      void client.invalidateQueries({ queryKey: qk.refs.all })
    },
  })
}

/* ------------------------------------------------------------- candidates */

/**
 * The pool the dedupe pass scores against.
 *
 * Fetching every contact would be simplest and is fine at 10k (11 §5), but an
 * import is exactly when the book is largest, so the pool is narrowed the way
 * the create-time check narrows it (02 §6): rows sharing a normalised email,
 * a phone number, or a surname with something in the file. Anything the file
 * cannot possibly match is never transferred.
 */
export async function fetchDedupeCandidates(rows: NormalisedRow[]): Promise<ContactRow[]> {
  const emails = unique(
    rows.map((r) => normaliseEmail(r.contact.email ?? null)).filter((v): v is string => Boolean(v)),
  )
  const phones = unique(
    rows
      .flatMap((r) => [normalisePhone(r.contact.phone ?? null), normalisePhone(r.contact.whatsapp ?? null)])
      .filter((v): v is string => Boolean(v)),
  )
  const surnames = unique(
    rows.map((r) => (r.contact.last_name ?? '').trim()).filter((v) => v.length > 1),
  )
  const orgs = unique(
    rows.map((r) => (r.contact.organization ?? '').trim()).filter((v) => v.length > 1),
  )

  const found = new Map<string, ContactRow>()
  const collect = (list: ContactRow[]) => {
    for (const row of list) if (!row.is_archived && !row.merged_into_id) found.set(row.id, row)
  }

  const requests: Array<Promise<ContactRow[]>> = []
  for (const part of chunk(emails)) {
    requests.push(selectRows<ContactRow>('contacts', (q) => q.in('email', part)))
  }
  for (const part of chunk(phones)) {
    requests.push(selectRows<ContactRow>('contacts', (q) => q.in('phone', part)))
    requests.push(selectRows<ContactRow>('contacts', (q) => q.in('whatsapp', part)))
  }
  for (const part of chunk(surnames)) {
    requests.push(selectRows<ContactRow>('contacts', (q) => q.in('last_name', part)))
  }
  for (const part of chunk(orgs)) {
    requests.push(selectRows<ContactRow>('contacts', (q) => q.in('organization', part)))
  }

  if (requests.length === 0) return []
  const results = await Promise.all(requests)
  for (const list of results) collect(list)
  return [...found.values()]
}

/* ---------------------------------------------------------------- batches */

export function useImportBatches(): UseQueryResult<ImportBatchRow[]> {
  return useQuery<ImportBatchRow[]>({
    queryKey: ik.imports.batches(),
    enabled: isConfigured,
    queryFn: () =>
      selectRows<ImportBatchRow>('import_batches', (q) =>
        q.order('created_at', { ascending: false }).limit(20),
      ),
  })
}

/* ----------------------------------------------------------------- commit */

export interface CommitInput extends PlanInput {
  filename: string
  /** Fund names the user agreed to create, lowercased for matching. */
  createFunds: string[]
}

export interface CommitResult {
  batch: ImportBatchRow
  contactsCreated: number
  contactsFilled: number
  giftsCreated: number
  /** Anything that failed mid-flight; the batch is still undoable. */
  problems: string[]
}

/**
 * Write the plan.
 *
 * The order is chosen so a failure never orphans anything: the batch row goes
 * first (so every subsequent insert can be stamped and therefore undone),
 * contacts next, gifts last. Inserts are chunked and each chunk asks for its
 * ids back — the gift rows need the contact ids the database just minted.
 */
export function useCommitImport() {
  const client = useQueryClient()

  return useMutation<CommitResult, Error, CommitInput>({
    mutationFn: async ({ rows, resolutions, funds, filename, createFunds }) => {
      const problems: string[] = []

      // Funds the user chose to create, before the plan is priced.
      let allFunds = funds
      for (const name of createFunds) {
        if (matchFund(allFunds, name)) continue
        const { data, error } = await supabase
          .from('funds')
          .insert({ name: name.trim(), is_active: true, is_restricted: false })
          .select('*')
          .single()
        if (error) {
          problems.push(`Could not create the fund "${name}": ${(error as Failed).message}`)
          continue
        }
        allFunds = [...allFunds, data as unknown as FundRow]
      }

      const plan: CommitPlan = buildCommitPlan({ rows, resolutions, funds: allFunds })

      const { data: session } = await supabase.auth.getUser()
      const startedBy = session?.user?.id ?? null

      const { data: batchData, error: batchError } = await supabase
        .from('import_batches')
        // `status` has a default, but a batch row that does not say what it is
        // makes the undo rule depend on a column the client never wrote.
        .insert({ filename, started_by: startedBy, contact_count: 0, donation_count: 0, status: 'committed' })
        .select('*')
        .single()
      if (batchError) throw new Error((batchError as Failed).message)
      const batch = batchData as unknown as ImportBatchRow

      /* -------------------------------------------------------- contacts */

      const createdIds: string[] = []
      for (const part of chunk(plan.creates, 100)) {
        const payload = part.map((row) => ({
          ...row.contact,
          first_name: row.contact.first_name ?? '',
          last_name: row.contact.last_name ?? '',
          import_batch: batch.id,
        }))
        const { data, error } = await supabase.from('contacts').insert(payload).select('id')
        if (error) {
          problems.push(`${part.length} contacts could not be created: ${(error as Failed).message}`)
          // Keep positions aligned so the gift binding below stays honest.
          for (let i = 0; i < part.length; i += 1) createdIds.push('')
          continue
        }
        for (const created of (data ?? []) as Array<{ id: string }>) createdIds.push(created.id)
      }

      /* ------------------------------------------------- fill-in merges */

      let contactsFilled = 0
      for (const { row, targetId } of plan.merges) {
        const existing = await selectRows<ContactRow>('contacts', (q) => q.eq('id', targetId).limit(1))
        const patch = fillBlanksPatch(row, (existing[0] ?? {}) as unknown as Record<string, unknown>)
        if (Object.keys(patch).length === 0) continue
        const { error } = await supabase.from('contacts').update(patch).eq('id', targetId)
        if (error) problems.push(`Could not fill in an existing contact: ${(error as Failed).message}`)
        else contactsFilled += 1
      }

      /* ----------------------------------------------------------- gifts */

      const giftPayload = plan.gifts
        .map(({ gift, targetId, createIndex }) => {
          const contactId = targetId ?? (createIndex === null ? '' : (createdIds[createIndex] ?? ''))
          if (!contactId) return null
          const fund = matchFund(allFunds, gift.fund)
          if (!fund) return null
          return {
            contact_id: contactId,
            donated_on: gift.donated_on,
            amount: gift.amount,
            amount_gbp: gift.amount,
            currency: 'GBP',
            fund_id: fund.id,
            payment_method: gift.payment_method,
            notes: gift.notes,
            import_batch: batch.id,
          }
        })
        .filter((g): g is NonNullable<typeof g> => g !== null)

      const unfunded = plan.gifts.length - giftPayload.length
      if (unfunded > 0) {
        problems.push(`${unfunded} ${unfunded === 1 ? 'gift was' : 'gifts were'} skipped — no fund to file them under.`)
      }

      let giftsCreated = 0
      for (const part of chunk(giftPayload, 100)) {
        const { data, error } = await supabase.from('donations').insert(part).select('id')
        if (error) problems.push(`${part.length} gifts could not be created: ${(error as Failed).message}`)
        else giftsCreated += ((data ?? []) as unknown[]).length
      }

      const contactsCreated = createdIds.filter(Boolean).length

      const { data: finalBatch } = await supabase
        .from('import_batches')
        .update({ contact_count: contactsCreated, donation_count: giftsCreated })
        .eq('id', batch.id)
        .select('*')
        .single()

      return {
        batch: (finalBatch as unknown as ImportBatchRow) ?? {
          ...batch,
          contact_count: contactsCreated,
          donation_count: giftsCreated,
        },
        contactsCreated,
        contactsFilled,
        giftsCreated,
        problems,
      }
    },

    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ik.imports.all })
      void client.invalidateQueries({ queryKey: qk.contacts.all })
      void client.invalidateQueries({ queryKey: qk.giving.all })
      void client.invalidateQueries({ queryKey: qk.savedViews.all })
    },
  })
}

/* ------------------------------------------------------------------- undo */

/** Read back what a batch created and decide what is still safe to remove. */
export async function fetchUndoPlan(batchId: string): Promise<UndoPlan> {
  const contacts = await selectRows<ContactRow & { created_at: string; updated_at: string }>(
    'contacts',
    (q) => q.eq('import_batch', batchId),
  )
  const donations = await selectRows<{ id: string }>('donations', (q) => q.eq('import_batch', batchId))
  const contactIds = contacts.map((c) => c.id)

  // "Used since" = anything hanging off the contact that this batch did not
  // create. Counted per table because a contact with one logged call is no
  // longer a spreadsheet row (11 §7).
  const foreign = new Map<string, number>()
  const bump = (id: string) => foreign.set(id, (foreign.get(id) ?? 0) + 1)

  if (contactIds.length > 0) {
    for (const part of chunk(contactIds)) {
      const [interactions, tasks, notes, otherGifts] = await Promise.all([
        selectRows<{ contact_id: string }>('interactions', (q) => q.in('contact_id', part)),
        selectRows<{ contact_id: string }>('tasks', (q) => q.in('contact_id', part)),
        selectRows<{ contact_id: string }>('notes', (q) => q.in('contact_id', part)),
        selectRows<{ contact_id: string; import_batch: string | null }>('donations', (q) =>
          q.in('contact_id', part),
        ),
      ])
      for (const row of interactions) bump(row.contact_id)
      for (const row of tasks) bump(row.contact_id)
      for (const row of notes) bump(row.contact_id)
      for (const row of otherGifts) if (row.import_batch !== batchId) bump(row.contact_id)
    }
  }

  const candidates: UndoCandidate[] = contacts.map((c) => ({
    id: c.id,
    import_batch: batchId,
    created_at: c.created_at,
    updated_at: c.updated_at,
    merged_into_id: c.merged_into_id,
    foreignChildren: foreign.get(c.id) ?? 0,
  }))

  return planBatchUndo(batchId, candidates, donations.map((d) => d.id))
}

export function useUndoPlan(batchId: string | null): UseQueryResult<UndoPlan> {
  return useQuery<UndoPlan>({
    queryKey: ik.imports.batchRows(batchId ?? 'none'),
    enabled: isConfigured && Boolean(batchId),
    queryFn: () => fetchUndoPlan(batchId as string),
  })
}

export interface UndoResult {
  contactsDeleted: number
  giftsDeleted: number
  kept: number
  problems: string[]
}

/**
 * Undo a whole batch (06 §5's "one-click undo of the whole batch").
 *
 * Gifts go first — a contact with a gift still attached cannot be deleted, and
 * deleting the gift first is also the honest order: the money row is the one
 * the import invented, the person may since have become real.
 */
export function useUndoBatch() {
  const client = useQueryClient()
  return useMutation<UndoResult, Error, { batchId: string }>({
    mutationFn: async ({ batchId }) => {
      const plan = await fetchUndoPlan(batchId)
      const problems: string[] = []
      let giftsDeleted = 0
      let contactsDeleted = 0

      for (const part of chunk(plan.deleteDonationIds)) {
        const { error } = await supabase.from('donations').delete().in('id', part)
        if (error) problems.push(`Some gifts could not be removed: ${(error as Failed).message}`)
        else giftsDeleted += part.length
      }

      for (const part of chunk(plan.deleteContactIds)) {
        const { error } = await supabase.from('contacts').delete().in('id', part)
        if (error) problems.push(`Some contacts could not be removed: ${(error as Failed).message}`)
        else contactsDeleted += part.length
      }

      const { error: markError } = await supabase
        .from('import_batches')
        .update({ status: 'undone', undone_at: new Date().toISOString() })
        .eq('id', batchId)
      if (markError) problems.push(`The batch could not be marked undone: ${(markError as Failed).message}`)

      return { contactsDeleted, giftsDeleted, kept: plan.kept.length, problems }
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ik.imports.all })
      void client.invalidateQueries({ queryKey: qk.contacts.all })
      void client.invalidateQueries({ queryKey: qk.giving.all })
      void client.invalidateQueries({ queryKey: qk.savedViews.all })
    },
  })
}
