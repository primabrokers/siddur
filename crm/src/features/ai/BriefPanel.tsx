import { useState } from 'react'
import { Button, SectionLabel } from '../../components'
import { cn } from '../../lib/cn'
import {
  AI_NOTICE,
  useAiFeature,
  useBriefReview,
  useDonorBrief,
  useRegenerateBrief,
  useResolveAiActivity,
  type AiCallError,
} from '../../lib/queries/ai'
import { AiLabel, WhyLine } from './AiLabel'
import { BRIEF_BULLET_ORDER, nextLabel, type AiLabelState, type BriefResponse } from './core'

export interface BriefPanelProps {
  contactId: string
  contactName: string
  /** How many timeline entries the brief could have seen — shown in "why". */
  timelineCount?: number
}

/**
 * "Brief me" on the profile (04 §5.8 / 09 §3).
 *
 * The 09 §1 contract, walked end to end:
 * - **Nothing runs until asked.** The button is the trigger; a brief costs
 *   money and a page view is not a request.
 * - **The output is a preview, not a write.** The card is rendered, labelled
 *   and refusable. The only thing the run touches is the holding line (which
 *   is itself labelled until accepted) and the cache.
 * - **Every verdict is logged.** Keep → `accepted`, Not useful → `rejected`,
 *   both onto the `pending` row the edge function opened (09 §1.5).
 * - **Regenerate exists** because a brief that reads wrong is a brief you
 *   should be able to throw away without leaving the page.
 * - **Unavailable is quiet.** No key, no connection, feature off: a one-line
 *   caption, and the timeline below is the answer, as it always was.
 */
export function BriefPanel({ contactId, contactName, timelineCount }: BriefPanelProps) {
  const featureOn = useAiFeature('daily_brief')
  const [asked, setAsked] = useState(false)
  /**
   * `null` = nobody has said anything *in this session*, so the ledger's answer
   * stands. Once a person acts here, their verdict wins — otherwise a
   * regenerate would be re-labelled "Reviewed" by a resolution that belongs to
   * the previous words.
   */
  const [label, setLabel] = useState<AiLabelState | null>(null)

  const brief = useDonorBrief({ contactId, enabled: asked && featureOn })
  const regenerate = useRegenerateBrief()
  const resolve = useResolveAiActivity()
  const review = useBriefReview(contactId)

  if (!featureOn) return null

  const data: BriefResponse | undefined = regenerate.data ?? brief.data
  const error = (regenerate.error ?? brief.error) as AiCallError | null
  const busy = brief.isFetching || regenerate.isPending

  // A brief already accepted in an earlier session opens as Reviewed; the state
  // machine takes over from there.
  const state: AiLabelState = label ?? (review.data?.reviewed ? 'reviewed' : 'ai')

  function verdict(event: 'accept' | 'reject') {
    setLabel(nextLabel(state, event))
    resolve.mutate({ aiActivityId: data?.ai_activity_id ?? null, event })
  }

  return (
    <section
      data-testid="brief-panel"
      className="flex flex-col gap-2 rounded-card border border-border bg-surface p-[14px]"
    >
      <div className="flex items-center justify-between gap-2">
        <SectionLabel as="h2">Brief</SectionLabel>
        {data ? <AiLabel state={state} /> : null}
      </div>

      {!asked && !data ? (
        <>
          <Button
            variant="accentOutline"
            size="sm"
            className="self-start"
            onClick={() => setAsked(true)}
            data-testid="brief-me"
          >
            <span aria-hidden="true">✦</span> Brief me
          </Button>
          <WhyLine>
            Five lines about {contactName} before you call — written from this record only, never from
            anything outside it.
          </WhyLine>
        </>
      ) : null}

      {busy && !data ? (
        <p className="py-2 text-[12.5px] text-muted" role="status">
          Reading the file…
        </p>
      ) : null}

      {error && !data ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="rounded-input bg-row px-[10px] py-2 text-[12.5px] text-muted">
            {AI_NOTICE[error.failure]}
          </p>
          <Button variant="ghost" size="sm" className="self-start" onClick={() => void brief.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}

      {data ? (
        <>
          {data.thin_file ? (
            <p className="rounded-input bg-[#FCF0E3] px-[10px] py-[6px] text-[12px] text-flag-today-ink">
              Thin file — the brief says what little is on record rather than filling the gaps.
            </p>
          ) : null}

          <ol
            data-testid="brief-bullets"
            className={cn(
              'flex flex-col gap-[10px] rounded-input px-[10px] py-[10px] text-[12.5px] leading-[1.5]',
              state === 'reviewed' ? 'bg-row' : 'bg-accent-soft',
            )}
          >
            {BRIEF_BULLET_ORDER.map((bullet) => (
              <li key={bullet.key} className="flex flex-col gap-[2px]">
                <span className="text-[11px] font-semibold tracking-[0.04em] text-accent-dark uppercase">
                  {bullet.label}
                </span>
                <span className="text-nav">{data.bullets[bullet.key]}</span>
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap items-center gap-2">
            {state === 'ai' ? (
              <>
                <Button size="sm" variant="accentOutline" onClick={() => verdict('accept')}>
                  Keep
                </Button>
                <Button size="sm" variant="ghost" onClick={() => verdict('reject')}>
                  Not useful
                </Button>
              </>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setLabel(nextLabel(state, 'regenerate'))
                regenerate.mutate({ contactId })
              }}
            >
              {busy ? 'Rewriting…' : 'Regenerate'}
            </Button>
          </div>

          <WhyLine>
            Built from this record alone
            {typeof timelineCount === 'number' ? ` — ${timelineCount} timeline entries` : ''} and the figures in
            the header, which were counted by the database, not the model. {data.cached ? 'Cached' : 'Written'}{' '}
            {new Date(data.generated_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
            {data.cached ? ' — a new interaction refreshes it.' : '.'}
          </WhyLine>
        </>
      ) : null}
    </section>
  )
}
