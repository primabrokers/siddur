import { Sheet } from '../../components'
import { useLinkWaConversation } from '../../lib/queries/wa'
import { ContactPicker } from '../tasks/ContactPicker'
import type { ContactRow } from '../contacts/types'

export interface LinkContactSheetProps {
  open: boolean
  onClose: () => void
  conversationId: string | null
  waId: string
}

/**
 * "Link to contact" — the human's correction when the number matched nobody.
 *
 * The automatic match (migration 012's BEFORE INSERT trigger) tries
 * `contacts.whatsapp` then `contacts.phone`, normalised. It misses whenever the
 * donor writes from a second number, so an unmatched thread is an ordinary
 * state with an ordinary remedy, and the link is stamped `matched_by =
 * 'manual'` so nobody later mistakes a person's judgement for the system's.
 */
export function LinkContactSheet({ open, onClose, conversationId, waId }: LinkContactSheetProps) {
  const link = useLinkWaConversation()

  const pick = (contact: ContactRow) => {
    if (!conversationId) return
    link.mutate({ conversationId, contactId: contact.id }, { onSuccess: onClose })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Link to contact"
      leading={
        <button type="button" onClick={onClose} className="text-[13px] text-muted">
          Cancel
        </button>
      }
    >
      <div className="flex flex-col gap-4 px-4 py-4">
        <p className="text-[12.5px] text-muted">
          <strong className="text-ink">{waId}</strong> did not match anyone automatically. Linking it files
          every message in this thread against that donor from now on.
        </p>
        <ContactPicker onPick={pick} label="Who is this?" />
        {link.error ? (
          <p role="alert" className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
            {link.error.message}
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}
