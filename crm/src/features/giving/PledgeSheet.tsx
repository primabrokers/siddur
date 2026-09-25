import { useEffect, useMemo, useState } from 'react'
import { Button, Field, Money, Select, Sheet, TextArea, TextInput, useUndoToast } from '../../components'
import { cn } from '../../lib/cn'
import { toISODate } from '../../lib/dates'
import { formatMoney } from '../../lib/format'
import { useCreatePledge, useDeletePledge, useGivingSelects } from '../../lib/queries/giving'
import { ContactPicker } from '../tasks/ContactPicker'
import { displayName } from '../contacts/normalise'
import {
  buildSchedule,
  checkSchedule,
  indicativeGbp,
  parseAmount,
  SCHEDULE_FREQUENCIES,
} from './logic'
import { CURRENCIES, type InstallmentDraft, type PledgeDraft, type ScheduleFrequency } from './types'

const emptyDraft = (today: string, contactId = ''): PledgeDraft => ({
  contact_id: contactId,
  total_amount: '',
  currency: 'GBP',
  fund_id: '',
  campaign_id: '',
  appeal_id: '',
  pledged_on: today,
  notes: '',
  count: '5',
  frequency: 'monthly',
  custom_days: '30',
  starts_on: today,
  installments: [],
})

export interface PledgeSheetProps {
  open: boolean
  onClose: () => void
  contactId?: string
  contactName?: string
  onSaved?: (pledgeId: string) => void
}

/**
 * Pledge entry with the schedule builder (05 §2): "promised £5,000 over 5
 * payments" as first-class state. Installments are generated as **editable**
 * rows — equal split, remainder on the last, with a live sum check — and stored
 * exactly as the fundraiser left them.
 */
export function PledgeSheet({ open, onClose, contactId, contactName, onSaved }: PledgeSheetProps) {
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null)
  const [draft, setDraft] = useState<PledgeDraft>(() => emptyDraft(toISODate(new Date())))
  const [gbpTouched, setGbpTouched] = useState(false)
  const [amountGbpText, setAmountGbpText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const selects = useGivingSelects()
  const create = useCreatePledge()
  const remove = useDeletePledge()
  const withUndo = useUndoToast()

  const targetId = contactId ?? picked?.id ?? ''
  const name = contactName ?? picked?.name ?? null
  const funds = selects.data?.funds ?? []

  useEffect(() => {
    if (!open) return
    setError(null)
    setPicked(null)
    setGbpTouched(false)
    setAmountGbpText('')
    setDraft(emptyDraft(toISODate(new Date()), contactId ?? ''))
  }, [open, contactId])

  useEffect(() => {
    if (!open || draft.fund_id !== '' || funds.length === 0) return
    const general = funds.find((fund) => fund.name.trim().toLowerCase() === 'general')
    setDraft((current) =>
      current.fund_id === '' ? { ...current, fund_id: (general ?? funds[0])?.id ?? '' } : current,
    )
  }, [open, draft.fund_id, funds])

  const set = <K extends keyof PledgeDraft>(key: K, value: PledgeDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const total = parseAmount(draft.total_amount)
  const isGbp = draft.currency === 'GBP'
  const indicative = indicativeGbp(total, draft.currency)
  const totalGbp = isGbp ? total : gbpTouched ? parseAmount(amountGbpText) : indicative

  const rows = draft.installments
  const check = useMemo(() => checkSchedule(total ?? 0, rows), [total, rows])

  function generate() {
    const count = Number.parseInt(draft.count, 10)
    if (total === null || total <= 0) {
      setError('Enter the pledged total before generating a schedule.')
      return
    }
    if (!Number.isFinite(count) || count < 1) {
      setError('How many installments?')
      return
    }
    setError(null)
    set(
      'installments',
      buildSchedule({
        total,
        count,
        frequency: draft.frequency,
        startOn: draft.starts_on,
        customDays: Number.parseInt(draft.custom_days, 10),
      }),
    )
  }

  function editRow(key: string, patch: Partial<InstallmentDraft>) {
    set(
      'installments',
      rows.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    )
  }

  function removeRow(key: string) {
    set(
      'installments',
      rows.filter((row) => row.key !== key),
    )
  }

  async function save() {
    if (targetId === '') {
      setError('Choose the person making the pledge.')
      return
    }
    if (total === null || total <= 0) {
      setError('Enter the pledged total.')
      return
    }
    if (totalGbp === null || totalGbp <= 0) {
      setError('Enter the sterling value of the pledge.')
      return
    }
    if (draft.fund_id === '') {
      setError('Choose the fund.')
      return
    }
    const installments = rows
      .map((row) => ({ due_on: row.due_on, amount: parseAmount(row.amount) ?? 0 }))
      .filter((row) => row.due_on !== '' && row.amount > 0)

    try {
      const result = await withUndo({
        message: `Pledge recorded — ${formatMoney(totalGbp)}${name ? ` from ${name}` : ''}`,
        tone: 'good',
        perform: () =>
          create.mutateAsync({
            pledge: {
              contact_id: targetId,
              total_amount: total,
              currency: draft.currency,
              amount_gbp: totalGbp,
              fund_id: draft.fund_id,
              campaign_id: draft.campaign_id === '' ? null : draft.campaign_id,
              appeal_id: draft.appeal_id === '' ? null : draft.appeal_id,
              pledged_on: draft.pledged_on,
              status: 'open',
              notes: draft.notes.trim() === '' ? null : draft.notes.trim(),
            },
            installments,
          }),
        undo: (created) => remove.mutateAsync({ id: created.pledge.id, contactId: targetId }),
      })
      onSaved?.(result.pledge.id)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the pledge.')
    }
  }

  const needsContact = targetId === ''

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Record a pledge"
      width={600}
      leading={
        <button type="button" onClick={onClose} className="text-muted hover:text-ink">
          Cancel
        </button>
      }
      footer={
        needsContact ? undefined : (
          <Button size="lg" className="w-full" disabled={create.isPending} onClick={() => void save()}>
            {create.isPending ? 'Saving…' : 'Save pledge'}
          </Button>
        )
      }
    >
      {needsContact ? (
        <ContactPicker
          label="Who is making the pledge?"
          onPick={(row) => setPicked({ id: row.id, name: displayName(row) })}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[12.5px] text-muted">
            Promised by <b className="text-ink">{name ?? 'this contact'}</b> — payments are ordinary gifts
            applied to an installment (05 §2).
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_110px_1fr]">
            <Field label="Pledged total" required>
              <TextInput
                autoFocus
                inputMode="decimal"
                aria-label="Pledged total"
                value={draft.total_amount}
                onChange={(e) => set('total_amount', e.target.value)}
                placeholder="5,000"
              />
            </Field>
            <Field label="Currency">
              <Select
                aria-label="Pledge currency"
                value={draft.currency}
                onChange={(e) => set('currency', e.target.value)}
                options={CURRENCIES.map((code) => ({ value: code, label: code }))}
              />
            </Field>
            <Field label="Pledged on" required>
              <TextInput
                type="date"
                aria-label="Pledged on"
                value={draft.pledged_on}
                onChange={(e) => set('pledged_on', e.target.value)}
              />
            </Field>
          </div>

          {!isGbp ? (
            <Field label="Sterling value" required hint="Indicative until the payments land — always editable.">
              <TextInput
                inputMode="decimal"
                aria-label="Pledge sterling value"
                value={gbpTouched ? amountGbpText : indicative === null ? '' : String(indicative)}
                onChange={(e) => {
                  setGbpTouched(true)
                  setAmountGbpText(e.target.value)
                }}
              />
            </Field>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Fund" required>
              <Select
                aria-label="Pledge fund"
                placeholder={funds.length === 0 ? 'No funds yet' : '—'}
                value={draft.fund_id}
                onChange={(e) => set('fund_id', e.target.value)}
                options={funds.map((fund) => ({ value: fund.id, label: fund.name }))}
              />
            </Field>
            <Field label="Campaign">
              <Select
                aria-label="Pledge campaign"
                placeholder="—"
                value={draft.campaign_id}
                onChange={(e) => set('campaign_id', e.target.value)}
                options={(selects.data?.campaigns ?? []).map((row) => ({ value: row.id, label: row.name }))}
              />
            </Field>
            <Field label="Appeal">
              <Select
                aria-label="Pledge appeal"
                placeholder="—"
                value={draft.appeal_id}
                onChange={(e) => set('appeal_id', e.target.value)}
                options={(selects.data?.appeals ?? []).map((row) => ({ value: row.id, label: row.name }))}
              />
            </Field>
          </div>

          {/* Schedule builder (05 §2). */}
          <section className="flex flex-col gap-3 rounded-card border border-border bg-ground p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <Field label="Installments">
                <TextInput
                  inputMode="numeric"
                  aria-label="Number of installments"
                  value={draft.count}
                  onChange={(e) => set('count', e.target.value)}
                />
              </Field>
              <Field label="Every">
                <Select
                  aria-label="Schedule frequency"
                  value={draft.frequency}
                  onChange={(e) => set('frequency', e.target.value as ScheduleFrequency)}
                  options={SCHEDULE_FREQUENCIES.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                />
              </Field>
              {draft.frequency === 'custom' ? (
                <Field label="Days apart">
                  <TextInput
                    inputMode="numeric"
                    aria-label="Days apart"
                    value={draft.custom_days}
                    onChange={(e) => set('custom_days', e.target.value)}
                  />
                </Field>
              ) : (
                <Field label="First payment">
                  <TextInput
                    type="date"
                    aria-label="First payment date"
                    value={draft.starts_on}
                    onChange={(e) => set('starts_on', e.target.value)}
                  />
                </Field>
              )}
              <div className="flex items-end">
                <Button variant="accentOutline" className="w-full" onClick={generate}>
                  Generate
                </Button>
              </div>
            </div>

            {draft.frequency === 'custom' ? (
              <Field label="First payment" className="sm:w-[220px]">
                <TextInput
                  type="date"
                  aria-label="First payment date"
                  value={draft.starts_on}
                  onChange={(e) => set('starts_on', e.target.value)}
                />
              </Field>
            ) : null}

            {rows.length === 0 ? (
              <p className="text-[12.5px] text-muted">
                Generate the schedule, then edit any row. Equal split with the remainder on the last payment.
              </p>
            ) : (
              <div className="flex flex-col gap-2" data-testid="schedule-rows">
                {rows.map((row, index) => (
                  <div key={row.key} className="flex items-center gap-2">
                    <span className="tabular w-[20px] shrink-0 text-[12px] text-muted">{index + 1}</span>
                    <TextInput
                      type="date"
                      aria-label={`Installment ${index + 1} due date`}
                      value={row.due_on}
                      onChange={(e) => editRow(row.key, { due_on: e.target.value })}
                      className="w-[160px] px-2 py-1 text-[12.5px]"
                    />
                    <TextInput
                      inputMode="decimal"
                      aria-label={`Installment ${index + 1} amount`}
                      value={row.amount}
                      onChange={(e) => editRow(row.key, { amount: e.target.value })}
                      className="w-[120px] px-2 py-1 text-[12.5px]"
                    />
                    <button
                      type="button"
                      aria-label={`Remove installment ${index + 1}`}
                      onClick={() => removeRow(row.key)}
                      className="ml-auto text-[12px] text-muted hover:text-flag-overdue"
                    >
                      Remove
                    </button>
                  </div>
                ))}

                <p
                  data-testid="schedule-check"
                  className={cn(
                    'text-[12.5px]',
                    check.balanced ? 'text-good' : 'font-semibold text-flag-overdue',
                  )}
                >
                  {check.balanced ? (
                    <>
                      Schedule sums to <Money amount={check.sum} /> ✓
                    </>
                  ) : (
                    <>
                      Schedule sums to {formatMoney(check.sum)} — {check.difference > 0 ? 'over' : 'under'} the
                      pledged total by {formatMoney(Math.abs(check.difference))}
                    </>
                  )}
                </p>
              </div>
            )}
          </section>

          <Field label="Notes">
            <TextArea rows={2} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>

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
