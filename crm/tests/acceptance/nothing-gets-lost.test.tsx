/**
 * ACCEPTANCE 3 — Nothing gets lost (brief §34.3, spec 12 §2.3)
 *
 *   "Capture 'call him again in three months' → a task exists at +3 months →
 *    advance the clock → he surfaces in Today that morning."
 *
 * The point of this test is the *gap*. A promise made in a car park in
 * September has to survive until December with nobody thinking about it. So it
 * is written as three separate moments — say it, store it, be reminded — with
 * the clock moved between them and the app re-mounted, so nothing carried in
 * React state can fake the result.
 *
 * The model call is stubbed (`stubParse`): what is under test is the pipeline
 * from an extraction to a dated task to a stream row, not the extractor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { addMonths } from 'date-fns'

vi.mock('../../src/lib/supabase', async () => {
  const harness = await import('../support/harness')
  return { supabase: harness.supabase, isConfigured: true }
})
vi.mock('../../src/lib/env', () => ({
  SUPABASE_URL: 'http://fake.local',
  SUPABASE_ANON_KEY: 'fake',
  isConfigured: true,
}))

const { IDS, MONDAY, seededMondayTables } = await import('./fixtures')
const { freezeClock, installWorld, moveClockTo, renderApp, resetWorld, thawClock } = await import('../support/harness')
const { toISODate } = await import('../../src/lib/dates')

type Row = Record<string, unknown>

/** The sentence, as it would be dictated leaving his office. */
const DICTATION = 'Spoke to Dovid Cohen about the building project — call him again in three months'

/** What the extractor returns for it (09 §2's contract, `resolved_due_on` null). */
const PARSED = {
  contact_query: 'Dovid Cohen',
  confidence: 0.94,
  interaction: {
    kind: 'call',
    occurred_at: null,
    location: null,
    summary: 'Spoke about the building project',
    outcome: null,
    ask_amount: null,
    is_scheduled: false,
  },
  next_action: {
    type: 'call',
    title: 'Call Dovid Cohen again',
    // The user's own words. The browser resolves them, not the model.
    date_expression: 'in three months',
    resolved_due_on: null,
  },
  suggested_updates: [],
  unparsed_remainder: null,
  model: 'claude-test',
  latency_ms: 812,
  usage: { input_tokens: 400, output_tokens: 120 },
}

const THREE_MONTHS_ON = addMonths(MONDAY, 3)

describe('acceptance 3 · a promise made today survives three months', () => {
  beforeEach(() => {
    freezeClock(MONDAY)
    window.localStorage.clear()
  })

  afterEach(() => {
    thawClock()
    resetWorld()
    vi.clearAllMocks()
  })

  it('captures the sentence, and stores a dated task three months out', async () => {
    const world = installWorld({ tables: seededMondayTables(), parse: PARSED })
    const user = userEvent.setup()
    await renderApp('/')

    await screen.findByRole('heading', { name: 'Today' })

    // Open the one capture surface (03 §1) and say it.
    const banner = await screen.findByRole('banner')
    await user.click(within(banner).getByRole('button', { name: 'Quick capture' }))
    const sheet = await screen.findByRole('dialog')
    await user.type(within(sheet).getByLabelText('What happened'), DICTATION)
    await user.click(within(sheet).getByRole('button', { name: 'Next' }))

    // The confirm sheet resolves the words into a date the person can see.
    await within(sheet).findByRole('heading', { name: 'Check & save' })
    expect(within(sheet).getByLabelText('Next action')).toHaveValue('Call Dovid Cohen again')
    // The chip shows the words *and* the date they resolved to, so the person
    // is confirming a real day rather than trusting a phrase (09 §2).
    expect(sheet.textContent ?? '').toMatch(/in three months → Mon 7 Dec/i)

    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    await screen.findByRole('heading', { name: 'Done' }, { timeout: 5000 })

    // The assertion that matters is in the database, not the toast.
    const tasks = world.tables.tasks as Row[]
    const created = tasks.find((task) => task.title === 'Call Dovid Cohen again')
    expect(created, 'the capture did not write a task').toBeTruthy()
    expect(created?.contact_id).toBe(IDS.dovid)
    expect(created?.due_on).toBe(toISODate(THREE_MONTHS_ON))
    expect(created?.status).toBe('todo')
    // Provenance: the origin says an AI capture put it there (02 §3.3).
    expect(created?.origin).toBe('quick_capture_ai')

    // And the conversation itself was kept, verbatim, alongside it.
    const interactions = world.tables.interactions as Row[]
    const logged = interactions.find((row) => row.ai_raw_input === DICTATION)
    expect(logged, 'the dictation was not stored verbatim').toBeTruthy()
    expect(logged?.contact_id).toBe(IDS.dovid)
  })

  it('surfaces him in Today on the morning it comes due — three months later', async () => {
    // The world as it is *after* the capture above: same tables, one task added.
    const tables = seededMondayTables()
    ;(tables.tasks as Row[]).push({
      id: 'task-dovid-three-months',
      contact_id: IDS.dovid,
      title: 'Call Dovid Cohen again',
      action_type: 'call',
      details: null,
      assigned_to: IDS.braun,
      created_by: IDS.braun,
      due_on: toISODate(THREE_MONTHS_ON),
      priority: 'medium',
      status: 'todo',
      waiting_for: null,
      completed_at: null,
      origin: 'quick_capture_ai',
      queue_order: null,
      opportunity_id: null,
    })
    installWorld({ tables })

    // Nothing has happened in between: no login, no reminder, no memory.
    moveClockTo(THREE_MONTHS_ON)
    await renderApp('/')

    await screen.findByRole('heading', { name: 'Today' })
    const row = await screen.findByText(/Call Dovid Cohen again/, {}, { timeout: 5000 })
    expect(row).toBeInTheDocument()

    const main = document.querySelector('main') as HTMLElement
    const text = (main.textContent ?? '').replace(/\s+/g, ' ')
    // Due today — not overdue, not upcoming. The morning it was promised for.
    expect(text).toMatch(/Call Dovid Cohen again — due today/)
    expect(within(main).getAllByText(/Dovid Cohen/).length).toBeGreaterThan(0)
  })

  it('does not surface him a day early', async () => {
    const tables = seededMondayTables()
    ;(tables.tasks as Row[]).push({
      id: 'task-dovid-three-months',
      contact_id: IDS.dovid,
      title: 'Call Dovid Cohen again',
      action_type: 'call',
      details: null,
      assigned_to: IDS.braun,
      created_by: IDS.braun,
      due_on: toISODate(THREE_MONTHS_ON),
      priority: 'medium',
      status: 'todo',
      waiting_for: null,
      completed_at: null,
      origin: 'quick_capture_ai',
      queue_order: null,
      opportunity_id: null,
    })
    installWorld({ tables })

    const dayBefore = new Date(THREE_MONTHS_ON)
    dayBefore.setDate(dayBefore.getDate() - 1)
    moveClockTo(dayBefore)
    await renderApp('/')

    await screen.findByText(/Call re proposal/, {}, { timeout: 5000 })
    const main = document.querySelector('main') as HTMLElement
    // Present in the app, but tomorrow's problem — the queue stays honest.
    expect(within(main).queryByText(/Call Dovid Cohen again/)).toBeNull()

    await userEvent.click(within(main).getByRole('tab', { name: /Upcoming/ }))
    await waitFor(() =>
      expect(within(main).getByText(/Call Dovid Cohen again/)).toBeInTheDocument(),
    )
  })
})
