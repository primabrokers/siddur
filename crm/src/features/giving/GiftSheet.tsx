import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Field,
  Money,
  Select,
  Sheet,
  TextArea,
  TextInput,
  useUndoToast,
} from '../../components'
import { cn } from '../../lib/cn'
import { toISODate } from '../../lib/dates'
import { formatDate, formatMoney } from '../../lib/format'
import {
  useContact,
  useContactDeclarations,
  useContactGiving,
  useLookupOptions,
} from '../../lib/queries/contacts'
import { useCreateGift, useDeleteGift, useGivingSelects } from '../../lib/queries/giving'
import { ContactPicker } from '../tasks/ContactPicker'
import { displayName } from '../contacts/normalise'
import {
  appliesToOptions,
  appliesToPatch,
  askArray,
  gasdsAvailable,
  GASDS_LIMIT,
  indicativeGbp,
  INDICATIVE_RATES,
  parseAmount,
  previewGiftAid,
  type AppliesToOption,
} from './logic'
import { CURRENCIES, emptyGiftDraft, type GiftDraft } from './types'

/** Seeds from 02 §6 — used until `lookup_options` is populated. */
const PAYMENT_METHOD_FALLBACK = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'standing_order', label: 'Standing order' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'contactless', label: 'Contactless' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'voucher_agency', label: 'Voucher agency' },
  { value: 'other', label: 'Other' },
]

const TRIBUTE_TYPE_FALLBACK = [
  { value: 'in_honor', label: 'In honour of' },
  { value: 'in_memory', label: 'In memory of' },
  { value: 'yahrzeit', label: 'Yahrzeit' },
  { value: 'simcha', label: 'Simcha' },
]

export interface GiftSheetPreset {
  /** Applies-to preset — the pledge card's "Record payment" (05 §2). */
  pledgeId?: string | null
  installmentId?: string | null
  recurringId?: string | null
  amount?: number | null
  fundId?: string | null
  campaignId?: string | null
  appealId?: string | null
}

export interface GiftSheetProps {
  open: boolean
  onClose: () => void
  /** Omit to open on the contact picker. */
  contactId?: string
  contactName?: string
  preset?: GiftSheetPreset
  onSaved?: (giftId: string) => void
}

/**
 * Gift entry (05 §1) — a gift recorded in under a minute with correct coding.
 *
 * Everything downstream is the database's job (08 §2): the thank-you task, the
 * receipt queueing, `gift_aid_status`, household soft credits and the
 * acknowledgee letter. This sheet writes the donation (plus an influencer soft
 * credit and a tribute when asked) and shows a 6-second undo (I-12); the
 * statuses appear on refetch, and degrade to the insert defaults when the
 * triggers are not live yet.
 */
export function GiftSheet({ open, onClose, contactId, contactName, preset, onSaved }: GiftSheetProps) {
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null)
  const [draft, setDraft] = useState<GiftDraft>(() => emptyGiftDraft(toISODate(new Date())))
  const [error, setError] = useState<string | null>(null)
  const [gbpTouched, setGbpTouched] = useState(false)

  const targetId = contactId ?? picked?.id ?? ''
  const detail = useContact(targetId === '' ? undefined : targetId)
  const declarations = useContactDeclarations(targetId === '' ? undefined : targetId)
  const giving = useContactGiving(targetId === '' ? undefined : targetId)
  const selects = useGivingSelects()
  const methods = useLookupOptions('payment_method')
  const tributeTypes = useLookupOptions('tribute_type')

  const create = useCreateGift()
  const remove = useDeleteGift()
  const withUndo = useUndoToast()

  const funds = selects.data?.funds ?? []
  const contact = detail.data?.contact ?? null
  const stats = detail.data?.stats ?? null
  const introducer = detail.data?.introducedBy ?? null
  const name = contactName ?? picked?.name ?? (contact ? displayName(contact) : null)

  // Re-seed each time the sheet opens, so a stale draft never leaks between gifts.
  useEffect(() => {
    if (!open) return
    setError(null)
    setGbpTouched(false)
    setPicked(null)
    setDraft({
      ...emptyGiftDraft(toISODate(new Date()), contactId ?? ''),
      amount: preset?.amount ? String(preset.amount) : '',
      fund_id: preset?.fundId ?? '',
      campaign_id: preset?.campaignId ?? '',
      appeal_id: preset?.appealId ?? '',
      pledge_id: preset?.pledgeId ?? null,
      installment_id: preset?.installmentId ?? null,
      recurring_agreement_id: preset?.recurringId ?? null,
    })
  }, [
    open,
    contactId,
    preset?.amount,
    preset?.fundId,
    preset?.campaignId,
    preset?.appealId,
    preset?.pledgeId,
    preset?.installmentId,
    preset?.recurringId,
  ])

  // Fund is required with General as the default (05 §1).
  useEffect(() => {
    if (!open || draft.fund_id !== '' || funds.length === 0) return
    const general = funds.find((fund) => fund.name.trim().toLowerCase() === 'general')
    setDraft((current) =>
      current.fund_id === '' ? { ...current, fund_id: (general ?? funds[0])?.id ?? '' } : current,
    )
  }, [open, draft.fund_id, funds])

  const set = <K extends keyof GiftDraft>(key: K, value: GiftDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const amount = parseAmount(draft.amount)
  const isGbp = draft.currency === 'GBP'
  const indicative = indicativeGbp(amount, draft.currency)
  const amountGbp = isGbp ? amount : gbpTouched ? parseAmount(draft.amount_gbp) : indicative

  const chips = useMemo(() => askArray(stats), [stats])

  const applies = useMemo(
    () =>
      giving.data
        ? appliesToOptions({
            pledges: giving.data.pledges,
            installments: giving.data.installments,
            recurring: giving.data.recurring,
          })
        : [],
    [giving.data],
  )

  const chosenApplies: AppliesToOption | null =
    applies.find(
      (option) =>
        (draft.installment_id !== null && option.installmentId === draft.installment_id) ||
        (draft.installment_id === null &&
          draft.pledge_id !== null &&
          option.kind === 'pledge' &&
          option.pledgeId === draft.pledge_id) ||
        (draft.recurring_agreement_id !== null && option.recurringId === draft.recurring_agreement_id),
    ) ?? null

  const giftAid = previewGiftAid({
    currency: draft.currency,
    donatedOn: draft.donated_on,
    contactKind: contact?.contact_kind ?? null,
    declarations: declarations.data,
  })

  const showGasds = gasdsAvailable({
    paymentMethod: draft.payment_method,
    amountGbp,
    currency: draft.currency,
  })
  // Never leave a hidden checkbox ticked: changing the method or the amount out
  // of GASDS range clears the flag.
  useEffect(() => {
    if (!showGasds && draft.is_gasds) setDraft((current) => ({ ...current, is_gasds: false }))
  }, [showGasds, draft.is_gasds])

  function chooseApplies(option: AppliesToOption) {
    const already = chosenApplies?.id === option.id
    const patch = appliesToPatch(already ? null : option)
    setDraft((current) => ({
      ...current,
      pledge_id: patch.pledge_id,
      installment_id: patch.installment_id,
      recurring_agreement_id: patch.recurring_agreement_id,
      // A one-tap link also fills the amount the schedule expects.
      amount: already || option.amount === null ? current.amount : String(option.amount),
    }))
  }

  async function save() {
    if (targetId === '') {
      setError('Choose the donor first.')
      return
    }
    if (amount === null || amount <= 0) {
      setError('Enter the amount received.')
      return
    }
    if (amountGbp === null || amountGbp <= 0) {
      setError('Enter the sterling value of the gift — the ledger claims in GBP.')
      return
    }
    if (draft.fund_id === '') {
      setError('Choose the fund this gift belongs to.')
      return
    }
    if (draft.tribute && draft.honoree_name.trim() === '') {
      setError('A tribute needs the honoree’s name.')
      return
    }

    const donation: Record<string, unknown> = {
      contact_id: targetId,
      donated_on: draft.donated_on,
      amount,
      currency: draft.currency,
      amount_gbp: amountGbp,
      fund_id: draft.fund_id,
      campaign_id: draft.campaign_id === '' ? null : draft.campaign_id,
      appeal_id: draft.appeal_id === '' ? null : draft.appeal_id,
      payment_method: draft.payment_method === '' ? null : draft.payment_method,
      status: 'received',
      pledge_id: draft.pledge_id,
      installment_id: draft.installment_id,
      recurring_agreement_id: draft.recurring_agreement_id,
      is_gasds: draft.is_gasds,
      notes: draft.notes.trim() === '' ? null : draft.notes.trim(),
    }

    try {
      const result = await withUndo({
        message: (
          <span>
            Gift recorded — {formatMoney(amountGbp)}
            {name ? ` from ${name}` : ''}
          </span>
        ),
        tone: 'good',
        perform: () =>
          create.mutateAsync({
            donation,
            softCredit:
              draft.credit_introducer && introducer
                ? { contact_id: introducer.id, role: 'influencer', amount: amountGbp }
                : null,
            tribute: draft.tribute
              ? {
                  tribute_type: draft.tribute_type === '' ? 'in_honor' : draft.tribute_type,
                  honoree_name: draft.honoree_name.trim(),
                  acknowledgee_name: draft.acknowledgee_name.trim() === '' ? null : draft.acknowledgee_name.trim(),
                  acknowledgee_address:
                    draft.acknowledgee_address.trim() === '' ? null : draft.acknowledgee_address.trim(),
                  notify: draft.notify,
                }
              : null,
          }),
        undo: (created) =>
          remove.mutateAsync({ id: created.donation.id, contactId: created.donation.contact_id }),
      })
      onSaved?.(result.donation.id)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the gift.')
    }
  }

  const needsContact = targetId === ''
  const methodOptions =
    methods.data && methods.data.length > 0
      ? methods.data.map((option) => ({ value: option.value, label: option.label }))
      : PAYMENT_METHOD_FALLBACK
  const tributeOptions =
    tributeTypes.data && tributeTypes.data.length > 0
      ? tributeTypes.data.map((option) => ({ value: option.value, label: option.label }))
      : TRIBUTE_TYPE_FALLBACK

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Record a gift"
      width={560}
      leading={
        <button type="button" onClick={onClose} className="text-muted hover:text-ink">
          Cancel
        </button>
      }
      footer={
        needsContact ? undefined : (
          <Button size="lg" className="w-full" disabled={create.isPending} onClick={() => void save()}>
            {create.isPending ? 'Saving…' : 'Save gift'}
          </Button>
        )
      }
    >
      {needsContact ? (
        <ContactPicker
          label="Whose gift is this?"
          onPick={(row) => setPicked({ id: row.id, name: displayName(row) })}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[12.5px] text-muted">
            Hard credit to <b className="text-ink">{name ?? 'this contact'}</b> — one legal donor per gift
            (02 D2).
          </p>

          {/* Applies-to banner (05 §1 → 02 §3.4). */}
          {applies.length > 0 ? (
            <section
              data-testid="applies-to"
              className="flex flex-col gap-2 rounded-card border border-accent bg-accent-soft/60 p-3"
            >
              <p className="text-[12px] font-semibold text-accent-dark">
                {name ?? 'This donor'} has an open commitment — apply this gift to it?
              </p>
              <div className="flex flex-wrap gap-[6px]">
                {applies.map((option) => {
                  const active = chosenApplies?.id === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => chooseApplies(option)}
                      className={cn(
                        'rounded-pill px-[10px] py-[4px] text-[12px] transition-colors',
                        active
                          ? 'bg-accent font-semibold text-surface'
                          : 'border border-accent/40 bg-surface text-accent-dark hover:border-accent',
                      )}
                    >
                      {option.label}
                      {option.dueOn ? ` · ${formatDate(option.dueOn)}` : ''}
                      {option.overdue ? ' · overdue' : ''}
                    </button>
                  )
                })}
              </div>
              {chosenApplies ? (
                <p className="text-[11.5px] text-accent-dark">
                  Linked — tap again to unlink. The pledge balance recomputes from the payments.
                </p>
              ) : null}
            </section>
          ) : null}

          {/* Ask-array chips (05 §1) — read from contact_stats, never recomputed. */}
          {chips.length > 0 ? (
            <div className="flex flex-col gap-[6px]" data-testid="ask-array">
              <span className="text-[12px] font-semibold text-muted">Their history</span>
              <div className="flex flex-wrap gap-[6px]">
                {chips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => set('amount', String(chip.amount))}
                    className="rounded-pill border border-[#C9BC96] px-[10px] py-[4px] text-[12px] text-gold hover:bg-[#F7F1E2]"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px]">
            <Field label="Amount" required>
              <TextInput
                autoFocus
                inputMode="decimal"
                value={draft.amount}
                onChange={(e) => set('amount', e.target.value)}
                placeholder="1,000"
                aria-label="Amount"
              />
            </Field>
            <Field label="Currency">
              <Select
                aria-label="Currency"
                value={draft.currency}
                onChange={(e) => set('currency', e.target.value)}
                options={CURRENCIES.map((code) => ({ value: code, label: code }))}
              />
            </Field>
          </div>

          {!isGbp ? (
            <Field
              label="Sterling value (amount_gbp)"
              required
              hint={
                <>
                  Indicative rate {INDICATIVE_RATES[draft.currency] ?? '—'} — edit to the sterling amount that
                  actually reached the bank. TODO(M7): read a stored rate.
                </>
              }
            >
              <TextInput
                inputMode="decimal"
                aria-label="Sterling value"
                value={gbpTouched ? draft.amount_gbp : indicative === null ? '' : String(indicative)}
                onChange={(e) => {
                  setGbpTouched(true)
                  set('amount_gbp', e.target.value)
                }}
              />
            </Field>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Date received" required>
              <TextInput
                type="date"
                aria-label="Date received"
                value={draft.donated_on}
                onChange={(e) => set('donated_on', e.target.value)}
              />
            </Field>
            <Field label="Payment method">
              <Select
                aria-label="Payment method"
                placeholder="—"
                value={draft.payment_method}
                onChange={(e) => set('payment_method', e.target.value)}
                options={methodOptions}
              />
            </Field>
          </div>

          {/* The three coding axes (02 D3) — fund is the only required one. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Fund" required>
              <Select
                aria-label="Fund"
                placeholder={funds.length === 0 ? 'No funds yet' : '—'}
                value={draft.fund_id}
                onChange={(e) => set('fund_id', e.target.value)}
                options={funds.map((fund) => ({ value: fund.id, label: fund.name }))}
              />
            </Field>
            <Field label="Campaign">
              <Select
                aria-label="Campaign"
                placeholder="—"
                value={draft.campaign_id}
                onChange={(e) => set('campaign_id', e.target.value)}
                options={(selects.data?.campaigns ?? []).map((row) => ({ value: row.id, label: row.name }))}
              />
            </Field>
            <Field label="Appeal">
              <Select
                aria-label="Appeal"
                placeholder="—"
                value={draft.appeal_id}
                onChange={(e) => set('appeal_id', e.target.value)}
                options={(selects.data?.appeals ?? []).map((row) => ({ value: row.id, label: row.name }))}
              />
            </Field>
          </div>

          {/* Gift Aid line (05 §1) — a preview; the trigger sets the real status. */}
          <section
            data-testid="gift-aid-line"
            className={cn(
              'flex flex-col gap-2 rounded-card border px-3 py-[10px] text-[12.5px]',
              giftAid.state === 'eligible'
                ? 'border-good bg-good-bg text-good'
                : giftAid.state === 'no_declaration'
                  ? 'border-flag-none bg-[#FBF6E3] text-flag-none-ink'
                  : 'border-border bg-ground text-muted',
            )}
          >
            <span className="font-semibold">
              Gift Aid: {giftAid.label}
              {giftAid.reason ? ` — ${giftAid.reason}` : ''}
            </span>
            {giftAid.state === 'eligible' && giftAid.declaration ? (
              <span className="text-[11.5px]">
                Declaration {formatDate(giftAid.declaration.declared_on)} ·{' '}
                {giftAid.declaration.covers_future ? 'enduring' : 'single gift'} · +
                {formatMoney(amountGbp === null ? null : Math.round(amountGbp * 0.25 * 100) / 100)} claimable
              </span>
            ) : null}
            {giftAid.state === 'no_declaration' ? (
              <span className="flex flex-wrap items-center gap-2 text-[11.5px]">
                <button
                  type="button"
                  disabled
                  title="Declaration chasing arrives with the Gift Aid workspace (05 §5)"
                  className="rounded-pill border border-flag-none px-[10px] py-[3px] text-[11.5px] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Request a declaration
                </button>
                {/* TODO(M7): the chase workflow (08 §2 ga_declaration_chase) + 05 §5. */}
                <span>Chasing lands with the Gift Aid workspace.</span>
              </span>
            ) : null}
            <span className="text-[11px] opacity-80">
              Preview only — the claim status is computed by the database when the gift saves.
            </span>
          </section>

          {showGasds ? (
            <label className="flex items-start gap-2 text-[12.5px] text-muted">
              <input
                type="checkbox"
                checked={draft.is_gasds}
                onChange={(e) => set('is_gasds', e.target.checked)}
                className="mt-[2px] h-[15px] w-[15px] accent-[#0E6E6B]"
              />
              <span>
                Claim under GASDS — small cash/contactless collection, no declaration needed (≤{' '}
                {formatMoney(GASDS_LIMIT)})
              </span>
            </label>
          ) : null}

          {/* Soft-credit prompt (05 §1; household credits are a trigger's job). */}
          {introducer ? (
            <button
              type="button"
              aria-pressed={draft.credit_introducer}
              onClick={() => set('credit_introducer', !draft.credit_introducer)}
              className={cn(
                'self-start rounded-pill px-[12px] py-[5px] text-[12.5px] transition-colors',
                draft.credit_introducer
                  ? 'bg-accent font-semibold text-surface'
                  : 'border border-accent text-accent-dark hover:bg-accent-soft',
              )}
            >
              {draft.credit_introducer
                ? `${introducer.name} credited as influencer ✓`
                : `Credit ${introducer.name} as influencer?`}
            </button>
          ) : null}

          {/* Tribute (05 §1 → 02 §3.15). */}
          <div className="flex flex-col gap-3 rounded-card border border-border p-3">
            <label className="flex items-center gap-2 text-[12.5px] font-semibold text-nav">
              <input
                type="checkbox"
                checked={draft.tribute}
                onChange={(e) => set('tribute', e.target.checked)}
                className="h-[15px] w-[15px] accent-[#0E6E6B]"
              />
              This gift is in honour / in memory of someone
            </label>

            {draft.tribute ? (
              <div className="flex flex-col gap-3" data-testid="tribute-fields">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Tribute type" required>
                    <Select
                      aria-label="Tribute type"
                      placeholder="—"
                      value={draft.tribute_type}
                      onChange={(e) => set('tribute_type', e.target.value)}
                      options={tributeOptions}
                    />
                  </Field>
                  <Field label="Honoree" required>
                    <TextInput
                      aria-label="Honoree"
                      value={draft.honoree_name}
                      onChange={(e) => set('honoree_name', e.target.value)}
                      placeholder="R' Moshe Cohen z”l"
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Acknowledgee">
                    <TextInput
                      aria-label="Acknowledgee"
                      value={draft.acknowledgee_name}
                      onChange={(e) => set('acknowledgee_name', e.target.value)}
                      placeholder="Mrs R. Cohen"
                    />
                  </Field>
                  <Field label="Acknowledgee address">
                    <TextInput
                      aria-label="Acknowledgee address"
                      value={draft.acknowledgee_address}
                      onChange={(e) => set('acknowledgee_address', e.target.value)}
                    />
                  </Field>
                </div>
                <label className="flex items-start gap-2 text-[12.5px] text-muted">
                  <input
                    type="checkbox"
                    checked={draft.notify}
                    onChange={(e) => set('notify', e.target.checked)}
                    className="mt-[2px] h-[15px] w-[15px] accent-[#0E6E6B]"
                  />
                  <span>
                    Notify the acknowledgee — the database raises the acknowledgee-letter task, separate from
                    the donor’s own thank-you (08 §2).
                  </span>
                </label>
              </div>
            ) : null}
          </div>

          <Field label="Notes">
            <TextArea rows={2} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>

          {amountGbp !== null && amountGbp > 0 ? (
            <p className="text-[12.5px] text-muted">
              Ledger value <Money amount={amountGbp} /> · status received · thank-you and receipt are queued by
              the database.
            </p>
          ) : null}

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
