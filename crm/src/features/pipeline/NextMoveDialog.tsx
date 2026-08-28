import { useEffect, useState } from 'react'
import { addDays } from 'date-fns'
import { Button, Field, Select, Sheet, TextInput } from '../../components'
import { toISODate } from '../../lib/dates'
import { useLookupOptions } from '../../lib/queries/contacts'
import type { PipelineCard } from './logic'

export interface NextMoveDraft {
  title: string
  actionType: string | null
  dueOn: string
}

export interface NextMoveDialogProps {
  card: PipelineCard | null
  /** The stage it just advanced into — the prompt says so out loud. */
  stageLabel: string
  onClose: () => void
  onSave: (draft: NextMoveDraft) => void
  pending?: boolean
}

/**
 * "Stage-advance prompts for the next move if none open" (06 §2, I-3/I-4).
 *
 * Deliberately not `features/tasks`' `TaskSheet`: that sheet's `TaskDraft`
 * carries no `opportunity_id`, and widening a shape three other screens write
 * through — to serve a prompt that needs three fields — is the wrong trade.
 * The task it writes is an ordinary task; only the link is extra.
 *
 * Declining is allowed (the board surfaces the gap in yellow instead) — I-3
 * surfaces, it never enforces.
 */
export function NextMoveDialog({ card, stageLabel, onClose, onSave, pending }: NextMoveDialogProps) {
  const actionTypes = useLookupOptions('action_type')
  const [title, setTitle] = useState('')
  const [actionType, setActionType] = useState('')
  const [dueOn, setDueOn] = useState(() => toISODate(addDays(new Date(), 7)))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!card) return
    setTitle('')
    setActionType('')
    setDueOn(toISODate(addDays(new Date(), 7)))
    setError(null)
  }, [card])

  if (!card) return null

  function save() {
    if (title.trim() === '') {
      setError('Say what the next move is.')
      return
    }
    if (dueOn === '') {
      setError('Give it a date — a move without one is a wish.')
      return
    }
    onSave({ title: title.trim(), actionType: actionType === '' ? null : actionType, dueOn })
  }

  return (
    <Sheet
      open
      onClose={onClose}
      width={440}
      title={`Moved to ${stageLabel}`}
      leading={
        <button type="button" onClick={onClose} className="text-muted hover:text-ink">
          Not yet
        </button>
      }
      footer={
        <Button size="lg" className="w-full" disabled={pending} onClick={save}>
          {pending ? 'Saving…' : 'Save the next move'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] leading-[1.5] text-nav">
          <b>{card.donor}</b> has no open next move. What happens next on {card.opportunity.name}?
        </p>

        <Field label="Next move" required>
          <TextInput
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Call to walk through the proposal"
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Action type">
            <Select
              placeholder="—"
              value={actionType}
              onChange={(event) => setActionType(event.target.value)}
              options={(actionTypes.data ?? []).map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
          </Field>
          <Field label="Due">
            <TextInput type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
          </Field>
        </div>

        {error ? (
          <p role="alert" className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}
