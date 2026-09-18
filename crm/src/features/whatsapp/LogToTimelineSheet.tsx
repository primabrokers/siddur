import { useEffect, useState } from 'react'
import { Button, Sheet, TextArea } from '../../components'
import { useLogWaToTimeline } from '../../lib/queries/wa'
import { ContactPicker } from '../tasks/ContactPicker'
import { displayName } from '../contacts/normalise'
import { timelinePrefill } from './core'
import type { ContactRow } from '../contacts/types'
import type { WaMessageRow } from './types'

export interface LogToTimelineSheetProps {
  open: boolean
  onClose: () => void
  /** The matched donor, when there is one; otherwise the sheet opens on the picker. */
  contact: ContactRow | null
  messages: WaMessageRow[]
  onLogged?: () => void
}

/**
 * "Log to timeline" (10 §2, I-5).
 *
 * The durable value of a WhatsApp thread is the *summary and the next action*,
 * not the transcript — so the box opens prefilled with the last few messages
 * and expects to be rewritten into a sentence a colleague can read in a year.
 * Nothing but the contact and the summary is required (I-5), and the row is
 * written as `kind: 'whatsapp'`, `source: 'manual'`: a person wrote this.
 */
export function LogToTimelineSheet({ open, onClose, contact, messages, onLogged }: LogToTimelineSheetProps) {
  const [picked, setPicked] = useState<ContactRow | null>(contact)
  const [summary, setSummary] = useState('')
  const log = useLogWaToTimeline()

  useEffect(() => {
    if (!open) return
    setPicked(contact)
    setSummary(timelinePrefill(messages))
  }, [open, contact, messages])

  const target = picked ?? contact
  const canSave = Boolean(target) && summary.trim() !== '' && !log.isPending

  const save = () => {
    if (!target || summary.trim() === '') return
    const last = messages[messages.length - 1]
    log.mutate(
      {
        contactId: target.id,
        summary: summary.trim(),
        occurredAt: last?.occurred_at ?? new Date().toISOString(),
      },
      {
        onSuccess: () => {
          onLogged?.()
          onClose()
        },
      },
    )
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Log to timeline"
      leading={
        <button type="button" onClick={onClose} className="text-[13px] text-muted">
          Cancel
        </button>
      }
      footer={
        <Button size="lg" className="w-full" onClick={save} disabled={!canSave}>
          {log.isPending ? 'Saving…' : 'Save to timeline'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-4 py-4">
        {target ? (
          <p className="text-[12.5px] text-muted">
            Logging against <strong className="text-ink">{displayName(target)}</strong>.
            {contact ? null : (
              <button
                type="button"
                className="ml-2 font-semibold text-accent"
                onClick={() => setPicked(null)}
              >
                Change
              </button>
            )}
          </p>
        ) : (
          // An interaction cannot exist without a person (I-2/I-5); the picker
          // is the first thing, not a validation error afterwards.
          <ContactPicker onPick={setPicked} label="Who was this with?" />
        )}

        <label className="flex flex-col gap-[6px]">
          <span className="text-[12px] font-semibold text-muted">What happened</span>
          <TextArea
            rows={6}
            value={summary}
            aria-label="Summary"
            placeholder="A sentence a colleague could read in a year."
            onChange={(event) => setSummary(event.target.value)}
          />
        </label>
        <p className="text-[11.5px] leading-[1.5] text-faint">
          Prefilled from the last few messages — rewrite it. The transcript stays in this pane; the timeline
          carries the meaning (10 §2).
        </p>

        {log.error ? (
          <p role="alert" className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
            {log.error.message}
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}
