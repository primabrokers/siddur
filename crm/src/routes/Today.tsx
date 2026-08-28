import { ActionStream } from '../features/stream/ActionStream'
import { TaskCompletionProvider } from '../features/tasks/completion'

/**
 * Today / Action Stream — spec 04 §1. The one screen the day is worked from.
 *
 * The completion provider wraps the screen because every "done" here runs
 * close-the-loop in the same interaction (I-4).
 */
export function TodayRoute() {
  return (
    <TaskCompletionProvider>
      <ActionStream />
    </TaskCompletionProvider>
  )
}
