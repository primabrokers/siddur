import { useEffect, useState } from 'react'
import { addDays } from 'date-fns'
import { Button, Field, Select, Sheet, TextArea, TextInput } from '../../components'
import { toISODate } from '../../lib/dates'
import { useCreateTask, useUpdateTask } from '../../lib/queries/tasks'
import { useLookupOptions } from '../../lib/queries/contacts'
import { displayName } from '../contacts/normalise'
import type { ContactRow } from '../contacts/types'
import { ContactPicker } from './ContactPicker'
import type { TaskRecord } from './types'

export interface TaskSheetProps {
  open: boolean
  onClose: () => void
  /** Omit to open on the contact picker — a task cannot exist without one (I-2). */
  contactId?: string
  contactName?: string
  /** Pass a row to edit it instead of creating. */
  task?: TaskRecord | null
  /** Prefill for a created row (action type / title / date / origin). */
  initial?: {
    title?: string
    action_type?: string | null
    due_on?: string | null
    priority?: string
    origin?: string
  }
  onCreated?: (title: string) => void
}

const PRIORITY_FALLBACK = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

/**
 * Create or edit one next action. Shared by the Action Stream, the Tasks view
 * and the donor profile — the profile's `features/contacts/TaskSheet` re-exports
 * this component so there is one sheet, not two.
 */
export function TaskSheet({ open, onClose, contactId, contactName, task, initial, onCreated }: TaskSheetProps) {
  const actionTypes = useLookupOptions('action_type')
  const priorities = useLookupOptions('priority')
  const create = useCreateTask()
  const update = useUpdateTask()

  const [picked, setPicked] = useState<ContactRow | null>(null)
  const [title, setTitle] = useState('')
  const [actionType, setActionType] = useState('')
  const [dueOn, setDueOn] = useState(() => toISODate(addDays(new Date(), 7)))
  const [priority, setPriority] = useState('medium')
  const [details, setDetails] = useState('')
  const [queueIt, setQueueIt] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const targetId = task?.contact_id ?? contactId ?? picked?.id ?? null
  const targetName = contactName ?? (picked ? displayName(picked) : null)

  // Re-seed each time the sheet opens so a stale draft never leaks between rows.
  useEffect(() => {
    if (!open) return
    setError(null)
    setPicked(null)
    if (task) {
      setTitle(task.title)
      setActionType(task.action_type ?? '')
      setDueOn(task.due_on ?? '')
      setPriority(task.priority)
      setDetails(task.details ?? '')
      setQueueIt(task.status === 'queued')
      return
    }
    setTitle(initial?.title ?? '')
    setActionType(initial?.action_type ?? '')
    setDueOn(initial?.due_on ?? toISODate(addDays(new Date(), 7)))
    setPriority(initial?.priority ?? 'medium')
    setDetails('')
    setQueueIt(false)
  }, [open, task, initial?.title, initial?.action_type, initial?.due_on, initial?.priority])

  async function save() {
    if (title.trim() === '') {
      setError('Give the task a title.')
      return
    }
    if (!targetId) {
      setError('Choose the person this task belongs to.')
      return
    }
    if (!queueIt && dueOn === '') {
      setError('Give it a date, or add it to the queue instead.')
      return
    }

    try {
      if (task) {
        await update.mutateAsync({
          id: task.id,
          contactId: task.contact_id,
          patch: {
            title: title.trim(),
            action_type: actionType === '' ? null : actionType,
            due_on: queueIt ? null : dueOn,
            priority,
            details: details.trim() === '' ? null : details.trim(),
            status: queueIt ? 'queued' : task.status === 'queued' ? 'todo' : task.status,
          },
        })
      } else {
        await create.mutateAsync({
          contact_id: targetId,
          title: title.trim(),
          action_type: actionType === '' ? null : actionType,
          due_on: queueIt ? null : dueOn,
          priority,
          details: details.trim() === '' ? null : details.trim(),
          status: queueIt ? 'queued' : 'todo',
          origin: initial?.origin ?? 'manual',
        })
      }
      onCreated?.(title.trim())
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the task.')
    }
  }

  const pending = create.isPending || update.isPending
  const needsContact = !targetId

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={task ? 'Edit task' : 'New task'}
      leading={
        <button type="button" onClick={onClose} className="text-muted hover:text-ink">
          Cancel
        </button>
      }
      footer={
        needsContact ? undefined : (
          <Button size="lg" className="w-full" disabled={pending} onClick={() => void save()}>
            {pending ? 'Saving…' : task ? 'Save changes' : 'Save task'}
          </Button>
        )
      }
    >
      {needsContact ? (
        <ContactPicker onPick={setPicked} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[12.5px] text-muted">
            For <b className="text-ink">{targetName ?? 'this contact'}</b> — every task belongs to a person (I-2).
          </p>

          <Field label="What needs doing" required>
            <TextInput
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Call about the building proposal"
            />
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
            <Field label="Due" hint={queueIt ? 'Queued tasks have no date until they activate.' : undefined}>
              <TextInput
                type="date"
                value={dueOn}
                disabled={queueIt}
                onChange={(e) => setDueOn(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Priority">
            <Select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              options={
                priorities.data && priorities.data.length > 0
                  ? priorities.data.map((o) => ({ value: o.value, label: o.label }))
                  : PRIORITY_FALLBACK
              }
            />
          </Field>

          <Field label="Details">
            <TextArea value={details} onChange={(e) => setDetails(e.target.value)} rows={2} />
          </Field>

          <label className="flex items-center gap-2 text-[12.5px] text-muted">
            <input
              type="checkbox"
              checked={queueIt}
              onChange={(e) => setQueueIt(e.target.checked)}
              className="h-[15px] w-[15px] accent-[#0E6E6B]"
            />
            Queue it instead — activates when the current next action completes
          </label>

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
