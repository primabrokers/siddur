/**
 * The nudge rail's data (04 §1): the `signals` table written by the nightly run
 * (08 §3), plus the overdue-pledge summary the rail shows as its last card.
 *
 * Snooze and dismiss are ordinary state transitions on the row — optimistic,
 * reversible inside the undo window (I-12). Nothing here ever auto-dismisses a
 * signal (03 §5.3); only the user's action or the nightly rule resolves one.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { supabase } from '../supabase'
import { isConfigured } from '../env'
import { qk } from './keys'
import { selectRows, unique } from './rest'
import { toISODate } from '../dates'
import type {
  PledgeSummary,
  SignalRow,
  SignalState,
  SignalsResult,
} from '../../features/stream/types'
import { displayName } from '../../features/contacts/normalise'
import type { ContactRow, PledgeInstallmentRow } from '../../features/contacts/types'

interface Failed {
  message: string
}

/** Snoozed signals return silently once their date passes (03 §5.3). */
export function isVisibleSignal(signal: SignalRow, todayISO: string): boolean {
  if (signal.state === 'open') return true
  if (signal.state !== 'snoozed') return false
  return !signal.snoozed_until || signal.snoozed_until <= todayISO
}

export function useSignals(): UseQueryResult<SignalsResult> {
  return useQuery<SignalsResult>({
    queryKey: qk.nudges.list(),
    enabled: isConfigured,
    queryFn: async () => {
      let rows: SignalRow[]
      try {
        rows = await selectRows<SignalRow>('signals', (q) =>
          q.in('state', ['open', 'snoozed']).order('created_at', { ascending: false }).limit(50),
        )
      } catch (caught) {
        return { items: [], error: caught instanceof Error ? caught.message : 'signals unavailable' }
      }

      const todayISO = toISODate(new Date())
      const visible = rows.filter((row) => isVisibleSignal(row, todayISO))
      const ids = unique(visible.map((row) => row.contact_id))
      const contacts =
        ids.length > 0 ? await selectRows<ContactRow>('contacts', (q) => q.in('id', ids)) : []
      const byId = new Map(contacts.map((row) => [row.id, row]))

      return {
        items: visible.map((signal) => {
          const contact = byId.get(signal.contact_id) ?? null
          return {
            signal,
            contact,
            contactName: contact ? displayName(contact) : 'This contact',
          }
        }),
        error: null,
      }
    },
  })
}

export interface SignalPatch {
  state: SignalState
  snoozed_until?: string | null
  resolved_at?: string | null
}

/** Optimistic state transition; the call site wraps it in the undo toast. */
export function useUpdateSignal() {
  const client = useQueryClient()
  return useMutation<void, Error, { id: string; patch: SignalPatch }>({
    mutationFn: async ({ id, patch }) => {
      const { error } = await supabase.from('signals').update(patch).eq('id', id)
      if (error) throw new Error((error as Failed).message)
    },
    onMutate: async ({ id, patch }) => {
      await client.cancelQueries({ queryKey: qk.nudges.all })
      client.setQueryData<SignalsResult>(qk.nudges.list(), (current) => {
        if (!current) return current
        const todayISO = toISODate(new Date())
        return {
          ...current,
          items: current.items
            .map((item) =>
              item.signal.id === id ? { ...item, signal: { ...item.signal, ...patch } } : item,
            )
            .filter((item) => isVisibleSignal(item.signal, todayISO)),
        }
      })
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.nudges.all })
    },
  })
}

/**
 * "3 installments overdue · £2,400 outstanding". Installments carry a stored
 * `expected` status and are overdue by date (02 §3.5), so the date comparison
 * is the query filter — no stored overdue flag exists to drift.
 */
export function usePledgeSummary(enabled = true): UseQueryResult<PledgeSummary> {
  return useQuery<PledgeSummary>({
    queryKey: qk.nudges.pledgeSummary(),
    enabled: isConfigured && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const rows = await selectRows<PledgeInstallmentRow>('pledge_installments', (q) =>
        q.in('status', ['expected', 'partly_paid']).lt('due_on', toISODate(new Date())),
      )
      return {
        overdueCount: rows.length,
        outstanding: rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
      }
    },
  })
}
