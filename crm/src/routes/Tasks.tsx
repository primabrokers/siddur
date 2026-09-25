import { TasksView } from '../features/tasks/TasksView'
import { TaskCompletionProvider } from '../features/tasks/completion'

/**
 * Tasks & follow-ups (04 §3) — the full inventory behind the Action Stream.
 * Reached from Today's header rather than the sidebar: it belongs to the daily
 * loop, not to the primary navigation (03 §1).
 */
export function TasksRoute() {
  return (
    <TaskCompletionProvider>
      <TasksView />
    </TaskCompletionProvider>
  )
}
