import type { ReactNode } from 'react'
import { Button } from '../../components'
import { formatResolvedDate } from '../../lib/jewish-dates'
import type { CaptureSaved } from './captureState'

/**
 * Pane 3 — the close-the-loop state (04 §4): what was written, in the user's
 * terms, so the 30-second promise ends in visible proof rather than a spinner
 * that vanished. "Meeting scheduled" when the parse booked something ahead
 * instead of logging something past.
 */

export interface SavedPaneProps {
  saved: CaptureSaved
  onAddAnother: () => void
  onDone: () => void
  /** Label for the primary button: "Back to Today" from the shell, else "Done". */
  doneLabel: string
}

function Line({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-card bg-ground px-[14px] py-[10px] text-[13.5px] text-nav">
      <span aria-hidden="true" className="font-bold text-accent">
        ✓
      </span>
      <span className="min-w-0">{children}</span>
    </div>
  )
}

export function SavedPane({ saved, onAddAnother, onDone, doneLabel }: SavedPaneProps) {
  return (
    <div
      data-testid="capture-saved"
      className="flex flex-col items-center justify-center gap-[16px] px-2 py-6 text-center"
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft">
        <svg
          width="30"
          height="30"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#0E6E6B"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4.5 12.5 10 18 19.5 7" />
        </svg>
      </span>

      <h3 className="text-[18px] font-bold">
        {saved.queued
          ? 'Kept safe on this device'
          : saved.isScheduled
            ? `Meeting scheduled with ${saved.contactName}`
            : `Logged to ${saved.contactName}`}
      </h3>

      <div className="flex w-full flex-col gap-2 text-left">
        {saved.queued ? (
          <Line>Waiting to sync — it will file itself when you have signal</Line>
        ) : (
          <>
            <Line>
              {saved.isScheduled
                ? `${saved.kindLabel} in Upcoming — it appears in Meetings and the ICS feed`
                : `${saved.kindLabel} on the timeline`}
            </Line>
            {saved.taskTitle ? (
              <Line>
                Next: {saved.taskTitle}
                {saved.taskDueOn ? ` — ${formatResolvedDate(saved.taskDueOn)}` : ' — queued, no date yet'}
                {saved.dateLabel ? ` (${saved.dateLabel})` : ''}
              </Line>
            ) : (
              <Line>No next action — this one carries the yellow flag until it has one</Line>
            )}
            <Line>Keep-in-touch clock reset</Line>
            {saved.tagCount > 0 ? (
              <Line>
                {saved.tagCount} tag{saved.tagCount === 1 ? '' : 's'} added
              </Line>
            ) : null}
          </>
        )}
      </div>

      <div className="mt-2 flex gap-[10px]">
        <Button variant="outline" onClick={onAddAnother}>
          Add another
        </Button>
        <Button onClick={onDone}>{doneLabel}</Button>
      </div>
    </div>
  )
}
