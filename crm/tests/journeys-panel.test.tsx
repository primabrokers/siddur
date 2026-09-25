/**
 * M9b UI — the two surfaces, against the in-memory PostgREST stand-in.
 *
 * What these prove, in the language of 08 §4 and 10 §4:
 *   · attaching shows the *whole future task list with dates* before it writes;
 *   · the active card reads "step x of y" and names the next step and its day;
 *   · detaching cancels the steps still open, takes no confirm dialog, and
 *     offers 6 seconds of undo (I-12);
 *   · Settings hands the member their own tokenised feed URL and nobody
 *     else's, and regenerating it is the one thing here that does ask first.
 *
 * The engine itself is SQL and is not under test here (the live smoke test,
 * rolled back, covers it); what the fake stands in for is the *trigger*, so
 * these tests seed `journey_tasks` explicitly where a materialised step is
 * needed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../src/lib/supabase', async () => {
  const harness = await import('./support/harness')
  return { supabase: harness.supabase, isConfigured: true }
})
vi.mock('../src/lib/env', () => ({
  SUPABASE_URL: 'https://fake.supabase.co',
  SUPABASE_ANON_KEY: 'fake',
  isConfigured: true,
}))

const { IDS, MONDAY, seededMondayTables } = await import('./acceptance/fixtures')
const { freezeClock, flat, installWorld, renderApp, resetWorld, thawClock } = await import(
  './support/harness'
)

type Row = Record<string, unknown>

const TEMPLATE = 'tpl-welcome'
const LAPSED = 'tpl-lapsed'

/** The seeded Monday plus the five-template journey catalogue in miniature. */
function journeyWorld(extra: { enrollments?: Row[]; journeyTasks?: Row[]; tasks?: Row[] } = {}) {
  const tables = seededMondayTables()

  tables.journey_templates = [
    {
      id: TEMPLATE,
      key: 'new_donor_welcome',
      name: 'New donor welcome',
      description: 'The first ninety days after a first gift.',
      exit_on_gift: false,
      is_active: true,
    },
    {
      id: LAPSED,
      key: 'lapsed_reactivation',
      name: 'Lapsed reactivation',
      description: 'Reconnect without asking first.',
      exit_on_gift: true,
      is_active: true,
    },
    {
      id: 'tpl-retired',
      key: 'retired',
      name: 'Retired template',
      description: null,
      exit_on_gift: false,
      is_active: false,
    },
  ]

  tables.journey_steps = [
    stepRow('s1', TEMPLATE, 1, 1, 'Thank-you call for the first gift', 'call'),
    stepRow('s2', TEMPLATE, 2, 30, 'Send the impact note', 'send_update'),
    stepRow('s3', TEMPLATE, 3, 90, 'Invite to the next event', 'invite_event'),
    stepRow('l1', LAPSED, 1, 0, 'Reconnect call — no ask', 'call'),
    stepRow('l2', LAPSED, 2, 21, 'Send a personal note', 'send_update', true),
  ]

  tables.journey_enrollments = extra.enrollments ?? []
  tables.journey_tasks = extra.journeyTasks ?? []
  if (extra.tasks) tables.tasks = [...(tables.tasks ?? []), ...extra.tasks]

  return tables
}

function stepRow(
  id: string,
  template_id: string,
  step_no: number,
  offset_days: number,
  title: string,
  action_type: string,
  depends_on_previous = false,
): Row {
  return { id, template_id, step_no, offset_days, title, action_type, details: null, depends_on_previous }
}

beforeEach(() => freezeClock(MONDAY))
afterEach(() => {
  thawClock()
  resetWorld()
})

const openProfile = async () => {
  await renderApp(`/contacts/${IDS.adler}`)
  return screen.findByTestId('journeys-panel', {}, { timeout: 5000 })
}

describe('the profile Journeys panel (08 §4)', () => {
  it('says what a journey is when none is running', async () => {
    installWorld({ tables: journeyWorld() })
    const panel = await openProfile()
    await waitFor(() => expect(flat(panel.textContent ?? '')).toContain('No journey running'))
  })

  it('previews the whole future step list with dates before anything is written', async () => {
    const world = installWorld({ tables: journeyWorld() })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await openProfile()

    await user.click(screen.getByTestId('journey-attach-open'))
    await user.click(await screen.findByRole('radio', { name: /New donor welcome/ }))

    const preview = await screen.findByTestId('journey-preview')
    const text = flat(preview.textContent ?? '')
    // Monday is 7 Sep 2026: +1, +30, +90.
    expect(text).toContain('8 Sep 2026')
    expect(text).toContain('Thank-you call for the first gift')
    expect(text).toContain('7 Oct 2026')
    expect(text).toContain('Send the impact note')
    expect(text).toContain('6 Dec 2026')
    expect(text).toContain('Invite to the next event')

    // Preview only: nothing has been enrolled yet.
    expect(world.tables.journey_enrollments).toHaveLength(0)
  })

  it('flags a step that waits for the one before it, and a template that ends on a gift', async () => {
    installWorld({ tables: journeyWorld() })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await openProfile()

    await user.click(screen.getByTestId('journey-attach-open'))
    await user.click(await screen.findByRole('radio', { name: /Lapsed reactivation/ }))

    const preview = await screen.findByTestId('journey-preview')
    expect(flat(preview.textContent ?? '')).toContain('waits for step 1')
    expect(flat(preview.textContent ?? '')).toContain('ends by itself the moment a gift arrives')
  })

  it('offers only active templates', async () => {
    installWorld({ tables: journeyWorld() })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await openProfile()

    await user.click(screen.getByTestId('journey-attach-open'))
    const sheet = await screen.findByTestId('journey-attach-sheet')
    expect(within(sheet).queryByRole('radio', { name: /Retired template/ })).toBeNull()
  })

  it('attaches on confirm and offers undo', async () => {
    const world = installWorld({ tables: journeyWorld() })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await openProfile()

    await user.click(screen.getByTestId('journey-attach-open'))
    await user.click(await screen.findByRole('radio', { name: /New donor welcome/ }))
    await user.click(screen.getByTestId('journey-attach-confirm'))

    await waitFor(() => expect(world.tables.journey_enrollments).toHaveLength(1))
    const enrollment = world.tables.journey_enrollments![0]!
    expect(enrollment.contact_id).toBe(IDS.adler)
    expect(enrollment.template_id).toBe(TEMPLATE)
    expect(enrollment.started_on).toBe('2026-09-07')

    const toast = await screen.findByTestId('toast')
    expect(flat(toast.textContent ?? '')).toContain('New donor welcome attached')

    // Undo ends the enrolment; nothing is left running on the profile.
    await user.click(within(toast).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(world.tables.journey_enrollments![0]!.status).toBe('exited'))
    expect(world.tables.journey_enrollments![0]!.exited_reason).toBe('undone')
  })

  it('reads "step x of y" and names the next step with its date', async () => {
    installWorld({
      tables: journeyWorld({
        enrollments: [
          {
            id: 'enr-1',
            contact_id: IDS.adler,
            template_id: TEMPLATE,
            started_on: '2026-08-10',
            status: 'active',
            exited_reason: null,
            ended_at: null,
            assigned_to: null,
            created_by: IDS.braun,
          },
        ],
        journeyTasks: [
          { id: 'jt-1', enrollment_id: 'enr-1', step_id: 's1', task_id: 'task-j1' },
          { id: 'jt-2', enrollment_id: 'enr-1', step_id: 's2', task_id: 'task-j2' },
        ],
        tasks: [
          {
            id: 'task-j1',
            contact_id: IDS.adler,
            title: 'Thank-you call for the first gift',
            action_type: 'call',
            details: null,
            assigned_to: IDS.braun,
            due_on: '2026-08-11',
            priority: 'medium',
            status: 'done',
            waiting_for: null,
            completed_at: '2026-08-11T10:00:00.000Z',
            origin: 'journey:new_donor_welcome',
          },
          {
            id: 'task-j2',
            contact_id: IDS.adler,
            title: 'Send the impact note',
            action_type: 'send_update',
            details: null,
            assigned_to: IDS.braun,
            due_on: '2026-09-09',
            priority: 'medium',
            status: 'todo',
            waiting_for: null,
            completed_at: null,
            origin: 'journey:new_donor_welcome',
          },
        ],
      }),
    })

    await openProfile()
    const card = await screen.findByTestId('journey-card', {}, { timeout: 5000 })
    const text = flat(card.textContent ?? '')
    expect(text).toContain('New donor welcome')
    expect(text).toContain('Step 2 of 3')
    expect(text).toContain('Next: Send the impact note')
    expect(text).toContain('9 Sep 2026')
  })

  it('detaches without a confirm dialog, cancelling the steps still open, with undo', async () => {
    const world = installWorld({
      tables: journeyWorld({
        enrollments: [
          {
            id: 'enr-1',
            contact_id: IDS.adler,
            template_id: TEMPLATE,
            started_on: '2026-08-10',
            status: 'active',
            exited_reason: null,
            ended_at: null,
            assigned_to: null,
            created_by: IDS.braun,
          },
        ],
        journeyTasks: [
          { id: 'jt-1', enrollment_id: 'enr-1', step_id: 's1', task_id: 'task-j1' },
          { id: 'jt-2', enrollment_id: 'enr-1', step_id: 's2', task_id: 'task-j2' },
        ],
        tasks: [
          {
            id: 'task-j1',
            contact_id: IDS.adler,
            title: 'Thank-you call for the first gift',
            action_type: 'call',
            details: null,
            assigned_to: IDS.braun,
            due_on: '2026-08-11',
            priority: 'medium',
            status: 'done',
            waiting_for: null,
            completed_at: '2026-08-11T10:00:00.000Z',
            origin: 'journey:new_donor_welcome',
          },
          {
            id: 'task-j2',
            contact_id: IDS.adler,
            title: 'Send the impact note',
            action_type: 'send_update',
            details: null,
            assigned_to: IDS.braun,
            due_on: '2026-09-09',
            priority: 'medium',
            status: 'todo',
            waiting_for: null,
            completed_at: null,
            origin: 'journey:new_donor_welcome',
          },
        ],
      }),
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await openProfile()

    await user.click(await screen.findByTestId('journey-detach', {}, { timeout: 5000 }))

    const task = () => world.tables.tasks!.find((row) => row.id === 'task-j2')!
    const done = () => world.tables.tasks!.find((row) => row.id === 'task-j1')!

    await waitFor(() => expect(task().status).toBe('cancelled'))
    // A completed step is history; a detach must not rewrite it.
    expect(done().status).toBe('done')
    expect(world.tables.journey_enrollments![0]!.status).toBe('exited')
    expect(world.tables.journey_enrollments![0]!.exited_reason).toBe('detached')

    const toast = await screen.findByTestId('toast')
    expect(flat(toast.textContent ?? '')).toContain('1 task cancelled')

    await user.click(within(toast).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(task().status).toBe('todo'))
    expect(world.tables.journey_enrollments![0]!.status).toBe('active')
  })
})

describe('Settings — the calendar feed (10 §4)', () => {
  const withToken = () => {
    const tables = journeyWorld()
    tables.team_members = (tables.team_members ?? []).map((row) => ({
      ...row,
      ics_token: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    }))
    return tables
  }

  it('shows the member their own tokenised URL', async () => {
    installWorld({ tables: withToken() })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderApp('/settings')

    await user.click(await screen.findByRole('tab', { name: /Team/ }, { timeout: 5000 }))
    const field = (await screen.findByTestId('calendar-feed-url')) as HTMLInputElement
    expect(field.value).toBe(
      'https://fake.supabase.co/functions/v1/ics-feed?token=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    )
    expect(field.readOnly).toBe(true)
  })

  it('regenerating asks first, then issues a different token', async () => {
    const world = installWorld({ tables: withToken() })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderApp('/settings')

    await user.click(await screen.findByRole('tab', { name: /Team/ }, { timeout: 5000 }))
    await user.click(await screen.findByTestId('calendar-feed-regenerate'))

    // The one confirm dialog in M9b: it breaks every existing subscription.
    const dialog = await screen.findByRole('dialog')
    expect(flat(dialog.textContent ?? '')).toContain('stops working immediately')
    expect(world.tables.team_members![0]!.ics_token).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')

    await user.click(within(dialog).getByRole('button', { name: 'Regenerate' }))
    await waitFor(() =>
      expect(world.tables.team_members![0]!.ics_token).not.toBe(
        'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      ),
    )
  })
})
