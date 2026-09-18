/**
 * The task sheet now lives with the rest of the task surfaces
 * (`features/tasks/TaskSheet`) so the stream, the tasks view and the profile
 * share one sheet. Re-exported here to keep the profile's import stable.
 */
export { TaskSheet } from '../tasks/TaskSheet'
export type { TaskSheetProps } from '../tasks/TaskSheet'
