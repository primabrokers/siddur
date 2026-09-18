import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '../../components'
import { ConfirmDialog } from '../giving/ConfirmDialog'
import { useUndoBatch, useUndoPlan } from '../../lib/queries/import'
import { describeUndo, undoAvailable } from './plan'
import type { CommitResult } from '../../lib/queries/import'

export interface DoneStepProps {
  result: CommitResult
  /** Undo deletes records; the database only lets an admin do that (11 §1). */
  canUndo: boolean
  onStartAnother: () => void
}

/**
 * Step 6 — done, with the undo (06 §5, 11 §7).
 *
 * The batch id is the whole safety net: everything the run wrote carries it,
 * so "undo the import" is a real, complete operation rather than an hour of
 * hunting. What it will actually remove is computed *before* the button is
 * pressed and shown in the confirm dialog — including what it will refuse to
 * remove, because a contact somebody has already logged a call against has
 * stopped being an import artefact.
 */
export function DoneStep({ result, canUndo, onStartAnother }: DoneStepProps) {
  const navigate = useNavigate()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [undone, setUndone] = useState<string | null>(null)

  const plan = useUndoPlan(confirmOpen ? result.batch.id : null)
  const undo = useUndoBatch()
  const available = undoAvailable(result.batch) && undone === null

  return (
    <div className="flex flex-col gap-4" data-testid="import-done">
      <div className="rounded-card border border-good bg-good-bg p-5">
        <p className="text-[19px] leading-[1.3] font-bold text-good">
          {result.contactsCreated.toLocaleString('en-GB')}{' '}
          {result.contactsCreated === 1 ? 'contact' : 'contacts'} imported
          {result.contactsFilled > 0 ? `, ${result.contactsFilled} filled in` : ''}
          {result.giftsCreated > 0
            ? `, ${result.giftsCreated.toLocaleString('en-GB')} ${result.giftsCreated === 1 ? 'gift' : 'gifts'}`
            : ''}
          .
        </p>
        <p className="mt-1 text-[12.5px] text-nav">
          Batch <code className="rounded bg-surface px-1 py-[1px]">{result.batch.id.slice(0, 8)}</code> ·{' '}
          {result.batch.filename}
        </p>
      </div>

      {result.problems.length > 0 ? (
        <div className="rounded-input bg-[#FCF0E3] px-3 py-2 text-[12.5px] text-flag-today-ink">
          <p className="font-semibold">Some rows did not make it:</p>
          <ul className="mt-1 flex list-disc flex-col gap-[2px] pl-4">
            {result.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {undone ? (
        <p className="rounded-input bg-row px-3 py-2 text-[12.5px] text-nav" data-testid="import-undone">
          {undone}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => navigate('/contacts')}>See the contacts</Button>
        <Button variant="outline" onClick={onStartAnother}>
          Import another file
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {!canUndo ? (
            <span className="text-[11.5px] text-faint">
              Undoing an import removes records — admin only (11 §1).
            </span>
          ) : null}
          <Button
            variant="danger"
            disabled={!canUndo || !available}
            onClick={() => setConfirmOpen(true)}
            data-testid="import-undo"
          >
            Undo entire batch
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Undo this import?"
        confirmLabel="Undo the import"
        pending={undo.isPending}
        disabled={plan.isLoading}
        onConfirm={() => {
          undo.mutate(
            { batchId: result.batch.id },
            {
              onSuccess: (outcome) => {
                setConfirmOpen(false)
                setUndone(
                  `Undone — ${outcome.contactsDeleted} contacts and ${outcome.giftsDeleted} gifts removed` +
                    (outcome.kept > 0 ? `, ${outcome.kept} kept because they have been used since.` : '.'),
                )
              },
            },
          )
        }}
      >
        {plan.isLoading ? (
          <p>Working out what can still be removed…</p>
        ) : plan.data ? (
          <>
            <p>{describeUndo(plan.data)}</p>
            {plan.data.kept.length > 0 ? (
              <ul className="flex list-disc flex-col gap-[2px] pl-4 text-[12.5px] text-muted">
                {[...new Set(plan.data.kept.map((k) => k.reason))].map((reason) => (
                  <li key={reason}>
                    {plan.data.kept.filter((k) => k.reason === reason).length} × {reason}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-[12.5px] text-muted">
              This is a bulk delete, so it confirms rather than offering an undo toast (I-12). It cannot
              itself be undone.
            </p>
          </>
        ) : (
          <p>Could not read the batch back. Try again in a moment.</p>
        )}
      </ConfirmDialog>
    </div>
  )
}
