/**
 * Typed data access for journeys (08 §4) and the ICS calendar feed (10 §4).
 *
 * Rules this file keeps:
 * - **Plain table writes only.** The journey engine (`run_journey_steps()`)
 *   and its helpers are revoked from `authenticated` in 005c, exactly as
 *   `run_nightly()` is: the client never calls an RPC. Attaching is an INSERT
 *   on `journey_enrollments`, and an AFTER INSERT trigger materialises
 *   whatever is already due inside the same transaction, so a Day-0 step
 *   appears at once without the browser deciding anything.
 * - **Detach cancels, never deletes** (08 §4 "deleting mid-way cancels
 *   remaining steps"). Delete is admin-only across this schema (11 §1) and the
 *   history is worth keeping anyway; the enrolment ends `exited`.
 * - No PostgREST embeds — templates, steps, enrolments and tasks are four
 *   small reads joined here, like every other query module.
 * - Every mutation is reversible and the 6-second undo toast lives at the call
 *   site (I-12 / CLAUDE.md rule 4), so each one returns what its undo needs.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { isConfigured, SUPABASE_URL } from '../env'
import { qk } from './keys'
import { jk } from './journeyKeys'
import { selectRows, unique } from './rest'
import { toISODate } from '../dates'
import { isOpenJourneyTask } from '../../features/journeys/schedule'
import type {
  JourneyEnrollment,
  JourneyEnrollmentRow,
  JourneyStepRow,
  JourneyTaskRow,
  JourneyTaskState,
  JourneyTemplate,
  JourneyTemplateRow,
} from '../../features/journeys/types'

interface Failed {
  message: string
}

/* ------------------------------------------------------------- templates */

/**
 * Active templates with their steps (08 §4). `is_active = false` retires a
 * template from the picker without touching the enrolments already running it.
 */
export function useJourneyTemplates(): UseQueryResult<JourneyTemplate[]> {
  return useQuery<JourneyTemplate[]>({
    queryKey: jk.journeys.templates(),
    enabled: isConfigured,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const templates = await selectRows<JourneyTemplateRow>('journey_templates', (q) =>
        q.eq('is_active', true).order('name', { ascending: true }),
      )
      if (templates.length === 0) return []

      const steps = await selectRows<JourneyStepRow>('journey_steps', (q) =>
        q.in('template_id', templates.map((row) => row.id)).order('step_no', { ascending: true }),
      )

      return templates.map((template) => ({
        ...template,
        steps: steps
          .filter((step) => step.template_id === template.id)
          .sort((a, b) => a.step_no - b.step_no),
      }))
    },
  })
}

/* ----------------------------------------------------- one contact's runs */

export interface ContactJourneys {
  /** Running now — at most one per template (the 005 partial unique index). */
  active: JourneyEnrollment[]
  /** Completed or exited, newest first — the profile's "has been through" line. */
  past: JourneyEnrollment[]
}

const EMPTY: ContactJourneys = { active: [], past: [] }

async function fetchContactJourneys(contactId: string): Promise<ContactJourneys> {
  const enrollments = await selectRows<JourneyEnrollmentRow>('journey_enrollments', (q) =>
    q.eq('contact_id', contactId).order('started_on', { ascending: false }),
  )
  if (enrollments.length === 0) return EMPTY

  const templateIds = unique(enrollments.map((row) => row.template_id))
  const [templates, links] = await Promise.all([
    selectRows<JourneyTemplateRow>('journey_templates', (q) => q.in('id', templateIds)),
    selectRows<JourneyTaskRow>('journey_tasks', (q) =>
      q.in('enrollment_id', enrollments.map((row) => row.id)),
    ),
  ])

  const steps =
    templateIds.length > 0
      ? await selectRows<JourneyStepRow>('journey_steps', (q) =>
          q.in('template_id', templateIds).order('step_no', { ascending: true }),
        )
      : []

  const taskIds = unique(links.map((link) => link.task_id))
  const tasks =
    taskIds.length > 0
      ? await selectRows<JourneyTaskState>('tasks', (q) => q.in('id', taskIds))
      : []
  const taskById = new Map(tasks.map((task) => [task.id, task]))

  const byTemplate = new Map(templates.map((row) => [row.id, row]))

  const entries: JourneyEnrollment[] = []
  for (const enrollment of enrollments) {
    const templateRow = byTemplate.get(enrollment.template_id)
    if (!templateRow) continue // a template deleted under a live enrolment: skip, never crash
    const template: JourneyTemplate = {
      ...templateRow,
      steps: steps.filter((step) => step.template_id === templateRow.id),
    }
    const tasksByStep: Record<string, JourneyTaskState> = {}
    for (const link of links) {
      if (link.enrollment_id !== enrollment.id) continue
      const task = taskById.get(link.task_id)
      if (task) tasksByStep[link.step_id] = task
    }
    entries.push({ enrollment, template, tasksByStep })
  }

  return {
    active: entries.filter((entry) => entry.enrollment.status === 'active'),
    past: entries.filter((entry) => entry.enrollment.status !== 'active'),
  }
}

export function useContactJourneys(contactId: string): UseQueryResult<ContactJourneys> {
  return useQuery<ContactJourneys>({
    queryKey: jk.journeys.forContact(contactId),
    enabled: isConfigured && contactId !== '',
    queryFn: () => fetchContactJourneys(contactId),
  })
}

/* ------------------------------------------------------------ mutations */

/** Everything an undo needs to put the world back exactly as it was. */
export interface AttachResult {
  enrollmentId: string
  /** The tasks the enrolment trigger created on the spot (Day-0 steps). */
  createdTaskIds: string[]
}

export interface AttachVariables {
  contactId: string
  templateId: string
  /** Defaults to today. The engine dates every step from this. */
  startedOn?: string
  /** Whose task list the steps land on; falls back to the relationship owner. */
  assignedTo?: string | null
  createdBy?: string | null
}

async function insertEnrollment(variables: AttachVariables): Promise<AttachResult> {
  const { data, error } = await supabase
    .from('journey_enrollments')
    .insert({
      contact_id: variables.contactId,
      template_id: variables.templateId,
      started_on: variables.startedOn ?? toISODate(new Date()),
      assigned_to: variables.assignedTo ?? null,
      created_by: variables.createdBy ?? null,
    })
    .select()
    .single()

  if (error) throw new Error((error as Failed).message)
  const enrollmentId = (data as unknown as JourneyEnrollmentRow).id

  // Whatever the trigger just materialised — read back rather than guessed, so
  // the undo cancels exactly the rows the database created.
  const links = await selectRows<JourneyTaskRow>('journey_tasks', (q) =>
    q.eq('enrollment_id', enrollmentId),
  )
  return { enrollmentId, createdTaskIds: links.map((link) => link.task_id) }
}

function useJourneySweep() {
  const client = useQueryClient()
  return (contactId: string) => {
    void client.invalidateQueries({ queryKey: jk.journeys.forContact(contactId) })
    // A journey writes tasks, so the stream, the tasks view and the profile's
    // derived numbers all move with it.
    void client.invalidateQueries({ queryKey: qk.tasks.all })
    void client.invalidateQueries({ queryKey: qk.contacts.all })
  }
}

/** Attach a journey (08 §4). The trigger creates any step already due. */
export function useAttachJourney() {
  const sweep = useJourneySweep()
  return useMutation<AttachResult, Error, AttachVariables>({
    mutationFn: insertEnrollment,
    onSettled: (_data, _error, variables) => sweep(variables.contactId),
  })
}

/** What a detach cancelled, so undo can restore each task to what it was. */
export interface DetachResult {
  enrollmentId: string
  restore: Array<{ id: string; status: string; due_on: string | null }>
}

export interface DetachVariables {
  contactId: string
  enrollmentId: string
  /** Stored on the enrolment; 'detached' unless a caller says otherwise. */
  reason?: string
}

async function cancelEnrollment(variables: DetachVariables): Promise<DetachResult> {
  const links = await selectRows<JourneyTaskRow>('journey_tasks', (q) =>
    q.eq('enrollment_id', variables.enrollmentId),
  )
  const taskIds = unique(links.map((link) => link.task_id))
  const tasks =
    taskIds.length > 0
      ? await selectRows<JourneyTaskState>('tasks', (q) => q.in('id', taskIds))
      : []

  // Only the still-open ones: a task already done or already cancelled is
  // history, and a detach must not rewrite history.
  const open = tasks.filter((task) => isOpenJourneyTask(task.status))
  const restore = open.map((task) => ({ id: task.id, status: task.status, due_on: task.due_on }))

  const dated = open.filter((task) => task.due_on !== null).map((task) => task.id)
  if (dated.length > 0) {
    const { error } = await supabase.from('tasks').update({ status: 'cancelled' }).in('id', dated)
    if (error) throw new Error((error as Failed).message)
  }

  // 001's check constraint: only a `queued` task may be dateless, so a dateless
  // one gets today's date on its way out — the same coalesce the SQL half of
  // this does in `cancel_journey_tasks()`.
  const dateless = open.filter((task) => task.due_on === null).map((task) => task.id)
  if (dateless.length > 0) {
    const { error } = await supabase
      .from('tasks')
      .update({ status: 'cancelled', due_on: toISODate(new Date()) })
      .in('id', dateless)
    if (error) throw new Error((error as Failed).message)
  }

  const { error: enrollmentError } = await supabase
    .from('journey_enrollments')
    .update({
      status: 'exited',
      exited_reason: variables.reason ?? 'detached',
      ended_at: new Date().toISOString(),
    })
    .eq('id', variables.enrollmentId)
  if (enrollmentError) throw new Error((enrollmentError as Failed).message)

  return { enrollmentId: variables.enrollmentId, restore }
}

/**
 * Detach: end the enrolment and cancel the steps still open (08 §4). No
 * confirm dialog — it is a single reversible record change, so it gets the
 * 6-second undo toast like everything else (I-12).
 */
export function useDetachJourney() {
  const sweep = useJourneySweep()
  return useMutation<DetachResult, Error, DetachVariables>({
    mutationFn: cancelEnrollment,
    onSettled: (_data, _error, variables) => sweep(variables.contactId),
  })
}

/** Undo a detach: reopen the enrolment and put its tasks back as they were. */
export function useRestoreJourney() {
  const sweep = useJourneySweep()
  return useMutation<void, Error, { contactId: string; result: DetachResult }>({
    mutationFn: async ({ result }) => {
      for (const task of result.restore) {
        const { error } = await supabase
          .from('tasks')
          .update({ status: task.status, due_on: task.due_on })
          .eq('id', task.id)
        if (error) throw new Error((error as Failed).message)
      }
      const { error } = await supabase
        .from('journey_enrollments')
        .update({ status: 'active', exited_reason: null, ended_at: null })
        .eq('id', result.enrollmentId)
      if (error) throw new Error((error as Failed).message)
    },
    onSettled: (_data, _error, variables) => sweep(variables.contactId),
  })
}

/* -------------------------------------------------- the ICS feed (10 §4) */

export interface CalendarFeed {
  token: string
  url: string
}

/** `…/functions/v1/ics-feed?token=<uuid>` — the whole integration (10 §4). */
export const icsFeedUrl = (token: string): string =>
  `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/ics-feed?token=${token}`

/**
 * The signed-in member's own feed. Scoped to their id on purpose: the token is
 * a bearer credential, and no screen in this app has a reason to show another
 * member's.
 */
export function useCalendarFeed(memberId: string | null): UseQueryResult<CalendarFeed | null> {
  return useQuery<CalendarFeed | null>({
    queryKey: jk.calendarFeed.token(memberId),
    enabled: isConfigured && Boolean(memberId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!memberId) return null
      const { data, error } = await supabase
        .from('team_members')
        .select('ics_token')
        .eq('id', memberId)
        .maybeSingle()
      if (error) throw new Error((error as Failed).message)
      const token = (data as unknown as { ics_token?: string } | null)?.ics_token
      return token ? { token, url: icsFeedUrl(token) } : null
    },
  })
}

/**
 * Regenerate the token. Irreversible from the subscriber's side — every
 * calendar already pointed at the old URL stops updating — so this is one of
 * the few places that earns a confirm dialog rather than an undo toast (I-12).
 */
export function useRegenerateIcsToken() {
  const client = useQueryClient()
  return useMutation<CalendarFeed, Error, { memberId: string }>({
    mutationFn: async ({ memberId }) => {
      const token = crypto.randomUUID()
      const { error } = await supabase
        .from('team_members')
        .update({ ics_token: token })
        .eq('id', memberId)
      if (error) throw new Error((error as Failed).message)
      return { token, url: icsFeedUrl(token) }
    },
    onSettled: (_data, _error, variables) => {
      void client.invalidateQueries({ queryKey: jk.calendarFeed.token(variables.memberId) })
    },
  })
}
