/**
 * An in-memory stand-in for `supabase-js` — **tests only**.
 *
 * It speaks the slice of PostgREST this codebase actually uses (`select` with
 * `eq/neq/in/is/gt/gte/lt/lte/ilike/or/order/limit/range`, `single` /
 * `maybeSingle`, plus `insert` / `update` / `upsert` / `delete`) over plain
 * arrays of rows, so a test can exercise the *real* query modules and the
 * *real* components against deterministic data with no server, no network and
 * no clock skew.
 *
 * Why not point the tests at `e2e/fixture-server.mjs`? Because a test suite
 * that needs a process running is a test suite that does not run in CI by
 * accident. The dataset is shared instead (`tests/acceptance/fixtures.ts`), so
 * the browser harness and the unit harness describe the same world.
 *
 * Deliberately strict about one thing: filter semantics match Postgres, not
 * JavaScript. `gte` on a null column excludes the row, `in` compares as text,
 * and ordering is stable — the acceptance tests lean on all three.
 */

export type Row = Record<string, unknown>
export type Tables = Record<string, Row[]>

type Predicate = (row: Row) => boolean

interface OrderSpec {
  column: string
  ascending: boolean
}

const asText = (value: unknown): string => (value === null || value === undefined ? '' : String(value))

/** `*` and `%` both mean "anything" — PostgREST accepts either in `ilike`. */
function likeToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

function compare(a: unknown, b: unknown): number {
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb) && a !== '' && b !== '') return na - nb
  return asText(a).localeCompare(asText(b))
}

/** One `col.op.value` term from an `or=(…)` clause. */
function parseOrTerm(term: string): Predicate {
  const [column, op, ...rest] = term.split('.')
  const value = rest.join('.')
  if (!column || !op) return () => false
  switch (op) {
    case 'eq':
      return (row) => asText(row[column]) === value
    case 'neq':
      return (row) => asText(row[column]) !== value
    case 'ilike': {
      const re = likeToRegExp(value)
      return (row) => row[column] !== null && row[column] !== undefined && re.test(asText(row[column]))
    }
    case 'is':
      return (row) => (value === 'null' ? row[column] === null || row[column] === undefined : row[column] !== null)
    case 'gte':
      return (row) => row[column] !== null && compare(row[column], value) >= 0
    case 'gt':
      return (row) => row[column] !== null && compare(row[column], value) > 0
    case 'lte':
      return (row) => row[column] !== null && compare(row[column], value) <= 0
    case 'lt':
      return (row) => row[column] !== null && compare(row[column], value) < 0
    default:
      return () => false
  }
}

export interface FakeQueryResult<T = Row> {
  data: T | null
  error: { message: string } | null
}

class FakeQuery implements PromiseLike<FakeQueryResult<Row[] | Row | null>> {
  private predicates: Predicate[] = []
  private orders: OrderSpec[] = []
  private limitValue: number | null = null
  private singleMode: 'none' | 'single' | 'maybe' = 'none'
  private mode: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private payload: Row[] = []
  private patch: Row = {}
  private conflictColumn: string | null = null

  constructor(
    private readonly tables: Tables,
    private readonly table: string,
    private readonly onWrite: (table: string) => void,
  ) {}

  private get rows(): Row[] {
    return this.tables[this.table] ?? []
  }

  /* ------------------------------------------------------------ builders */

  select(): this {
    return this
  }

  eq(column: string, value: unknown): this {
    this.predicates.push((row) => asText(row[column]) === asText(value))
    return this
  }

  neq(column: string, value: unknown): this {
    this.predicates.push((row) => asText(row[column]) !== asText(value))
    return this
  }

  in(column: string, values: unknown[]): this {
    const set = new Set((values ?? []).map(asText))
    this.predicates.push((row) => set.has(asText(row[column])))
    return this
  }

  is(column: string, value: unknown): this {
    this.predicates.push((row) =>
      value === null ? row[column] === null || row[column] === undefined : row[column] === value,
    )
    return this
  }

  gt(column: string, value: unknown): this {
    this.predicates.push((row) => row[column] !== null && row[column] !== undefined && compare(row[column], value) > 0)
    return this
  }

  gte(column: string, value: unknown): this {
    this.predicates.push((row) => row[column] !== null && row[column] !== undefined && compare(row[column], value) >= 0)
    return this
  }

  lt(column: string, value: unknown): this {
    this.predicates.push((row) => row[column] !== null && row[column] !== undefined && compare(row[column], value) < 0)
    return this
  }

  lte(column: string, value: unknown): this {
    this.predicates.push((row) => row[column] !== null && row[column] !== undefined && compare(row[column], value) <= 0)
    return this
  }

  ilike(column: string, pattern: string): this {
    const re = likeToRegExp(pattern)
    this.predicates.push(
      (row) => row[column] !== null && row[column] !== undefined && re.test(asText(row[column])),
    )
    return this
  }

  or(clause: string): this {
    const terms = clause.split(',').map(parseOrTerm)
    this.predicates.push((row) => terms.some((term) => term(row)))
    return this
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orders.push({ column, ascending: options?.ascending !== false })
    return this
  }

  limit(count: number): this {
    this.limitValue = count
    return this
  }

  range(from: number, to: number): this {
    this.limitValue = to - from + 1
    return this
  }

  single(): this {
    this.singleMode = 'single'
    return this
  }

  maybeSingle(): this {
    this.singleMode = 'maybe'
    return this
  }

  /* ------------------------------------------------------------ mutations */

  insert(rows: Row | Row[]): this {
    this.mode = 'insert'
    this.payload = Array.isArray(rows) ? rows : [rows]
    return this
  }

  update(patch: Row): this {
    this.mode = 'update'
    this.patch = patch
    return this
  }

  upsert(rows: Row | Row[], options?: { onConflict?: string }): this {
    this.mode = 'insert'
    this.payload = Array.isArray(rows) ? rows : [rows]
    this.conflictColumn = options?.onConflict ?? null
    return this
  }

  delete(): this {
    this.mode = 'delete'
    return this
  }

  /* -------------------------------------------------------------- resolve */

  private matching(): Row[] {
    return this.rows.filter((row) => this.predicates.every((predicate) => predicate(row)))
  }

  private run(): FakeQueryResult<Row[] | Row | null> {
    if (!this.tables[this.table]) {
      return { data: null, error: { message: `Could not find the table 'public.${this.table}'` } }
    }

    let result: Row[]

    if (this.mode === 'insert') {
      const created: Row[] = []
      for (const row of this.payload) {
        const key = this.conflictColumn
        const existing = key ? this.rows.find((candidate) => asText(candidate[key]) === asText(row[key])) : undefined
        if (existing) {
          Object.assign(existing, row)
          created.push(existing)
        } else {
          const inserted: Row = { id: `fake-${Math.random().toString(36).slice(2, 10)}`, ...row }
          this.rows.push(inserted)
          created.push(inserted)
        }
      }
      this.onWrite(this.table)
      result = created
    } else if (this.mode === 'update') {
      const targets = this.matching()
      for (const row of targets) Object.assign(row, this.patch)
      this.onWrite(this.table)
      result = targets
    } else if (this.mode === 'delete') {
      const targets = new Set(this.matching())
      this.tables[this.table] = this.rows.filter((row) => !targets.has(row))
      this.onWrite(this.table)
      result = [...targets]
    } else {
      result = this.matching()
      for (const spec of [...this.orders].reverse()) {
        result = [...result].sort((a, b) => {
          const order = compare(a[spec.column], b[spec.column])
          return spec.ascending ? order : -order
        })
      }
      if (this.limitValue !== null) result = result.slice(0, this.limitValue)
    }

    if (this.singleMode === 'single') {
      const first = result[0]
      return first
        ? { data: { ...first }, error: null }
        : { data: null, error: { message: 'No rows returned' } }
    }
    if (this.singleMode === 'maybe') {
      return { data: result[0] ? { ...result[0] } : null, error: null }
    }
    return { data: result.map((row) => ({ ...row })), error: null }
  }

  then<A = FakeQueryResult<Row[] | Row | null>, B = never>(
    onFulfilled?: ((value: FakeQueryResult<Row[] | Row | null>) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected)
  }
}

export interface FakeUser {
  id: string
  email: string
}

export interface FakeSupabase {
  /** The live tables — mutate them directly to set up a scenario. */
  tables: Tables
  /** `{ tasks: 2 }` — how many write statements each table has taken. */
  writes: Record<string, number>
  client: {
    from: (table: string) => FakeQuery
    auth: Record<string, unknown>
  }
}

/**
 * Build a fake client over a deep copy of `tables`, so one fixture object can
 * seed many tests without them leaking into each other.
 */
export function createFakeSupabase(tables: Tables, user: FakeUser): FakeSupabase {
  const data: Tables = {}
  for (const [name, rows] of Object.entries(tables)) data[name] = rows.map((row) => ({ ...row }))

  const writes: Record<string, number> = {}
  const onWrite = (table: string) => {
    writes[table] = (writes[table] ?? 0) + 1
  }

  const session = {
    access_token: 'fake-token',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'fake-refresh',
    user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated' },
  }

  return {
    tables: data,
    writes,
    client: {
      from: (table: string) => new FakeQuery(data, table, onWrite),
      auth: {
        getSession: async () => ({ data: { session }, error: null }),
        getUser: async () => ({ data: { user: session.user }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signOut: async () => ({ error: null }),
        signInWithPassword: async () => ({ data: { session }, error: null }),
        signInWithOtp: async () => ({ data: {}, error: null }),
      },
    },
  }
}
