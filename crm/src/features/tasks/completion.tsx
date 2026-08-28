import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useToast, useUndoToast } from '../../components'
import { formatDate } from '../../lib/format'
import {
  useActivateQueued,
  useCompleteTask,
  useCreateTask,
  useQueuedTasks,
  useReopenTask,
} from '../../lib/queries/tasks'
import { CloseTheLoopDialog } from './CloseTheLoopDialog'
import { planFollowUp } from './logic'
import type { TaskContext, TaskRecord } from './types'

export interface TaskCompletionApi {
  /**
   * Complete a task and open the follow-up prompt in the same interaction
   * (I-4). Pass the contact/stats/queued rows the caller already holds so the
   * dialog opens without a round trip.
   */
  complete: (task: TaskRecord, context?: Partial<TaskContext>) => void
}

const CompletionContext = createContext<TaskCompletionApi | null>(null)

interface Pending {
  task: TaskRecord
  context: Partial<TaskContext>
  contactName: string
}

/**
 * Completing a next action, everywhere it can happen (stream row, tasks view,
 * focus mode):
 *
 * 1. the write goes out immediately with a 6-second undo toast (I-12);
 * 2. the close-the-loop dialog opens in the same interaction (I-4) — schedule,
 *    activate the next queued action, or decline explicitly.
 */
export function TaskCompletionProvider({ children }: { children: ReactNode }) {
  const withUndo = useUndoToast()
  const toast = useToast()
  const complete = useCompleteTask()
  const reopen = useReopenTask()
  const createTask = useCreateTask()
  const activateQueued = useActivateQueued()

  const [pending, setPending] = useState<Pending | null>(null)

  // Only fetched when the caller could not supply the stack.
  const needsQueued = Boolean(pending && pending.context.queued === undefined)
  const queuedQuery = useQueuedTasks(needsQueued ? (pending?.task.contact_id ?? null) : null)
  const queued = pending?.context.queued ?? queuedQuery.data ?? []

  const api = useMemo<TaskCompletionApi>(
    () => ({
      complete: (task, context = {}) => {
        const contactName = context.contact
          ? [context.contact.first_name, context.contact.last_name].filter(Boolean).join(' ')
          : 'this contact'
        setPending({ task, context, contactName })
        void withUndo({
          message: `Completed: ${task.title}`,
          tone: 'good',
          perform: () => complete.completeAsync(task),
          undo: async () => {
            setPending(null)
            await reopen(task)
          },
        })
      },
    }),
    [withUndo, complete, reopen],
  )

  const plan = useMemo(
    () =>
      pending
        ? planFollowUp({
            task: pending.task,
            contact: pending.context.contact ?? null,
            stats: pending.context.stats ?? null,
            queued,
          })
        : null,
    [pending, queued],
  )

  const close = useCallback(() => setPending(null), [])

  return (
    <CompletionContext.Provider value={api}>
      {children}
      {pending && plan ? (
        <CloseTheLoopDialog
          open
          contactName={pending.contactName}
          plan={plan}
          pending={createTask.isPending}
          onClose={close}
          onDecline={() => {
            toast.push(`No next action for ${pending.contactName} — they'll show in the yellow section.`)
            close()
          }}
          onActivate={(task, dueOn) => {
            void activateQueued(task, dueOn)
            toast.push(`Activated: ${task.title} · ${formatDate(dueOn)}`, { tone: 'good' })
            close()
          }}
          onSchedule={(next) => {
            void createTask.mutateAsync({
              contact_id: pending.task.contact_id,
              title: next.title,
              action_type: next.action_type,
              due_on: next.due_on,
              priority: pending.task.priority,
              origin: 'manual',
            })
            toast.push(`Next: ${next.title} · ${formatDate(next.due_on)}`, { tone: 'good' })
            close()
          }}
        />
      ) : null}
    </CompletionContext.Provider>
  )
}

export function useTaskCompletion(): TaskCompletionApi {
  const ctx = useContext(CompletionContext)
  if (!ctx) throw new Error('useTaskCompletion must be used inside <TaskCompletionProvider>')
  return ctx
}
