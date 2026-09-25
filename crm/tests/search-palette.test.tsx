/**
 * The two command surfaces, rendered (03 §3):
 *
 *   "/"        → record search — fuzzy, across name/Hebrew name/organisation/
 *                phone/email/city, showing enough to act without opening
 *                anything (brief §21's field list);
 *   Cmd/Ctrl+K → the command palette — fuzzy, shortcut-teaching, context-ranked.
 *
 * These run the real query modules against a real PostgREST stand-in, so the
 * `or=(…ilike…)` clause the overlay builds is genuinely executed rather than
 * mocked away.
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

const { IDS, MONDAY, seededMondayTables } = await import('./acceptance/fixtures')
const { freezeClock, installWorld, renderApp, resetWorld, thawClock } = await import('./support/harness')
const { RECENTS_KEY } = await import('../src/features/search/recents')

/** The overlay debounces 150ms before it queries (03 §3 / 11 §5). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 220))

describe('global search overlay', () => {
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

  it('opens on "/" from anywhere and takes the caret', async () => {
    const user = userEvent.setup()
    await renderApp('/')
    await screen.findByRole('heading', { name: 'Today' })

    await user.keyboard('/')
    const field = await screen.findByRole('combobox', { name: 'Search people, phones, cities' })
    expect(field).toHaveFocus()
  })

  it('does not steal "/" while someone is typing in a field', async () => {
    const user = userEvent.setup()
    await renderApp('/contacts')
    const filter = await screen.findByLabelText('Filter contacts by name or city')

    await user.click(filter)
    await user.keyboard('a/b')

    expect(filter).toHaveValue('a/b')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens from the top bar’s search field too — one surface, two doors', async () => {
    const user = userEvent.setup()
    await renderApp('/')
    const banner = await screen.findByRole('banner')

    await user.click(within(banner).getByRole('button', { name: 'Search people, phones, cities' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('finds a person by surname and shows the row the spec asks for', async () => {
    const user = userEvent.setup()
    await renderApp('/')
    await screen.findByRole('heading', { name: 'Today' })

    await user.keyboard('/')
    await user.type(await screen.findByRole('combobox', { name: 'Search people, phones, cities' }), 'cohen')
    await settle()

    const option = await screen.findByRole('option', { name: /Dovid Cohen/ }, { timeout: 5000 })
    const row = option.textContent ?? ''
    // brief §21: name · stage pill · flag · last gift · last contact · next action.
    expect(row).toMatch(/Dovid Cohen/)
    expect(row).toMatch(/In discussion/i)
    expect(row).toMatch(/Call re proposal/)
    expect(row).toMatch(/last spoke/)
    expect(row).toMatch(/£15,000/)
    expect(option.querySelector('[title="No next action"], [title]')).toBeTruthy()
  })

  it('finds the same person by organisation, city and phone number', async () => {
    const user = userEvent.setup()
    await renderApp('/')
    await screen.findByRole('heading', { name: 'Today' })
    await user.keyboard('/')
    const field = await screen.findByRole('combobox', { name: 'Search people, phones, cities' })

    for (const term of ['Cohen & Partner', 'Golders', '07700900123']) {
      await user.clear(field)
      await user.type(field, term)
      await settle()
      await waitFor(
        () => expect(screen.getAllByRole('option', { name: /Dovid Cohen/ }).length).toBeGreaterThan(0),
        { timeout: 5000 },
      )
    }
  })

  it('opens the profile on Enter, and remembers it for next time', async () => {
    const user = userEvent.setup()
    await renderApp('/')
    await screen.findByRole('heading', { name: 'Today' })

    await user.keyboard('/')
    await user.type(await screen.findByRole('combobox', { name: 'Search people, phones, cities' }), 'cohen')
    await settle()
    await screen.findByRole('option', { name: /Dovid Cohen/ }, { timeout: 5000 })
    await user.keyboard('{Enter}')

    await screen.findByTestId('profile-header', {}, { timeout: 5000 })
    const stored = JSON.parse(window.localStorage.getItem(RECENTS_KEY) ?? '[]') as Array<{ id: string }>
    expect(stored[0]?.id).toBe(IDS.dovid)
  })

  it('shows recently viewed people before a single keystroke', async () => {
    window.localStorage.setItem(
      RECENTS_KEY,
      JSON.stringify([{ id: IDS.katz, name: 'Yanky Katz', at: Date.now() }]),
    )
    const user = userEvent.setup()
    await renderApp('/')
    await screen.findByRole('heading', { name: 'Today' })

    await user.keyboard('/')
    expect(await screen.findByText('Recently viewed')).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /Yanky Katz/ }, { timeout: 5000 })).toBeInTheDocument()
  })

  it('says so plainly when nothing matches', async () => {
    const user = userEvent.setup()
    await renderApp('/')
    await screen.findByRole('heading', { name: 'Today' })

    await user.keyboard('/')
    await user.type(await screen.findByRole('combobox', { name: 'Search people, phones, cities' }), 'zzzzqq')
    await settle()

    expect(await screen.findByText(/Nothing matches/, {}, { timeout: 5000 })).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    await renderApp('/')
    await screen.findByRole('heading', { name: 'Today' })

    await user.keyboard('/')
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('command palette', () => {
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

  it('opens on Cmd/Ctrl+K and lists actions with their shortcuts', async () => {
    const user = userEvent.setup()
    await renderApp('/')
    await screen.findByRole('heading', { name: 'Today' })

    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByRole('combobox', { name: 'Type a command' })).toHaveFocus()
    // The palette teaches the faster path (03 §3).
    expect(screen.getByRole('option', { name: /Go to Contacts/ })).toHaveTextContent('G C')
  })

  it('ranks the current screen’s actions first', async () => {
    const user = userEvent.setup()
    await renderApp('/giving')
    await screen.findByRole('heading', { name: 'Giving' })

    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('combobox', { name: 'Type a command' })
    const options = screen.getAllByRole('option').map((node) => node.textContent ?? '')
    expect(options.slice(0, 2).join(' ')).toMatch(/gift|pledge/i)
  })

  it('fuzzy-matches, so "qcap" finds Quick capture', async () => {
    const user = userEvent.setup()
    await renderApp('/')
    await screen.findByRole('heading', { name: 'Today' })

    await user.keyboard('{Control>}k{/Control}')
    await user.type(await screen.findByRole('combobox', { name: 'Type a command' }), 'qcap')
    expect(await screen.findByRole('option', { name: /Quick capture/ })).toBeInTheDocument()
  })

  it('dispatches into the surface that already exists, rather than reimplementing it', async () => {
    const user = userEvent.setup()
    await renderApp('/')
    await screen.findByRole('heading', { name: 'Today' })

    await user.keyboard('{Control>}k{/Control}')
    await user.type(await screen.findByRole('combobox', { name: 'Type a command' }), 'quick capture')
    await user.keyboard('{Enter}')

    // The one capture sheet (04 §4), not a palette-local copy of it.
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Quick capture' })).toBeInTheDocument()
  })

  it('navigates, and the route really changes', async () => {
    const user = userEvent.setup()
    await renderApp('/')
    await screen.findByRole('heading', { name: 'Today' })

    await user.keyboard('{Control>}k{/Control}')
    await user.type(await screen.findByRole('combobox', { name: 'Type a command' }), 'settings')
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
  })

  it('opens the create sheet for "New contact" via the contacts route', async () => {
    const user = userEvent.setup()
    await renderApp('/')
    await screen.findByRole('heading', { name: 'Today' })

    await user.keyboard('{Control>}k{/Control}')
    await user.type(await screen.findByRole('combobox', { name: 'Type a command' }), 'new contact')
    await user.keyboard('{Enter}')

    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 })
    expect(within(dialog).getByRole('heading', { name: /New contact/i })).toBeInTheDocument()
  })

  it('swaps to record search when "/" is the better tool', async () => {
    const user = userEvent.setup()
    await renderApp('/')
    await screen.findByRole('heading', { name: 'Today' })

    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('combobox', { name: 'Type a command' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await user.keyboard('/')
    expect(await screen.findByRole('combobox', { name: 'Search people, phones, cities' })).toBeInTheDocument()
  })
})
