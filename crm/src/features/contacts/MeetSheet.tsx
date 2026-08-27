import { useState } from 'react'
import { addDays, format } from 'date-fns'
import { Button, Field, Sheet, TextInput } from '../../components'
import { useScheduleMeeting } from '../../lib/queries/contacts'

export interface MeetSheetProps {
  open: boolean
  onClose: () => void
  contactId: string
  contactName: string
  onCreated?: () => void
}

const defaultWhen = () => format(addDays(new Date(), 7), "yyyy-MM-dd'T'10:00")

/**
 * Schedule a meeting: a future interaction with `status='scheduled'`, which is
 * exactly what "an upcoming meeting" means in the model (02 §3.2).
 */
export function MeetSheet({ open, onClose, contactId, contactName, onCreated }: MeetSheetProps) {
  const schedule = useScheduleMeeting()
  const [when, setWhen] = useState(defaultWhen)
  const [purpose, setPurpose] = useState('')
  const [location, setLocation] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const at = new Date(when)
    if (Number.isNaN(at.getTime())) {
      setError('Pick a date and time.')
      return
    }
    try {
      await schedule.mutateAsync({
        contact_id: contactId,
        occurred_at: at.toISOString(),
        summary: purpose.trim() === '' ? `Meeting with ${contactName}` : purpose.trim(),
        purpose: purpose.trim() === '' ? null : purpose.trim(),
        location: location.trim() === '' ? null : location.trim(),
      })
      setWhen(defaultWhen())
      setPurpose('')
      setLocation('')
      setError(null)
      onCreated?.()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not schedule the meeting.')
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Schedule a meeting"
      leading={
        <button type="button" onClick={onClose} className="text-muted hover:text-ink">
          Cancel
        </button>
      }
      footer={
        <Button size="lg" className="w-full" disabled={schedule.isPending} onClick={() => void save()}>
          {schedule.isPending ? 'Saving…' : 'Schedule'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-muted">
          With <b className="text-ink">{contactName}</b>. It appears under Upcoming until it happens.
        </p>
        <Field label="When" required>
          <TextInput
            autoFocus
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </Field>
        <Field label="Purpose">
          <TextInput
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Walk through the naming opportunities"
          />
        </Field>
        <Field label="Location">
          <TextInput
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="His office, Golders Green"
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
