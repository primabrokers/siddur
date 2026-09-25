import { useEffect, useRef, useState } from 'react'
import { Button, Sheet, TextArea, useToast } from '../../components'
import { cn } from '../../lib/cn'
import { AI_NOTICE, useDraftMessage, useResolveAiActivity, type AiCallError } from '../../lib/queries/ai'
import { AiLabel, WhyLine } from './AiLabel'
import {
  PURPOSE_LABEL,
  isExcluded,
  nextLabel,
  type AiLabelState,
  type DraftFact,
  type DraftPurpose,
} from './core'

export interface DraftSheetProps {
  open: boolean
  onClose: () => void
  contactId: string
  contactName: string
  purpose: DraftPurpose
  /** The gift being thanked for, when there is one. */
  giftId?: string | null
  contactEmail?: string | null
}

/** The grounding panel that renders *beside* every draft (09 §1.3). */
function FactsPanel({ facts }: { facts: DraftFact[] }) {
  return (
    <aside
      data-testid="draft-facts"
      className="flex w-full shrink-0 flex-col gap-[6px] rounded-card border border-border bg-ground p-3 lg:w-[240px]"
    >
      <span className="text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">Facts used</span>
      {facts.length === 0 ? (
        <p className="text-[12px] text-muted">Nothing — which is why there is no draft.</p>
      ) : (
        <dl className="flex flex-col gap-[6px] text-[12px] leading-[1.45]">
          {facts.map((fact) => (
            <div key={fact.label} className="flex flex-col">
              <dt className="text-faint">{fact.label}</dt>
              <dd className="text-nav">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <WhyLine className="mt-1">
        The draft may reference only these — they come from this record, nothing else was retrieved.
      </WhyLine>
    </aside>
  )
}

/**
 * The drafting surface (09 §4, autonomy level L1 — a human always sends).
 *
 * What this screen is careful about:
 * - **The facts sit next to the words.** Grounded generation is only a claim
 *   unless the reviewer can check it at a glance (09 §1.3), so the panel is a
 *   sibling of the text, not a disclosure behind a chevron.
 * - **Blank-page mode is a first-class outcome.** A bereavement or serious
 *   illness anywhere in the record returns no draft at all, and this sheet then
 *   opens an empty box with the reason (09 §1.6 ▸ Vanderbilt 2023). Nothing to
 *   accept, nothing to "just tweak and send".
 * - **Copy, never send.** The buttons put the text on the clipboard or into a
 *   mail client. This product does not send donor-facing messages (I-10).
 * - **Editing is the signal.** Copying an edited draft logs `edited`, copying an
 *   untouched one logs `accepted`, closing without either logs `rejected`
 *   (09 §1.5).
 */
export function DraftSheet({
  open,
  onClose,
  contactId,
  contactName,
  purpose,
  giftId,
  contactEmail,
}: DraftSheetProps) {
  const toast = useToast()
  const draftMutation = useDraftMessage()
  const resolve = useResolveAiActivity()

  const [text, setText] = useState('')
  const [label, setLabel] = useState<AiLabelState>('ai')
  /** The model's words, kept so "did a human change this?" is answerable. */
  const original = useRef('')
  const requested = useRef<string | null>(null)
  const settled = useRef(false)

  const { mutate } = draftMutation
  useEffect(() => {
    if (!open) {
      requested.current = null
      return
    }
    const signature = `${contactId}:${purpose}:${giftId ?? ''}`
    if (requested.current === signature) return
    requested.current = signature
    settled.current = false
    setLabel('ai')
    setText('')
    original.current = ''
    mutate(
      { contactId, purpose, giftId: giftId ?? null },
      {
        onSuccess: (result) => {
          if (isExcluded(result)) return
          setText(result.draft)
          original.current = result.draft
        },
      },
    )
  }, [open, contactId, purpose, giftId, mutate])

  const result = draftMutation.data
  const error = draftMutation.error as AiCallError | null
  const excluded = isExcluded(result) ? result : null
  const facts = result && !isExcluded(result) ? result.facts_used : []
  const activityId = result && !isExcluded(result) ? (result.ai_activity_id ?? null) : null

  function settle(event: 'accept' | 'edit' | 'reject') {
    if (settled.current || !activityId) return
    settled.current = true
    setLabel((current) => nextLabel(current, event))
    resolve.mutate({
      aiActivityId: activityId,
      event,
      ...(event === 'edit' ? { editedFields: ['draft'] } : {}),
    })
  }

  function take(): void {
    settle(text.trim() === original.current.trim() ? 'accept' : 'edit')
  }

  async function copy() {
    take()
    try {
      await navigator.clipboard.writeText(text)
      toast.push('Draft copied — read it before you send it', { tone: 'good' })
    } catch {
      toast.push('Could not reach the clipboard — select the text and copy it')
    }
  }

  function mailto() {
    take()
    const subject = `${PURPOSE_LABEL[purpose]} — ${contactName}`
    const href = `mailto:${contactEmail ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`
    window.location.href = href
  }

  function close() {
    // Opened, read, walked away: that is a rejection and it is worth knowing.
    if (!settled.current && activityId) settle('reject')
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      width={760}
      title={
        <span className="flex items-center gap-2">
          {PURPOSE_LABEL[purpose]} — {contactName}
          {result && !excluded ? <AiLabel state={label} /> : null}
        </span>
      }
      footer={
        excluded ? (
          <Button className="w-full" size="lg" variant="outline" onClick={close}>
            I’ll write this one
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button className="grow" size="lg" disabled={text.trim() === ''} onClick={() => void copy()}>
              Copy
            </Button>
            <Button
              size="lg"
              variant="outline"
              disabled={text.trim() === ''}
              onClick={mailto}
              title={contactEmail ? `Open a mail to ${contactEmail}` : 'No email on file — opens a blank mail'}
            >
              Email
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {draftMutation.isPending ? (
          <p role="status" className="py-6 text-center text-[13px] text-muted">
            Drafting…
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-input bg-row px-3 py-2 text-[12.5px] text-muted">
            {AI_NOTICE[error.failure]} Write it in the box below — the send is yours either way.
          </p>
        ) : null}

        {excluded ? (
          /* Blank-page mode (09 §1.6). No draft is generated, none is offered. */
          <div data-testid="draft-excluded" className="flex flex-col gap-3">
            <div className="rounded-card border border-flag-overdue bg-[#FBECEC] px-4 py-3">
              <p className="text-[13px] font-semibold text-flag-overdue">This one is written by hand.</p>
              <p className="mt-1 text-[12.5px] leading-[1.5] text-nav">{excluded.reason}</p>
            </div>
            <TextArea
              rows={10}
              aria-label="Write the message"
              placeholder={`Write to ${contactName} in your own words.`}
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="text-[13.5px] leading-[1.6]"
            />
            <WhyLine>
              Why you are seeing this: the record carries a marker for a bereavement or serious illness
              (<code>{excluded.marker}</code>). AI never drafts those messages here, whatever the setting.
            </WhyLine>
          </div>
        ) : null}

        {result && !excluded ? (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <div className="flex min-w-0 grow flex-col gap-2">
              <TextArea
                rows={12}
                aria-label="Draft message"
                value={text}
                onChange={(event) => setText(event.target.value)}
                className={cn(
                  'text-[13.5px] leading-[1.6]',
                  label === 'ai' ? 'border-accent bg-accent-soft/30' : '',
                )}
              />
              <WhyLine>
                A first draft, not a message. Read it, change what is wrong, then copy it — nothing here reaches
                the donor until you send it yourself.
              </WhyLine>
            </div>
            <FactsPanel facts={facts} />
          </div>
        ) : null}
      </div>
    </Sheet>
  )
}
