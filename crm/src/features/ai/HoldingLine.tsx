import { useState } from 'react'
import { Button, TextArea } from '../../components'
import { cn } from '../../lib/cn'
import { formatDate } from '../../lib/format'
import {
  useAiFeature,
  useBriefReview,
  useResolveAiActivity,
  useSaveHoldingLine,
} from '../../lib/queries/ai'
import { AiLabel, WhyLine } from './AiLabel'
import { nextLabel, type AiLabelState } from './core'

export interface HoldingLineProps {
  contactId: string
  line: string | null | undefined
  at?: string | null
  /** Viewers cannot write `contacts`, so they read the line and cannot keep it. */
  readOnly?: boolean
}

/**
 * "Where we're holding" — the rolling one-liner under the header (04 §5.8
 * ▸ Gong's `Next_Steps`), rewritten by `donor-brief` after each capture.
 *
 * It renders **outlined, not filled** (I-7): the sentence is generated, so it
 * is not a control a human set, and the AI label sits beside it until somebody
 * says the words are right. Keeping it flips the label to "Reviewed" and writes
 * `accepted` to the ledger; editing writes the human's wording over the column
 * and logs `edited` — the correction is the signal (09 §1.5).
 *
 * There is no holding line until a brief has been run once. That is deliberate:
 * an empty outline under every header would be noise, and the line only means
 * something once there is something to hold.
 */
export function HoldingLine({ contactId, line, at, readOnly }: HoldingLineProps) {
  const featureOn = useAiFeature('daily_brief')
  const review = useBriefReview(contactId)
  const resolve = useResolveAiActivity()
  const save = useSaveHoldingLine()

  /** `null` until a person acts here; the ledger's verdict stands until then. */
  const [label, setLabel] = useState<AiLabelState | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (!featureOn) return null
  if (!line || line.trim() === '') return null

  const state: AiLabelState = label ?? (review.data?.reviewed ? 'reviewed' : 'ai')
  if (state === 'discarded') return null

  function keep() {
    setLabel(nextLabel(state, 'accept'))
    resolve.mutate({ aiActivityId: review.data?.id ?? null, event: 'accept' })
  }

  function commitEdit() {
    const next = draft.trim()
    setEditing(false)
    if (next === '' || next === line) {
      // Opened the editor and changed nothing: that is an accept, not an edit.
      keep()
      return
    }
    setLabel(nextLabel(state, 'edit'))
    resolve.mutate({ aiActivityId: review.data?.id ?? null, event: 'edit', editedFields: ['holding_line'] })
    save.mutate({ contactId, line: next, edited: true })
  }

  return (
    <div
      data-testid="holding-line"
      className={cn(
        'flex flex-col gap-[6px] rounded-card border px-[14px] py-[10px]',
        state === 'reviewed' ? 'border-border bg-surface' : 'border-accent bg-accent-soft/40',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
          Where we’re holding
        </span>
        <AiLabel state={state} />
        {at ? <span className="text-[11.5px] text-faint">rewritten {formatDate(at)}</span> : null}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <TextArea
            autoFocus
            rows={2}
            aria-label="Where we’re holding"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="text-[13px]"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={commitEdit}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-[13.5px] leading-[1.5] text-ink">{line}</p>
      )}

      {!editing && !readOnly && state === 'ai' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="accentOutline" onClick={keep}>
            Keep
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(line ?? '')
              setEditing(true)
            }}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setLabel(nextLabel(state, 'reject'))
              resolve.mutate({ aiActivityId: review.data?.id ?? null, event: 'reject' })
            }}
          >
            Dismiss
          </Button>
        </div>
      ) : null}

      {state === 'ai' ? (
        <WhyLine>
          Rewritten from the newest entries on this record after the last brief. Nothing here has been sent or
          shown to the donor.
        </WhyLine>
      ) : null}
    </div>
  )
}
