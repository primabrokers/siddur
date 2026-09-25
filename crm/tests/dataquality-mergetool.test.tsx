/**
 * The duplicates queue and the merge tool, end to end (06 §5).
 *
 * The merge is executed by the real query module against the in-memory
 * PostgREST stand-in, so what these tests assert is the state of the tables
 * afterwards: the gift moved, the tag did not double, the loser is a tombstone
 * rather than a hole, and a note says what happened (11 §4).
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

type Row = Record<string, unknown>

const TWIN = 'aaaa0000-0000-0000-0000-0000000000ff'

function setViewport(desktop: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: desktop && query.includes('min-width'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  })
}

/**
 * The seeded Monday plus a thinner second Dovid Cohen: same phone, one gift,
 * one tag the survivor already carries, and a task. Exactly the shape a bad
 * import leaves behind.
 */
function duplicateWorld(role: 'admin' | 'fundraiser' = 'admin') {
  const tables = seededMondayTables()
  ;(tables.team_members as Row[])[0].role = role

  const dovid = (tables.contacts as Row[]).find((row) => row.id === IDS.dovid) as Row
  tables.contacts = [
    ...(tables.contacts as Row[]),
    {
      ...dovid,
      id: TWIN,
      first_name: 'David',
      last_name: 'Cohen',
      hebrew_name: null,
      organization: null,
      position: null,
      email: null,
      whatsapp: null,
      city: null,
      spouse_name: null,
      things_to_remember: null,
      mutual_connections: null,
      pinned_note_id: null,
      // The one thing the duplicate knows that the survivor does not.
      postcode: 'NW11 8AA',
    },
  ]

  tables.duplicates_queue = [
    {
      id: 'dupe-1',
      contact_a_id: IDS.dovid < TWIN ? IDS.dovid : TWIN,
      contact_b_id: IDS.dovid < TWIN ? TWIN : IDS.dovid,
      score: 0.85,
      reason: 'same phone',
      state: 'open',
      created_at: MONDAY.toISOString(),
    },
  ]

  tables.donations = [
    ...(tables.donations as Row[]),
    {
      id: 'gift-twin',
      contact_id: TWIN,
      donated_on: '2026-01-05',
      amount: 180,
      amount_gbp: 180,
      currency: 'GBP',
      fund_id: 'fund-general',
      status: 'received',
      receipt_status: 'not_sent',
      thank_you_status: 'not_done',
      gift_aid_status: 'ineligible',
      is_gasds: false,
    },
  ]

  tables.tasks = [
    ...(tables.tasks as Row[]),
    { id: 'task-twin', contact_id: TWIN, title: 'Ring back', status: 'open', priority: 'medium', due_on: null },
  ]

  const existingTag = (tables.taggings as Row[])[0]
  tables.taggings = [
    ...(tables.taggings as Row[]),
    // The same tag on both records — a naive re-parent would break the
    // (tag_id, contact_id) unique constraint.
    { id: 'tagging-twin', tag_id: existingTag.tag_id, contact_id: TWIN },
    { id: 'tagging-twin-2', tag_id: (tables.tags as Row[])[1].id, contact_id: TWIN },
  ]

  tables.pledges = tables.pledges ?? []
  tables.recurring_agreements = tables.recurring_agreements ?? []
  tables.soft_credits = tables.soft_credits ?? []
  tables.gift_aid_declarations = tables.gift_aid_declarations ?? []
  tables.opportunities = tables.opportunities ?? []
  tables.documents = tables.documents ?? []
  tables.households = tables.households ?? []
  return tables
}

const openPair = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('tab', { name: 'Duplicates' }))
  const list = await screen.findByTestId('duplicates-list', {}, { timeout: 5000 })
  await user.click(within(list).getByRole('button', { name: 'Open pair' }))
  await screen.findByTestId('merge-winner')
}

describe('duplicates queue', () => {
  beforeEach(() => {
    freezeClock(MONDAY)
    window.localStorage.clear()
    setViewport(true)
  })

  afterEach(() => {
    thawClock()
    resetWorld()
    vi.clearAllMocks()
  })

  it('lists the filed pairs with the reason the scan gave', async () => {
    installWorld({ tables: duplicateWorld() })
    const user = userEvent.setup()
    await renderApp('/import')

    await user.click(await screen.findByRole('tab', { name: 'Duplicates' }))
    const list = await screen.findByTestId('duplicates-list', {}, { timeout: 5000 })
    expect(within(list).getByText(/Dovid Cohen/)).toBeInTheDocument()
    expect(within(list).getByText(/same phone/)).toBeInTheDocument()
  })

  it('dismisses a pair without touching either record', async () => {
    const world = installWorld({ tables: duplicateWorld() })
    const user = userEvent.setup()
    await renderApp('/import')

    await user.click(await screen.findByRole('tab', { name: 'Duplicates' }))
    const list = await screen.findByTestId('duplicates-list', {}, { timeout: 5000 })
    await user.click(within(list).getByRole('button', { name: 'Not a duplicate' }))

    await waitFor(() => {
      expect((world.tables.duplicates_queue as Row[])[0].state).toBe('dismissed')
    })
    expect((world.tables.contacts as Row[]).find((row) => row.id === TWIN)?.merged_into_id).toBeNull()
  })

  it('shows a fundraiser the queue but no way to act on it (11 §1)', async () => {
    installWorld({ tables: duplicateWorld('fundraiser') })
    const user = userEvent.setup()
    await renderApp('/import')

    await user.click(await screen.findByRole('tab', { name: 'Duplicates' }))
    const list = await screen.findByTestId('duplicates-list', {}, { timeout: 5000 })
    expect(within(list).getByRole('button', { name: 'Open pair' })).toBeDisabled()
    expect(screen.getByText(/Merging is admin-only/)).toBeInTheDocument()
  })
})

describe('merge tool', () => {
  beforeEach(() => {
    freezeClock(MONDAY)
    window.localStorage.clear()
    setViewport(true)
  })

  afterEach(() => {
    thawClock()
    resetWorld()
    vi.clearAllMocks()
  })

  it('defaults the survivor to the more complete record', async () => {
    installWorld({ tables: duplicateWorld() })
    const user = userEvent.setup()
    await renderApp('/import')
    await openPair(user)

    const winner = screen.getByTestId('merge-winner')
    expect(within(winner).getByText('Dovid Cohen')).toBeInTheDocument()
    expect(within(screen.getByTestId('merge-loser')).getByText('David Cohen')).toBeInTheDocument()
  })

  it('swaps which record survives on request', async () => {
    installWorld({ tables: duplicateWorld() })
    const user = userEvent.setup()
    await renderApp('/import')
    await openPair(user)

    await user.click(screen.getByRole('button', { name: 'Swap which one survives' }))
    expect(within(screen.getByTestId('merge-winner')).getByText('David Cohen')).toBeInTheDocument()
  })

  it('re-parents every child, tombstones the loser and leaves a note', async () => {
    const world = installWorld({ tables: duplicateWorld() })
    const user = userEvent.setup()
    await renderApp('/import')
    await openPair(user)

    await user.click(screen.getByTestId('merge-submit'))
    await user.click(await screen.findByRole('button', { name: 'Merge' }))

    await waitFor(() => {
      expect((world.tables.contacts as Row[]).find((row) => row.id === TWIN)?.merged_into_id).toBe(IDS.dovid)
    })

    const twin = (world.tables.contacts as Row[]).find((row) => row.id === TWIN)
    expect(twin?.is_archived).toBe(true)
    // Never deleted: the tombstone is what keeps old links resolving.
    expect(twin).toBeTruthy()

    expect((world.tables.donations as Row[]).find((row) => row.id === 'gift-twin')?.contact_id).toBe(IDS.dovid)
    expect((world.tables.tasks as Row[]).find((row) => row.id === 'task-twin')?.contact_id).toBe(IDS.dovid)

    // The gap the duplicate could fill was filled; nothing else was overwritten.
    const survivor = (world.tables.contacts as Row[]).find((row) => row.id === IDS.dovid)
    expect(survivor?.postcode).toBe('NW11 8AA')
    expect(survivor?.first_name).toBe('Dovid')

    const note = (world.tables.notes as Row[]).find(
      (row) => row.contact_id === IDS.dovid && String(row.body).startsWith('Merged duplicate record'),
    )
    expect(note).toBeTruthy()
    expect(String(note?.body)).toContain('tombstone')

    expect((world.tables.duplicates_queue as Row[])[0].state).toBe('merged')
  })

  it('does not leave two copies of a tag both records carried', async () => {
    const world = installWorld({ tables: duplicateWorld() })
    const user = userEvent.setup()
    await renderApp('/import')
    await openPair(user)

    await user.click(screen.getByTestId('merge-submit'))
    await user.click(await screen.findByRole('button', { name: 'Merge' }))

    await waitFor(() => {
      expect((world.tables.contacts as Row[]).find((row) => row.id === TWIN)?.merged_into_id).toBe(IDS.dovid)
    })

    const onSurvivor = (world.tables.taggings as Row[]).filter((row) => row.contact_id === IDS.dovid)
    const tagIds = onSurvivor.map((row) => row.tag_id)
    expect(new Set(tagIds).size).toBe(tagIds.length)
    // The tag only the duplicate had came across.
    expect(tagIds).toContain((world.tables.tags as Row[])[1].id)
  })

  it('refuses to merge the organisation record (I-2)', async () => {
    const tables = duplicateWorld()
    ;(tables.contacts as Row[]).find((row) => row.id === TWIN)!.is_organisation_self = true
    installWorld({ tables })
    const user = userEvent.setup()
    await renderApp('/import')
    await user.click(await screen.findByRole('tab', { name: 'Duplicates' }))
    const list = await screen.findByTestId('duplicates-list', {}, { timeout: 5000 })
    await user.click(within(list).getByRole('button', { name: 'Open pair' }))

    expect(await screen.findByText(/anchors admin tasks and cannot be merged/)).toBeInTheDocument()
    expect(screen.getByTestId('merge-submit')).toBeDisabled()
  })
})
