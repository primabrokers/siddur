/**
 * Smart views on the Contacts route (06 §1, 03 §4) — rendered end to end.
 *
 * One dataset, many lenses: selecting a view must change *which rows the query
 * returns* and nothing else. These tests run the real `saved_views` read, the
 * real push-down to `contacts` + `contact_stats`, and the real save path, so a
 * view's criteria are executed rather than described.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../src/lib/supabase', async () => {
  const harness = await import('./support/harness')
  return { supabase: harness.supabase, isConfigured: true }
})
vi.mock('../src/lib/env', () => ({
  SUPABASE_URL: 'http://fake.local',
  SUPABASE_ANON_KEY: 'fake',
  isConfigured: true,
}))

const { MONDAY, seededMondayTables } = await import('./acceptance/fixtures')
const { freezeClock, installWorld, renderApp, resetWorld, thawClock } = await import('./support/harness')

type Row = Record<string, unknown>

const list = () => document.querySelector('main ul') as HTMLElement | null

describe('contacts · views bar (06 §1)', () => {
  beforeEach(() => {
    freezeClock(MONDAY)
    window.localStorage.clear()
  })

  afterEach(() => {
    thawClock()
    resetWorld()
    vi.clearAllMocks()
  })

  it('offers the saved lenses as chips, with All contacts selected by default', async () => {
    installWorld({ tables: seededMondayTables() })
    await renderApp('/contacts')

    const bar = await screen.findByRole('region', { name: 'Views' })
    expect(within(bar).getByRole('button', { name: /All contacts/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await within(bar).findByRole('button', { name: /LYBUNT/ })
    await within(bar).findByRole('button', { name: /No contact 90\+ days/ })
    // A task-entity view belongs on the sidebar, not in the contacts bar.
    expect(within(bar).queryByRole('button', { name: /Overdue follow-ups/ })).toBeNull()
  })

  it('narrows the rows to the view’s criteria, and says which view is open', async () => {
    installWorld({ tables: seededMondayTables() })
    const user = userEvent.setup()
    await renderApp('/contacts')

    const bar = await screen.findByRole('region', { name: 'Views' })
    await user.click(await within(bar).findByRole('button', { name: /LYBUNT/ }))

    // Dovid, Katz and Berger are the LYBUNT donors in the seeded world.
    await waitFor(() => expect(list()?.children.length).toBe(3), { timeout: 5000 })
    expect(screen.getByRole('heading', { level: 1, name: 'LYBUNT' })).toBeInTheDocument()
    const rows = list()?.textContent ?? ''
    expect(rows).toMatch(/Dovid Cohen/)
    expect(rows).toMatch(/Yanky Katz/)
    expect(rows).toMatch(/Aron Berger/)
    expect(rows).not.toMatch(/Devorah Frankel/)
  })

  it('shows the criteria as removable chips, and removing one makes the view dirty', async () => {
    installWorld({ tables: seededMondayTables() })
    const user = userEvent.setup()
    await renderApp('/contacts')

    const bar = await screen.findByRole('region', { name: 'Views' })
    await user.click(await within(bar).findByRole('button', { name: /No contact 90\+ days/ }))

    const chip = await within(bar).findByRole('button', { name: 'Remove filter No contact 90+ days' })
    expect(within(bar).queryByRole('button', { name: 'Save as view' })).toBeNull()

    await user.click(chip)
    // With no criteria left the list falls back to everyone…
    await waitFor(() => expect(list()?.children.length).toBe(10), { timeout: 5000 })
    // …and the header stops claiming to be the saved view.
    expect(screen.getByRole('heading', { level: 1, name: 'Contacts' })).toBeInTheDocument()
  })

  it('offers "Save as view" the moment hand-picked criteria exist', async () => {
    installWorld({ tables: seededMondayTables() })
    const user = userEvent.setup()
    await renderApp('/contacts')

    const bar = await screen.findByRole('region', { name: 'Views' })
    expect(within(bar).queryByRole('button', { name: 'Save as view' })).toBeNull()

    await user.selectOptions(within(bar).getByLabelText('Add a filter'), 'priority:high')
    expect(await within(bar).findByRole('button', { name: 'Save as view' })).toBeInTheDocument()
    expect(within(bar).getByText('Priority: High')).toBeInTheDocument()

    // Adler, Dovid — the two high-priority people in the seeded world.
    await waitFor(() => expect(list()?.children.length).toBe(2), { timeout: 5000 })
  })

  it('saves a new view, pins it, and switches to it', async () => {
    const world = installWorld({ tables: seededMondayTables() })
    const user = userEvent.setup()
    await renderApp('/contacts')

    const bar = await screen.findByRole('region', { name: 'Views' })
    await user.selectOptions(within(bar).getByLabelText('Add a filter'), 'quiet:60')
    await user.click(await within(bar).findByRole('button', { name: 'Save as view' }))

    const sheet = await screen.findByRole('dialog')
    await user.type(within(sheet).getByLabelText(/^Name/), 'Quiet two months')
    await user.click(within(sheet).getByLabelText('Time-based'))
    await user.click(within(sheet).getByRole('button', { name: 'Save view' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 5000 })

    const saved = (world.tables.saved_views as Row[]).find((view) => view.name === 'Quiet two months')
    expect(saved, 'the view was not written').toBeTruthy()
    expect(saved?.filters).toEqual({ days_since_contact_gte: 60 })
    expect(saved?.entity).toBe('contacts')
    // Shared by default: one small team, one shared vocabulary (06 §1).
    expect(saved?.is_shared).toBe(true)

    expect(await screen.findByRole('heading', { level: 1, name: 'Quiet two months' })).toBeInTheDocument()
  })

  it('reads the active view from the URL, so a pinned link lands on it', async () => {
    installWorld({ tables: seededMondayTables() })
    await renderApp('/contacts?view=view-quiet-90')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'No contact 90+ days' }, { timeout: 5000 }),
    ).toBeInTheDocument()
    // Dovid (184 days) and Katz (92 days).
    await waitFor(() => expect(list()?.children.length).toBe(2), { timeout: 5000 })
  })

  it('tells the truth when a queue is empty — a view at zero is the goal', async () => {
    const tables = seededMondayTables()
    tables.contact_stats = (tables.contact_stats as Row[]).map((row) => ({ ...row, is_lybunt: false }))
    installWorld({ tables })
    const user = userEvent.setup()
    await renderApp('/contacts')

    const bar = await screen.findByRole('region', { name: 'Views' })
    await user.click(await within(bar).findByRole('button', { name: /LYBUNT/ }))

    expect(
      await screen.findByText(/A queue at zero is the goal/, {}, { timeout: 5000 }),
    ).toBeInTheDocument()
  })
})

describe('sidebar · pinned views with live counts (06 §1)', () => {
  beforeEach(() => {
    freezeClock(MONDAY)
    window.localStorage.clear()
    installWorld({ tables: seededMondayTables() })
  })

  afterEach(() => {
    thawClock()
    resetWorld()
    vi.clearAllMocks()
  })

  it('lists the saved views and counts each one', async () => {
    await renderApp('/')
    const navs = await screen.findAllByRole('navigation', { name: 'Primary' })
    const sidebar = navs[0] as HTMLElement

    const lybunt = await within(sidebar).findByRole('link', { name: /LYBUNT/ }, { timeout: 5000 })
    await waitFor(() => expect(lybunt).toHaveTextContent('LYBUNT3'), { timeout: 5000 })

    const quiet = within(sidebar).getByRole('link', { name: /No contact 90\+ days/ })
    await waitFor(() => expect(quiet).toHaveTextContent('2'), { timeout: 5000 })

    // The tasks view counts open tasks due before today: Dovid's and Feld's.
    const overdue = within(sidebar).getByRole('link', { name: /Overdue follow-ups/ })
    await waitFor(() => expect(overdue).toHaveTextContent('2'), { timeout: 5000 })
  })

  it('points each view at the route that can work it', async () => {
    await renderApp('/')
    const navs = await screen.findAllByRole('navigation', { name: 'Primary' })
    const sidebar = navs[0] as HTMLElement

    const lybunt = await within(sidebar).findByRole('link', { name: /LYBUNT/ }, { timeout: 5000 })
    expect(lybunt).toHaveAttribute('href', '/contacts?view=view-lybunt')

    const overdue = within(sidebar).getByRole('link', { name: /Overdue follow-ups/ })
    expect(overdue).toHaveAttribute('href', '/tasks?due=overdue')
  })

  it('narrows the task list when an overdue view is opened', async () => {
    await renderApp('/tasks?due=overdue')
    await screen.findByRole('heading', { level: 1, name: 'Tasks' })

    const main = document.querySelector('main') as HTMLElement
    await waitFor(() => expect(within(main).getByText(/OVERDUE · 2/)).toBeInTheDocument(), {
      timeout: 5000,
    })
    expect(within(main).queryByText(/^TODAY ·/)).toBeNull()
    expect(within(main).getByRole('button', { name: /Overdue only/ })).toBeInTheDocument()
  })
})
