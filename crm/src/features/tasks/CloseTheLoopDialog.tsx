import { useEffect, useState } from 'react'
import { Button, Field, Select, Sheet, TextInput } from '../../components'
import { formatDate } from '../../lib/format'
import { useLookupOptions } from '../../lib/queries/contacts'
import type { FollowUpPlan } from './logic'
import type { TaskRecord } from './types'

export interface CloseTheLoopDialogProps {
  open: boolean
  contactName: string
  plan: FollowUpPlan
  /** Schedule the prefilled (possibly edited) follow-up. */
  onSchedule: (next: { title: string; action_type: string | null; due_on: string }) => void
  /** Activate the contact's first queued task on the given date. */
  onActivate: (task: TaskRecord, dueOn: string) => void
  /** Explicit decline — allowed; the contact goes yellow (I-3/I-4). */
  onDecline: () => void
  onClose: () => void
  pending?: boolean
}

const SOURCE_HINT: Record<FollowUpPlan['dueSource'], string> = {
  'queue-activation': 'Queued actions activate three days out (04 §3).',
  cadence: "From this contact's keep-in-touch cadence.",
  'kit-due': 'From the keep-in-touch date in contact_stats.',
  default: 'Default: one week from today.',
}

/**
 * I-4 — never complete into a void. The completion already happened; this is
 * the same interaction's second half: schedule the follow-up, activate the next
 * queued action, or decline explicitly. There is no way to skip the question,
 * only to answer "no".
 */
export function CloseTheLoopDialog({
  open,
  contactName,
  plan,
  onSchedule,
  onActivate,
  onDecline,
  onClose,
  pending = false,
}: CloseTheLoopDialogProps) {
  const actionTypes = useLookupOptions('action_type')
  const [title, setTitle] = useState(plan.title)
  const [actionType, setActionType] = useState(plan.actionType ?? '')
  const [dueOn, setDueOn] = useState(plan.dueOn)
  /** Queued mode can be swapped for a hand-written action. */
  const [override, setOverride] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(plan.title)
    setActionType(plan.actionType ?? '')
    setDueOn(plan.dueOn)
    setOverride(false)
  }, [open, plan.title, plan.actionType, plan.dueOn])

  const queuedMode = plan.mode === 'queued' && plan.queuedTask && !override

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Done ✓"
      leading={
        <button type="button" onClick={onDecline} className="text-muted hover:text-ink">
          Not now
        </button>
      }
      footer={
        <div className="flex flex-col gap-2" data-testid="close-the-loop-actions">
          <Button
            size="lg"
            className="w-full"
            disabled={pending}
            onClick={() => {
              if (queuedMode && plan.queuedTask) {
                onActivate(plan.queuedTask, dueOn)
                return
              }
              onSchedule({
                title: title.trim() === '' ? plan.title : title.trim(),
                action_type: actionType === '' ? null : actionType,
                due_on: dueOn,
              })
            }}
          >
            {queuedMode ? 'Activate it' : 'Schedule'}
          </Button>
          <Button variant="ghost" size="md" className="w-full" disabled={pending} onClick={onDecline}>
            No next action
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <h3 className="text-[15px] font-bold">What&rsquo;s next for {contactName}?</h3>

        {queuedMode && plan.queuedTask ? (
          <div className="flex flex-col gap-3">
            <p className="rounded-card border border-accent bg-accent-soft px-[14px] py-3 text-[13px] text-accent-dark">
              Activate next queued: <b>{plan.queuedTask.title}</b>
            </p>
            <Field label="Due" hint={SOURCE_HINT[plan.dueSource]}>
              <TextInput type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
            </Field>
            <button
              type="button"
              onClick={() => setOverride(true)}
              className="self-start text-[12.5px] font-semibold text-accent hover:text-accent-dark"
            >
              Choose a different action instead
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="Next action">
              <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Action type">
                <Select
                  placeholder="—"
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value)}
                  options={(actionTypes.data ?? []).map((o) => ({ value: o.value, label: o.label }))}
                />
              </Field>
              <Field label="Due" hint={SOURCE_HINT[plan.dueSource]}>
                <TextInput type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
              </Field>
            </div>
            <p className="text-[12px] text-faint">
              {formatDate(dueOn)} · declining is allowed — {contactName} then shows in the yellow
              &ldquo;needs a next action&rdquo; section.
            </p>
          </div>
        )}
      </div>
    </Sheet>
  )
}
