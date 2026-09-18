import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, TextInput, useToast } from '../../components'
import { qk } from '../../lib/queries/keys'
import { useCaptureTags } from '../../lib/queries/capture'
import { useLookupOptions, useTeamMembers } from '../../lib/queries/contacts'
import { downloadCsv } from '../giving/download'
import { ConfirmDialog } from '../giving/ConfirmDialog'
import type { ContactListRow } from '../contacts/types'
import {
  addTag,
  countPhrase,
  createTaskEach,
  describeBulk,
  selectionCsv,
  setOwner,
  setPriority,
  type BulkVerb,
} from './bulkActions'

export interface BulkActionSheetProps {
  /** The selected rows, in the order the list shows them. */
  rows: ContactListRow[]
  onClear: () => void
  /** Export is admin-only (11 §1). */
  isAdmin: boolean
}

const controlClass =
  'rounded-input border border-border bg-surface px-2 py-[6px] text-[12.5px] focus:border-accent focus:outline-none'

/**
 * The floating bulk sheet (03 §4 ▸ Attio, 06 §1).
 *
 * It exists only while a selection does, rises from the bottom of the list,
 * and carries the count first — because the count is the thing that makes a
 * bulk action feel safe or reckless.
 *
 * Every verb confirms before it runs (I-12: bulk is the exception to
 * undo-not-confirm). The toast afterwards reports what happened rather than
 * offering to reverse it, which would be a promise this cannot keep across
 * forty rows.
 */
export function BulkActionSheet({ rows, onClear, isAdmin }: BulkActionSheetProps) {
  const toast = useToast()
  const client = useQueryClient()
  const tags = useCaptureTags()
  const team = useTeamMembers()
  const priorities = useLookupOptions('priority')

  const [verb, setVerb] = useState<BulkVerb | null>(null)
  const [tagId, setTagId] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [priority, setPriorityValue] = useState('high')
  const [taskTitle, setTaskTitle] = useState('')
  const [pending, setPending] = useState(false)

  const ids = rows.map((row) => row.contact.id)
  const count = ids.length
  if (count === 0) return null

  const tagName = tags.data?.find((t) => t.id === tagId)?.name ?? ''
  const ownerName = team.data?.find((m) => m.id === ownerId)?.full_name ?? 'nobody'

  const detail =
    verb === 'tag'
      ? tagName
      : verb === 'owner'
        ? ownerName
        : verb === 'priority'
          ? priority
          : verb === 'task'
            ? taskTitle
            : ''

  const ready =
    verb === 'tag'
      ? tagId !== ''
      : verb === 'owner'
        ? true
        : verb === 'priority'
          ? priority !== ''
          : verb === 'task'
            ? taskTitle.trim() !== ''
            : true

  const run = async () => {
    if (!verb) return
    setPending(true)
    try {
      if (verb === 'export') {
        downloadCsv(`contacts-${new Date().toISOString().slice(0, 10)}.csv`, selectionCsv(rows))
        toast.push(`${countPhrase(count)} exported`, { tone: 'neutral' })
      } else {
        const outcome =
          verb === 'tag'
            ? await addTag(ids, tagId)
            : verb === 'owner'
              ? await setOwner(ids, ownerId || null)
              : verb === 'priority'
                ? await setPriority(ids, priority)
                : await createTaskEach(ids, {
                    title: taskTitle,
                    dueOn: null,
                    actionType: null,
                    assignedTo: null,
                  })
        toast.push(outcome.message, { tone: outcome.failed > 0 ? 'overdue' : 'good' })
        void client.invalidateQueries({ queryKey: qk.contacts.all })
        void client.invalidateQueries({ queryKey: qk.savedViews.all })
        if (verb === 'task') void client.invalidateQueries({ queryKey: qk.tasks.all })
      }
      setVerb(null)
      onClear()
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'That did not work', { tone: 'overdue' })
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <div
        className="sticky bottom-3 z-30 mt-3 flex flex-wrap items-center gap-2 rounded-card border border-border bg-surface px-4 py-3 shadow-[0_3px_16px_rgba(31,41,51,.16)]"
        data-testid="bulk-sheet"
        role="region"
        aria-label="Bulk actions"
      >
        <span className="text-[13.5px] font-bold">{countPhrase(count)} selected</span>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Tag to add"
            value={tagId}
            onChange={(e) => setTagId(e.target.value)}
            className={controlClass}
          >
            <option value="">Add tag…</option>
            {(tags.data ?? []).map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={tagId === ''} onClick={() => setVerb('tag')}>
            Add tag
          </Button>

          <select
            aria-label="Relationship owner"
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            className={controlClass}
          >
            <option value="">Unassigned</option>
            {(team.data ?? []).map((member) => (
              <option key={member.id} value={member.id}>
                {member.full_name}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={() => setVerb('owner')}>
            Set owner
          </Button>

          <select
            aria-label="Priority"
            value={priority}
            onChange={(e) => setPriorityValue(e.target.value)}
            className={controlClass}
          >
            {(priorities.data ?? [{ value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]).map(
              (option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ),
            )}
          </select>
          <Button size="sm" variant="outline" onClick={() => setVerb('priority')}>
            Set priority
          </Button>

          {/* Wrapped rather than sized inline: `TextInput` carries `w-full`,
              and two width utilities on one element is a coin toss. */}
          <div className="w-[180px]">
            <TextInput
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="Task for each…"
              aria-label="Task title for each contact"
              className="py-[6px] text-[12.5px]"
            />
          </div>
          <Button size="sm" variant="outline" disabled={taskTitle.trim() === ''} onClick={() => setVerb('task')}>
            Create task each
          </Button>

          {isAdmin ? (
            <Button size="sm" variant="outline" onClick={() => setVerb('export')}>
              Export CSV
            </Button>
          ) : null}
        </div>

        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
          Clear selection
        </Button>
      </div>

      <ConfirmDialog
        open={verb !== null}
        onClose={() => setVerb(null)}
        title={verb === 'export' ? 'Export this selection?' : `Change ${countPhrase(count)}?`}
        confirmLabel={verb === 'export' ? 'Download CSV' : 'Do it'}
        tone={verb === 'export' ? 'primary' : 'danger'}
        pending={pending}
        disabled={!ready}
        onConfirm={() => void run()}
      >
        <p>{verb ? describeBulk(verb, count, detail) : ''}</p>
        <p className="text-[12.5px] text-muted">
          {verb === 'export'
            ? 'The file contains only what this screen can already see — a restricted viewer exports no amounts (11 §2).'
            : 'Bulk changes confirm rather than offering an undo toast (I-12), because forty records is more than six seconds of regret.'}
        </p>
      </ConfirmDialog>
    </>
  )
}
