/**
 * The import wizard end to end (06 §5) — the file goes in, the batch comes
 * out, and the batch can be taken back.
 *
 * Rendered against the in-memory PostgREST stand-in, so the *real* query
 * module does the writing: what these tests assert is the state of the tables
 * afterwards, not what a mock was called with. That is the only way the undo
 * story can be tested honestly, because undo is defined in terms of what is
 * still in the database.
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

/** The wizard's own tables on top of the seeded Monday. */
function importWorld(role: 'admin' | 'fundraiser' = 'admin') {
  const tables = seededMondayTables()
  tables.import_batches = []
  ;(tables.team_members as Row[])[0].role = role
  return tables
}

/**
 * `matchMedia` decides whether the route renders at all — the wizard is
 * desktop-only (06 §5) and jsdom reports no media by default.
 */
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

const csvFile = (body: string, name = 'book.csv') =>
  new File([body], name, { type: 'text/csv' })

/** Two new people, one already on file by email, one gift. */
const SHEET = [
  'First Name,Surname,E-mail Address,Mobile,Town,Amount,Date Given,Fund',
  'SHLOIMY,fischer,shloimy@example.com,07700 900321,hendon,500,15/03/2024,General',
  'malky,gross,malky@example.com,,manchester,,,',
  'David,Cohen,dovid.cohen@example.com,,,250,20/03/2024,General',
].join('\n')

async function uploadSheet(user: ReturnType<typeof userEvent.setup>, body = SHEET) {
  await screen.findByText('Drop the spreadsheet here')
  await user.upload(screen.getByLabelText('CSV file'), csvFile(body))
  // The upload step advances itself once the file parses.
  await screen.findByText('Column in the file', {}, { timeout: 5000 })
}

const next = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByTestId('import-next'))
}

describe('import wizard', () => {
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

  it('refuses to render on a phone, and says what to do instead', async () => {
    setViewport(false)
    installWorld({ tables: importWorld() })
    await renderApp('/import')
    expect(await screen.findByText('This one needs a bigger screen')).toBeInTheDocument()
  })

  it('guesses the mapping from the sheet\'s own headers', async () => {
    installWorld({ tables: importWorld() })
    const user = userEvent.setup()
    await renderApp('/import')
    await uploadSheet(user)

    expect((screen.getByLabelText('What "First Name" imports as') as HTMLSelectElement).value).toBe('first_name')
    expect((screen.getByLabelText('What "Surname" imports as') as HTMLSelectElement).value).toBe('last_name')
    expect((screen.getByLabelText('What "E-mail Address" imports as') as HTMLSelectElement).value).toBe('email')
    expect((screen.getByLabelText('What "Mobile" imports as') as HTMLSelectElement).value).toBe('phone')
    expect((screen.getByLabelText('What "Amount" imports as') as HTMLSelectElement).value).toBe('gift_amount')
    expect((screen.getByLabelText('What "Date Given" imports as') as HTMLSelectElement).value).toBe('gift_date')
  })

  it('shows every rewrite before anything is written', async () => {
    installWorld({ tables: importWorld() })
    const user = userEvent.setup()
    await renderApp('/import')
    await uploadSheet(user)
    await next(user)

    const table = await screen.findByTestId('import-preview-table')
    expect(within(table).getByText('+447700900321')).toBeInTheDocument()
    expect(within(table).getByText('Shloimy')).toBeInTheDocument()
    expect(within(table).getByText('2024-03-15')).toBeInTheDocument()
  })

  it('flags the row that matches somebody already on file', async () => {
    installWorld({ tables: importWorld() })
    const user = userEvent.setup()
    await renderApp('/import')
    await uploadSheet(user)
    await next(user) // preview
    await next(user) // dedupe

    // Row 3 shares Dovid Cohen's email, so it is proposed as a fill-in.
    const card = await screen.findByTestId('dedupe-row-3', {}, { timeout: 5000 })
    expect(within(card).getByText(/the same email address/)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Fill in the existing one' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('summarises the run in one sentence', async () => {
    installWorld({ tables: importWorld() })
    const user = userEvent.setup()
    await renderApp('/import')
    await uploadSheet(user)
    await next(user)
    await next(user)
    await screen.findByTestId('dedupe-row-3', {}, { timeout: 5000 })
    await next(user)

    const sentence = await screen.findByTestId('dryrun-sentence')
    expect(sentence.textContent).toBe('2 contacts, 1 filled in, 2 gifts')
  })

  it('commits, stamping every row with the batch', async () => {
    const world = installWorld({ tables: importWorld() })
    const user = userEvent.setup()
    await renderApp('/import')
    await uploadSheet(user)
    await next(user)
    await next(user)
    await screen.findByTestId('dedupe-row-3', {}, { timeout: 5000 })
    await next(user)
    await user.click(await screen.findByTestId('import-commit'))

    await screen.findByTestId('import-done', {}, { timeout: 5000 })

    const batches = world.tables.import_batches as Row[]
    expect(batches).toHaveLength(1)
    expect(batches[0]).toMatchObject({ filename: 'book.csv', status: 'committed', contact_count: 2 })

    const batchId = batches[0].id
    const imported = (world.tables.contacts as Row[]).filter((row) => row.import_batch === batchId)
    expect(imported.map((row) => row.last_name).sort()).toEqual(['Fischer', 'Gross'])
    // Titles and phones were normalised on the way in (02 §6).
    expect(imported.find((row) => row.last_name === 'Fischer')).toMatchObject({
      first_name: 'Shloimy',
      phone: '+447700900321',
      city: 'Hendon',
    })

    const gifts = (world.tables.donations as Row[]).filter((row) => row.import_batch === batchId)
    expect(gifts).toHaveLength(2)
    expect(gifts.every((gift) => gift.fund_id === 'fund-general')).toBe(true)
    // The gift on the matched row hangs off the existing contact, not a copy.
    expect(gifts.some((gift) => gift.contact_id === IDS.dovid)).toBe(true)
  })

  it('fills only the blanks on the record it matched', async () => {
    const world = installWorld({ tables: importWorld() })
    const user = userEvent.setup()
    await renderApp('/import')
    await uploadSheet(user)
    await next(user)
    await next(user)
    await screen.findByTestId('dedupe-row-3', {}, { timeout: 5000 })
    await next(user)
    await user.click(await screen.findByTestId('import-commit'))
    await screen.findByTestId('import-done', {}, { timeout: 5000 })

    const dovid = (world.tables.contacts as Row[]).find((row) => row.id === IDS.dovid)
    // The sheet said "David"; the record says "Dovid" and keeps saying it.
    expect(dovid?.first_name).toBe('Dovid')
    expect(dovid?.import_batch).toBeUndefined()
  })

  it('undoes the whole batch, and says what it removed', async () => {
    const world = installWorld({ tables: importWorld() })
    const user = userEvent.setup()
    await renderApp('/import')
    await uploadSheet(user)
    await next(user)
    await next(user)
    await screen.findByTestId('dedupe-row-3', {}, { timeout: 5000 })
    await next(user)
    await user.click(await screen.findByTestId('import-commit'))
    await screen.findByTestId('import-done', {}, { timeout: 5000 })

    const before = (world.tables.contacts as Row[]).length
    await user.click(screen.getByTestId('import-undo'))
    await user.click(await screen.findByRole('button', { name: 'Undo the import' }))

    await screen.findByTestId('import-undone', {}, { timeout: 5000 })
    await waitFor(() => {
      expect((world.tables.contacts as Row[]).length).toBe(before - 2)
    })
    expect((world.tables.donations as Row[]).filter((row) => row.import_batch)).toHaveLength(0)
    // Dovid Cohen is untouched: the batch never created him.
    expect((world.tables.contacts as Row[]).some((row) => row.id === IDS.dovid)).toBe(true)
    expect((world.tables.import_batches as Row[])[0].status).toBe('undone')
  })

  it('offers a fundraiser the wizard but not the undo (11 §1)', async () => {
    installWorld({ tables: importWorld('fundraiser') })
    const user = userEvent.setup()
    await renderApp('/import')
    await uploadSheet(user, 'First Name,Surname\nShloimy,Fischer')
    await next(user)
    await next(user)
    await next(user)
    await user.click(await screen.findByTestId('import-commit'))

    await screen.findByTestId('import-done', {}, { timeout: 5000 })
    expect(screen.getByTestId('import-undo')).toBeDisabled()
    expect(screen.getByText(/admin only/)).toBeInTheDocument()
  })

  it('imports a contacts-only sheet with no gift columns at all', async () => {
    const world = installWorld({ tables: importWorld() })
    const user = userEvent.setup()
    await renderApp('/import')
    await uploadSheet(user, 'First Name,Surname,Town\nShloimy,Fischer,Hendon')
    await next(user)
    await next(user)
    await next(user)
    expect((await screen.findByTestId('dryrun-sentence')).textContent).toBe('1 contact')

    await user.click(await screen.findByTestId('import-commit'))
    await screen.findByTestId('import-done', {}, { timeout: 5000 })
    expect((world.tables.donations as Row[]).filter((row) => row.import_batch)).toHaveLength(0)
  })

  it('offers to create a fund the sheet mentions and we do not have', async () => {
    installWorld({ tables: importWorld() })
    const user = userEvent.setup()
    await renderApp('/import')
    await uploadSheet(
      user,
      'First Name,Surname,Amount,Date Given,Fund\nShloimy,Fischer,100,01/01/2024,Kollel',
    )
    await next(user)
    await next(user)
    await next(user)

    expect(await screen.findByText('Kollel')).toBeInTheDocument()
    expect(screen.getByText('gifts skipped')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /Kollel/ }))
    expect(screen.getByText('will be created')).toBeInTheDocument()
  })

  it('holds a name-only match rather than importing or discarding it', async () => {
    installWorld({ tables: importWorld() })
    const user = userEvent.setup()
    await renderApp('/import')
    // Same name as the seeded Yaakov Weiss, no email or phone to confirm it.
    await uploadSheet(user, 'First Name,Surname\nYaakov,Weiss')
    await next(user)
    await next(user)

    const card = await screen.findByTestId('dedupe-row-1', {}, { timeout: 5000 })
    expect(within(card).getByRole('button', { name: 'Hold for review' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await next(user)
    expect((await screen.findByTestId('dryrun-sentence')).textContent).toBe(
      '0 contacts, 1 held for review',
    )
  })
})
