import { useEffect, useState } from 'react'
import { Button, Sheet, TextArea, useToast } from '../../components'
import { formatMoney } from '../../lib/format'
import { mailtoHref, requestDraftText, requestSubject } from './logic'
import type { GaContactRow } from './types'

export interface RequestDraftSheetProps {
  open: boolean
  onClose: () => void
  contact: GaContactRow | null
  donorName: string
  recoverable: number
  charityName: string
  amountsHidden: boolean
}

/** Copy to clipboard with a graceful path for browsers that refuse it. */
async function copy(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the manual path below.
  }
  return false
}

/**
 * The declaration-request draft (05 §5 panel 2, 08 §2 `ga_declaration_chase`).
 *
 * **The app drafts, the human sends.** Anything that leaves the system is the
 * person's action (03 §5.2): the email opens in their client, the WhatsApp text
 * goes to their clipboard. Nothing is sent from here and nothing is logged as
 * sent, because nothing was.
 */
export function RequestDraftSheet({
  open,
  onClose,
  contact,
  donorName,
  recoverable,
  charityName,
  amountsHidden,
}: RequestDraftSheetProps) {
  const toast = useToast()
  const [body, setBody] = useState('')

  useEffect(() => {
    if (!open) return
    setBody(requestDraftText({ donorName, recoverable, charityName }))
  }, [open, donorName, recoverable, charityName])

  const subject = requestSubject(charityName)
  const href = mailtoHref(contact?.email, subject, body)
  const whatsapp = (contact?.whatsapp ?? contact?.phone ?? '').trim()

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Declaration request — ${donorName}`}
      width={560}
      leading={
        <button type="button" onClick={onClose} className="text-muted hover:text-ink">
          Close
        </button>
      }
      footer={
        <div className="flex flex-wrap gap-2">
          {href ? (
            <a
              href={href}
              className="inline-flex grow items-center justify-center rounded-input bg-accent px-[14px] py-2 text-[13px] font-semibold text-surface hover:bg-accent-dark"
            >
              Open in email
            </a>
          ) : (
            <span className="grow rounded-input bg-row px-[14px] py-2 text-center text-[12.5px] text-muted">
              No email address on file
            </span>
          )}
          <Button
            variant="outline"
            className="grow"
            onClick={() => {
              void copy(body).then((ok) =>
                toast.push(ok ? 'Draft copied — paste it into WhatsApp' : 'Select the text above and copy it', {
                  tone: ok ? 'good' : 'neutral',
                }),
              )
            }}
          >
            Copy for WhatsApp
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] text-muted">
          A declaration from {donorName} would recover{' '}
          <b className="text-gold">{amountsHidden ? '—' : formatMoney(recoverable)}</b> on gifts already made. Edit the
          words to sound like you — nothing sends until you send it.
        </p>

        <label className="flex flex-col gap-[6px]">
          <span className="text-[12px] font-semibold text-muted">Draft</span>
          <TextArea rows={12} value={body} onChange={(event) => setBody(event.target.value)} />
        </label>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
          <dt className="text-muted">Email</dt>
          <dd>{contact?.email ?? <span className="text-faint">none on file</span>}</dd>
          <dt className="text-muted">WhatsApp</dt>
          <dd>{whatsapp === '' ? <span className="text-faint">none on file</span> : whatsapp}</dd>
        </dl>
      </div>
    </Sheet>
  )
}
