import { useEffect, useState } from 'react'
import { Button, Field, FieldGroup, Select, Sheet, TextArea, TextInput } from '../../components'
import { formatMoney } from '../../lib/format'
import { useGivingSelects } from '../../lib/queries/giving'
// Deep imports on purpose: the barrels behind these two would drag the whole
// tasks board into the sheet's module graph for one picker.
import { ContactPicker } from '../tasks/ContactPicker'
import { displayName } from '../contacts/normalise'
import { defaultExpected, movePatch, num, parseAmount, STATUS_LABEL } from './logic'
import type { ContactRow, OpportunityDraft, OpportunityRow, OpportunityStatus, PipelineStage } from './types'

export interface OpportunitySheetProps {
  open: boolean
  onClose: () => void
  /** Pass a row to edit it; omit to create. */
  opportunity?: OpportunityRow | null
  /** Prefill when opening from a donor profile — skips the picker. */
  contactId?: string
  contactName?: string
  stages: PipelineStage[]
  onSave: (draft: OpportunityDraft, id: string | null) => Promise<void> | void
  onDelete?: (opportunity: OpportunityRow) => void
  pending?: boolean
}

const STATUSES: OpportunityStatus[] = ['open', 'on_hold', 'won', 'lost']

const asText = (value: number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value)

/**
 * New / edit one ask (06 §2: "New opportunity requires contact + name + ask").
 *
 * Everything else 02 §3.9 lists is here too — the two projections (▸ LGL
 * Goals), the ask date, the motivation and the restrictions — because an ask
 * whose *why* lives in someone's head is not a managed ask.
 *
 * The stage select is also the board's keyboard-accessible move: it runs the
 * same `movePatch` a drag does, so the two clocks stay honest whichever way the
 * card was moved.
 */
export function OpportunitySheet({
  open,
  onClose,
  opportunity,
  contactId,
  contactName,
  stages,
  onSave,
  onDelete,
  pending,
}: OpportunitySheetProps) {
  const selects = useGivingSelects()

  const [picked, setPicked] = useState<ContactRow | null>(null)
  const [name, setName] = useState('')
  const [stage, setStage] = useState('')
  const [status, setStatus] = useState<OpportunityStatus>('open')
  const [ask, setAsk] = useState('')
  const [probability, setProbability] = useState('')
  const [expected, setExpected] = useState('')
  const [expectedTouched, setExpectedTouched] = useState(false)
  const [fundId, setFundId] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [decisionOn, setDecisionOn] = useState('')
  const [askDate, setAskDate] = useState('')
  const [high, setHigh] = useState('')
  const [low, setLow] = useState('')
  const [motivation, setMotivation] = useState('')
  const [restrictions, setRestrictions] = useState('')
  const [error, setError] = useState<string | null>(null)

  const targetId = opportunity?.contact_id ?? contactId ?? picked?.id ?? null
  const targetName = opportunity ? contactName : (contactName ?? (picked ? displayName(picked) : null))
  const firstStage = stages[0]?.value ?? 'identified'

  // Re-seed on every open so a stale draft never leaks between cards.
  useEffect(() => {
    if (!open) return
    setError(null)
    setPicked(null)
    setExpectedTouched(false)
    if (opportunity) {
      setName(opportunity.name)
      setStage(opportunity.stage)
      setStatus(opportunity.status)
      setAsk(asText(num(opportunity.ask_amount)))
      setProbability(asText(num(opportunity.probability_pct)))
      setExpected(asText(num(opportunity.expected_amount)))
      setFundId(opportunity.fund_id ?? '')
      setCampaignId(opportunity.campaign_id ?? '')
      setDecisionOn(opportunity.expected_decision_on ?? '')
      setAskDate(opportunity.ask_date ?? '')
      setHigh(asText(num(opportunity.projection_high)))
      setLow(asText(num(opportunity.projection_low)))
      setMotivation(opportunity.motivation ?? '')
      setRestrictions(opportunity.restrictions ?? '')
      return
    }
    setName('')
    setStage(firstStage)
    setStatus('open')
    setAsk('')
    setProbability('')
    setExpected('')
    setFundId('')
    setCampaignId('')
    setDecisionOn('')
    setAskDate('')
    setHigh('')
    setLow('')
    setMotivation('')
    setRestrictions('')
  }, [open, opportunity, firstStage])

  // Expected defaults to ask × probability and stays live until it is edited by
  // hand — the fundraiser's own number always wins (I-8 applies to *derived*
  // rollups; this is a forecast they own).
  const autoExpected = defaultExpected(parseAmount(ask), parseAmount(probability))
  const expectedValue = expectedTouched ? parseAmount(expected) : autoExpected

  async function save() {
    if (!targetId) {
      setError('Choose the donor this ask belongs to.')
      return
    }
    if (name.trim() === '') {
      setError('Give the ask a name — "Building campaign", "Dinner sponsorship".')
      return
    }
    const askAmount = parseAmount(ask)
    if (askAmount === null) {
      setError('An ask needs an amount, even a rough one.')
      return
    }

    const draft: OpportunityDraft = {
      contact_id: targetId,
      name: name.trim(),
      ask_amount: askAmount,
      probability_pct: parseAmount(probability),
      expected_amount: expectedValue,
      fund_id: fundId === '' ? null : fundId,
      campaign_id: campaignId === '' ? null : campaignId,
      expected_decision_on: decisionOn === '' ? null : decisionOn,
      ask_date: askDate === '' ? null : askDate,
      projection_high: parseAmount(high),
      projection_low: parseAmount(low),
      motivation: motivation.trim() === '' ? null : motivation.trim(),
      restrictions: restrictions.trim() === '' ? null : restrictions.trim(),
    }

    if (opportunity) {
      // A stage change from here is a move like any other: same patch, same
      // clocks (02 §3.9).
      const moved = movePatch(opportunity, stage, stages)
      if (moved) Object.assign(draft, moved)
      if (status !== opportunity.status) {
        draft.status = status
        if (status === 'open' || status === 'on_hold') {
          draft.closed_on = null
          draft.lost_reason = null
        }
      }
    } else {
      draft.stage = stage
      draft.status = 'open'
    }

    try {
      await onSave(draft, opportunity?.id ?? null)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the ask.')
    }
  }

  const needsContact = !targetId
  const funds = selects.data?.funds ?? []
  const campaigns = selects.data?.campaigns ?? []

  return (
    <Sheet
      open={open}
      onClose={onClose}
      width={560}
      title={opportunity ? 'Edit ask' : 'New opportunity'}
      leading={
        <button type="button" onClick={onClose} className="text-muted hover:text-ink">
          Cancel
        </button>
      }
      footer={
        needsContact ? undefined : (
          <div className="flex gap-2">
            {opportunity && onDelete ? (
              <Button variant="outline" onClick={() => onDelete(opportunity)}>
                Delete
              </Button>
            ) : null}
            <Button size="lg" className="grow" disabled={pending} onClick={() => void save()}>
              {pending ? 'Saving…' : opportunity ? 'Save changes' : 'Save the ask'}
            </Button>
          </div>
        )
      }
    >
      {needsContact ? (
        <ContactPicker onPick={setPicked} label="Who is the ask to?" />
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-[12.5px] text-muted">
            For <b className="text-ink">{targetName ?? 'this donor'}</b>
            {expectedValue !== null ? (
              <>
                {' '}
                · weighted <b className="tabular text-gold">{formatMoney(expectedValue)}</b>
              </>
            ) : null}
          </p>

          <FieldGroup title="THE ASK">
            <Field label="What are we asking for" required className="sm:col-span-2">
              <TextInput
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Kollel wing naming"
              />
            </Field>
            <Field label="Ask amount" required>
              <TextInput
                inputMode="decimal"
                value={ask}
                onChange={(event) => setAsk(event.target.value)}
                placeholder="40000"
              />
            </Field>
            <Field label="Probability %">
              <TextInput
                inputMode="numeric"
                value={probability}
                onChange={(event) => setProbability(event.target.value)}
                placeholder="40"
              />
            </Field>
            <Field
              label="Expected (weighted)"
              hint={expectedTouched ? 'Your figure — not recomputed.' : 'Defaults to ask × probability.'}
            >
              <TextInput
                inputMode="decimal"
                value={expectedTouched ? expected : asText(autoExpected)}
                onChange={(event) => {
                  setExpectedTouched(true)
                  setExpected(event.target.value)
                }}
              />
            </Field>
            <Field label="Stage">
              <Select
                value={stage}
                onChange={(event) => setStage(event.target.value)}
                options={stages.map((option) => ({ value: option.value, label: option.label }))}
              />
            </Field>
          </FieldGroup>

          <FieldGroup title="DATES">
            <Field label="Expected decision">
              <TextInput
                type="date"
                value={decisionOn}
                onChange={(event) => setDecisionOn(event.target.value)}
              />
            </Field>
            <Field label="Ask made on" hint="When the number was actually put to them.">
              <TextInput type="date" value={askDate} onChange={(event) => setAskDate(event.target.value)} />
            </Field>
          </FieldGroup>

          <FieldGroup title="CODING">
            <Field label="Fund">
              <Select
                placeholder="—"
                value={fundId}
                onChange={(event) => setFundId(event.target.value)}
                options={funds.map((fund) => ({ value: fund.id, label: fund.name }))}
              />
            </Field>
            <Field label="Campaign">
              <Select
                placeholder="—"
                value={campaignId}
                onChange={(event) => setCampaignId(event.target.value)}
                options={campaigns.map((campaign) => ({ value: campaign.id, label: campaign.name }))}
              />
            </Field>
          </FieldGroup>

          <FieldGroup title="PROJECTIONS">
            <Field label="Best case" hint="The stretch number worth planning for.">
              <TextInput
                inputMode="decimal"
                value={high}
                onChange={(event) => setHigh(event.target.value)}
                placeholder="60000"
              />
            </Field>
            <Field label="Worst case">
              <TextInput
                inputMode="decimal"
                value={low}
                onChange={(event) => setLow(event.target.value)}
                placeholder="25000"
              />
            </Field>
          </FieldGroup>

          <FieldGroup title="WHY">
            <Field label="Motivation" className="sm:col-span-2">
              <TextArea
                rows={2}
                value={motivation}
                onChange={(event) => setMotivation(event.target.value)}
                placeholder="Learned here for six years; wants his father's name on the beis medrash."
              />
            </Field>
            <Field label="Restrictions" className="sm:col-span-2">
              <TextArea
                rows={2}
                value={restrictions}
                onChange={(event) => setRestrictions(event.target.value)}
                placeholder="Building only — not general funds."
              />
            </Field>
          </FieldGroup>

          {opportunity ? (
            <Field label="Status" hint="Won and lost are usually recorded by dragging to the footer.">
              <Select
                value={status}
                onChange={(event) => setStatus(event.target.value as OpportunityStatus)}
                options={STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] }))}
              />
            </Field>
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
