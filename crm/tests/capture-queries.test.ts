import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The capture write path and the AI fallback, against a stubbed supabase-js:
 * which rows go out, in which order, with which values — and what happens when
 * the edge function is not there.
 */

interface Insert {
  table: string
  row: Record<string, unknown>
}

const inserts: Insert[] = []
let selectResponses: Record<string, Array<Record<string, unknown>>> = {}
let insertError: string | null = null
let insertThrows: Error | null = null

/** A minimal PostgREST chain: `.insert().select().single()` / `.select().ilike().limit()`. */
function builder(table: string) {
  const chain: Record<string, unknown> = {}
  let pending: Record<string, unknown> | null = null

  const resolve = () => {
    if (pending) {
      if (insertThrows) throw insertThrows
      if (insertError) return { data: null, error: { message: insertError } }
      return { data: { id: `${table}-1`, ...pending }, error: null }
    }
    return { data: selectResponses[table] ?? [], error: null }
  }

  for (const method of ['select', 'eq', 'ilike', 'in', 'is', 'order', 'limit']) {
    chain[method] = () => chain
  }
  chain.insert = (row: Record<string, unknown>) => {
    pending = row
    inserts.push({ table, row })
    return chain
  }
  chain.single = () => Promise.resolve(resolve())
  chain.maybeSingle = () => Promise.resolve(resolve())
  chain.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(onFulfilled(resolve()))
  return chain
}

const invoke = vi.fn()

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => builder(table),
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
  isConfigured: true,
}))
vi.mock('../src/lib/env', () => ({ isConfigured: true, SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }))

const { CaptureParseError, minimalContactRow, parseCapture, saveCapture } = await import(
  '../src/lib/queries/capture'
)

const PARSED = {
  contact_query: 'dovid cohen',
  confidence: 0.93,
  interaction: {
    kind: 'meeting',
    occurred_at: '2026-08-25T10:00',
    location: 'London',
    summary: 'Met in London.',
    outcome: null,
    ask_amount: 20000,
    is_scheduled: false,
  },
  next_action: { type: 'call', title: 'Call him', date_expression: 'after sukkos', resolved_due_on: null },
  suggested_updates: [],
  unparsed_remainder: null,
  model: 'claude-opus-5',
  latency_ms: 1200,
  usage: { input_tokens: 1500, output_tokens: 300 },
}

const baseSave = {
  source: 'ai' as const,
  rawText: 'met dovid cohen in london, call him after sukkos',
  contact: { id: 'c1', createName: null },
  interaction: {
    kind: 'meeting',
    occurredAt: '2026-08-25T10:00',
    location: 'London',
    summary: 'Met in London.',
    outcome: null,
    askAmount: 20000,
    isScheduled: false,
  },
  nextAction: { type: 'call', title: 'Call him', dueOn: '2026-10-06' },
  tags: [] as string[],
  ai: {
    model: 'claude-opus-5',
    output: PARSED,
    resolution: 'accepted' as const,
    editedFields: [] as string[],
    latencyMs: 1200,
    tokensIn: 1500,
    tokensOut: 300,
  },
}

beforeEach(() => {
  inserts.length = 0
  selectResponses = {}
  insertError = null
  insertThrows = null
  invoke.mockReset()
})

/* ---------------------------------------------------------------- parsing */

describe('parseCapture', () => {
  it('sends the note, today and the trimmed roster to the edge function', async () => {
    invoke.mockResolvedValue({ data: PARSED, error: null })
    const roster = Array.from({ length: 250 }, (_, i) => ({
      id: `c${i}`,
      first_name: 'Name',
      last_name: String(i),
      organization: i === 0 ? 'Feld Brothers Ltd' : null,
      city: null,
      tier: null,
      email: null,
      phone: null,
      whatsapp: null,
    }))

    await parseCapture({ text: 'hello', today: new Date(2026, 7, 25), roster })

    expect(invoke).toHaveBeenCalledTimes(1)
    const [name, options] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }]
    expect(name).toBe('ai-quick-capture')
    expect(options.body.text).toBe('hello')
    expect(options.body.today).toBe('2026-08-25')
    // The prompt roster is capped; the browser still matches against the rest.
    expect((options.body.contact_names as unknown[]).length).toBe(200)
    expect((options.body.contact_names as Array<{ org: string | null }>)[0]?.org).toBe('Feld Brothers Ltd')
  })

  it('classifies a 503 as `unconfigured` so the client falls back to manual', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
        name: 'FunctionsHttpError',
        context: new Response(JSON.stringify({ error: 'ai_unconfigured' }), { status: 503 }),
      }),
    })

    const failure = await parseCapture({ text: 'hello' }).catch((error) => error)
    expect(failure).toBeInstanceOf(CaptureParseError)
    expect(failure.failure).toBe('unconfigured')
  })

  it('reads `ai_unconfigured` from the body even behind a relay 500', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('relay'), {
        name: 'FunctionsHttpError',
        context: new Response(JSON.stringify({ error: 'ai_unconfigured' }), { status: 500 }),
      }),
    })
    const failure = await parseCapture({ text: 'hello' }).catch((error) => error)
    expect(failure.failure).toBe('unconfigured')
  })

  it('classifies a network failure as `offline`', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('Failed to fetch'), { name: 'FunctionsFetchError' }),
    })
    const failure = await parseCapture({ text: 'hello' }).catch((error) => error)
    expect(failure.failure).toBe('offline')
  })

  it('classifies any other non-2xx as a plain error', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('boom'), {
        name: 'FunctionsHttpError',
        context: new Response(JSON.stringify({ error: 'ai_failed' }), { status: 502 }),
      }),
    })
    const failure = await parseCapture({ text: 'hello' }).catch((error) => error)
    expect(failure.failure).toBe('error')
  })

  it('rejects a response that is not the 09 §2 shape rather than half-filling chips', async () => {
    invoke.mockResolvedValue({ data: { something: 'else' }, error: null })
    const failure = await parseCapture({ text: 'hello' }).catch((error) => error)
    expect(failure).toBeInstanceOf(CaptureParseError)
    expect(failure.failure).toBe('error')
  })
})

/* ----------------------------------------------------- new contact at the door */

describe('minimalContactRow', () => {
  it('normalises a phone to E.164 and mirrors it to WhatsApp (02 §6)', () => {
    const row = minimalContactRow({ name: 'dovid cohen', phone: '07700 900123' })
    expect(row.first_name).toBe('Dovid')
    expect(row.last_name).toBe('Cohen')
    expect(row.phone).toBe('+447700900123')
    expect(row.whatsapp).toBe('+447700900123')
  })

  it('handles the other shapes a UK number arrives in', () => {
    expect(minimalContactRow({ name: 'x y', phone: '+44 7700 900123' }).phone).toBe('+447700900123')
    expect(minimalContactRow({ name: 'x y', phone: '00447700900123' }).phone).toBe('+447700900123')
    expect(minimalContactRow({ name: 'x y', phone: '(020) 7946 0000' }).phone).toBe('+442079460000')
    expect(minimalContactRow({ name: 'x y' }).phone).toBeNull()
    expect(minimalContactRow({ name: 'x y', phone: '' }).phone).toBeNull()
  })

  it('lowercases the email and never writes empty strings', () => {
    const row = minimalContactRow({ name: 'x y', email: '  Dovid.Cohen@Example.COM ' })
    expect(row.email).toBe('dovid.cohen@example.com')
    expect(minimalContactRow({ name: 'x y', email: '' }).email).toBeNull()
    expect(minimalContactRow({ name: 'x y' }).organization).toBeNull()
  })

  it('files a capture-created contact as a prospect from quick_capture', () => {
    const row = minimalContactRow({ name: 'Shloimy Katz' })
    expect(row.stage).toBe('prospect')
    expect(row.source).toBe('quick_capture')
    expect(row.contact_kind).toBe('individual')
  })
})

/* ------------------------------------------------------------------ saving */

describe('saveCapture', () => {
  it('writes the AI log first, then the interaction that points at it', async () => {
    const result = await saveCapture(baseSave)

    expect(inserts.map((i) => i.table)).toEqual(['ai_activity_log', 'interactions', 'tasks'])

    const log = inserts[0]!.row
    expect(log.feature).toBe('quick_capture')
    expect(log.model).toBe('claude-opus-5')
    expect(log.raw_input).toBe(baseSave.rawText)
    expect(log.resolution).toBe('accepted')
    expect(log.edited_fields).toEqual([])
    expect(log.tokens_in).toBe(1500)
    expect(log.team_member_id).toBe('user-1')

    const interaction = inserts[1]!.row
    expect(interaction.contact_id).toBe('c1')
    expect(interaction.source).toBe('quick_capture_ai')
    expect(interaction.ai_raw_input).toBe(baseSave.rawText)
    expect(interaction.ai_activity_id).toBe('ai_activity_log-1')
    expect(interaction.status).toBe('logged')
    expect(interaction.ask_amount).toBe(20000)

    const task = inserts[2]!.row
    expect(task.origin).toBe('quick_capture_ai')
    expect(task.due_on).toBe('2026-10-06')
    expect(task.status).toBe('todo')
    expect(task.action_type).toBe('call')

    expect(result.contactId).toBe('c1')
    expect(result.aiActivityId).toBe('ai_activity_log-1')
  })

  it('records the edited fields and flips the resolution', async () => {
    await saveCapture({
      ...baseSave,
      ai: { ...baseSave.ai, resolution: 'edited', editedFields: ['summary', 'next_action_due_on'] },
    })
    expect(inserts[0]!.row.resolution).toBe('edited')
    expect(inserts[0]!.row.edited_fields).toEqual(['summary', 'next_action_due_on'])
  })

  it('writes no AI log at all on the manual path', async () => {
    await saveCapture({ ...baseSave, source: 'manual', ai: undefined })
    expect(inserts.map((i) => i.table)).toEqual(['interactions', 'tasks'])
    expect(inserts[0]!.row.source).toBe('manual')
    expect(inserts[0]!.row.ai_activity_id).toBeNull()
    // The dictation is kept even without AI (04 §4).
    expect(inserts[0]!.row.ai_raw_input).toBe(baseSave.rawText)
    expect(inserts[1]!.row.origin).toBe('manual')
  })

  it('saves a future arrangement as a scheduled interaction (04 §4)', async () => {
    await saveCapture({
      ...baseSave,
      interaction: { ...baseSave.interaction, isScheduled: true, occurredAt: '2026-09-03T15:00' },
    })
    const interaction = inserts.find((i) => i.table === 'interactions')!.row
    expect(interaction.status).toBe('scheduled')
    expect(String(interaction.occurred_at)).toContain('2026-09-03')
  })

  it('queues a task with no date instead of dropping it (02 §3.3)', async () => {
    await saveCapture({ ...baseSave, nextAction: { type: 'call', title: 'Call him', dueOn: null } })
    const task = inserts.find((i) => i.table === 'tasks')!.row
    expect(task.due_on).toBeNull()
    expect(task.status).toBe('queued')
  })

  it('writes no task when there is no next action', async () => {
    await saveCapture({ ...baseSave, nextAction: null })
    expect(inserts.some((i) => i.table === 'tasks')).toBe(false)
  })

  it('creates the contact through the E.164-safe path when the chip says so', async () => {
    await saveCapture({ ...baseSave, contact: { id: null, createName: 'shloimy katz' } })
    const created = inserts.find((i) => i.table === 'contacts')!.row
    expect(created.first_name).toBe('Shloimy')
    expect(created.last_name).toBe('Katz')
    expect(created.created_by).toBe('user-1')
    expect(inserts.find((i) => i.table === 'interactions')!.row.contact_id).toBe('contacts-1')
  })

  it('refuses to save with neither a contact nor a name to create', async () => {
    await expect(saveCapture({ ...baseSave, contact: { id: null, createName: null } })).rejects.toThrow(
      /No contact chosen/,
    )
  })

  it('reuses an existing tag rather than forking the vocabulary', async () => {
    selectResponses = { tags: [{ id: 'tag-1' }] }
    const result = await saveCapture({ ...baseSave, tags: ['Building project'] })
    expect(inserts.some((i) => i.table === 'tags')).toBe(false)
    const tagging = inserts.find((i) => i.table === 'taggings')!.row
    expect(tagging.tag_id).toBe('tag-1')
    expect(result.tagCount).toBe(1)
  })

  it('creates a tag that does not exist yet', async () => {
    selectResponses = { tags: [] }
    await saveCapture({ ...baseSave, tags: ['New cause'] })
    expect(inserts.find((i) => i.table === 'tags')!.row.name).toBe('New cause')
  })

  it('surfaces a rejected write rather than pretending it saved', async () => {
    insertError = 'new row violates row-level security policy'
    await expect(saveCapture(baseSave)).rejects.toThrow(/row-level security/)
  })

  it('lets a network failure out so the caller can queue it (11 §6)', async () => {
    insertThrows = new TypeError('Failed to fetch')
    await expect(saveCapture(baseSave)).rejects.toThrow(/Failed to fetch/)
  })
})
