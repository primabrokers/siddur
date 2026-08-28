/**
 * `draft-message` — first drafts a human sends (09 §4, autonomy level L1).
 *
 * Three things make this function what it is:
 *
 * 1. **The hard exclusion comes first.** Condolence, bereavement and serious
 *    illness are never AI-drafted (09 §1.6 ▸ the Vanderbilt 2023 failure). The
 *    check runs before the model is even constructed: a gift recorded
 *    `in_memory`, or a bereavement/illness marker anywhere in the grounding
 *    text, returns `{ excluded: true, reason }` and no draft exists to be sent
 *    by accident. The reason is a sentence, because a fundraiser staring at a
 *    blank compose box deserves to know why.
 * 2. **Grounded generation.** The facts panel is assembled here, from the
 *    database, and returned alongside the draft (09 §1.3). The model may
 *    reference only those facts and names which of them it used — from a fixed
 *    enum, so it cannot invent a source any more than it can invent a figure.
 * 3. **The caller's own eyes.** Same rule as `donor-brief`: the Supabase client
 *    carries the caller's Authorization header, never the service key, so a
 *    restricted viewer's draft contains no amounts because the rows carrying
 *    them never arrive.
 *
 * Deployment: `verify_jwt = true`; no `ANTHROPIC_API_KEY` → **503
 * `ai_unconfigured`**, and the compose box opens blank, which is how every
 * message in this product was written before there was a model.
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.122.0'
import { createClient } from 'npm:@supabase/supabase-js@2.58.0'
import { DRAFT_PURPOSES, PURPOSE_LABEL, detectExclusion } from './core.ts'
import type { DraftFact, DraftPurpose } from './core.ts'

/* ------------------------------------------------------------------ config */

const MODEL = 'claude-opus-5'
const MAX_TOKENS = 1500
/** More than this and the tone samples stop being samples (09 §4). */
const MAX_TONE_CHARS = 4000

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

const PURPOSE_BRIEF: Record<DraftPurpose, string> = {
  thank_you:
    'A thank-you for the gift below. Warm, specific, short — three or four sentences. Name what the gift does, not how grateful the institution is. Never mention Gift Aid, never ask for anything.',
  proposal_follow_up:
    'A follow-up on the proposal below. Light touch: reference the conversation, restate nothing at length, ask one clear question that moves it forward. Four sentences at most.',
  ga_declaration_request:
    'A request for a Gift Aid declaration. Explain in one sentence what it does (the charity reclaims 25p per £1 at no cost to the donor), say exactly what is needed, and keep the whole thing under five sentences. Do not thank at length — this is an admin note, courteously written.',
}

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

const gbp = (amount: unknown): string => {
  const value = Number(amount)
  if (!Number.isFinite(value)) return ''
  return `£${value.toLocaleString('en-GB', { minimumFractionDigits: value % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`
}

const SYSTEM_PROMPT = `You write first drafts of fundraising messages for an Anglo-charedi yeshiva in the UK. A person reads, edits and sends every one of them; you never send anything.

Hard rules:
- FACTS is everything you know. Every name, figure, date, project and event in the draft must come from FACTS, copied exactly. Invent nothing — not a detail about the donor's family, not a fact about the yeshiva, not a number.
- No amount may appear unless it is in FACTS. If FACTS carries no amount, write about the gift without a figure.
- Match the register in TONE SAMPLES when they are present: the salutation, the honorifics, the Hebrew and Yiddish phrases, the sign-off. If there are no samples, write plainly and warmly in British English and use no Hebrew the record does not already use.
- Address the donor as the record names them (title and name in FACTS). Write in the sender's first person.
- British English and British spelling. Sterling as "£1,000".
- Plain text only — no markdown, no headings, no bullet points, no subject line unless asked.
- Nothing about death, illness, bereavement or a family tragedy may appear. If the facts hint at one, stop and write nothing.
- used_labels lists exactly which FACTS entries the draft actually leans on. Choose only from the labels supplied.`

/* --------------------------------------------------------------- the handler */

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json(503, { error: 'ai_unconfigured' })

  const authorization = req.headers.get('Authorization') ?? ''
  if (authorization === '') return json(401, { error: 'unauthorized' })

  let body: { contact_id?: unknown; purpose?: unknown; gift_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'bad_request', message: 'Body must be JSON.' })
  }

  const contactId = typeof body.contact_id === 'string' ? body.contact_id : ''
  const purpose = String(body.purpose ?? '') as DraftPurpose
  const giftId = typeof body.gift_id === 'string' && body.gift_id !== '' ? body.gift_id : null

  if (contactId === '') return json(400, { error: 'bad_request', message: '`contact_id` is required.' })
  if (!DRAFT_PURPOSES.includes(purpose)) {
    return json(400, { error: 'bad_request', message: `\`purpose\` must be one of ${DRAFT_PURPOSES.join(', ')}.` })
  }

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
    const [member, contact, timeline, notes, declarations] = await Promise.all([
      supabase.from('team_members').select('id, full_name, role, can_see_amounts, drafting_examples').eq('id', viewerId).maybeSingle(),
      supabase.from('contacts').select('*').eq('id', contactId).maybeSingle(),
      supabase
        .from('interactions')
        .select('occurred_at, kind, status, summary, outcome, location, ask_amount')
        .eq('contact_id', contactId)
        .order('occurred_at', { ascending: false })
        .limit(10),
      supabase
        .from('notes')
        .select('category, body, is_private, created_by')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(8),
      supabase
        .from('gift_aid_declarations')
        .select('declared_on, covers_future, cancelled_on')
        .eq('contact_id', contactId)
        .is('cancelled_on', null)
        .limit(1),
    ])

    if (!member.data) return json(403, { error: 'not_a_member' })
    if (!contact.data) return json(404, { error: 'not_found' })

    const contactRow = contact.data as Row
    const memberRow = member.data as Row

    /* ------------------------------------------------------------- the gift */

    let giftRow: Row | null = null
    let fundName: string | null = null
    let campaignName: string | null = null
    let tributeType: string | null = null

    if (giftId) {
      // `donations_sel` gates on can_see_amounts; a restricted viewer simply
      // gets no row here, and the draft is written without a figure.
      const gift = await supabase
        .from('donations')
        .select('id, amount, amount_gbp, currency, donated_on, fund_id, campaign_id, payment_method, gift_aid_status')
        .eq('id', giftId)
        .maybeSingle()
      giftRow = (gift.data as Row | null) ?? null

      if (giftRow?.fund_id) {
        const fund = await supabase.from('funds').select('name').eq('id', giftRow.fund_id).maybeSingle()
        fundName = ((fund.data as Row | null)?.name as string | null) ?? null
      }
      if (giftRow?.campaign_id) {
        const campaign = await supabase.from('campaigns').select('name').eq('id', giftRow.campaign_id).maybeSingle()
        campaignName = ((campaign.data as Row | null)?.name as string | null) ?? null
      }

      const tribute = await supabase.from('tributes').select('tribute_type, honoree_name').eq('donation_id', giftId).maybeSingle()
      tributeType = ((tribute.data as Row | null)?.tribute_type as string | null) ?? null
    }

    /* ------------------------------------------- THE HARD EXCLUSION (09 §1.6) */

    const exclusionTexts: Array<string | null | undefined> = [
      contactRow.things_to_remember as string | null,
      contactRow.family_notes as string | null,
      ...rows(timeline).flatMap((row) => [row.summary as string | null, row.outcome as string | null]),
      ...rows(notes)
        .filter((note) => note.is_private !== true || note.created_by === viewerId)
        .map((note) => note.body as string | null),
    ]

    const exclusion = detectExclusion({ tributeType, texts: exclusionTexts })
    if (exclusion) {
      // Deliberately not written to `ai_activity_log`: no model ran, and a row
      // resolved `rejected` here would read as "a human rejected a draft" and
      // skew the edit-rate KPI the ledger exists to produce (09 §1.5).
      return json(200, { ...exclusion, purpose })
    }

    /* ------------------------------------------------------ grounding facts */

    const lastMeeting = rows(timeline).find(
      (row) => row.status !== 'scheduled' && (row.kind === 'meeting' || row.kind === 'call' || row.kind === 'video_call'),
    )
    const lastInteraction = rows(timeline).find((row) => row.status !== 'scheduled')
    const declaration = rows(declarations)[0] ?? null

    const facts: DraftFact[] = []
    const push = (label: string, value: unknown): void => {
      const text = typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value)
      if (text !== '') facts.push({ label, value: text })
    }

    const donorName = [contactRow.title, contactRow.first_name, contactRow.last_name].filter(Boolean).join(' ').trim()
    push('Donor', donorName)
    push('Hebrew name', contactRow.hebrew_name)
    push('Organisation', contactRow.organization)
    push('Preferred language', contactRow.preferred_language)
    push('Preferred channel', contactRow.preferred_channel)

    if (giftRow) {
      push('Gift amount', gbp(giftRow.amount_gbp ?? giftRow.amount))
      push('Gift date', giftRow.donated_on)
      push('Fund', fundName)
      push('Campaign', campaignName)
      push('Payment method', typeof giftRow.payment_method === 'string' ? giftRow.payment_method.replace(/_/g, ' ') : null)
    } else if (giftId) {
      push('Gift amount', 'not visible to you')
    }

    if (lastMeeting) {
      push(
        'Last meeting',
        `${String(lastMeeting.occurred_at ?? '').slice(0, 10)} — ${String(lastMeeting.summary ?? '').slice(0, 400)}`,
      )
    } else if (lastInteraction) {
      push(
        'Last contact',
        `${String(lastInteraction.occurred_at ?? '').slice(0, 10)} — ${String(lastInteraction.summary ?? '').slice(0, 400)}`,
      )
    }
    if (lastInteraction?.outcome) push('What was promised', String(lastInteraction.outcome).slice(0, 400))
    if (lastInteraction?.ask_amount) push('Amount discussed', gbp(lastInteraction.ask_amount))

    if (purpose === 'ga_declaration_request') {
      push(
        'Gift Aid on file',
        declaration ? `Declared ${declaration.declared_on}${declaration.covers_future ? ', enduring' : ''}` : 'None on file',
      )
      push('Address on record', [contactRow.address_line1, contactRow.postcode].filter(Boolean).join(', '))
    }

    push('Sender', memberRow.full_name)

    if (facts.length === 0) {
      return json(422, {
        error: 'no_grounding',
        message: 'There is nothing on this record to ground a draft in. Write it by hand.',
      })
    }

    const toneSamples = String(memberRow.drafting_examples ?? '').slice(0, MAX_TONE_CHARS)
    const labels = facts.map((fact) => fact.label)

    /* --------------------------------------------------------------- the call */

    const DRAFT_SCHEMA = {
      type: 'object',
      additionalProperties: false,
      required: ['draft', 'used_labels'],
      properties: {
        draft: {
          type: 'string',
          description: 'The message itself, plain text, ready for a human to edit and send.',
        },
        used_labels: {
          type: 'array',
          description: 'Exactly the FACTS labels the draft leans on. No others exist.',
          items: { type: 'string', enum: labels },
        },
      },
    }

    const client = new Anthropic({ apiKey })

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: DRAFT_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            `PURPOSE: ${PURPOSE_LABEL[purpose]}.`,
            PURPOSE_BRIEF[purpose],
            '',
            'FACTS (the only things you may reference):',
            ...facts.map((fact) => `- ${fact.label}: ${fact.value}`),
            '',
            toneSamples.trim() === ''
              ? 'TONE SAMPLES: none on file — write plainly in British English.'
              : `TONE SAMPLES (the sender's own past messages — match this register):\n${toneSamples}`,
          ].join('\n'),
        },
      ],
    })

    if (response.stop_reason === 'refusal') {
      return json(422, { error: 'ai_refused', message: 'The model declined this draft.' })
    }

    const parsed = extractJson(response.content as Array<{ type: string; text?: string }>) as {
      draft: string
      used_labels: string[]
    }
    const latencyMs = Date.now() - started

    // The panel shows what was *retrieved*, filtered to what the model says it
    // used. If it names nothing, every supplied fact is shown — the reviewer
    // must always be able to check the draft against its sources (09 §1.3).
    const used = new Set(parsed.used_labels ?? [])
    const factsUsed = used.size > 0 ? facts.filter((fact) => used.has(fact.label)) : facts

    const logged = await supabase
      .from('ai_activity_log')
      .insert({
        feature: 'draft',
        model: response.model ?? MODEL,
        raw_input: `${purpose}:${contactId}${giftId ? `:${giftId}` : ''}`,
        output: { draft: parsed.draft, facts_used: factsUsed, purpose } as never,
        resolution: 'pending',
        latency_ms: latencyMs,
        tokens_in: response.usage?.input_tokens ?? null,
        tokens_out: response.usage?.output_tokens ?? null,
        team_member_id: viewerId,
      })
      .select('id')
      .maybeSingle()

    return json(200, {
      draft: parsed.draft,
      facts_used: factsUsed,
      purpose,
      excluded: false,
      model: response.model ?? MODEL,
      ai_activity_id: ((logged.data as Row | null)?.id as string | undefined) ?? null,
      latency_ms: latencyMs,
    })
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Unknown model error'
    const status = typeof (caught as { status?: number }).status === 'number' ? (caught as { status: number }).status : 0
    if (status === 401 || status === 403) return json(503, { error: 'ai_unconfigured' })
    console.error('[draft-message]', message)
    return json(502, { error: 'ai_failed', message })
  }
})
