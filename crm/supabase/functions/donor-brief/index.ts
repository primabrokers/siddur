/**
 * `donor-brief` — the pre-meeting brief and the rolling holding line (09 §3).
 *
 * Contract, in one line: **the numbers arrive already computed and the model
 * only narrates them.** Every figure in the prompt comes from `contact_stats`
 * (I-8/I-9); the model is told, in the system prompt and again in the schema
 * description, that a number it did not receive is a bug.
 *
 * **Whose eyes.** The Supabase client here is built with the *caller's*
 * Authorization header, never the service-role key. That is the whole privacy
 * design (09 §1.7 / 11 §2): a private note invisible to the requester is
 * invisible to this function, and therefore to the model. `buildBriefFacts`
 * then re-asserts the same rules in code, so a policy regression cannot become
 * a leak into a prompt.
 *
 * **Caching.** One row per (contact, viewer) in `ai_briefs`, marked stale by a
 * database trigger when an interaction or a gift lands (09 §3: "cached until a
 * new interaction lands"). A cache hit is not a run and is not logged.
 *
 * Deployment: `verify_jwt = true`. With no `ANTHROPIC_API_KEY` this returns
 * **503 `ai_unconfigured`** and the profile simply does not offer a brief — the
 * manual path (read the timeline) is the product's normal state, not a fallback.
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.122.0'
import { createClient } from 'npm:@supabase/supabase-js@2.58.0'
import { BRIEF_BULLET_ORDER, TIMELINE_LIMIT, buildBriefFacts } from './core.ts'
import type { BriefFacts, BriefOpenItemRow } from './core.ts'

/* ------------------------------------------------------------------ config */

const MODEL = 'claude-opus-5'
const MAX_TOKENS = 2000

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })

/* ------------------------------------------------------------------ schema */

/**
 * The five fixed bullets of 09 §3, in the spec's order, plus the rolling
 * "Where we're holding" line. `additionalProperties: false` and every property
 * required, so the card never has to render a hole.
 */
const BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bullets', 'holding_line'],
  properties: {
    bullets: {
      type: 'object',
      additionalProperties: false,
      required: ['who', 'trajectory', 'giving', 'last_time', 'talking_points'],
      properties: {
        who: {
          type: 'string',
          description: 'Who he is and how we know him: household, business, who introduced him, how long.',
        },
        trajectory: {
          type: 'string',
          description:
            'Where the relationship is going — warming, steady, cooling — and the evidence for it from the timeline and the flag.',
        },
        giving: {
          type: 'string',
          description:
            'Giving pattern and capacity signal. Only figures present in numbers{}. If amounts_visible is false, describe the pattern in words and state that amounts are not visible to this user.',
        },
        last_time: {
          type: 'string',
          description: 'The last contact and what was promised or asked for, from the timeline entries only.',
        },
        talking_points: {
          type: 'string',
          description:
            'Two or three talking points, then the one thing not to forget. Drawn from things_to_remember, family, tags and open items.',
        },
      },
    },
    holding_line: {
      type: 'string',
      description:
        'ONE sentence, under 160 characters, present tense, no name at the start: where this relationship is holding right now and what is expected next. Example: "Discussed £20k for the building at the June meeting; he asked to talk after Sukkos."',
    },
  },
} as const

const SYSTEM_PROMPT = `You write a fundraiser's pre-meeting brief about one donor, for an Anglo-charedi yeshiva in the UK. You are briefing a colleague who is about to pick up the phone.

Hard rules:
- FACTS is everything you know. Never state a name, a number, a date, an intention or an event that is not in FACTS. No outside knowledge about this person or their business — none. There is no external enrichment and no wealth screening here.
- Every figure you write must be copied from FACTS.numbers exactly as given. Do not add, average, round, convert or infer a number. If a figure is absent, say what you can in words instead.
- If FACTS.amounts_visible is false, this reader is not permitted to see money. Write no amounts at all and say plainly that giving figures are not visible to them.
- If FACTS.thin_file is true, open the brief by saying how few interactions are on record ("3 interactions on record — thin file") and keep the rest short. Never pad a thin file.
- British English. Sterling as "£20,000". Keep Hebrew and Yiddish terms as they appear in the record; do not translate names, places or Jewish terms.
- Plain, specific, unsentimental. No headings, no bullet characters, no markdown — each field is one short paragraph of one to three sentences.
- Scores (engagement, donor status, flag) are arithmetic from our own data, not judgements. You may explain one ("cooling — no meaningful contact in 80 days after a monthly rhythm"), never invent one.
- holding_line replaces the previous one. If current_holding_line is still accurate, you may keep its substance, but rewrite it against the newest timeline entry.`

/* ----------------------------------------------------------------- helpers */

interface Row {
  [key: string]: unknown
}

const rows = (result: { data: unknown }): Row[] => (Array.isArray(result.data) ? (result.data as Row[]) : [])

function extractJson(content: Array<{ type: string; text?: string }>): unknown {
  const text = content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
    .trim()
  if (text === '') throw new Error('empty model response')
  return JSON.parse(text)
}

/** The prompt body: the facts, then the five things to write. */
function userPrompt(facts: BriefFacts, today: string): string {
  return [
    `Today is ${today}.`,
    '',
    'FACTS (the only source you have):',
    JSON.stringify(facts, null, 1),
    '',
    'Write the five bullets and the holding line:',
    ...BRIEF_BULLET_ORDER.map((bullet, index) => `${index + 1}. ${bullet.label} → bullets.${bullet.key}`),
  ].join('\n')
}

/* --------------------------------------------------------------- the handler */

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  // Supported state, not an outage: the profile hides "Brief me" and the
  // fundraiser reads the timeline, which is what they did before AI existed.
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json(503, { error: 'ai_unconfigured' })

  const authorization = req.headers.get('Authorization') ?? ''
  if (authorization === '') return json(401, { error: 'unauthorized' })

  let body: { contact_id?: unknown; force?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'bad_request', message: 'Body must be JSON.' })
  }

  const contactId = typeof body.contact_id === 'string' ? body.contact_id : ''
  if (contactId === '') return json(400, { error: 'bad_request', message: '`contact_id` is required.' })
  const force = body.force === true

  // The caller's own token: RLS shapes every read below exactly as it shapes
  // the UI. Never the service key (09 §1.7).
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } },
  )

  const { data: userData } = await supabase.auth.getUser()
  const viewerId = userData?.user?.id ?? null
  if (!viewerId) return json(401, { error: 'unauthorized' })

  const started = Date.now()

  try {
    const member = await supabase
      .from('team_members')
      .select('id, full_name, role, can_see_amounts')
      .eq('id', viewerId)
      .maybeSingle()
    if (!member.data) return json(403, { error: 'not_a_member' })

    const role = (member.data as Row).role as string
    // Mirrors `crm_can_see_amounts()` — the same rule, read once, so the prompt
    // can say "amounts are not visible to you" rather than silently omitting.
    const canSeeAmounts = role === 'admin' || role === 'fundraiser' || (member.data as Row).can_see_amounts === true

    /* ------------------------------------------------------------- cache */

    const cached = await supabase
      .from('ai_briefs')
      .select('brief, holding_line, model, stale, generated_at, ai_activity_id')
      .eq('contact_id', contactId)
      .eq('team_member_id', viewerId)
      .maybeSingle()

    if (!force && cached.data && (cached.data as Row).stale !== true) {
      const row = cached.data as Row
      const brief = row.brief as Record<string, unknown>
      return json(200, {
        ...brief,
        holding_line: row.holding_line ?? (brief as Row).holding_line ?? '',
        cached: true,
        generated_at: row.generated_at,
        model: row.model ?? null,
        ai_activity_id: row.ai_activity_id ?? null,
      })
    }

    /* ----------------------------------------------------------- context */

    const [contact, stats, timeline, tasks, notes, taggings, pledges, opportunities] = await Promise.all([
      supabase.from('contacts').select('*').eq('id', contactId).maybeSingle(),
      supabase.from('contact_stats').select('*').eq('contact_id', contactId).maybeSingle(),
      supabase
        .from('interactions')
        .select('occurred_at, kind, status, summary, outcome, location, ask_amount')
        .eq('contact_id', contactId)
        .order('occurred_at', { ascending: false })
        .limit(TIMELINE_LIMIT),
      supabase
        .from('tasks')
        .select('title, action_type, due_on, status')
        .eq('contact_id', contactId)
        .in('status', ['todo', 'waiting', 'queued'])
        .order('due_on', { ascending: true })
        .limit(10),
      // Private notes are filtered by `notes_sel` before they reach this line;
      // `buildBriefFacts` filters them again.
      supabase
        .from('notes')
        .select('category, body, is_private, created_by, created_at')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(6),
      supabase.from('taggings').select('tag_id').eq('contact_id', contactId),
      supabase.from('pledges').select('id, total_amount, status, pledged_on').eq('contact_id', contactId).eq('status', 'open'),
      supabase
        .from('opportunities')
        .select('name, ask_amount, stage, status, expected_decision_on')
        .eq('contact_id', contactId)
        .eq('status', 'open'),
    ])

    if (!contact.data) return json(404, { error: 'not_found' })

    const tagIds = rows(taggings).map((row) => row.tag_id as string).filter(Boolean)
    const tagRows = tagIds.length > 0 ? await supabase.from('tags').select('name').in('id', tagIds) : { data: [] }
    const tags = rows(tagRows).map((row) => String(row.name ?? '')).filter((name) => name !== '')

    const openItems: BriefOpenItemRow[] = [
      ...rows(pledges).map((row) => ({
        kind: 'pledge' as const,
        label: `Open pledge${row.pledged_on ? ` from ${row.pledged_on}` : ''}`,
        amount: (row.total_amount as number | null) ?? null,
        stage: null,
        due_on: null,
      })),
      ...rows(opportunities).map((row) => ({
        kind: 'opportunity' as const,
        label: String(row.name ?? 'Opportunity'),
        amount: (row.ask_amount as number | null) ?? null,
        stage: (row.stage as string | null) ?? null,
        due_on: (row.expected_decision_on as string | null) ?? null,
      })),
    ]

    const facts = buildBriefFacts({
      contact: contact.data as never,
      stats: (stats.data ?? null) as never,
      timeline: rows(timeline) as never,
      tasks: rows(tasks) as never,
      notes: rows(notes) as never,
      openItems,
      tags,
      viewer: { id: viewerId, canSeeAmounts },
    })

    /* --------------------------------------------------------- the call */

    const client = new Anthropic({ apiKey })
    const today = new Date().toISOString().slice(0, 10)

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: BRIEF_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt(facts, today) }],
    })

    if (response.stop_reason === 'refusal') {
      return json(422, { error: 'ai_refused', message: 'The model declined this brief.' })
    }

    const parsed = extractJson(response.content as Array<{ type: string; text?: string }>) as {
      bullets: Record<string, string>
      holding_line: string
    }
    const latencyMs = Date.now() - started

    /* -------------------------------------------------- log · cache · line */

    // Logged first, and as `pending`: the run happened, the human verdict has
    // not. The client PATCHes this row to accepted/edited/rejected (09 §1.5),
    // which is what makes the Settings edit-rate honest.
    const logged = await supabase
      .from('ai_activity_log')
      .insert({
        feature: 'brief',
        model: response.model ?? MODEL,
        raw_input: `brief:${contactId}`,
        output: parsed as never,
        resolution: 'pending',
        latency_ms: latencyMs,
        tokens_in: response.usage?.input_tokens ?? null,
        tokens_out: response.usage?.output_tokens ?? null,
        team_member_id: viewerId,
      })
      .select('id')
      .maybeSingle()
    const aiActivityId = (logged.data as Row | null)?.id as string | undefined

    const generatedAt = new Date().toISOString()
    const briefBody = { bullets: parsed.bullets, thin_file: facts.thin_file }

    await supabase.from('ai_briefs').upsert(
      {
        contact_id: contactId,
        team_member_id: viewerId,
        brief: briefBody as never,
        holding_line: parsed.holding_line,
        model: response.model ?? MODEL,
        ai_activity_id: aiActivityId ?? null,
        stale: false,
        generated_at: generatedAt,
      },
      { onConflict: 'contact_id,team_member_id' },
    )

    // Best effort by design: `contacts_upd` is admin/fundraiser only, so a
    // viewer gets the brief and the line on screen without writing the column.
    // A failed write must never lose the brief that succeeded.
    const line = await supabase
      .from('contacts')
      .update({ holding_line: parsed.holding_line, holding_line_at: generatedAt })
      .eq('id', contactId)
    const holdingLinePersisted = !line.error

    return json(200, {
      bullets: parsed.bullets,
      holding_line: parsed.holding_line,
      thin_file: facts.thin_file,
      cached: false,
      generated_at: generatedAt,
      model: response.model ?? MODEL,
      ai_activity_id: aiActivityId ?? null,
      latency_ms: latencyMs,
      holding_line_persisted: holdingLinePersisted,
    })
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Unknown model error'
    const status = typeof (caught as { status?: number }).status === 'number' ? (caught as { status: number }).status : 0
    if (status === 401 || status === 403) return json(503, { error: 'ai_unconfigured' })
    console.error('[donor-brief]', message)
    return json(502, { error: 'ai_failed', message })
  }
})
