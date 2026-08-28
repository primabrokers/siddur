/**
 * The wire shapes Quick Capture deals in.
 *
 * `CaptureExtraction` is EXACTLY the 09 §2 contract — the edge function's
 * structured-output schema is generated from the same field list, and the
 * client trusts nothing beyond it. Note what is *not* here: a resolved date.
 * `resolved_due_on` is always null on the wire; the browser resolves
 * `date_expression` with `lib/jewish-dates.ts`.
 */

/** 02 §3.2 `interactions` fields the extractor fills. */
export interface ExtractedInteraction {
  kind: string
  /** Local wall-clock `yyyy-MM-ddTHH:mm`, or null when the note is silent. */
  occurred_at: string | null
  location: string | null
  summary: string
  outcome: string | null
  ask_amount: number | null
  /** True = a future arrangement, saved as `status='scheduled'` (04 §4). */
  is_scheduled: boolean
}

export interface ExtractedNextAction {
  type: string
  title: string
  /** The user's own words: "after sukkos". Never a date. */
  date_expression: string | null
  /** Always null — the client resolves dates deterministically (09 §2). */
  resolved_due_on: null
}

export interface ExtractedUpdate {
  kind: 'add_tag' | string
  value: string
}

export interface CaptureExtraction {
  contact_query: string | null
  confidence: number
  interaction: ExtractedInteraction
  next_action: ExtractedNextAction | null
  suggested_updates: ExtractedUpdate[]
  unparsed_remainder: string | null
}

/** What the edge function returns: the extraction plus tracing (09 §8). */
export interface CaptureParseResult extends CaptureExtraction {
  model: string
  latency_ms: number
  usage: { input_tokens: number | null; output_tokens: number | null }
}

/**
 * Why the AI path was not available. Every one of these lands the user in the
 * manual form with the dictation prefilled — never an error dead end (09 §2).
 */
export type CaptureFailure = 'unconfigured' | 'timeout' | 'offline' | 'error'

export const CAPTURE_FAILURE_NOTICE: Record<CaptureFailure, string> = {
  unconfigured: 'AI parsing is not switched on — your note is below, ready to file by hand.',
  timeout: 'The parse took too long. Your note is below, nothing was lost.',
  offline: 'No connection to the parser. Your note is below, nothing was lost.',
  error: 'The parser could not read that. Your note is below, nothing was lost.',
}

/** The narrow contact row the matcher needs — names, org, and the dedupe keys. */
export interface CaptureContact {
  id: string
  first_name: string
  last_name: string
  organization: string | null
  city: string | null
  tier: string | null
  email: string | null
  phone: string | null
  whatsapp: string | null
}

/** Below this the chips render empty rather than guessed (09 §2). */
export const LOW_CONFIDENCE = 0.6
