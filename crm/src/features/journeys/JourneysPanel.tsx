import { useState } from 'react'
import { Pill, SectionLabel, useToast, useUndoToast } from '../../components'
import { cn } from '../../lib/cn'
import { formatDate } from '../../lib/format'
import { isPastDay } from '../../lib/dates'
import {
  useAttachJourney,
  useContactJourneys,
  useDetachJourney,
  useJourneyTemplates,
  useRestoreJourney,
} from '../../lib/queries/journeys'
import { AttachJourneySheet } from './AttachJourneySheet'
import { journeyProgress, openJourneyTasks } from './schedule'
import type { JourneyEnrollment, JourneyTemplate } from './types'

export interface JourneysPanelProps {
  contactId: string
  contactName: string
  /** The signed-in member — stamped as `created_by` on the enrolment. */
  memberId?: string | null
  /** Viewers see the journeys and no buttons; Postgres enforces it either way. */
  readOnly?: boolean
}

function ActiveJourneyCard({
  entry,
  onDetach,
  readOnly,
}: {
  entry: JourneyEnrollment
  onDetach: () => void
  readOnly?: boolean
}) {
  const progress = journeyProgress(entry)
  const next = progress.next

  return (
    <article
      className="flex flex-col gap-[6px] rounded-input border border-border bg-surface p-[10px]"
      data-testid="journey-card"
    >
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 grow truncate text-[13px] font-semibold text-ink">
          {entry.template.name}
        </span>
        <span className="shrink-0 text-[11.5px] text-faint tabular-nums">
          Step {progress.current} of {progress.total}
        </span>
      </div>

      {next ? (
        <p className="text-[12.5px] leading-[1.45] text-nav">
          Next: {next.step.title}
          {' · '}
          <b
            className={cn(
              next.state === 'blocked'
                ? 'text-flag-waiting'
                : isPastDay(next.dateISO)
                  ? 'text-flag-overdue'
                  : 'text-ink',
            )}
          >
            {formatDate(next.dateISO)}
          </b>
          {next.state === 'blocked' ? (
            <span className="text-[11.5px] text-flag-waiting">
              {' '}
              — waits for step {next.step.step_no - 1}
            </span>
          ) : null}
        </p>
      ) : (
        <p className="text-[12.5px] text-muted">Every step is done; it closes on the next run.</p>
      )}

      <div className="flex items-center gap-2">
        <span className="text-[11.5px] text-faint">
          Started {formatDate(entry.enrollment.started_on)}
        </span>
        {entry.template.exit_on_gift ? <Pill>Ends on a gift</Pill> : null}
        {readOnly ? null : (
          <button
            type="button"
            onClick={onDetach}
            data-testid="journey-detach"
            className="ml-auto text-[12px] font-semibold text-muted hover:text-flag-overdue"
          >
            Detach
          </button>
        )}
      </div>
    </article>
  )
}

/**
 * The profile's Journeys panel (08 §4).
 *
 * Three things, in the order a fundraiser needs them: what is running on this
 * person, what happens next and when, and the way out. Attaching opens a sheet
 * that shows the entire future task list with dates before anything is
 * written; detaching takes no confirm dialog — it cancels the remaining steps
 * and offers 6 seconds of undo, like every other single-record change (I-12).
 */
export function JourneysPanel({ contactId, contactName, memberId, readOnly }: JourneysPanelProps) {
  const [attachOpen, setAttachOpen] = useState(false)
  const journeys = useContactJourneys(contactId)
  const templates = useJourneyTemplates()
  const attach = useAttachJourney()
  const detach = useDetachJourney()
  const restore = useRestoreJourney()
  const toast = useToast()
  const withUndo = useUndoToast()

  const active = journeys.data?.active ?? []
  const past = journeys.data?.past ?? []

  async function onAttach(template: JourneyTemplate) {
    setAttachOpen(false)
    try {
      await withUndo({
        message: `${template.name} attached`,
        tone: 'good',
        perform: () =>
          attach.mutateAsync({
            contactId,
            templateId: template.id,
            createdBy: memberId ?? null,
          }),
        // Undo detaches rather than deletes: DELETE is admin-only across this
        // schema (11 §1), so the reversal a fundraiser is allowed to make is
        // the cancelling one. Nothing stays visible — the enrolment leaves the
        // active list and its tasks are cancelled — but the row survives as
        // history, which is the honest record of what happened.
        undo: async (result) => {
          await detach.mutateAsync({
            contactId,
            enrollmentId: result.enrollmentId,
            reason: 'undone',
          })
        },
      })
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Could not attach the journey', {
        tone: 'overdue',
      })
    }
  }

  async function onDetach(entry: JourneyEnrollment) {
    const open = openJourneyTasks(entry).length
    try {
      await withUndo({
        message: `${entry.template.name} detached${
          open > 0 ? ` · ${open} task${open === 1 ? '' : 's'} cancelled` : ''
        }`,
        perform: () => detach.mutateAsync({ contactId, enrollmentId: entry.enrollment.id }),
        undo: (result) => restore.mutateAsync({ contactId, result }),
      })
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Could not detach the journey', {
        tone: 'overdue',
      })
    }
  }

  return (
    <section
      className="flex flex-col gap-2 rounded-card border border-border bg-surface p-[14px]"
      data-testid="journeys-panel"
    >
      <div className="flex items-center gap-2">
        <SectionLabel as="h2">Journeys</SectionLabel>
        {readOnly ? null : (
          <button
            type="button"
            onClick={() => setAttachOpen(true)}
            data-testid="journey-attach-open"
            className="ml-auto text-[12px] font-semibold text-accent hover:text-accent-dark"
          >
            Attach
          </button>
        )}
      </div>

      {journeys.isLoading ? (
        <div className="h-[64px] animate-pulse rounded-input bg-row" />
      ) : active.length === 0 ? (
        <p className="text-[12.5px] leading-[1.45] text-muted">
          No journey running. A journey is a ready-made task sequence — a welcome, a
          reactivation, a stewardship plan — dated from the day you attach it.
        </p>
      ) : (
        active.map((entry) => (
          <ActiveJourneyCard
            key={entry.enrollment.id}
            entry={entry}
            readOnly={readOnly}
            onDetach={() => void onDetach(entry)}
          />
        ))
      )}

      {past.length > 0 ? (
        <p className="text-[11.5px] text-faint">
          Previously:{' '}
          {past
            .map(
              (entry) =>
                `${entry.template.name} (${
                  entry.enrollment.status === 'completed'
                    ? 'completed'
                    : (entry.enrollment.exited_reason ?? 'exited')
                })`,
            )
            .join(' · ')}
        </p>
      ) : null}

      {journeys.error ? (
        <p className="text-[11.5px] text-flag-overdue">
          {journeys.error instanceof Error ? journeys.error.message : 'Journeys unavailable'}
        </p>
      ) : null}

      {readOnly ? null : (
        <AttachJourneySheet
          open={attachOpen}
          onClose={() => setAttachOpen(false)}
          contactName={contactName}
          templates={templates.data ?? []}
          loading={templates.isLoading}
          activeTemplateIds={active.map((entry) => entry.template.id)}
          pending={attach.isPending}
          onAttach={(template) => void onAttach(template)}
        />
      )}
    </section>
  )
}
