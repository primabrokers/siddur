import { useEffect, useMemo, useState } from 'react'
import { Button, Pill, Sheet } from '../../components'
import { cn } from '../../lib/cn'
import { useMergeContacts } from '../../lib/queries/dataquality'
import { useLookupOptions, useTeamMembers } from '../../lib/queries/contacts'
import { displayName } from '../contacts/normalise'
import type { ContactRow } from '../contacts/types'
import { ConfirmDialog } from '../giving/ConfirmDialog'
import {
  buildFieldRows,
  buildMergePlan,
  completeness,
  defaultWinner,
  describePlan,
  mergeRefusal,
  REFUSAL_MESSAGE,
  type MergeFieldRow,
} from './mergePlan'

export interface MergeToolProps {
  open: boolean
  onClose: () => void
  a: ContactRow | null
  b: ContactRow | null
  /** Called after a successful merge, with the surviving record's id. */
  onMerged?: (winnerId: string) => void
}

/**
 * The merge tool (06 §5) — side-by-side, desktop, admin, confirmed.
 *
 * Three things it insists on:
 *
 *   1. **A survivor is chosen, not assumed.** The default is the more complete
 *      record because that is usually right, but the swap is one click and the
 *      completeness score is shown so the choice is informed rather than
 *      magical.
 *   2. **Every differing field is a decision.** Conflicts are marked; gaps the
 *      other record can fill are pre-set to fill them.
 *   3. **The loser is never deleted.** It becomes a tombstone pointing at the
 *      survivor, so an old link, a printed report or someone's bookmark still
 *      lands on the right person.
 */
export function MergeTool({ open, onClose, a, b, onMerged }: MergeToolProps) {
  const [swapped, setSwapped] = useState(false)
  const [fields, setFields] = useState<MergeFieldRow[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const merge = useMergeContacts()
  const team = useTeamMembers()
  const stages = useLookupOptions('stage')
  const priorities = useLookupOptions('priority')

  /**
   * What the picker *shows*. The value written is always the stored one — a
   * merge is a decision about records, and asking someone to choose between
   * two UUIDs is asking them to guess.
   */
  const label = (field: keyof ContactRow, value: string): string => {
    if (value === '') return ''
    if (field === 'relationship_owner_id') {
      return team.data?.find((m) => m.id === value)?.full_name ?? 'Someone no longer on the team'
    }
    if (field === 'household_id') return 'A household'
    if (field === 'stage') return stages.data?.find((o) => o.value === value)?.label ?? value
    if (field === 'priority') return priorities.data?.find((o) => o.value === value)?.label ?? value
    return value
  }

  const refusal = a && b ? mergeRefusal(a, b) : null

  // Which side survives. Recomputed when the pair changes, not on every render,
  // so a manual swap survives a background refetch of the two records.
  const preferred = useMemo(() => (a && b ? defaultWinner(a, b) : null), [a, b])
  useEffect(() => {
    setSwapped(false)
  }, [a?.id, b?.id])

  const winner = !a || !b || !preferred ? null : swapped ? (preferred === a ? b : a) : preferred
  const loser = !a || !b || !winner ? null : winner === a ? b : a

  useEffect(() => {
    if (winner && loser) setFields(buildFieldRows(winner, loser))
  }, [winner, loser])

  const choose = (field: string, side: 'winner' | 'loser') => {
    setFields((current) => current.map((row) => (row.field === field ? { ...row, choice: side } : row)))
  }

  const plan = winner && loser ? buildMergePlan(winner, loser, fields) : null
  const conflicts = fields.filter((row) => row.conflict).length

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title="Merge duplicates"
        width={860}
        leading={
          <button type="button" onClick={onClose} className="text-muted hover:text-ink">
            Cancel
          </button>
        }
        footer={
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-muted">
              {conflicts === 0
                ? 'No field disagrees between the two.'
                : `${conflicts} ${conflicts === 1 ? 'field disagrees' : 'fields disagree'} — pick a side for each.`}
            </span>
            <Button
              className="ml-auto"
              variant="danger"
              disabled={!plan || Boolean(refusal) || merge.isPending}
              onClick={() => setConfirmOpen(true)}
              data-testid="merge-submit"
            >
              Merge records
            </Button>
          </div>
        }
      >
        {refusal ? (
          <p role="alert" className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
            {REFUSAL_MESSAGE[refusal]}
          </p>
        ) : !winner || !loser ? (
          <p className="text-[13px] text-muted">Pick two records to merge.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-card border border-accent bg-accent-soft p-3" data-testid="merge-winner">
                <div className="flex items-center gap-2">
                  <Pill variant="manual" tone="accentSolid">
                    Survives
                  </Pill>
                  <span className="text-[11.5px] text-muted tabular-nums">
                    {completeness(winner)} fields filled
                  </span>
                </div>
                <p className="mt-2 text-[15px] font-bold">{displayName(winner) || 'Unnamed contact'}</p>
                <p className="text-[12.5px] text-muted">
                  {[winner.email, winner.phone, winner.city].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>

              <div className="rounded-card border border-border bg-surface p-3" data-testid="merge-loser">
                <div className="flex items-center gap-2">
                  <Pill variant="computed" tone="today">
                    Becomes a tombstone
                  </Pill>
                  <span className="text-[11.5px] text-muted tabular-nums">
                    {completeness(loser)} fields filled
                  </span>
                </div>
                <p className="mt-2 text-[15px] font-bold">{displayName(loser) || 'Unnamed contact'}</p>
                <p className="text-[12.5px] text-muted">
                  {[loser.email, loser.phone, loser.city].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setSwapped((v) => !v)}>
                Swap which one survives
              </Button>
              <span className="text-[11.5px] text-faint">
                The survivor keeps its id, so every existing link keeps working.
              </span>
            </div>

            <div className="overflow-hidden rounded-card border border-border">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-row">
                    <th className="w-[150px] px-3 py-2 text-left font-semibold">Field</th>
                    <th className="px-3 py-2 text-left font-semibold">Survivor</th>
                    <th className="px-3 py-2 text-left font-semibold">Duplicate</th>
                  </tr>
                </thead>
                <tbody>
                  {fields
                    .filter((row) => row.winnerValue !== '' || row.loserValue !== '')
                    .map((row) => (
                      <tr key={String(row.field)} className="border-t border-border">
                        <td className="px-3 py-[7px] text-muted">
                          {row.label}
                          {row.conflict ? (
                            <span className="ml-1 text-flag-today-ink" title="The two records disagree">
                              ●
                            </span>
                          ) : null}
                        </td>
                        <ValueCell
                          value={label(row.field, row.winnerValue)}
                          selected={row.choice === 'winner'}
                          onSelect={() => choose(String(row.field), 'winner')}
                          disabled={row.winnerValue === ''}
                          label={`Keep the survivor's ${row.label.toLowerCase()}`}
                        />
                        <ValueCell
                          value={label(row.field, row.loserValue)}
                          selected={row.choice === 'loser'}
                          onSelect={() => choose(String(row.field), 'loser')}
                          disabled={row.loserValue === ''}
                          label={`Take ${row.label.toLowerCase()} from the duplicate`}
                        />
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <p className="text-[12px] leading-[1.5] text-muted">
              Everything hanging off the duplicate — conversations, gifts, pledges, recurring gifts, soft
              credits, Gift Aid declarations, opportunities, tasks, notes, documents, tags and nudges —
              moves to the survivor. A note recording the merge is added to the survivor's timeline (11 §4).
            </p>

            {merge.error ? (
              <p role="alert" className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
                {merge.error.message}
              </p>
            ) : null}
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Merge these two records?"
        confirmLabel="Merge"
        pending={merge.isPending}
        onConfirm={() => {
          if (!plan) return
          merge.mutate(plan, {
            onSuccess: () => {
              setConfirmOpen(false)
              onClose()
              onMerged?.(plan.winnerId)
            },
          })
        }}
      >
        {plan && winner && loser ? <p>{describePlan(plan, winner, loser)}</p> : null}
        <p className="text-[12.5px] text-muted">
          Merges always confirm (I-12). The duplicate is kept as a tombstone rather than deleted, so the
          history survives even though this cannot be reversed in one click.
        </p>
      </ConfirmDialog>
    </>
  )
}

function ValueCell({
  value,
  selected,
  onSelect,
  disabled,
  label,
}: {
  value: string
  selected: boolean
  onSelect: () => void
  disabled: boolean
  label: string
}) {
  return (
    <td className="px-2 py-[5px]">
      <button
        type="button"
        aria-pressed={selected}
        aria-label={label}
        disabled={disabled}
        onClick={onSelect}
        className={cn(
          'w-full rounded-input px-2 py-[5px] text-left transition-colors',
          selected ? 'bg-accent-soft font-semibold text-accent-dark' : 'text-nav hover:bg-row',
          disabled && 'cursor-default text-faint hover:bg-transparent',
        )}
      >
        {value === '' ? '—' : value}
      </button>
    </td>
  )
}
