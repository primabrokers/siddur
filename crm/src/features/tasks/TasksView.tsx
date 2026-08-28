import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  Button,
  FilterChip,
  Pill,
  SectionLabel,
  Select,
  TextInput,
  useToast,
  useUndoToast,
} from '../../components'
import { formatDate } from '../../lib/format'
import { useLookupOptions } from '../../lib/queries/contacts'
import {
  useReorderQueued,
  useTaskBoard,
  useTeamMemberOptions,
  useUpdateTask,
} from '../../lib/queries/tasks'
import { useTeamMember } from '../auth/useTeamMember'
import { PageHeader } from '../shell/PageHeader'
import { displayName } from '../contacts/normalise'
import { TaskSheet } from './TaskSheet'
import { useTaskCompletion } from './completion'
import { filterBoard, originLabel, partitionTasks, sortQueued, type TaskScope } from './logic'
import { EMPTY_BOARD, type TaskBoard, type TaskRecord } from './types'

interface Group {
  id: string
  label: string
  tone: 'muted' | 'overdue' | 'today' | 'accent' | 'faint'
  tasks: TaskRecord[]
  /** Queued rows carry arrows instead of a date (04 §3). */
  queue?: boolean
}

/** Today · Overdue · Upcoming · Waiting · Queued · Done (04 §3). */
export function groupTasks(board: TaskBoard, now: Date = new Date()): Group[] {
  const parts = partitionTasks(board.tasks, now)
  const groups: Group[] = [
    { id: 'today', label: 'TODAY', tone: 'today', tasks: [...parts.due, ...parts.kit] },
    { id: 'overdue', label: 'OVERDUE', tone: 'overdue', tasks: parts.overdue },
    { id: 'upcoming', label: 'UPCOMING', tone: 'muted', tasks: parts.future },
    { id: 'waiting', label: 'WAITING', tone: 'muted', tasks: parts.waiting },
    { id: 'queued', label: 'QUEUED', tone: 'faint', tasks: sortQueued(parts.queued), queue: true },
    { id: 'done', label: 'DONE TODAY', tone: 'accent', tasks: board.doneToday },
  ]
  return groups.filter((group) => group.tasks.length > 0)
}

/**
 * The full task inventory (04 §3) — the Action Stream shows the edge of this
 * iceberg. Same board query, same optimistic writes, same close-the-loop on
 * every completion (I-4).
 */
export function TasksView() {
  const board = useTaskBoard()
  const member = useTeamMember()
  const team = useTeamMemberOptions()
  const actionTypes = useLookupOptions('action_type')
  const priorities = useLookupOptions('priority')
  const completion = useTaskCompletion()
  const update = useUpdateTask()
  const reorder = useReorderQueued()
  const withUndo = useUndoToast()
  const toast = useToast()

  const [scope, setScope] = useState<TaskScope>('everyone')
  const [actionType, setActionType] = useState('')
  const [origin, setOrigin] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [editing, setEditing] = useState<TaskRecord | null>(null)

  const memberId = member.data?.id ?? null
  const readOnly = member.data?.role === 'viewer'
  const raw = board.data ?? EMPTY_BOARD

  const data = useMemo(
    () =>
      filterBoard(raw, {
        memberId,
        scope,
        actionType: actionType === '' ? null : actionType,
        origin: origin === '' ? null : origin,
      }),
    [raw, memberId, scope, actionType, origin],
  )

  const groups = useMemo(() => groupTasks(data), [data])
  const actionLabels = useMemo(
    () => Object.fromEntries((actionTypes.data ?? []).map((o) => [o.value, o.label])),
    [actionTypes.data],
  )

  function patch(task: TaskRecord, next: Partial<TaskRecord>, message: string) {
    const before: Partial<TaskRecord> = Object.fromEntries(
      Object.keys(next).map((key) => [key, (task as unknown as Record<string, unknown>)[key]]),
    )
    void withUndo({
      message,
      perform: () => update.mutateAsync({ id: task.id, contactId: task.contact_id, patch: next }),
      undo: async () => {
        await update.mutateAsync({ id: task.id, contactId: task.contact_id, patch: before })
      },
    })
  }

  function move(group: Group, index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= group.tasks.length) return
    const a = group.tasks[index] as TaskRecord
    const b = group.tasks[target] as TaskRecord
    void reorder.mutateAsync([
      { id: a.id, queue_order: b.queue_order ?? target },
      { id: b.id, queue_order: a.queue_order ?? index },
    ])
  }

  const total = groups.reduce((sum, group) => sum + group.tasks.length, 0)

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle={
          <span>
            {total} task{total === 1 ? '' : 's'} · every one attached to a person (I-2) ·{' '}
            <Link to="/" className="font-semibold text-accent hover:text-accent-dark">
              back to Today
            </Link>
          </span>
        }
        actions={
          readOnly ? undefined : <Button onClick={() => setNewOpen(true)}>＋ New task</Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterChip active={scope === 'mine'} onClick={() => setScope('mine')}>
          Mine
        </FilterChip>
        <FilterChip active={scope === 'everyone'} onClick={() => setScope('everyone')}>
          Everyone
        </FilterChip>
        <div className="w-[180px]">
          <Select
            aria-label="Filter by action type"
            className="py-[6px] text-[12.5px]"
            placeholder="All action types"
            value={actionType}
            onChange={(e) => setActionType(e.target.value)}
            options={(actionTypes.data ?? []).map((o) => ({ value: o.value, label: o.label }))}
          />
        </div>
        <div className="w-[160px]">
          <Select
            aria-label="Filter by origin"
            className="py-[6px] text-[12.5px]"
            placeholder="Any origin"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            options={[
              { value: 'manual', label: 'Manual' },
              { value: 'auto', label: 'Automation' },
              { value: 'quick_capture_ai', label: 'AI capture' },
            ]}
          />
        </div>
      </div>

      {board.isLoading && !board.data ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[52px] animate-pulse rounded-card border border-border bg-surface" />
          ))}
        </div>
      ) : null}

      {!board.isLoading && groups.length === 0 ? (
        <p className="rounded-card border border-dashed border-border bg-surface px-4 py-10 text-center text-[13px] text-muted">
          No tasks match these filters. Clear them, or add the next action for someone.
        </p>
      ) : null}

      <div className="flex flex-col gap-5">
        {groups.map((group) => (
          <section key={group.id} className="flex flex-col gap-2">
            <SectionLabel tone={group.tone}>
              {group.label} · {group.tasks.length}
            </SectionLabel>

            <div className="overflow-x-auto rounded-card border border-border bg-surface">
              <table className="w-full min-w-[720px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11.5px] tracking-[0.05em] text-muted uppercase">
                    <th className="px-3 py-2 font-semibold">Task</th>
                    <th className="px-3 py-2 font-semibold">Contact</th>
                    <th className="px-3 py-2 font-semibold">Type</th>
                    <th className="px-3 py-2 font-semibold">{group.queue ? 'Order' : 'Due'}</th>
                    <th className="px-3 py-2 font-semibold">Priority</th>
                    <th className="px-3 py-2 font-semibold">Assigned</th>
                    <th className="px-3 py-2 font-semibold">Origin</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {group.tasks.map((task, index) => {
                    const contact = data.contacts[task.contact_id]
                    const badge = originLabel(task.origin)
                    return (
                      <tr key={task.id} className="border-b border-border last:border-b-0 align-middle">
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => setEditing(task)}
                            className="text-left font-semibold hover:text-accent-dark"
                          >
                            {task.title}
                          </button>
                          {task.status === 'waiting' && task.waiting_for ? (
                            <div className="text-[12px] text-flag-waiting">Waiting — {task.waiting_for}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            to={`/contacts/${task.contact_id}`}
                            className="text-accent-dark hover:underline"
                          >
                            {contact ? displayName(contact) : 'Contact'}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-muted">
                          {task.action_type ? (actionLabels[task.action_type] ?? task.action_type) : '—'}
                        </td>
                        <td className="px-3 py-2">
                          {group.queue ? (
                            <span className="flex items-center gap-1">
                              <span className="tabular text-muted">{index + 1}</span>
                              <button
                                type="button"
                                aria-label={`Move ${task.title} up`}
                                disabled={readOnly || index === 0}
                                onClick={() => move(group, index, -1)}
                                className="rounded px-1 text-muted hover:text-ink disabled:opacity-30"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                aria-label={`Move ${task.title} down`}
                                disabled={readOnly || index === group.tasks.length - 1}
                                onClick={() => move(group, index, 1)}
                                className="rounded px-1 text-muted hover:text-ink disabled:opacity-30"
                              >
                                ↓
                              </button>
                            </span>
                          ) : group.id === 'done' ? (
                            <span className="text-muted">{formatDate(task.completed_at)}</span>
                          ) : (
                            <TextInput
                              type="date"
                              aria-label={`Due date for ${task.title}`}
                              value={task.due_on ?? ''}
                              disabled={readOnly}
                              onChange={(e) => patch(task, { due_on: e.target.value }, 'Due date changed')}
                              className="w-[140px] px-2 py-1 text-[12.5px]"
                            />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            aria-label={`Priority for ${task.title}`}
                            value={task.priority}
                            disabled={readOnly}
                            onChange={(e) => patch(task, { priority: e.target.value }, 'Priority changed')}
                            className="w-[110px] px-2 py-1 text-[12.5px]"
                            options={
                              priorities.data && priorities.data.length > 0
                                ? priorities.data.map((o) => ({ value: o.value, label: o.label }))
                                : [
                                    { value: 'high', label: 'High' },
                                    { value: 'medium', label: 'Medium' },
                                    { value: 'low', label: 'Low' },
                                  ]
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            aria-label={`Assignee for ${task.title}`}
                            placeholder="Unassigned"
                            value={task.assigned_to ?? ''}
                            disabled={readOnly}
                            onChange={(e) =>
                              patch(
                                task,
                                { assigned_to: e.target.value === '' ? null : e.target.value },
                                'Assignee changed',
                              )
                            }
                            className="w-[150px] px-2 py-1 text-[12.5px]"
                            options={(team.data ?? []).map((m) => ({ value: m.id, label: m.full_name }))}
                          />
                        </td>
                        <td className="px-3 py-2">
                          {badge ? <Pill tone="accent">{badge}</Pill> : <span className="text-faint">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {group.id === 'done' || readOnly ? null : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                completion.complete(task, {
                                  contact: contact ?? null,
                                  stats: data.stats[task.contact_id] ?? null,
                                  queued: data.tasks.filter(
                                    (t) => t.status === 'queued' && t.contact_id === task.contact_id,
                                  ),
                                })
                              }
                            >
                              Done
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      <TaskSheet
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(title) => toast.push(`Task added: ${title}`, { tone: 'good' })}
      />
      <TaskSheet
        open={editing !== null}
        task={editing}
        contactId={editing?.contact_id}
        contactName={
          editing && data.contacts[editing.contact_id]
            ? displayName(data.contacts[editing.contact_id])
            : undefined
        }
        onClose={() => setEditing(null)}
        onCreated={() => toast.push('Task updated', { tone: 'good' })}
      />
    </>
  )
}
