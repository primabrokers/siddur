/**
 * ACCEPTANCE 4 — Relationship maintenance (brief §34.4, spec 12 §2.4, 07 §4)
 *
 *   "2-month cadence + a meaningful contact logged → fast-forward past the
 *    window with no contact → exactly one `auto:kit` task exists; the contact
 *    appears as overdue for relationship contact; logging a call clears it and
 *    restarts the clock."
 *
 * **Where the boundary sits.** The keep-in-touch clock is computed in the
 * database — `contact_stats.kit_due_on` from the timeline, and the nightly run
 * that raises the task (08 §3). The client must never recompute either
 * (I-8/I-9), so this test asserts two different things:
 *
 *  - what the *client* does with the view's values: shows one KIT row, exactly
 *    one open `auto:kit` task, the cadence on the header, and — crucially —
 *    keeps showing the old value after an interaction is logged, because
 *    resetting the clock is not its job;
 *  - what the *database* would then compute, applied here by `afterNightlyRun`
 *    as an explicit stand-in, so the reset is asserted end to end.
 *
 * The real nightly function is exercised by the LIVE=1 sibling
 * (`kit-live.test.ts`), which calls `run_nightly()` and reads the real rows.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { addDays, differenceInCalendarDays } from 'date-fns'

vi.mock('../../src/lib/supabase', async () => {
  const harness = await import('../support/harness')
  return { supabase: harness.supabase, isConfigured: true }
})
vi.mock('../../src/lib/env', () => ({
  SUPABASE_URL: 'http://fake.local',
  SUPABASE_ANON_KEY: 'fake',
  isConfigured: true,
}))

const { IDS, MONDAY, at, iso, seededMondayTables } = await import('./fixtures')
const { freezeClock, installWorld, renderApp, resetWorld, thawClock } = await import('../support/harness')
const { toISODate } = await import('../../src/lib/dates')
const { saveCapture } = await import('../../src/lib/queries/capture')

type Row = Record<string, unknown>
type Tables = ReturnType<typeof seededMondayTables>

const CADENCE_DAYS = 60

/** Open statuses, per 02 §3.3 — a `done` KIT task is not "one that exists". */
const isOpen = (task: Row) => task.status === 'todo' || task.status === 'waiting' || task.status === 'queued'

const openKitTasks = (tables: Tables, contactId: string): Row[] =>
  (tables.tasks as Row[]).filter(
    (task) => task.contact_id === contactId && task.origin === 'auto:kit' && isOpen(task),
  )

/**
 * What the database does overnight (08 §3 `kit_due`, 02 §4.1 `contact_stats`),
 * written out here so the client half can be tested without one. Deliberately
 * *not* imported from `src/` — if this logic ever appears in the client, that
 * is the bug I-9 exists to prevent.
 */
function afterNightlyRun(tables: Tables, contactId: string, now: Date): Tables {
  const contact = (tables.contacts as Row[]).find((row) => row.id === contactId)
  const cadence = Number(contact?.contact_frequency_days ?? 0)

  const meaningful = (tables.interactions as Row[])
    .filter((row) => row.contact_id === contactId && row.status === 'logged' && row.is_meaningful)
    .map((row) => new Date(String(row.occurred_at)))
    .sort((a, b) => b.getTime() - a.getTime())

  const last = meaningful[0] ?? null
  // Calendar days, as Postgres computes it — a call at 11:00 today is zero
  // days ago even when "now" is 08:30.
  const daysSince = last ? Math.max(0, differenceInCalendarDays(now, last)) : null
  const kitDue = last && cadence > 0 ? toISODate(addDays(last, cadence)) : null

  tables.contact_stats = (tables.contact_stats as Row[]).map((row) =>
    row.contact_id === contactId
      ? {
          ...row,
          last_meaningful_contact_at: last ? last.toISOString() : null,
          days_since_contact: daysSince,
          kit_due_on: kitDue,
          // The KIT task was the next action; with it closed there is none.
          next_action_id: null,
          next_action_title: null,
          next_action_due_on: null,
          next_action_type: null,
          flag: 'none',
        }
      : row,
  )
  return tables
}

/** The fixture as it stands the morning the cadence has just elapsed. */
function kitDueWorld(): Tables {
  return seededMondayTables()
}

describe('acceptance 4 · a two-month cadence keeps itself', () => {
  beforeEach(() => {
    freezeClock(MONDAY)
    window.localStorage.clear()
  })

  afterEach(() => {
    thawClock()
    resetWorld()
    vi.clearAllMocks()
  })

  it('raises exactly one auto:kit task when the window passes — never a second', async () => {
    const world = installWorld({ tables: kitDueWorld() })

    const kit = openKitTasks(world.tables as Tables, IDS.goldstein)
    expect(kit, 'the cadence elapsed and no keep-in-touch task exists').toHaveLength(1)
    expect(kit[0]?.due_on).toBe(iso(0))
    expect(kit[0]?.origin).toBe('auto:kit')

    // 08 §1: a rule never creates a second open task of the same origin for the
    // same contact. Two would mean the fundraiser calls twice, or ignores both.
    expect(
      (world.tables.tasks as Row[]).filter(
        (task) => task.origin === 'auto:kit' && task.contact_id === IDS.goldstein,
      ),
    ).toHaveLength(1)
  })

  it('shows the contact as due for relationship contact, in its own section', async () => {
    installWorld({ tables: kitDueWorld() })
    await renderApp('/')
    await screen.findByText(/Call re proposal/, {}, { timeout: 5000 })

    const main = document.querySelector('main') as HTMLElement
    const section = within(main).getByText(/KEEP IN TOUCH DUE · 1/)
    expect(section).toBeInTheDocument()
    expect(within(main).getAllByText(/Goldstein Family/).length).toBeGreaterThan(0)
    expect(within(main).getByText(/Keep in touch — every 2 months — due today/)).toBeInTheDocument()
  })

  it('states the cadence and the due date on the profile, both from the view', async () => {
    installWorld({ tables: kitDueWorld() })
    await renderApp(`/contacts/${IDS.goldstein}`)

    const header = await screen.findByTestId('profile-header', {}, { timeout: 5000 })
    await waitFor(() =>
      expect(within(header).getAllByText(/every 2 months/).length).toBeGreaterThan(0),
    )
    expect(within(header).getByText(/63 days ago/)).toBeInTheDocument()
  })

  it('does not reset the clock in the browser — that is the database’s job (I-9)', async () => {
    const world = installWorld({ tables: kitDueWorld() })

    // Log the catch-up call, exactly as Quick Capture would (07 §4.4).
    await saveCapture({
      source: 'manual',
      rawText: 'Called the Goldsteins — long catch-up, asked about the boys',
      contact: { id: IDS.goldstein, createName: null },
      interaction: {
        kind: 'call',
        occurredAt: at(0, 11).slice(0, 16),
        location: null,
        summary: 'Long catch-up, asked about the boys',
        outcome: null,
        askAmount: null,
        isScheduled: false,
      },
      nextAction: null,
      tags: [],
    })

    const stats = (world.tables.contact_stats as Row[]).find((row) => row.contact_id === IDS.goldstein)
    // Still the old numbers: the write happened, the view has not been re-read.
    expect(stats?.kit_due_on).toBe(iso(0))
    expect(stats?.days_since_contact).toBe(63)
  })

  it('clears the queue and restarts the cycle once the view recomputes', async () => {
    const tables = kitDueWorld()
    const world = installWorld({ tables })

    // 1. The catch-up call is logged, and it is a meaningful one.
    ;(world.tables.interactions as Row[]).push({
      id: 'int-goldstein-catchup',
      contact_id: IDS.goldstein,
      occurred_at: at(0, 11),
      kind: 'call',
      status: 'logged',
      team_member_id: IDS.braun,
      summary: 'Long catch-up, asked about the boys',
      outcome: null,
      is_meaningful: true,
      location: null,
      attendees: null,
      purpose: null,
      ask_amount: null,
      source: 'manual',
    })

    // 2. Its close-the-loop completes the KIT task (07 §4.4).
    for (const task of world.tables.tasks as Row[]) {
      if (task.id === 'task-goldstein-kit') {
        task.status = 'done'
        task.completed_at = at(0, 11)
      }
    }

    // 3. Overnight, the view and the rule recompute.
    afterNightlyRun(world.tables as Tables, IDS.goldstein, MONDAY)

    expect(openKitTasks(world.tables as Tables, IDS.goldstein)).toHaveLength(0)
    const stats = (world.tables.contact_stats as Row[]).find((row) => row.contact_id === IDS.goldstein)
    expect(stats?.days_since_contact).toBe(0)
    // The clock restarted: the next nudge is one full cadence away.
    expect(stats?.kit_due_on).toBe(iso(CADENCE_DAYS))

    // 4. And the client simply reflects it: no keep-in-touch queue this morning.
    await renderApp('/')
    await screen.findByText(/Call re proposal/, {}, { timeout: 5000 })
    const main = document.querySelector('main') as HTMLElement
    expect(within(main).queryByText(/KEEP IN TOUCH DUE/)).toBeNull()
    expect(within(main).queryByText(/Keep in touch — every 2 months/)).toBeNull()
  })

  it('brings him back exactly one cadence later, and not before', async () => {
    const tables = kitDueWorld()
    const world = installWorld({ tables })

    ;(world.tables.interactions as Row[]).push({
      id: 'int-goldstein-catchup',
      contact_id: IDS.goldstein,
      occurred_at: at(0, 11),
      kind: 'call',
      status: 'logged',
      team_member_id: IDS.braun,
      summary: 'Long catch-up',
      outcome: null,
      is_meaningful: true,
      location: null,
      attendees: null,
      purpose: null,
      ask_amount: null,
      source: 'manual',
    })
    for (const task of world.tables.tasks as Row[]) {
      if (task.id === 'task-goldstein-kit') task.status = 'done'
    }
    afterNightlyRun(world.tables as Tables, IDS.goldstein, MONDAY)

    const stats = (world.tables.contact_stats as Row[]).find((row) => row.contact_id === IDS.goldstein)
    const dueOn = String(stats?.kit_due_on)

    // A day early the clock has not elapsed; on the day it has. That single
    // day is the whole promise of a cadence.
    expect(dueOn > iso(CADENCE_DAYS - 1)).toBe(true)
    expect(dueOn).toBe(iso(CADENCE_DAYS))
  })
})
