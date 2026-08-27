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

const { findDuplicates } = await import('../src/lib/queries/contacts')

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
