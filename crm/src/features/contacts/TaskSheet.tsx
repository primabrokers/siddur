import { useState } from 'react'
import { Button, Field, Select, Sheet, TextInput } from '../../components'
import { toISODate } from '../../lib/dates'
import { useCreateTask, useLookupOptions } from '../../lib/queries/contacts'
import { addDays } from 'date-fns'

export interface TaskSheetProps {
  open: boolean
  onClose: () => void
  contactId: string
  contactName: string
  onCreated?: (title: string) => void
}

/**
 * Create the next action for this contact. `contact_id` is fixed — a task
 * cannot exist without a person (I-2) — so the sheet only asks for the four
 * fields the row needs.
 */
export function TaskSheet({ open, onClose, contactId, contactName, onCreated }: TaskSheetProps) {
  const actionTypes = useLookupOptions('action_type')
  const priorities = useLookupOptions('priority')
  const create = useCreateTask()

  const [title, setTitle] = useState('')
  const [actionType, setActionType] = useState('')
  const [dueOn, setDueOn] = useState(() => toISODate(addDays(new Date(), 7)))
  const [priority, setPriority] = useState('medium')
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setTitle('')
    setActionType('')
    setDueOn(toISODate(addDays(new Date(), 7)))
    setPriority('medium')
    setError(null)
  }

  async function save() {
    if (title.trim() === '') {
      setError('Give the task a title.')
      return
    }
    try {
      await create.mutateAsync({
        contact_id: contactId,
        title: title.trim(),
        action_type: actionType === '' ? null : actionType,
        due_on: dueOn === '' ? null : dueOn,
        priority,
      })
      onCreated?.(title.trim())
      reset()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the task.')
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New task"
      leading={
        <button type="button" onClick={onClose} className="text-muted hover:text-ink">
          Cancel
        </button>
      }
      footer={
        <Button size="lg" className="w-full" disabled={create.isPending} onClick={() => void save()}>
          {create.isPending ? 'Saving…' : 'Save task'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-muted">
          For <b className="text-ink">{contactName}</b> — every task belongs to a person (I-2).
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
          <Field label="Due">
            <TextInput type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          </Field>
        </div>

        <Field label="Priority">
          <Select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            options={
              priorities.data && priorities.data.length > 0
                ? priorities.data.map((o) => ({ value: o.value, label: o.label }))
                : [
                    { value: 'high', label: 'High' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'low', label: 'Low' },
                  ]
            }
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
