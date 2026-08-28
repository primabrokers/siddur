/**
 * Journey row shapes (08 §4 / migration 005_journeys_and_ics).
 *
 * Annotated locally rather than inferred from `Database`, for the same reason
 * `features/auth/useTeamMember.ts` does it: the generated types are `any`
 * today and concrete tomorrow, and these call sites should compile either way.
 */

export interface JourneyTemplateRow {
  id: string
  key: string
  name: string
  description: string | null
  /** 08 §4 auto-exit: the goal was a gift, so a gift ends the sequence. */
  exit_on_gift: boolean
  is_active: boolean
}

export interface JourneyStepRow {
  id: string
  template_id: string
  step_no: number
  /** Days from `journey_enrollments.started_on`. */
  offset_days: number
  title: string
  action_type: string | null
  details: string | null
  /** ▸ NPSP engagement plans: wait for step n-1 to be done. */
  depends_on_previous: boolean
}

export type JourneyStatus = 'active' | 'completed' | 'exited'

export interface JourneyEnrollmentRow {
  id: string
  contact_id: string
  template_id: string
  started_on: string
  status: JourneyStatus
  exited_reason: string | null
  ended_at: string | null
  assigned_to: string | null
  created_by: string | null
}

/** `journey_tasks` — which task this enrolment's step produced. */
export interface JourneyTaskRow {
  id: string
  enrollment_id: string
  step_id: string
  task_id: string
}

/** Just enough of `tasks` to say whether a step is done and when it is due. */
export interface JourneyTaskState {
  id: string
  status: string
  due_on: string | null
  title: string
}

/** A template with its steps, ordered — what the picker and preview render. */
export interface JourneyTemplate extends JourneyTemplateRow {
  steps: JourneyStepRow[]
}

/** One enrolment joined to its template and the tasks its steps produced. */
export interface JourneyEnrollment {
  enrollment: JourneyEnrollmentRow
  template: JourneyTemplate
  /** Keyed by `journey_steps.id`. Absent = the step has not materialised yet. */
  tasksByStep: Record<string, JourneyTaskState>
}
