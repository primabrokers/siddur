import { Button, Pill } from '../../components'
import { cn } from '../../lib/cn'
import { displayName } from '../contacts/normalise'
import { describeReasons } from './dedupe'
import type { DedupeAction, NormalisedRow, ResolutionMap, RowDuplicate } from './types'

export interface DedupeStepProps {
  rows: NormalisedRow[]
  duplicates: RowDuplicate[]
  resolutions: ResolutionMap
  loading: boolean
  error: string | null
  onSet: (index: number, action: DedupeAction, targetId?: string | null) => void
  onSetAll: (action: DedupeAction) => void
}

const ACTION_LABEL: Record<DedupeAction, string> = {
  merge: 'Fill in the existing one',
  create: 'Create anyway',
  skip: 'Skip this row',
  review: 'Hold for review',
}

const ACTION_HINT: Record<DedupeAction, string> = {
  merge: 'Only blank fields on the existing record are filled — nothing is overwritten.',
  create: 'A second record is created. Use this when they really are two people.',
  skip: 'Nothing is written for this row.',
  review: 'Held back from this import; decide later in the duplicates queue.',
}

/**
 * Step 4 — the dedupe pass (06 §5).
 *
 * One card per flagged row, with the file's version on the left and what is
 * already on file on the right. The defaults do the obvious work (a shared
 * phone number fills the existing record; a repeat inside the file is skipped)
 * and park the genuinely ambiguous ones — two similar names — under "hold for
 * review", which is the spec's "3 duplicates held for review".
 *
 * Nothing here is destructive: the worst a wrong choice does is create a
 * duplicate the merge tool can join afterwards.
 */
export function DedupeStep({
  rows,
  duplicates,
  resolutions,
  loading,
  error,
  onSet,
  onSetAll,
}: DedupeStepProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2" data-testid="dedupe-loading">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[92px] animate-pulse rounded-card border border-border bg-surface" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <p role="alert" className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
        Could not check for duplicates ({error}). You can still import, but nothing will be matched
        against what is already on file.
      </p>
    )
  }

  if (duplicates.length === 0) {
    return (
      <div
        className="rounded-card border border-border bg-surface px-4 py-8 text-center"
        data-testid="dedupe-clean"
      >
        <p className="text-[15px] font-bold">Nothing looks like a duplicate</p>
        <p className="mt-1 text-[13px] text-muted">
          No row in this file shares an email, a phone number or a close name with anything already on
          file — or with another row in the sheet.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-surface p-3">
        <span className="text-[13px] font-semibold">
          {duplicates.length} {duplicates.length === 1 ? 'row needs' : 'rows need'} a decision
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-muted">All of them:</span>
          <Button size="sm" variant="outline" onClick={() => onSetAll('merge')}>
            Fill in existing
          </Button>
          <Button size="sm" variant="outline" onClick={() => onSetAll('create')}>
            Create anyway
          </Button>
          <Button size="sm" variant="outline" onClick={() => onSetAll('review')}>
            Hold all
          </Button>
        </div>
      </div>

      {duplicates.map((duplicate) => {
        const row = rows[duplicate.index]
        const resolution = resolutions[duplicate.index]
        const action = resolution?.action ?? 'review'
        const existing = duplicate.existing
        const twin = duplicate.withinFile !== null ? rows[duplicate.withinFile] : null

        return (
          <div
            key={duplicate.index}
            className="rounded-card border border-border bg-surface p-4"
            data-testid={`dedupe-row-${row.line}`}
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-bold">Row {row.line}</span>
              <Pill variant="computed" tone={action === 'review' ? 'today' : 'neutral'}>
                matched on {describeReasons(duplicate.reasons)}
              </Pill>
              {existing?.score ? (
                <span className="text-[11.5px] text-faint tabular-nums">
                  name similarity {existing.score.toFixed(2)}
                </span>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-input bg-ground p-3">
                <p className="mb-1 text-[11.5px] font-semibold tracking-[.04em] text-muted uppercase">
                  In the file
                </p>
                <p className="text-[13.5px] font-semibold">{row.displayName}</p>
                <p className="text-[12.5px] text-muted">
                  {[row.contact.email, row.contact.phone, row.contact.city].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>

              <div className="rounded-input bg-ground p-3">
                <p className="mb-1 text-[11.5px] font-semibold tracking-[.04em] text-muted uppercase">
                  {existing ? 'Already on file' : twin ? `Earlier in this file (row ${twin.line})` : 'No match'}
                </p>
                <p className="text-[13.5px] font-semibold">
                  {existing ? displayName(existing.contact) : (twin?.displayName ?? '—')}
                </p>
                <p className="text-[12.5px] text-muted">
                  {existing
                    ? [existing.contact.email, existing.contact.phone, existing.contact.city]
                        .filter(Boolean)
                        .join(' · ') || '—'
                    : [twin?.contact.email, twin?.contact.phone, twin?.contact.city]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(['merge', 'create', 'skip', 'review'] as DedupeAction[]).map((option) => {
                const disabled = option === 'merge' && !existing
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={disabled}
                    aria-pressed={action === option}
                    onClick={() => onSet(duplicate.index, option, existing?.contact.id ?? null)}
                    className={cn(
                      'rounded-pill px-[11px] py-[5px] text-[12px] transition-colors',
                      action === option
                        ? 'bg-accent-soft font-semibold text-accent-dark'
                        : 'border border-border text-muted hover:text-ink',
                      disabled && 'cursor-not-allowed opacity-45',
                    )}
                  >
                    {ACTION_LABEL[option]}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-[11.5px] text-faint">{ACTION_HINT[action]}</p>
          </div>
        )
      })}
    </div>
  )
}
