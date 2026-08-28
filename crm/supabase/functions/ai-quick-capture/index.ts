/**
 * `ai-quick-capture` — the one model call behind Quick Capture (09 §2).
 *
 * Contract, in one line: **the model extracts, it never decides and never
 * calculates.** It returns the spec's strictly-typed JSON — including the date
 * as the *phrase the user said* — and the browser resolves that phrase with
 * the deterministic Hebcal-backed resolver (`src/lib/jewish-dates.ts`), matches
 * the contact with the trigram utilities, shows every field as an editable
 * chip, and only then writes (I-12 / 09 §1: propose → preview → confirm →
 * write).
 *
 * Deployment: `verify_jwt = true` — the Supabase gateway authenticates the
 * caller, so an anonymous request never reaches this code. The Anthropic key
 * is a server secret; the browser never talks to the model.
 *
 * Failure is a first-class path: with no `ANTHROPIC_API_KEY` configured this
 * returns **503 `ai_unconfigured`**, and the client falls back to the manual
 * form with the raw dictation prefilled. The dictation is never lost.
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.122.0'

/* ------------------------------------------------------------------ config */

const MODEL = 'claude-opus-5'
const MAX_TOKENS = 4000
/** Client sends its recent shortlist; more than this is noise, not signal. */
const MAX_CONTACT_NAMES = 200
const MAX_TEXT_LENGTH = 4000

/** 02 §7 lookup seed — `interaction_kind`. */
const INTERACTION_KINDS = [
  'call',
  'whatsapp',
  'sms',
  'email',
  'meeting',
  'event',
  'letter',
  'video_call',
  'receipt_sent',
  'other',
] as const

/** 02 §7 lookup seed — `action_type`. */
const ACTION_TYPES = [
  'call',
  'whatsapp',
  'send_email',
  'arrange_meeting',
  'send_proposal',
  'ask',
  'follow_up_proposal',
  'send_update',
  'invite_event',
  'thank_you',
  'send_receipt',
  'speak_to_introducer',
  'keep_in_touch',
  'other',
] as const

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

/* ------------------------------------------------------------------ schema */

/**
 * EXACTLY the 09 §2 shape. Every property is required and
 * `additionalProperties: false`, so the structured-output constraint gives the
 * client a total, predictable object — nullable fields carry `null`, never a
 * missing key. `resolved_due_on` is in the schema and pinned to `null`: the
 * model is told, in the type system as well as in words, that dates are not
 * its job.
 */
const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['contact_query', 'confidence', 'interaction', 'next_action', 'suggested_updates', 'unparsed_remainder'],
  properties: {
    contact_query: {
      type: ['string', 'null'],
      description: 'The person or organisation as the user named them, verbatim. Null if nobody was named.',
    },
    confidence: {
      type: 'number',
      description: '0–1, your confidence in the whole extraction.',
    },
    interaction: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'occurred_at', 'location', 'summary', 'outcome', 'ask_amount', 'is_scheduled'],
      properties: {
        kind: { type: 'string', enum: [...INTERACTION_KINDS] },
        occurred_at: {
          type: ['string', 'null'],
          description:
            'Local wall-clock time as YYYY-MM-DDTHH:mm, ONLY when the note states a clear day/time relative to today. Null otherwise.',
        },
        location: { type: ['string', 'null'] },
        summary: { type: 'string', description: 'One or two clean English sentences. Facts from the note only.' },
        outcome: { type: ['string', 'null'], description: 'What it led to, if stated.' },
        ask_amount: { type: ['number', 'null'], description: 'Amount discussed, in pounds, as a number.' },
        is_scheduled: {
          type: 'boolean',
          description: 'True when this is a FUTURE arrangement being booked, not something that already happened.',
        },
      },
    },
    next_action: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['type', 'title', 'date_expression', 'resolved_due_on'],
      properties: {
        type: { type: 'string', enum: [...ACTION_TYPES] },
        title: { type: 'string', description: 'Imperative and short: "Call re building project / £20k".' },
        date_expression: {
          type: ['string', 'null'],
          description:
            'The timing phrase EXACTLY as the user said it ("after sukkos", "in three months", "next tuesday"). Never a date.',
        },
        resolved_due_on: {
          type: 'null',
          description: 'Always null. The client resolves dates deterministically; you must not calculate them.',
        },
      },
    },
    suggested_updates: {
      type: 'array',
      description: 'At most three. Only from what the note plainly says.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'value'],
        properties: {
          kind: { type: 'string', enum: ['add_tag'] },
          value: { type: 'string' },
        },
      },
    },
    unparsed_remainder: {
      type: ['string', 'null'],
      description: 'Any part of the note that did not fit a field, so nothing is silently dropped.',
    },
  },
} as const

const SYSTEM_PROMPT = `You extract structured CRM records from a fundraiser's dictated note. You fill a fixed schema; you do not summarise freely, advise, or converse.

Rules:
- Facts only, from the note. Never invent a name, an amount, a place, an outcome or an intention that is not there. If something is not stated, use null.
- Summaries in clean English, one or two sentences, third person, past tense. Normalise Yinglish/Yiddish/Hebrew wording to English but keep names, places and Jewish terms as said.
- NEVER compute a date. Put the user's own timing words in next_action.date_expression ("after sukkos", "before pesach", "in three months", "next tuesday") and leave resolved_due_on null. A date you calculate is a bug.
- interaction.occurred_at only when the note states the timing of what happened ("this morning", "yesterday 3pm", "thursday 10am"); resolve it against the supplied today's date, local wall-clock, no timezone suffix. Otherwise null.
- is_scheduled is true only when the note books something in the FUTURE ("meeting with Katz Thursday 3pm"), false when it reports something that happened.
- contact_query is the name as spoken — do not correct spellings, and do not pick from the roster; the roster is context for spelling only. The client does the matching.
- next_action is null unless the note implies a follow-up.
- ask_amount is a plain number in pounds: "twenty k" is 20000.
- suggested_updates: tags only, at most three, drawn from interests or causes the note names.
- Put anything you could not place into unparsed_remainder rather than dropping it.
- Low confidence is useful: score honestly, and prefer nulls to guesses.`

/* ------------------------------------------------------------------ helpers */

interface ContactName {
  id: string
  name: string
  org?: string | null
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })

function rosterLine(contacts: ContactName[]): string {
  if (contacts.length === 0) return 'No roster supplied.'
  return contacts
    .slice(0, MAX_CONTACT_NAMES)
    .map((c) => (c.org ? `${c.name} (${c.org})` : c.name))
    .join(' · ')
}

/** The model returns one text block holding the constrained JSON. */
function extractJson(content: Array<{ type: string; text?: string }>): unknown {
  const text = content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
    .trim()
  if (text === '') throw new Error('empty model response')
  return JSON.parse(text)
}

/* --------------------------------------------------------------- the handler */

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  // No key configured → the client falls back to the manual form (09 §2
  // failure modes). This is a supported state, not an outage.
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json(503, { error: 'ai_unconfigured' })

  let body: { text?: unknown; today?: unknown; contact_names?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'bad_request', message: 'Body must be JSON.' })
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (text === '') return json(400, { error: 'bad_request', message: '`text` is required.' })
  if (text.length > MAX_TEXT_LENGTH) return json(400, { error: 'bad_request', message: '`text` is too long.' })

  const today = typeof body.today === 'string' && body.today.length > 0 ? body.today : new Date().toISOString().slice(0, 10)
  const contacts: ContactName[] = Array.isArray(body.contact_names)
    ? (body.contact_names as ContactName[]).filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
    : []

  const client = new Anthropic({ apiKey })
  const started = Date.now()

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Extraction against a fixed schema, not open generation (09 §2).
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: EXTRACTION_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            `Today is ${today}.`,
            `Known contacts (spelling context only): ${rosterLine(contacts)}`,
            '',
            'Note:',
            text,
          ].join('\n'),
        },
      ],
    })

    if (response.stop_reason === 'refusal') {
      return json(422, { error: 'ai_refused', message: 'The model declined this note.' })
    }

    const extraction = extractJson(response.content as Array<{ type: string; text?: string }>)

    return json(200, {
      ...(extraction as Record<string, unknown>),
      model: response.model ?? MODEL,
      latency_ms: Date.now() - started,
      usage: {
        input_tokens: response.usage?.input_tokens ?? null,
        output_tokens: response.usage?.output_tokens ?? null,
      },
    })
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Unknown model error'
    const status = typeof (caught as { status?: number }).status === 'number' ? (caught as { status: number }).status : 0
    // 401/403 from Anthropic means the secret is wrong — from the client's
    // point of view that is the same story as no key: fall back to manual.
    if (status === 401 || status === 403) return json(503, { error: 'ai_unconfigured' })
    console.error('[ai-quick-capture]', message)
    return json(502, { error: 'ai_failed', message })
  }
})
