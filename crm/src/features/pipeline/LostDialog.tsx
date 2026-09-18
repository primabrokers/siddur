import { useEffect, useState } from 'react'
import { Button, Field, Select, Sheet, TextArea } from '../../components'
import { compactMoney, type PipelineCard } from './logic'
import type { LookupOption } from './types'

export interface LostDialogProps {
  card: PipelineCard | null
  /** `lookup_options('opportunity_lost_reason')` — seeded by migration 010. */
  reasons: LookupOption[]
  onClose: () => void
  onConfirm: (reason: string, note: string) => void
  pending?: boolean
}

/**
 * "Lost → reason (lookup) for the conversion report" (06 §2 · 07 §9.4).
 *
 * The reason is the point of the dialog: a loss with no reason is a hole in the
 * win/loss half of the conversion report (06 §3), so it is the one required
 * field. The note is optional and lands in the opportunity's notes, where the
 * next fundraiser to look at this donor will find it.
 */
export function LostDialog({ card, reasons, onClose, onConfirm, pending }: LostDialogProps) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!card) return
    setReason('')
    setNote('')
    setError(null)
  }, [card])

  if (!card) return null

  function confirm() {
    if (reason === '') {
      setError('Choose why it was lost — the conversion report is built from these.')
      return
    }
    onConfirm(reason, note.trim())
  }

  return (
    <Sheet
      open
      onClose={onClose}
      width={440}
      title="Record the loss"
      leading={
        <button type="button" onClick={onClose} className="text-muted hover:text-ink">
          Cancel
        </button>
      }
      footer={
        <Button size="lg" className="w-full" disabled={pending} onClick={confirm}>
          {pending ? 'Saving…' : 'Record it as lost'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] leading-[1.5] text-nav">
          <b>{card.donor}</b> — {card.opportunity.name}, {compactMoney(card.ask)}. The ask closes; the
          relationship does not.
        </p>

        <Field label="Why was it lost" required>
          <Select
            autoFocus
            placeholder="Choose a reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            options={reasons.map((option) => ({ value: option.value, label: option.label }))}
          />
        </Field>

        <Field label="Anything worth remembering" hint="Appended to the ask's notes.">
          <TextArea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Said to come back after the building is finished."
          />
        </Field>

        {error ? (
          <p role="alert" className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}
