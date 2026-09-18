/**
 * ACCEPTANCE 1 — Daily management (brief §34.1, spec 12 §2.1)
 *
 *   "Seeded Monday → the Action Stream shows every due call/message/meeting/
 *    task, every overdue item, every neglected relationship; assert zero items
 *    reachable only by memory or search."
 *
 * The test asserts twice over, on purpose:
 *
 *  1. against `MONDAY_MANIFEST` — a hand-written statement of what the day owes
 *     the fundraiser, each entry carrying *why* it matters; and
 *  2. against a set **re-derived from the raw tables** — every open task due on
 *     or before today, every meeting scheduled today, every active contact the
 *     stats view flags yellow.
 *
 * The second pass is what makes "zero reliance on memory" a real assertion: if
 * a row is added to the fixture and forgotten in the manifest, the derived pass
 * still demands it on screen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../src/lib/supabase', async () => {
  const harness = await import('../support/harness')
  return { supabase: harness.supabase, isConfigured: true }
})
vi.mock('../../src/lib/env', () => ({
  SUPABASE_URL: 'http://fake.local',
  SUPABASE_ANON_KEY: 'fake',
  isConfigured: true,
}))

const {
  MONDAY,
  MONDAY_MANIFEST,
  NOT_TODAY,
  iso,
  seededMondayTables,
} = await import('./fixtures')
const { freezeClock, installWorld, renderApp, resetWorld, thawClock } = await import('../support/harness')
const { INACTIVE_STAGES } = await import('../../src/lib/queries/tasks')

type Row = Record<string, unknown>

/** The set the *data* says today owes, computed from the tables, not memory. */
function deriveExpected(tables: ReturnType<typeof seededMondayTables>) {
  const today = iso(0)
  const contacts = tables.contacts as Row[]
  const byId = new Map(contacts.map((row) => [String(row.id), row]))

  const dueOrOverdue = (tables.tasks as Row[]).filter(
    (task) =>
      (task.status === 'todo' || task.status === 'waiting') &&
      typeof task.due_on === 'string' &&
      task.due_on <= today,
  )

  const meetingsToday = (tables.interactions as Row[]).filter(
    (row) => row.status === 'scheduled' && String(row.occurred_at).slice(0, 10) === today,
  )

  // I-3: yellow counts only for a contact still in an active stage.
  const neglected = (tables.contact_stats as Row[])
    .filter((row) => row.flag === 'none')
    .map((row) => byId.get(String(row.contact_id)))
    .filter((contact): contact is Row => Boolean(contact))
    .filter((contact) => !contact.is_archived && !INACTIVE_STAGES.has(String(contact.stage)))

  return { dueOrOverdue, meetingsToday, neglected, byId }
}

describe('acceptance 1 · a seeded Monday leaves nothing to memory', () => {
  beforeEach(() => {
    freezeClock(MONDAY)
    window.localStorage.clear()
  })

  afterEach(() => {
    thawClock()
    resetWorld()
    vi.clearAllMocks()
  })

  it('shows every manifest item, in its own section', async () => {
    installWorld({ tables: seededMondayTables() })
    await renderApp('/')

    await screen.findByRole('heading', { name: 'Today' })
    // The board resolves one tick after the shell; wait for the first row.
    await screen.findByText(/Call re proposal/, {}, { timeout: 5000 })

    const main = document.querySelector('main') as HTMLElement
    for (const entry of MONDAY_MANIFEST) {
      const found = within(main).queryAllByText(new RegExp(entry.who.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      expect(
        found.length,
        `${entry.who} is missing from the stream. ${entry.because}`,
      ).toBeGreaterThan(0)

      const line = within(main).queryAllByText(
        new RegExp(entry.line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      )
      expect(line.length, `"${entry.line}" is missing for ${entry.who}. ${entry.because}`).toBeGreaterThan(0)
    }
  })

  it('groups them the way the spec orders the day (04 §1)', async () => {
    installWorld({ tables: seededMondayTables() })
    await renderApp('/')
    await screen.findByText(/Call re proposal/, {}, { timeout: 5000 })

    const main = document.querySelector('main') as HTMLElement
    const text = main.textContent ?? ''

    expect(text).toMatch(/MEETINGS TODAY/)
    expect(text).toMatch(/OVERDUE · 2/)
    expect(text).toMatch(/KEEP IN TOUCH DUE · 1/)
    expect(text).toMatch(/NEEDS A NEXT ACTION · 1/)

    // Meetings sit above overdue, overdue above the due-today groups.
    expect(text.indexOf('MEETINGS TODAY')).toBeLessThan(text.indexOf('OVERDUE'))
    expect(text.indexOf('OVERDUE')).toBeLessThan(text.indexOf('NEEDS A NEXT ACTION'))
  })

  it('shows everything the tables say is due, overdue or neglected — derived, not remembered', async () => {
    const tables = seededMondayTables()
    const expected = deriveExpected(tables)
    installWorld({ tables })
    await renderApp('/')
    await screen.findByText(/Call re proposal/, {}, { timeout: 5000 })

    const main = document.querySelector('main') as HTMLElement
    const text = (main.textContent ?? '').replace(/\s+/g, ' ')

    expect(expected.dueOrOverdue.length).toBe(6)
    for (const task of expected.dueOrOverdue) {
      // A waiting task renders as its `waiting_for` line, not its title.
      const needle = task.status === 'waiting' ? String(task.waiting_for) : String(task.title)
      expect(text, `task ${String(task.id)} is not on the stream`).toContain(needle.slice(0, 24))
    }

    expect(expected.meetingsToday).toHaveLength(1)
    for (const meeting of expected.meetingsToday) {
      expect(text).toContain(String(meeting.purpose))
    }

    expect(expected.neglected).toHaveLength(1)
    for (const contact of expected.neglected) {
      expect(text).toContain(String(contact.last_name))
    }
  })

  it('does not crowd today with tomorrow’s work or this morning’s finished work', async () => {
    installWorld({ tables: seededMondayTables() })
    await renderApp('/')
    await screen.findByText(/Call re proposal/, {}, { timeout: 5000 })

    const main = document.querySelector('main') as HTMLElement
    const today = main.textContent ?? ''

    // Berger's task is six days out: not in today's sections.
    expect(today).not.toMatch(/Dinner invite/)
    for (const row of NOT_TODAY) {
      if (row.id === 'task-berger-future') {
        expect(within(main).queryByText(/Aron Berger/), `${row.who} (${row.why}) should not be on today`).toBeNull()
      }
    }

    // The finished one is counted, never listed as work to do: it lives behind
    // the Done tab, which is the reward, not the queue.
    expect(today).not.toMatch(/Chaim Levy/)
    const done = within(main).getByRole('tab', { name: /^Done/ })
    expect(done).toHaveTextContent('Done · 1')
    await userEvent.click(done)
    expect(within(main).getByText(/DONE TODAY · 1/)).toBeInTheDocument()
    expect(within(main).getByText(/Chaim Levy/)).toBeInTheDocument()
  })

  it('surfaces the nudge for the neglected VIP alongside the stream (08 §3)', async () => {
    installWorld({ tables: seededMondayTables() })
    await renderApp('/')
    await screen.findByText(/Call re proposal/, {}, { timeout: 5000 })

    // The rail is rendered twice (desktop column + mobile cards), so a match
    // in either is the assertion that matters.
    await waitFor(() =>
      expect(screen.getAllByText(/no meaningful contact in 92 days/i).length).toBeGreaterThan(0),
    )
  })
})
