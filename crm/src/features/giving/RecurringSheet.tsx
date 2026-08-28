import { useEffect, useState } from 'react'
import { Button, Field, Select, Sheet, TextInput, useUndoToast } from '../../components'
import { toISODate } from '../../lib/dates'
import { formatMoney } from '../../lib/format'
import { useLookupOptions } from '../../lib/queries/contacts'
import { useCreateRecurring, useDeleteRecurring, useGivingSelects } from '../../lib/queries/giving'
import { ContactPicker } from '../tasks/ContactPicker'
import { displayName } from '../contacts/normalise'
import { parseAmount } from './logic'
import { CURRENCIES, RECURRING_FREQUENCIES, type RecurringDraft } from './types'

const PAYMENT_METHOD_FALLBACK = [
  { value: 'standing_order', label: 'Standing order' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'voucher_agency', label: 'Voucher agency' },
  { value: 'other', label: 'Other' },
]

const emptyDraft = (today: string, contactId = ''): RecurringDraft => ({
  contact_id: contactId,
  amount: '',
  currency: 'GBP',
  frequency: 'monthly',
  payment_method: 'standing_order',
  fund_id: '',
  starts_on: today,
  ends_on: '',
  expected_day: '',
})

export interface RecurringSheetProps {
  open: boolean
  onClose: () => void
  contactId?: string
  contactName?: string
  onSaved?: (id: string) => void
}

/**
 * A standing order as a record (02 §3.6 / D12): amount, frequency, method,
 * expected day. The nightly job — not this sheet — flags it `failing` when an
 * expected payment runs more than 7 days late (08 §3).
 */
export function RecurringSheet({ open, onClose, contactId, contactName, onSaved }: RecurringSheetProps) {
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null)
  const [draft, setDraft] = useState<RecurringDraft>(() => emptyDraft(toISODate(new Date())))
  const [error, setError] = useState<string | null>(null)

  const selects = useGivingSelects()
  const methods = useLookupOptions('payment_method')
  const create = useCreateRecurring()
  const remove = useDeleteRecurring()
  const withUndo = useUndoToast()

  const targetId = contactId ?? picked?.id ?? ''
  const name = contactName ?? picked?.name ?? null
  const funds = selects.data?.funds ?? []

  useEffect(() => {
    if (!open) return
    setError(null)
    setPicked(null)
    setDraft(emptyDraft(toISODate(new Date()), contactId ?? ''))
  }, [open, contactId])

  const set = <K extends keyof RecurringDraft>(key: K, value: RecurringDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  async function save() {
    const amount = parseAmount(draft.amount)
    if (targetId === '') {
      setError('Choose the donor.')
      return
    }
    if (amount === null || amount <= 0) {
      setError('Enter the recurring amount.')
      return
    }
    const day = Number.parseInt(draft.expected_day, 10)

    try {
      const created = await withUndo({
        message: `Standing order recorded — ${formatMoney(amount)} ${draft.frequency}`,
        tone: 'good',
        perform: () =>
          create.mutateAsync({
            contact_id: targetId,
            amount,
            currency: draft.currency,
            frequency: draft.frequency,
            payment_method: draft.payment_method === '' ? null : draft.payment_method,
            fund_id: draft.fund_id === '' ? null : draft.fund_id,
            starts_on: draft.starts_on,
            ends_on: draft.ends_on === '' ? null : draft.ends_on,
            expected_day: Number.isFinite(day) ? day : null,
          }),
        undo: (row) => remove.mutateAsync({ id: row.id, contactId: targetId }),
      })
      onSaved?.(created.id)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the agreement.')
    }
  }

  const needsContact = targetId === ''
  const methodOptions =
    methods.data && methods.data.length > 0
      ? methods.data.map((option) => ({ value: option.value, label: option.label }))
      : PAYMENT_METHOD_FALLBACK

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New standing order"
      width={520}
      leading={
        <button type="button" onClick={onClose} className="text-muted hover:text-ink">
          Cancel
        </button>
      }
      footer={
        needsContact ? undefined : (
          <Button size="lg" className="w-full" disabled={create.isPending} onClick={() => void save()}>
            {create.isPending ? 'Saving…' : 'Save agreement'}
          </Button>
        )
      }
    >
      {needsContact ? (
        <ContactPicker
          label="Whose standing order is this?"
          onPick={(row) => setPicked({ id: row.id, name: displayName(row) })}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[12.5px] text-muted">
            For <b className="text-ink">{name ?? 'this contact'}</b>. A missed payment is a retention emergency
            — the nightly job flags it and raises a “call, don’t email” signal (08 §3).
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_110px_1fr]">
            <Field label="Amount" required>
              <TextInput
                autoFocus
                inputMode="decimal"
                aria-label="Recurring amount"
                value={draft.amount}
                onChange={(e) => set('amount', e.target.value)}
                placeholder="150"
              />
            </Field>
            <Field label="Currency">
              <Select
                aria-label="Recurring currency"
                value={draft.currency}
                onChange={(e) => set('currency', e.target.value)}
                options={CURRENCIES.map((code) => ({ value: code, label: code }))}
              />
            </Field>
            <Field label="Frequency" required>
              <Select
                aria-label="Frequency"
                value={draft.frequency}
                onChange={(e) => set('frequency', e.target.value)}
                options={RECURRING_FREQUENCIES.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Payment method">
              <Select
                aria-label="Recurring payment method"
                placeholder="—"
                value={draft.payment_method}
                onChange={(e) => set('payment_method', e.target.value)}
                options={methodOptions}
              />
            </Field>
            <Field label="Fund">
              <Select
                aria-label="Recurring fund"
                placeholder="—"
                value={draft.fund_id}
                onChange={(e) => set('fund_id', e.target.value)}
                options={funds.map((fund) => ({ value: fund.id, label: fund.name }))}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Starts">
              <TextInput
                type="date"
                aria-label="Starts on"
                value={draft.starts_on}
                onChange={(e) => set('starts_on', e.target.value)}
              />
            </Field>
            <Field label="Ends (optional)">
              <TextInput
                type="date"
                aria-label="Ends on"
                value={draft.ends_on}
                onChange={(e) => set('ends_on', e.target.value)}
              />
            </Field>
            <Field label="Expected day" hint="Day of the month the payment lands.">
              <TextInput
                inputMode="numeric"
                aria-label="Expected day"
                value={draft.expected_day}
                onChange={(e) => set('expected_day', e.target.value)}
                placeholder="1"
              />
            </Field>
          </div>

          {error ? (
            <p role="alert" className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Sheet>
  )
}
