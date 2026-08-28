/**
 * Typed data access for the Giving screens (05 §1–§4).
 *
 * Rules this file keeps (same as `queries/tasks.ts`):
 * - **One board query** behind the metric cards and all five tabs
 *   (`qk.giving.board`), so a one-tap "Mark thanked" has exactly one cache
 *   shape to patch (I-12).
 * - No PostgREST embeds — contacts, funds, campaigns and appeals are fetched by
 *   id and joined client-side.
 * - **The database owns the downstream loop** (08 §2): saving a gift lets
 *   triggers create the thank-you task, queue the receipt, compute
 *   `gift_aid_status`, maintain household soft credits and raise the
 *   acknowledgee task. Nothing here simulates any of that; the statuses are
 *   read back on refetch, and if the triggers are not live yet the row simply
 *   shows the defaults it was inserted with.
 * - Mutations are optimistic where they are one-tap; the 6-second undo toast
 *   lives at the call site (I-12 / CLAUDE.md rule 4).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { endOfMonth, endOfYear, startOfMonth, startOfYear, subMonths } from 'date-fns'
import { supabase } from '../supabase'
import { isConfigured } from '../env'
import { qk } from './keys'
import { selectRows, unique } from './rest'
import { toISODate } from '../dates'
import type {
  ContactRow,
  DonationRow,
  GiftInput,
  GivingBoard,
  GivingOption,
  GivingSelects,
  PledgeInstallmentRow,
  PledgeRow,
  RecurringAgreementRow,
} from '../../features/giving/types'
import type { TaskRow } from '../../features/contacts/types'

interface Failed {
  message: string
}

const fail = (error: unknown): never => {
  throw new Error((error as Failed)?.message ?? 'Write failed')
}

/** How far back the Recent-gifts tab reads. The queues live inside this window. */
const RECENT_MONTHS = 18
const RECENT_LIMIT = 400

/**
 * Read gifts through whichever path this member is allowed (11 §2, CLAUDE.md
 * rule 7) — the same fall-through `queries/contacts.ts` uses for the profile:
 * the amount-bearing table first, then `donations_redacted`, so a restricted
 * viewer sees the ledger without the money rather than an empty screen.
 */
async function fetchDonations(build: (q: any) => any): Promise<{ rows: DonationRow[]; amountsHidden: boolean }> {
  const rows = await selectRows<DonationRow>('donations', build)
  if (rows.length > 0) return { rows, amountsHidden: false }
  try {
    const redacted = await selectRows<DonationRow>('donations_redacted', build)
    return { rows: redacted, amountsHidden: redacted.length > 0 }
  } catch {
    return { rows: [], amountsHidden: false }
  }
}

/* ------------------------------------------------------------------- board */

async function fetchBoard(now: Date): Promise<GivingBoard> {
  const since = toISODate(subMonths(now, RECENT_MONTHS))
  const yearStart = toISODate(startOfYear(now))
  const yearEnd = toISODate(endOfYear(now))
  const monthStart = toISODate(startOfMonth(now))
  const monthEnd = toISODate(endOfMonth(now))

  const [recent, pledges, recurring] = await Promise.all([
    fetchDonations((q) =>
      q.gte('donated_on', since).order('donated_on', { ascending: false }).limit(RECENT_LIMIT),
    ),
    selectRows<PledgeRow>('pledges', (q) => q.order('pledged_on', { ascending: false })),
    selectRows<RecurringAgreementRow>('recurring_agreements', (q) =>
      q.order('starts_on', { ascending: false }),
    ),
  ])
  const gifts = recent.rows

  const pledgeIds = pledges.map((pledge) => pledge.id)
  const installments =
    pledgeIds.length > 0
      ? await selectRows<PledgeInstallmentRow>('pledge_installments', (q) =>
          q.in('pledge_id', pledgeIds).order('due_on', { ascending: true }),
        )
      : []

  const contactIds = unique([
    ...gifts.map((gift) => gift.contact_id),
    ...pledges.map((pledge) => pledge.contact_id),
    ...recurring.map((agreement) => agreement.contact_id),
  ])
  const contactRows =
    contactIds.length > 0 ? await selectRows<ContactRow>('contacts', (q) => q.in('id', contactIds)) : []
  const contacts: Record<string, ContactRow> = {}
  for (const row of contactRows) contacts[row.id] = row

  // The metric windows are slices of the same fetch when they fall inside it,
  // which they do for this month; the year window can start before `since`
  // only in the first months of a calendar year, so it is filtered from the
  // wider read rather than fetched twice.
  const inWindow = (gift: DonationRow, from: string, to: string) =>
    gift.donated_on >= from && gift.donated_on <= to
  const yearGifts =
    yearStart >= since
      ? gifts.filter((gift) => inWindow(gift, yearStart, yearEnd))
      : (
          await fetchDonations((q) =>
            q.gte('donated_on', yearStart).lte('donated_on', yearEnd).limit(2000),
          )
        ).rows

  return {
    gifts,
    pledges,
    installments,
    recurring,
    contacts,
    yearGifts,
    monthGifts: gifts.filter((gift) => inWindow(gift, monthStart, monthEnd)),
    amountsHidden: recent.amountsHidden,
  }
}

/**
 * The one read behind /giving. Refetches on focus (money arrives while the tab
 * sits open) and keeps previous data on screen, so a refetch never blanks the
 * table.
 */
export function useGivingBoard(): UseQueryResult<GivingBoard> {
  return useQuery<GivingBoard>({
    queryKey: qk.giving.board(),
    enabled: isConfigured,
    queryFn: () => fetchBoard(new Date()),
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  })
}

/* ----------------------------------------------------------------- selects */

/**
 * Fund · campaign · appeal option lists for the entry sheets (05 §4).
 * Managing these lists is Settings territory — TODO(M5+), 05 §4: admin lists
 * plus the per-campaign progress page.
 */
export function useGivingSelects(): UseQueryResult<GivingSelects> {
  return useQuery<GivingSelects>({
    queryKey: qk.giving.selects(),
    enabled: isConfigured,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const [funds, campaigns, appeals] = await Promise.all([
        selectRows<GivingOption>('funds', (q) => q.order('name', { ascending: true })),
        selectRows<GivingOption>('campaigns', (q) => q.order('name', { ascending: true })),
        selectRows<GivingOption>('appeals', (q) => q.order('name', { ascending: true })),
      ])
      const active = (rows: GivingOption[]) => rows.filter((row) => row.is_active !== false)
      return { funds: active(funds), campaigns: active(campaigns), appeals: active(appeals) }
    },
  })
}

/* --------------------------------------------------------- invalidation */

/**
 * A gift touches: the board, the donor's profile + `contact_stats`, the Action
 * Stream (the trigger's thank-you task lands there) and the month-giving card.
 */
function invalidateGiving(client: QueryClient, contactId?: string | null) {
  void client.invalidateQueries({ queryKey: qk.giving.all })
  void client.invalidateQueries({ queryKey: qk.donations.all })
  void client.invalidateQueries({ queryKey: qk.pledges.all })
  void client.invalidateQueries({ queryKey: qk.tasks.all })
  void client.invalidateQueries({ queryKey: qk.reports.all })
  void client.invalidateQueries({ queryKey: qk.contacts.all })
  if (contactId) {
    void client.invalidateQueries({ queryKey: qk.contacts.detail(contactId) })
    void client.invalidateQueries({ queryKey: qk.contacts.giving(contactId) })
    void client.invalidateQueries({ queryKey: qk.contacts.timeline(contactId) })
  }
}

const patchBoard = (client: QueryClient, update: (board: GivingBoard) => GivingBoard) => {
  client.setQueriesData<GivingBoard>({ queryKey: qk.giving.all }, (board) => (board ? update(board) : board))
}

const applyGiftPatch = (board: GivingBoard, id: string, patch: Partial<DonationRow>): GivingBoard => ({
  ...board,
  gifts: board.gifts.map((gift) => (gift.id === id ? { ...gift, ...patch } : gift)),
  monthGifts: board.monthGifts.map((gift) => (gift.id === id ? { ...gift, ...patch } : gift)),
  yearGifts: board.yearGifts.map((gift) => (gift.id === id ? { ...gift, ...patch } : gift)),
})

/* -------------------------------------------------------------- gift entry */

export interface CreatedGift {
  donation: DonationRow
  softCreditId: string | null
  tributeId: string | null
}

/**
 * Insert one gift (status `received`) plus its optional influencer soft credit
 * and tribute row.
 *
 * The acknowledgee-letter task, the thank-you task, the receipt queueing and
 * `gift_aid_status` all belong to triggers (08 §2) — writing them here would
 * double them up the moment the triggers land.
 */
export function useCreateGift() {
  const client = useQueryClient()
  return useMutation<CreatedGift, Error, GiftInput>({
    mutationFn: async (input) => {
      const { data: session } = await supabase.auth.getUser()
      const userId = session?.user?.id ?? null

      const gift = await supabase
        .from('donations')
        .insert({ ...input.donation, created_by: userId })
        .select('*')
        .single()
      if (gift.error) fail(gift.error)
      const donation = gift.data as unknown as DonationRow

      let softCreditId: string | null = null
      if (input.softCredit) {
        const credit = await supabase
          .from('soft_credits')
          .insert({ ...input.softCredit, donation_id: donation.id, created_by: userId })
          .select('id')
          .single()
        // A soft credit is a parallel rollup, never the ledger: if it fails the
        // gift still stands, and the failure surfaces as the toast's error.
        if (credit.error) fail(credit.error)
        softCreditId = (credit.data as unknown as { id: string }).id
      }

      let tributeId: string | null = null
      if (input.tribute) {
        const tribute = await supabase
          .from('tributes')
          .insert({ ...input.tribute, donation_id: donation.id })
          .select('id')
          .single()
        if (tribute.error) fail(tribute.error)
        tributeId = (tribute.data as unknown as { id: string }).id
      }

      return { donation, softCreditId, tributeId }
    },
    onSettled: (_data, _error, input) =>
      invalidateGiving(client, (input.donation.contact_id as string | undefined) ?? null),
  })
}

/** Undo for a just-saved gift: children first, then the donation itself. */
export function useDeleteGift() {
  const client = useQueryClient()
  return useMutation<void, Error, { id: string; contactId?: string | null }>({
    mutationFn: async ({ id }) => {
      await supabase.from('tributes').delete().eq('donation_id', id)
      await supabase.from('soft_credits').delete().eq('donation_id', id)
      const { error } = await supabase.from('donations').delete().eq('id', id)
      if (error) fail(error)
    },
    onSettled: (_d, _e, variables) => invalidateGiving(client, variables.contactId ?? null),
  })
}

/* ------------------------------------------------------------ thanks queue */

export interface MarkThankedResult {
  /** Task ids the mark completed, so undo can reopen exactly those. */
  completedTaskIds: string[]
  previousStatus: string
}

/**
 * "Mark thanked" (05 §3): stamp the gift **and** complete any open
 * `auto:thank_you` task for that donor, so the queue and the Action Stream
 * cannot disagree.
 */
export function useMarkThanked() {
  const client = useQueryClient()
  return useMutation<MarkThankedResult, Error, { gift: DonationRow }>({
    mutationFn: async ({ gift }) => {
      const update = await supabase
        .from('donations')
        .update({ thank_you_status: 'done' })
        .eq('id', gift.id)
        .select('id')
      if (update.error) fail(update.error)

      // The task may not exist (triggers not live, or already completed).
      let completedTaskIds: string[] = []
      try {
        const open = await selectRows<TaskRow>('tasks', (q) =>
          q
            .eq('contact_id', gift.contact_id)
            .eq('origin', 'auto:thank_you')
            .in('status', ['todo', 'waiting', 'queued']),
        )
        if (open.length > 0) {
          const ids = open.map((task) => task.id)
          const done = await supabase
            .from('tasks')
            .update({ status: 'done', completed_at: new Date().toISOString() })
            .in('id', ids)
          if (!done.error) completedTaskIds = ids
        }
      } catch {
        // No tasks table access or no rows — the stamp on the gift is enough.
      }

      return { completedTaskIds, previousStatus: gift.thank_you_status }
    },
    onMutate: async ({ gift }) => {
      await client.cancelQueries({ queryKey: qk.giving.all })
      patchBoard(client, (board) => applyGiftPatch(board, gift.id, { thank_you_status: 'done' }))
    },
    onSettled: (_d, _e, variables) => invalidateGiving(client, variables.gift.contact_id),
  })
}

/** Undo for "Mark thanked": restore the gift stamp and reopen the tasks. */
export function useUnmarkThanked() {
  const client = useQueryClient()
  return useMutation<void, Error, { gift: DonationRow; result: MarkThankedResult }>({
    mutationFn: async ({ gift, result }) => {
      const { error } = await supabase
        .from('donations')
        .update({ thank_you_status: result.previousStatus })
        .eq('id', gift.id)
      if (error) fail(error)
      if (result.completedTaskIds.length > 0) {
        await supabase
          .from('tasks')
          .update({ status: 'todo', completed_at: null })
          .in('id', result.completedTaskIds)
      }
    },
    onMutate: async ({ gift, result }) => {
      patchBoard(client, (board) =>
        applyGiftPatch(board, gift.id, { thank_you_status: result.previousStatus }),
      )
    },
    onSettled: (_d, _e, variables) => invalidateGiving(client, variables.gift.contact_id),
  })
}

/* ----------------------------------------------------------- receipt queue */

/** Receipts P1 (05 §3): mark-sent plus the CSV export — no generated letters. */
export function useSetReceiptStatus() {
  const client = useQueryClient()
  return useMutation<void, Error, { gift: DonationRow; status: string }>({
    mutationFn: async ({ gift, status }) => {
      const { error } = await supabase.from('donations').update({ receipt_status: status }).eq('id', gift.id)
      if (error) fail(error)
    },
    onMutate: async ({ gift, status }) => {
      await client.cancelQueries({ queryKey: qk.giving.all })
      patchBoard(client, (board) => applyGiftPatch(board, gift.id, { receipt_status: status }))
    },
    onSettled: (_d, _e, variables) => invalidateGiving(client, variables.gift.contact_id),
  })
}

/* ----------------------------------------------------------------- pledges */

export interface PledgeInput {
  pledge: Record<string, unknown>
  installments: Array<{ due_on: string; amount: number }>
}

export interface CreatedPledge {
  pledge: PledgeRow
  installmentIds: string[]
}

/**
 * Insert the pledge and its schedule (05 §2). The rows are generated here
 * rather than left to `pledge_schedule` (08 §2) because the builder's rows are
 * hand-editable — what the fundraiser saw is what gets stored.
 */
export function useCreatePledge() {
  const client = useQueryClient()
  return useMutation<CreatedPledge, Error, PledgeInput>({
    mutationFn: async (input) => {
      const { data: session } = await supabase.auth.getUser()
      const userId = session?.user?.id ?? null

      const created = await supabase
        .from('pledges')
        .insert({ ...input.pledge, created_by: userId })
        .select('*')
        .single()
      if (created.error) fail(created.error)
      const pledge = created.data as unknown as PledgeRow

      let installmentIds: string[] = []
      if (input.installments.length > 0) {
        const rows = input.installments.map((row) => ({
          pledge_id: pledge.id,
          due_on: row.due_on,
          amount: row.amount,
          status: 'expected',
        }))
        const inserted = await supabase.from('pledge_installments').insert(rows).select('id')
        if (inserted.error) fail(inserted.error)
        installmentIds = ((inserted.data ?? []) as unknown as Array<{ id: string }>).map((r) => r.id)
      }

      return { pledge, installmentIds }
    },
    onSettled: (_d, _e, input) =>
      invalidateGiving(client, (input.pledge.contact_id as string | undefined) ?? null),
  })
}

export function useDeletePledge() {
  const client = useQueryClient()
  return useMutation<void, Error, { id: string; contactId?: string | null }>({
    mutationFn: async ({ id }) => {
      await supabase.from('pledge_installments').delete().eq('pledge_id', id)
      const { error } = await supabase.from('pledges').delete().eq('id', id)
      if (error) fail(error)
    },
    onSettled: (_d, _e, variables) => invalidateGiving(client, variables.contactId ?? null),
  })
}

export interface PledgeStatusInput {
  pledge: PledgeRow
  status: 'open' | 'fulfilled' | 'written_off' | 'cancelled'
  /** Write-off amount (02 §3.5) — admin only, see 11 §1. */
  writeOffAmount?: number | null
  /** Appended to the pledge's notes, so the reason survives with the history. */
  reason?: string | null
}

/**
 * Write off / cancel / reopen a pledge (05 §2). History is preserved: the row
 * changes status and carries the write-off amount, it is never deleted.
 */
export function useSetPledgeStatus() {
  const client = useQueryClient()
  return useMutation<void, Error, PledgeStatusInput>({
    mutationFn: async ({ pledge, status, writeOffAmount, reason }) => {
      const patch: Record<string, unknown> = { status }
      if (writeOffAmount !== undefined) patch.write_off_amount = writeOffAmount
      if (reason) {
        const stamp = `${status === 'cancelled' ? 'Cancelled' : 'Written off'} ${toISODate(new Date())}: ${reason}`
        patch.notes = pledge.notes ? `${pledge.notes}\n${stamp}` : stamp
      }
      const { error } = await supabase.from('pledges').update(patch).eq('id', pledge.id)
      if (error) fail(error)
    },
    onSettled: (_d, _e, variables) => invalidateGiving(client, variables.pledge.contact_id),
  })
}

/* ------------------------------------------------------ recurring (02 §3.6) */

export function useCreateRecurring() {
  const client = useQueryClient()
  return useMutation<RecurringAgreementRow, Error, Record<string, unknown>>({
    mutationFn: async (row) => {
      const { data, error } = await supabase
        .from('recurring_agreements')
        .insert({ ...row, status: 'active', missed_count: 0 })
        .select('*')
        .single()
      if (error) fail(error)
      return data as unknown as RecurringAgreementRow
    },
    onSettled: (_d, _e, row) => invalidateGiving(client, (row.contact_id as string | undefined) ?? null),
  })
}

export function useDeleteRecurring() {
  const client = useQueryClient()
  return useMutation<void, Error, { id: string; contactId?: string | null }>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('recurring_agreements').delete().eq('id', id)
      if (error) fail(error)
    },
    onSettled: (_d, _e, variables) => invalidateGiving(client, variables.contactId ?? null),
  })
}

/** Pause · reactivate · cancel, inline on the card (05 §2). */
export function useSetRecurringStatus() {
  const client = useQueryClient()
  return useMutation<void, Error, { agreement: RecurringAgreementRow; status: string }>({
    mutationFn: async ({ agreement, status }) => {
      const patch: Record<string, unknown> = { status }
      // Reactivating clears the missed run so the nightly job starts clean
      // (08 §3 `recurring_failing` counts from the last expected payment).
      if (status === 'active') patch.missed_count = 0
      const { error } = await supabase.from('recurring_agreements').update(patch).eq('id', agreement.id)
      if (error) fail(error)
    },
    onMutate: async ({ agreement, status }) => {
      await client.cancelQueries({ queryKey: qk.giving.all })
      patchBoard(client, (board) => ({
        ...board,
        recurring: board.recurring.map((row) => (row.id === agreement.id ? { ...row, status } : row)),
      }))
    },
    onSettled: (_d, _e, variables) => invalidateGiving(client, variables.agreement.contact_id),
  })
}
