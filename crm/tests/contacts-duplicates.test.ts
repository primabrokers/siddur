import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContactRow } from '../src/features/contacts/types'

/**
 * The duplicate check as it actually runs (02 §6): which queries go out, and
 * how their results are merged, de-duplicated and ranked.
 */

interface Recorded {
  table: string
  filters: Array<[string, string, unknown]>
}

const recorded: Recorded[] = []
let responses: ContactRow[][] = []

function builder(table: string) {
  const entry: Recorded = { table, filters: [] }
  recorded.push(entry)
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'ilike', 'in', 'is', 'order', 'limit']) {
    chain[method] = (...args: unknown[]) => {
      if (method === 'eq' || method === 'ilike') entry.filters.push([method, String(args[0]), args[1]])
      return chain
    }
  }
  chain.then = (resolve: (value: { data: ContactRow[]; error: null }) => unknown) =>
    Promise.resolve(resolve({ data: responses.shift() ?? [], error: null }))
  return chain
}

vi.mock('../src/lib/supabase', () => ({
  supabase: { from: (table: string) => builder(table) },
  isConfigured: true,
}))
vi.mock('../src/lib/env', () => ({ isConfigured: true, SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }))

/** Capture the options each hook hands to useQuery, so a data path can be run
 *  without mounting React. */
let lastQueryOptions: { queryFn: () => Promise<any> } | null = null
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryFn: () => Promise<unknown> }) => {
    lastQueryOptions = options as { queryFn: () => Promise<any> }
    return { data: undefined, isLoading: false, error: null }
  },
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), cancelQueries: vi.fn(), getQueryData: vi.fn(), setQueryData: vi.fn() }),
}))

const { findDuplicates, useContactGiving } = await import('../src/lib/queries/contacts')

const contact = (over: Partial<ContactRow>): ContactRow =>
  ({
    id: 'x',
    first_name: 'Dovid',
    last_name: 'Cohen',
    email: null,
    phone: null,
    whatsapp: null,
    organization: null,
    is_archived: false,
    ...over,
  }) as ContactRow

describe('findDuplicates', () => {
  beforeEach(() => {
    recorded.length = 0
    responses = []
  })

  it('queries the normalised email, both phone columns and the surname', async () => {
    await findDuplicates({
      first_name: 'Dovid',
      last_name: 'Cohen',
      email: '  Dovid@Example.com ',
      phone: '07700 900123',
    })

    const filters = recorded.flatMap((r) => r.filters)
    expect(recorded.every((r) => r.table === 'contacts')).toBe(true)
    expect(filters).toContainEqual(['ilike', 'email', 'dovid@example.com'])
    expect(filters).toContainEqual(['eq', 'phone', '+447700900123'])
    expect(filters).toContainEqual(['eq', 'whatsapp', '+447700900123'])
    expect(filters).toContainEqual(['ilike', 'last_name', 'Cohen'])
  })

  it('falls back to the first name when there is no surname', async () => {
    await findDuplicates({ first_name: 'Dovid' })
    expect(recorded.flatMap((r) => r.filters)).toContainEqual(['ilike', 'first_name', 'Dovid'])
  })

  it('issues no query at all when there is nothing to match on', async () => {
    expect(await findDuplicates({ first_name: '   ' })).toEqual([])
    expect(recorded).toHaveLength(0)
  })

  it('merges results, drops archived rows and the record being edited', async () => {
    responses = [
      [contact({ id: 'same-email', email: 'dovid@example.com', first_name: 'Zev', last_name: 'Roth' })],
      [contact({ id: 'self', email: 'dovid@example.com' })],
      [contact({ id: 'archived', is_archived: true })],
      [contact({ id: 'same-email' }), contact({ id: 'similar', first_name: 'David' })],
    ]

    const matches = await findDuplicates(
      { first_name: 'Dovid', last_name: 'Cohen', email: 'dovid@example.com', phone: '07700900123' },
      'self',
    )

    const ids = matches.map((m) => m.contact.id)
    expect(ids).toContain('same-email')
    expect(ids).toContain('similar')
    expect(ids).not.toContain('self')
    expect(ids).not.toContain('archived')
    // Deduplicated across the per-signal queries.
    expect(ids.filter((id) => id === 'same-email')).toHaveLength(1)
    // Email match outranks the name-only match.
    expect(ids[0]).toBe('same-email')
  })

  it('reports no duplicates when nothing comes back', async () => {
    expect(await findDuplicates({ first_name: 'Chaim', last_name: 'Lax' })).toEqual([])
  })
})

/**
 * Amounts and private notes must never be fetched through a path that bypasses
 * the redacted views (CLAUDE.md rule 7 / 11 §2). `donations_sel` requires
 * `crm_can_see_amounts()`, so a restricted viewer gets zero rows from
 * `donations` — the reader must fall back to `donations_redacted` rather than
 * reporting "never gave".
 */
describe('gift reads honour the redacted view', () => {
  beforeEach(() => {
    recorded.length = 0
    responses = []
  })

  it('falls back to donations_redacted when donations yields nothing', async () => {
    const gift = { id: 'd1', contact_id: 'c1', donated_on: '2026-03-12', amount: null, amount_gbp: null }
    // Promise.all starts donations, pledges and recurring in the same tick;
    // the redacted retry only happens after donations comes back empty.
    responses = [
      [], // donations — RLS hides every row from this member
      [], // pledges
      [], // recurring_agreements
      [gift] as never, // donations_redacted
    ]

    const result = await runGivingQuery('c1')

    expect(recorded.map((r) => r.table)).toContain('donations')
    expect(recorded.map((r) => r.table)).toContain('donations_redacted')
    expect(result.donations).toHaveLength(1)
    expect(result.amountsHidden).toBe(true)
  })

  it('uses donations directly, and never the redacted view, when amounts are visible', async () => {
    const gift = { id: 'd1', contact_id: 'c1', donated_on: '2026-03-12', amount: 500, amount_gbp: 500 }
    responses = [[gift] as never, [], []]

    const result = await runGivingQuery('c1')

    expect(recorded.map((r) => r.table)).not.toContain('donations_redacted')
    expect(result.amountsHidden).toBe(false)
    expect(result.donations[0]?.amount_gbp).toBe(500)
  })

  it('reports an empty ledger, not hidden amounts, when the donor simply never gave', async () => {
    responses = [[], [], [], []]
    const result = await runGivingQuery('c1')
    expect(result.donations).toEqual([])
    expect(result.amountsHidden).toBe(false)
  })
})

/** Invoke the hook's queryFn directly — no React needed for a data-path test. */
async function runGivingQuery(id: string) {
  lastQueryOptions = null
  useContactGiving(id)
  const options = lastQueryOptions as { queryFn: () => Promise<any> } | null
  if (!options) throw new Error('useContactGiving did not register a query')
  return options.queryFn()
}
