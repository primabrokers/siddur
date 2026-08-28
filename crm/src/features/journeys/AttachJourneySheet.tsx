import { useMemo, useState } from 'react'
import { Button, Pill, Sheet } from '../../components'
import { cn } from '../../lib/cn'
import { formatDate } from '../../lib/format'
import { toISODate } from '../../lib/dates'
import { scheduleSteps } from './schedule'
import type { JourneyTemplate } from './types'

export interface AttachJourneySheetProps {
  open: boolean
  onClose: () => void
  contactName: string
  templates: JourneyTemplate[]
  loading?: boolean
  /** Templates already running on this contact — one live journey of a kind. */
  activeTemplateIds?: string[]
  onAttach: (template: JourneyTemplate) => void
  pending?: boolean
}

const actionWord = (value: string | null): string =>
  value ? value.replace(/_/g, ' ') : 'task'

/**
 * Attach a journey (08 §4).
 *
 * The whole point of this sheet is the second half: **"attaching a journey
 * shows its whole future task list on the profile"** — so it shows that list
 * *before* the commit, with real dates, not after. Nothing is written until
 * "Attach"; the write itself is reversible and lands under a 6-second undo
 * toast, so there is no confirm dialog here (I-12).
 */
export function AttachJourneySheet({
  open,
  onClose,
  contactName,
  templates,
  loading,
  activeTemplateIds = [],
  onAttach,
  pending,
}: AttachJourneySheetProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const running = new Set(activeTemplateIds)

  const selected = templates.find((template) => template.id === selectedId) ?? null
  const startedOn = toISODate(new Date())

  const preview = useMemo(
    () => (selected ? scheduleSteps(selected.steps, startedOn) : []),
    [selected, startedOn],
  )

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Attach a journey"
      width={520}
      footer={
        <div className="flex gap-2">
          <Button variant="outline" className="grow" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="grow"
            disabled={!selected || pending || running.has(selected.id)}
            onClick={() => selected && onAttach(selected)}
            data-testid="journey-attach-confirm"
          >
            {pending ? 'Attaching…' : 'Attach journey'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4" data-testid="journey-attach-sheet">
        <p className="text-[12.5px] leading-[1.5] text-muted">
          A journey is a sequence of <b>tasks</b> for you — nothing is ever sent to {contactName}{' '}
          automatically. Every step lands on your list on the day below; detaching cancels whatever
          is still to come.
        </p>

        {loading ? (
          <div className="h-[120px] animate-pulse rounded-card border border-border bg-surface" />
        ) : templates.length === 0 ? (
          <p className="text-[13px] text-muted">No journey templates are active.</p>
        ) : (
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Journey template">
            {templates.map((template) => {
              const active = template.id === selectedId
              const alreadyRunning = running.has(template.id)
              return (
                <button
                  key={template.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={alreadyRunning}
                  onClick={() => setSelectedId(template.id)}
                  className={cn(
                    'rounded-card border p-3 text-left transition-colors',
                    active ? 'border-accent bg-accent-soft' : 'border-border bg-surface',
                    alreadyRunning ? 'cursor-not-allowed opacity-55' : 'hover:border-accent',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-[13.5px] font-semibold text-ink">{template.name}</span>
                    <span className="text-[11.5px] text-faint">
                      {template.steps.length} step{template.steps.length === 1 ? '' : 's'}
                    </span>
                    {template.exit_on_gift ? <Pill>Ends on a gift</Pill> : null}
                    {alreadyRunning ? <Pill tone="accent">Already running</Pill> : null}
                  </span>
                  {template.description ? (
                    <span className="mt-1 block text-[12.5px] leading-[1.45] text-muted">
                      {template.description}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        )}

        {selected ? (
          <section className="flex flex-col gap-2" data-testid="journey-preview">
            <h3 className="text-[10.5px] font-semibold tracking-[0.08em] text-faint uppercase">
              What will be created
            </h3>
            <ol className="flex flex-col gap-[6px]">
              {preview.map((row) => (
                <li
                  key={row.step.id}
                  className="flex items-baseline gap-3 rounded-input bg-row px-[10px] py-2"
                >
                  <span className="w-[84px] shrink-0 text-[12px] font-semibold whitespace-nowrap text-nav tabular-nums">
                    {formatDate(row.dateISO)}
                  </span>
                  <span className="min-w-0 grow text-[13px] text-ink">
                    {row.step.title}
                    <span className="ml-2 text-[11.5px] text-faint">{actionWord(row.step.action_type)}</span>
                    {row.step.depends_on_previous ? (
                      <span className="ml-2 text-[11.5px] text-flag-waiting">
                        waits for step {row.step.step_no - 1}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-[11.5px] text-faint">
              {selected.exit_on_gift
                ? 'Dated from today. The journey ends by itself the moment a gift arrives.'
                : 'Dated from today. A step that waits for the one before it moves with it.'}
            </p>
          </section>
        ) : null}
      </div>
    </Sheet>
  )
}
