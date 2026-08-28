/**
 * Magic columns and the bulk sheet (03 §4, 06 §1).
 *
 * Two invariants carry most of the weight here:
 *
 *   - **I-8/I-9**: a magic column is a projection of `contact_stats`, never a
 *     client-side calculation. The sort tests pin that by asserting the order
 *     follows the view's numbers exactly, nulls last.
 *   - **I-12**: bulk mutations confirm rather than offering an undo toast. The
 *     render tests assert the dialog appears *before* anything is written.
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
const {
  COLUMNS_KEY,
  MAGIC_COLUMN_BY_ID,
  loadColumns,
  renderColumn,
  saveColumns,
  sortByColumn,
} = await import('../src/features/dataquality/magicColumns')
const { describeBulk, selectionCsv } = await import('../src/features/dataquality/bulkActions')

type Row = Record<string, unknown>

const row = (id: string, name: string, stats: Record<string, unknown> | null) =>
  ({
    contact: { id, first_name: name, last_name: '', organization: null, engagement_tier: 'warm' },
    stats,
  }) as never

/* ------------------------------------------------------------ pure pieces */

describe('magic columns', () => {
  beforeEach(() => window.localStorage.clear())

  it('projects the view\'s own numbers, formatted', () => {
    const column = MAGIC_COLUMN_BY_ID.this_year_giving
    expect(column.render({ this_year_giving: 1500 } as never)).toContain('1,500')
    // Nothing to say is an empty cell, not a zero.
    expect(column.render({ this_year_giving: 0 } as never)).toBe('')
    expect(column.render(null)).toBe('')
  })

  it('reads engagement tier off the contact, where the schema keeps it', () => {
    expect(renderColumn(MAGIC_COLUMN_BY_ID.engagement_tier, row('a', 'A', null))).toBe('Warm')
  })

  it('sorts by the column, sinking nulls whichever way it is sorted', () => {
    const rows = [
      row('a', 'A', { lifetime_giving: 100 }),
      row('b', 'B', null),
      row('c', 'C', { lifetime_giving: 5000 }),
    ]
    const column = MAGIC_COLUMN_BY_ID.lifetime_giving

    expect(sortByColumn(rows, column, 'desc').map((r) => r.contact.id)).toEqual(['c', 'a', 'b'])
    expect(sortByColumn(rows, column, 'asc').map((r) => r.contact.id)).toEqual(['a', 'c', 'b'])
  })

  it('remembers a choice per view, not globally', () => {
    saveColumns('Contacts', ['lifetime_giving'])
    saveColumns('LYBUNT', ['last_year_giving', 'days_since_contact'])

    expect(loadColumns('Contacts')).toEqual(['lifetime_giving'])
    expect(loadColumns('LYBUNT')).toEqual(['last_year_giving', 'days_since_contact'])
    expect(loadColumns('Never seen')).toEqual([])
  })

  it('drops a stored column that no longer exists', () => {
    window.localStorage.setItem(COLUMNS_KEY, JSON.stringify({ Contacts: ['lifetime_giving', 'gone'] }))
    expect(loadColumns('Contacts')).toEqual(['lifetime_giving'])
  })

  it('survives corrupt storage', () => {
    window.localStorage.setItem(COLUMNS_KEY, 'not json')
    expect(loadColumns('Contacts')).toEqual([])
  })
})

describe('selection CSV', () => {
  it('exports only what the rows already carry (11 §2)', () => {
    const csv = selectionCsv([
      {
        contact: {
          id: 'a', title: null, first_name: 'Dovid', last_name: 'Cohen', organization: 'Cohen & Partner',
          email: 'dovid@example.com', phone: '+447700900123', city: 'Golders Green',
          stage: 'in_discussion', priority: 'high',
        },
        // A restricted viewer's row has no amounts, so the file has none.
        stats: { days_since_contact: 12, this_year_giving: null, lifetime_giving: null, donor_status: 'active' },
      } as never,
    ])
    const [header, line] = csv.split('\n')
    expect(header).toBe(
      'Name,Organisation,Email,Phone,City,Stage,Priority,Days since contact,This year,Lifetime,Donor status',
    )
    expect(line).toBe('Dovid Cohen,Cohen & Partner,dovid@example.com,+447700900123,Golders Green,in_discussion,high,12,,,active')
  })

  it('quotes a value containing a comma', () => {
    const csv = selectionCsv([
      { contact: { id: 'a', first_name: 'Klein', last_name: 'Family', organization: 'Klein, Sons & Co' }, stats: null } as never,
    ])
    expect(csv.split('\n')[1]).toContain('"Klein, Sons & Co"')
  })
})

describe('describeBulk', () => {
  it('says what will happen, in the plural the count needs', () => {
    expect(describeBulk('tag', 40, 'VIP')).toBe('Adds the tag "VIP" to 40 contacts.')
    expect(describeBulk('task', 1, 'Call before Yom Tov')).toBe(
      'Creates one task ("Call before Yom Tov") for each of 1 contact — 1 tasks in all, ' +
        'queued rather than dated, so each can be given a day of its own.',
    )
    expect(describeBulk('priority', 3, 'high')).toBe('Sets priority to high on 3 contacts.')
  })
})

/* ------------------------------------------------------------- the screen */

describe('the contacts list', () => {
  beforeEach(() => {
    freezeClock(MONDAY)
    window.localStorage.clear()
  })

  afterEach(() => {
    thawClock()
    resetWorld()
    vi.clearAllMocks()
  })

  it('adds a magic column and remembers it', async () => {
    installWorld({ tables: seededMondayTables() })
    const user = userEvent.setup()
    await renderApp('/contacts')

    await screen.findByRole('heading', { level: 1, name: 'Contacts' })
    await user.click(screen.getByTestId('column-picker'))
    await user.click(await screen.findByRole('checkbox', { name: 'Lifetime' }))

    expect(loadColumns('Contacts')).toEqual(['lifetime_giving'])
    // The header strip appears with the column, sortable.
    expect(await screen.findByRole('button', { name: 'Lifetime' })).toBeInTheDocument()
  })

  it('raises the bulk sheet only while a selection exists', async () => {
    installWorld({ tables: seededMondayTables() })
    const user = userEvent.setup()
    await renderApp('/contacts')

    await screen.findByRole('heading', { level: 1, name: 'Contacts' })
    expect(screen.queryByTestId('bulk-sheet')).toBeNull()

    await user.click(await screen.findByRole('checkbox', { name: /Select Dovid Cohen/ }))
    const sheet = await screen.findByTestId('bulk-sheet')
    expect(within(sheet).getByText('1 contact selected')).toBeInTheDocument()

    await user.click(within(sheet).getByRole('button', { name: 'Clear selection' }))
    await waitFor(() => expect(screen.queryByTestId('bulk-sheet')).toBeNull())
  })

  it('confirms a bulk change before writing it (I-12)', async () => {
    const world = installWorld({ tables: seededMondayTables() })
    const user = userEvent.setup()
    await renderApp('/contacts')

    await screen.findByRole('heading', { level: 1, name: 'Contacts' })
    await user.click(await screen.findByRole('checkbox', { name: /Select Dovid Cohen/ }))
    const sheet = await screen.findByTestId('bulk-sheet')

    await user.selectOptions(within(sheet).getByLabelText('Priority'), 'low')
    await user.click(within(sheet).getByRole('button', { name: 'Set priority' }))

    // Nothing written yet — the dialog is the gate.
    expect(await screen.findByText('Sets priority to low on 1 contact.')).toBeInTheDocument()
    expect((world.tables.contacts as Row[]).find((r) => r.id === IDS.dovid)?.priority).toBe('high')

    await user.click(screen.getByRole('button', { name: 'Do it' }))
    await waitFor(() => {
      expect((world.tables.contacts as Row[]).find((r) => r.id === IDS.dovid)?.priority).toBe('low')
    })
  })

  it('creates one task per selected contact (I-2)', async () => {
    const world = installWorld({ tables: seededMondayTables() })
    const user = userEvent.setup()
    await renderApp('/contacts')

    await screen.findByRole('heading', { level: 1, name: 'Contacts' })
    await user.click(await screen.findByRole('checkbox', { name: /Select Dovid Cohen/ }))
    await user.click(await screen.findByRole('checkbox', { name: /Select Reuven Adler/ }))

    const sheet = await screen.findByTestId('bulk-sheet')
    await user.type(within(sheet).getByLabelText('Task title for each contact'), 'Call before Rosh Hashana')
    await user.click(within(sheet).getByRole('button', { name: 'Create task each' }))
    await user.click(await screen.findByRole('button', { name: 'Do it' }))

    await waitFor(() => {
      const created = (world.tables.tasks as Row[]).filter((t) => t.title === 'Call before Rosh Hashana')
      expect(created).toHaveLength(2)
      // Every task carries its own contact — never one task about two people.
      expect(new Set(created.map((t) => t.contact_id)).size).toBe(2)
      /*
       * …and every one of them satisfies the two check constraints on `tasks`,
       * which the in-memory stand-in does not enforce and the live database
       * very much does:
       *
       *   check (status in ('todo','in_progress','waiting','queued','done','cancelled'))
       *   check (status = 'queued' or due_on is not null)
       *
       * The sheet has no date field, so a dateless task must be a queued one.
       */
      for (const task of created) {
        expect(task.status).toBe('queued')
        expect(task.due_on ?? null).toBeNull()
      }
    })
  })

  it('selects every row shown in one tick', async () => {
    installWorld({ tables: seededMondayTables() })
    const user = userEvent.setup()
    await renderApp('/contacts')

    await screen.findByRole('heading', { level: 1, name: 'Contacts' })
    await user.click(await screen.findByRole('checkbox', { name: /Select Dovid Cohen/ }))
    await user.click(await screen.findByRole('checkbox', { name: 'Select every contact shown' }))

    const sheet = await screen.findByTestId('bulk-sheet')
    expect(within(sheet).getByText('10 contacts selected')).toBeInTheDocument()
  })
})
