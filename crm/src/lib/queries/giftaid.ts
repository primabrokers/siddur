/**
 * Typed data access for the Gift Aid workspace (05 §5, 07 §8).
 *
 * Rules this file keeps:
 *
 * - **The database owns every number.** The hero, the history and the
 *   found-money queue read `gift_aid_claim_totals` and `ga_missing_declarations`
 *   (migration 007). Nothing here sums claim lines (I-8/I-9).
 * - **The database owns the state transition.** Filing a claim is one call to
 *   `ga_submit_claim`, which stamps the gifts, totals the claim, records the
 *   HMRC reference and opens the next rolling claim inside one transaction.
 *   Doing it as four client writes would leave a half-filed claim on any error.
 * - **One board query** behind the three panels (`gak.giftAid.board`), so a
 *   one-tap "took it orally" has exactly one cache shape to sweep.
 * - No PostgREST embeds — contacts are fetched by id and joined client-side.
 * - Filing a claim is admin-only in RLS *and* in `ga_submit_claim`; the UI hides
 *   the button, the database refuses the call (11 §1, defence in depth).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { supabase } from '../supabase'
import { isConfigured } from '../env'
import { qk } from './keys'
import { gak } from './giftaidKeys'
import { selectRows, unique } from './rest'
import { toISODate } from '../dates'
import { GA_WORDING_VERSION } from '../../features/giftaid/logic'
import type {
  ClaimLine,
  ClaimTotalsRow,
  DeclarationRow,
  GaContactRow,
  GaDonationRow,
  GiftAidBoard,
  MissingDeclarationRow,
  ValidationFailure,
} from '../../features/giftaid/types'

interface Failed {
  message: string
}

const fail = (error: unknown): never => {
  throw new Error((error as Failed)?.message ?? 'Write failed')
}

/** Recent declarations panel: enough to read, not a second contacts list. */
const RECENT_DECLARATIONS = 25
/** The found-money queue is worked from the top; the tail is not navigation. */
const MISSING_LIMIT = 200

/**
 * Read gifts through whichever path this member is allowed (11 §2) — the same
 * fall-through the Giving board uses: the amount-bearing table first, then
 * `donations_redacted`, so a restricted viewer sees the ledger without money
 * rather than an empty screen.
 */
async function fetchDonations(
  build: (q: any) => any,
): Promise<{ rows: GaDonationRow[]; amountsHidden: boolean }> {
  const rows = await selectRows<GaDonationRow>('donations', build)
  if (rows.length > 0) return { rows, amountsHidden: false }
  try {
    const redacted = await selectRows<GaDonationRow>('donations_redacted', build)
    return { rows: redacted, amountsHidden: redacted.length > 0 }
  } catch {
    return { rows: [], amountsHidden: false }
  }
}

async function fetchContacts(ids: string[]): Promise<Record<string, GaContactRow>> {
  const wanted = unique(ids.filter(Boolean))
  if (wanted.length === 0) return {}
  const rows = await selectRows<GaContactRow>('contacts', (q) => q.in('id', wanted))
  const index: Record<string, GaContactRow> = {}
  for (const row of rows) index[row.id] = row
  return index
}

/* --------------------------------------------------------------- the board */

async function fetchBoard(): Promise<GiftAidBoard> {
  const [claims, missing, declarations, held] = await Promise.all([
    selectRows<ClaimTotalsRow>('gift_aid_claim_totals', (q) => q.limit(200)),
    selectRows<MissingDeclarationRow>('ga_missing_declarations', (q) =>
      q.order('recoverable', { ascending: false }).limit(MISSING_LIMIT),
    ),
    selectRows<DeclarationRow>('gift_aid_declarations', (q) =>
      q.order('declared_on', { ascending: false }).limit(RECENT_DECLARATIONS),
    ),
    // A held-back gift is eligible but attached to nothing: `ga_excluded_at`
    // detaches it (007) and the rolling-claim trigger cannot re-attach it.
    fetchDonations((q) =>
      q
        .eq('gift_aid_status', 'eligible')
        .is('gift_aid_claim_id', null)
        .order('donated_on', { ascending: false })
        .limit(200),
    ),
  ])

  const rolling = claims.find((claim) => claim.status === 'draft-rolling') ?? null
  const history = claims
    .filter((claim) => claim.status === 'submitted' || claim.status === 'paid')
    .sort((a, b) => String(b.submitted_on ?? '').localeCompare(String(a.submitted_on ?? '')))

  const contacts = await fetchContacts([
    ...missing.map((row) => row.contact_id),
    ...declarations.map((row) => row.contact_id),
    ...held.rows.map((row) => row.contact_id),
  ])

  return {
    rolling,
    history,
    missing,
    declarations,
    excluded: held.rows,
    contacts,
    amountsHidden: held.amountsHidden,
  }
}

/**
 * The one read behind /gift-aid. Refetches on focus — a gift entered on another
 * screen joins the rolling claim while this tab sits open — and keeps previous
 * data on screen so a refetch never blanks the hero.
 */
export function useGiftAidBoard(): UseQueryResult<GiftAidBoard> {
  return useQuery<GiftAidBoard>({
    queryKey: gak.giftAid.board(),
    enabled: isConfigured,
    queryFn: fetchBoard,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  })
}

/* ------------------------------------------------------- claim lines + validation */

/** The gifts on one claim joined to their donors — the CSV's rows, and the
 *  records the inline fixes edit. */
export function useClaimLines(claimId: string | null | undefined): UseQueryResult<ClaimLine[]> {
  return useQuery<ClaimLine[]>({
    queryKey: gak.giftAid.lines(claimId ?? 'none'),
    enabled: isConfigured && Boolean(claimId),
    queryFn: async () => {
      const gifts = await fetchDonations((q) =>
        q
          .eq('gift_aid_claim_id', claimId as string)
          .eq('status', 'received')
          .order('donated_on', { ascending: true })
          .limit(5000),
      )
      const contacts = await fetchContacts(gifts.rows.map((gift) => gift.contact_id))
      return gifts.rows.map((gift) => ({ gift, contact: contacts[gift.contact_id] ?? null }))
    },
  })
}

/**
 * `ga_claim_validation(claim)` — one row per failure, so an empty result means
 * the claim is ready to export (05 §5). Server-side on purpose: the coverage
 * rule lives next to the trigger that wrote the statuses, and cannot drift.
 */
export function useClaimValidation(
  claimId: string | null | undefined,
): UseQueryResult<ValidationFailure[]> {
  return useQuery<ValidationFailure[]>({
    queryKey: gak.giftAid.validation(claimId ?? 'none'),
    enabled: isConfigured && Boolean(claimId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ga_claim_validation', { p_claim_id: claimId })
      if (error) throw new Error((error as Failed).message)
      return (data ?? []) as unknown as ValidationFailure[]
    },
  })
}

/**
 * The saved view the 4-year back-claim card links to (07 §10). Looked up by
 * name rather than hard-coded id: the seed owns the row, this owns the link.
 */
export const BACK_CLAIM_VIEW_NAME = 'GA: missing declarations'

export function useBackClaimViewId(): UseQueryResult<string | null> {
  return useQuery<string | null>({
    queryKey: gak.giftAid.backClaimView(),
    enabled: isConfigured,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      try {
        const rows = await selectRows<{ id: string; name: string }>('saved_views', (q) =>
          q.eq('name', BACK_CLAIM_VIEW_NAME).limit(1),
        )
        return rows[0]?.id ?? null
      } catch {
        return null
      }
    },
  })
}

/* -------------------------------------------------------------- invalidation */

/**
 * A Gift Aid write touches: this workspace, the Giving board (gift rows carry
 * `gift_aid_status`), the donor's profile + `contact_stats` (`has_ga_declaration`)
 * and the Action Stream (an oral declaration queues a confirmation task).
 */
function invalidateGiftAid(client: QueryClient, contactId?: string | null) {
  void client.invalidateQueries({ queryKey: gak.giftAid.all })
  void client.invalidateQueries({ queryKey: qk.giftAid.all })
  void client.invalidateQueries({ queryKey: qk.giving.all })
  void client.invalidateQueries({ queryKey: qk.donations.all })
  void client.invalidateQueries({ queryKey: qk.tasks.all })
  void client.invalidateQueries({ queryKey: qk.contacts.all })
  if (contactId) {
    void client.invalidateQueries({ queryKey: qk.contacts.declarations(contactId) })
    void client.invalidateQueries({ queryKey: qk.contacts.detail(contactId) })
    void client.invalidateQueries({ queryKey: qk.contacts.timeline(contactId) })
  }
}

/* ------------------------------------------------------------ declarations */

export interface DeclarationInput {
  contact_id: string
  declared_on: string
  method: string
  covers_future: boolean
  covers_past: boolean
  covers_from?: string | null
  evidence_url?: string | null
}

export interface CreatedDeclaration {
  declaration: DeclarationRow
  /** The written-confirmation task an oral declaration queues (02 §3.7). */
  taskId: string | null
}

/**
 * Record a declaration (05 §5). An **oral** declaration is not usable until the
 * written confirmation HMRC requires has been sent, so recording one also
 * queues that letter as a task — the gifts stay `pending_declaration` until it
 * is stamped, which is `crm_gift_aid_status`'s own rule, not this file's.
 */
export function useCreateDeclaration() {
  const client = useQueryClient()
  return useMutation<CreatedDeclaration, Error, DeclarationInput>({
    mutationFn: async (input) => {
      const created = await supabase
        .from('gift_aid_declarations')
        .insert({
          contact_id: input.contact_id,
          declared_on: input.declared_on,
          method: input.method,
          wording_version: GA_WORDING_VERSION,
          covers_future: input.covers_future,
          covers_past: input.covers_past,
          covers_from: input.covers_from || null,
          evidence_url: input.evidence_url || null,
        })
        .select('*')
        .single()
      if (created.error) fail(created.error)
      const declaration = created.data as unknown as DeclarationRow

      let taskId: string | null = null
      if (input.method === 'oral') {
        const { data: session } = await supabase.auth.getUser()
        const due = new Date()
        due.setDate(due.getDate() + 2)
        const task = await supabase
          .from('tasks')
          .insert({
            contact_id: input.contact_id,
            title: 'Send written confirmation of the oral Gift Aid declaration',
            details:
              'HMRC requires a written confirmation of an oral declaration before the gifts can be claimed (02 §3.7).',
            action_type: 'send_update',
            due_on: toISODate(due),
            status: 'todo',
            origin: 'auto:ga_oral_confirmation',
            created_by: session?.user?.id ?? null,
          })
          .select('id')
          .single()
        // The declaration stands even if the task cannot be written (a viewer's
        // RLS, a missing lookup) — the pill on the row still says "pending".
        if (!task.error) taskId = (task.data as unknown as { id: string }).id
      }

      return { declaration, taskId }
    },
    onSettled: (_d, _e, input) => invalidateGiftAid(client, input.contact_id),
  })
}

/** Undo for a just-recorded declaration: the task first, then the declaration. */
export function useDeleteDeclaration() {
  const client = useQueryClient()
  return useMutation<void, Error, { id: string; contactId: string; taskId?: string | null }>({
    mutationFn: async ({ id, taskId }) => {
      if (taskId) await supabase.from('tasks').delete().eq('id', taskId)
      const { error } = await supabase.from('gift_aid_declarations').delete().eq('id', id)
      if (error) fail(error)
    },
    onSettled: (_d, _e, variables) => invalidateGiftAid(client, variables.contactId),
  })
}

/**
 * Cancel a declaration (02 §3.7). History is preserved: the row is stamped
 * `cancelled_on`, never deleted, and gifts before that date stay covered.
 */
export function useCancelDeclaration() {
  const client = useQueryClient()
  return useMutation<void, Error, { declaration: DeclarationRow; on?: string }>({
    mutationFn: async ({ declaration, on }) => {
      const { error } = await supabase
        .from('gift_aid_declarations')
        .update({ cancelled_on: on ?? toISODate(new Date()) })
        .eq('id', declaration.id)
      if (error) fail(error)
    },
    onSettled: (_d, _e, variables) => invalidateGiftAid(client, variables.declaration.contact_id),
  })
}

/** Undo for a cancel. */
export function useUncancelDeclaration() {
  const client = useQueryClient()
  return useMutation<void, Error, { declaration: DeclarationRow }>({
    mutationFn: async ({ declaration }) => {
      const { error } = await supabase
        .from('gift_aid_declarations')
        .update({ cancelled_on: null })
        .eq('id', declaration.id)
      if (error) fail(error)
    },
    onSettled: (_d, _e, variables) => invalidateGiftAid(client, variables.declaration.contact_id),
  })
}

/**
 * Stamp the written confirmation of an oral declaration as sent — the moment
 * the donor's gifts become claimable. Completes the queued task with it, so the
 * Action Stream and this panel cannot disagree.
 */
export function useConfirmOralDeclaration() {
  const client = useQueryClient()
  return useMutation<{ previous: string | null; completedTaskIds: string[] }, Error, { declaration: DeclarationRow }>({
    mutationFn: async ({ declaration }) => {
      const { error } = await supabase
        .from('gift_aid_declarations')
        .update({ oral_confirmation_sent_on: toISODate(new Date()) })
        .eq('id', declaration.id)
      if (error) fail(error)

      let completedTaskIds: string[] = []
      try {
        const open = await selectRows<{ id: string }>('tasks', (q) =>
          q
            .eq('contact_id', declaration.contact_id)
            .eq('origin', 'auto:ga_oral_confirmation')
            .in('status', ['todo', 'in_progress', 'waiting', 'queued']),
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
        // No task to close — the stamp on the declaration is what matters.
      }

      return { previous: declaration.oral_confirmation_sent_on, completedTaskIds }
    },
    onSettled: (_d, _e, variables) => invalidateGiftAid(client, variables.declaration.contact_id),
  })
}

/** Undo for the confirmation stamp: unstamp and reopen exactly those tasks. */
export function useUnconfirmOralDeclaration() {
  const client = useQueryClient()
  return useMutation<
    void,
    Error,
    { declaration: DeclarationRow; result: { previous: string | null; completedTaskIds: string[] } }
  >({
    mutationFn: async ({ declaration, result }) => {
      const { error } = await supabase
        .from('gift_aid_declarations')
        .update({ oral_confirmation_sent_on: result.previous })
        .eq('id', declaration.id)
      if (error) fail(error)
      if (result.completedTaskIds.length > 0) {
        await supabase
          .from('tasks')
          .update({ status: 'todo', completed_at: null })
          .in('id', result.completedTaskIds)
      }
    },
    onSettled: (_d, _e, variables) => invalidateGiftAid(client, variables.declaration.contact_id),
  })
}

/* -------------------------------------------------------- inline claim fixes */

export interface AddressFixInput {
  contactId: string
  postcode?: string | null
  gaHouseNo?: string | null
}

/**
 * The validation list's one-click fixes (05 §5): a postcode or a house
 * name/number typed straight into the review, written to the *contact* — the
 * gift was never wrong, the donor record was.
 */
export function useFixDonorAddress() {
  const client = useQueryClient()
  return useMutation<void, Error, AddressFixInput>({
    mutationFn: async ({ contactId, postcode, gaHouseNo }) => {
      const patch: Record<string, unknown> = {}
      if (postcode !== undefined) patch.postcode = postcode === '' ? null : postcode
      if (gaHouseNo !== undefined) patch.ga_house_no = gaHouseNo === '' ? null : gaHouseNo
      if (Object.keys(patch).length === 0) return
      const { error } = await supabase.from('contacts').update(patch).eq('id', contactId)
      if (error) fail(error)
    },
    onSettled: (_d, _e, variables) => invalidateGiftAid(client, variables.contactId),
  })
}

/**
 * Hold a gift back from the claim, or release it (05 §5 "exclude this gift").
 *
 * `ga_excluded_at` is what makes this stick: without it the rolling-claim
 * trigger re-attaches an eligible gift on the very next write (007).
 */
export function useSetGiftExcluded() {
  const client = useQueryClient()
  return useMutation<void, Error, { giftId: string; contactId?: string | null; excluded: boolean; reason?: string | null }>({
    mutationFn: async ({ giftId, excluded, reason }) => {
      const { error } = await supabase
        .from('donations')
        .update(
          excluded
            ? { ga_excluded_at: new Date().toISOString(), ga_exclude_reason: reason ?? null }
            : { ga_excluded_at: null, ga_exclude_reason: null },
        )
        .eq('id', giftId)
      if (error) fail(error)
    },
    onSettled: (_d, _e, variables) => invalidateGiftAid(client, variables.contactId ?? null),
  })
}

/* -------------------------------------------------------------- the claim */

/**
 * File the claim (07 §8.3). One transaction in the database: the gifts are
 * stamped `claimed`, the claim is totalled and given its HMRC reference, and
 * the next rolling claim opens so the following gift has somewhere to go.
 */
export function useSubmitClaim() {
  const client = useQueryClient()
  return useMutation<void, Error, { claimId: string; reference: string }>({
    mutationFn: async ({ claimId, reference }) => {
      const { error } = await supabase.rpc('ga_submit_claim', {
        p_claim_id: claimId,
        p_reference: reference,
      })
      if (error) fail(error)
    },
    onSettled: () => invalidateGiftAid(client),
  })
}

/** HMRC paid: the last state in the claim's life (02 §3.7, 07 §8.3). */
export function useMarkClaimPaid() {
  const client = useQueryClient()
  return useMutation<void, Error, { claimId: string; on?: string }>({
    mutationFn: async ({ claimId, on }) => {
      const { error } = await supabase
        .from('gift_aid_claims')
        .update({ status: 'paid', paid_on: on ?? toISODate(new Date()) })
        .eq('id', claimId)
      if (error) fail(error)
    },
    onSettled: () => invalidateGiftAid(client),
  })
}

/** Undo for "mark paid" — back to `submitted`, the payment date cleared. */
export function useUnmarkClaimPaid() {
  const client = useQueryClient()
  return useMutation<void, Error, { claimId: string }>({
    mutationFn: async ({ claimId }) => {
      const { error } = await supabase
        .from('gift_aid_claims')
        .update({ status: 'submitted', paid_on: null })
        .eq('id', claimId)
      if (error) fail(error)
    },
    onSettled: () => invalidateGiftAid(client),
  })
}
