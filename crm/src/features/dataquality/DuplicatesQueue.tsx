import { useState } from 'react'
import { Button, EmptyState, Pill } from '../../components'
import { useDismissPair, useDuplicatePairs, useMarkPairMerged, type DuplicatePair } from '../../lib/queries/dataquality'
import { displayName } from '../contacts/normalise'
import { MergeTool } from './MergeTool'

export interface DuplicatesQueueProps {
  /** Merging is admin-only (11 §1); everyone else sees the queue read-only. */
  isAdmin: boolean
}

/**
 * The duplicates queue (06 §5) — the after-the-fact half of duplicate
 * handling, the create-time interstitial (02 §6) being the at-the-door half.
 *
 * Rows come from `duplicates_queue`, written by the nightly scan. On a
 * database whose nightly has not run the query layer falls back to scanning
 * what it can see in the browser, and the screen says so — a fallback that
 * pretends to be the real thing is how a queue silently goes stale.
 *
 * Two verbs only: open the pair in the merge tool, or dismiss it. Dismiss is
 * not "not a duplicate, ever" — the nightly re-inserts `on conflict do
 * nothing`, so a dismissed pair stays dismissed.
 */
export function DuplicatesQueue({ isAdmin }: DuplicatesQueueProps) {
  const { data, isLoading, error } = useDuplicatePairs('open')
  const dismiss = useDismissPair()
  const markMerged = useMarkPairMerged()
  const [pair, setPair] = useState<DuplicatePair | null>(null)

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[74px] animate-pulse rounded-card border border-border bg-surface" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <p role="alert" className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
        {error instanceof Error ? error.message : 'Could not read the duplicates queue.'}
      </p>
    )
  }

  const pairs = data?.pairs ?? []

  return (
    <>
      {data?.usedFallback ? (
        <p className="mb-3 rounded-input bg-[#FCF0E3] px-3 py-2 text-[12.5px] text-flag-today-ink">
          The nightly duplicate scan has not filed anything yet, so these pairs were found in the browser
          from the first 400 live contacts. The nightly run (08 §7) is the real queue.
        </p>
      ) : null}

      {data?.queueError ? (
        <p className="mb-3 rounded-input bg-[#FCF0E3] px-3 py-2 text-[12.5px] text-flag-today-ink">
          The filed queue is not readable from this account ({data.queueError}) — it is admin-only.
        </p>
      ) : null}

      {pairs.length === 0 ? (
        <EmptyState
          title="No duplicates waiting"
          hint="The nightly scan compares every live contact on email, phone and name similarity. An empty queue means the book is clean."
        />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="duplicates-list">
          {pairs.map((entry) => (
            <li
              key={entry.id ?? `${entry.a.id}-${entry.b.id}`}
              className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface px-4 py-3"
            >
              <div className="min-w-[180px] grow">
                <p className="text-[13.5px] font-semibold">
                  {displayName(entry.a) || 'Unnamed'} <span className="text-faint">↔</span>{' '}
                  {displayName(entry.b) || 'Unnamed'}
                </p>
                <p className="text-[12px] text-muted">
                  {[entry.a.email ?? entry.a.phone, entry.b.email ?? entry.b.phone]
                    .filter(Boolean)
                    .join(' · ') || 'no contact details on either'}
                </p>
              </div>

              <Pill variant="computed" tone={entry.reason === 'similar name' ? 'today' : 'neutral'}>
                {entry.reason}
                {entry.score !== null ? ` · ${entry.score.toFixed(2)}` : ''}
              </Pill>

              <div className="flex items-center gap-2">
                <Button size="sm" disabled={!isAdmin} onClick={() => setPair(entry)}>
                  Open pair
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!isAdmin || entry.id === null}
                  onClick={() => entry.id && dismiss.mutate({ id: entry.id })}
                >
                  Not a duplicate
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!isAdmin ? (
        <p className="mt-3 text-[11.5px] text-faint">
          Merging is admin-only, and the database enforces it (11 §1) — this screen only reflects that.
        </p>
      ) : null}

      <MergeTool
        open={pair !== null}
        onClose={() => setPair(null)}
        a={pair?.a ?? null}
        b={pair?.b ?? null}
        onMerged={() => {
          if (pair?.id) markMerged.mutate({ id: pair.id })
          setPair(null)
        }}
      />
    </>
  )
}
