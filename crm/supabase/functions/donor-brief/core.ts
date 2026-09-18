// GENERATED MIRROR — do not edit.
// Source: crm/src/features/ai/core.ts. The Deno edge runtime cannot reach into
// src/, so each function carries a byte-identical copy under this header.
// tests/ai-core-mirror.test.ts fails the build the moment one drifts.
/**
 * The pure core of M9a — the parts of the AI features that must be *decided*
 * rather than *generated*, and therefore testable without a model, a browser
 * or a database.
 *
 * Three rules shape this file:
 *
 * 1. **No imports.** Not one. The three edge functions (`donor-brief`,
 *    `draft-message`, `send-digest`) run on Deno and cannot reach into `src/`,
 *    so each carries a byte-identical mirror of this file next to its
 *    `index.ts`. `tests/ai-core-mirror.test.ts` fails the build if a mirror
 *    drifts. Adding an import here would break all three deployments, which is
 *    why there are none.
 * 2. **Redaction happens before the prompt, not after.** RLS already hides what
 *    the requester may not see (09 §1.7) — `buildBriefFacts` re-asserts it, so
 *    a policy regression cannot turn into a leak into a model prompt.
 * 3. **Numbers are copied, never computed.** Everything the model is allowed to
 *    say a number about arrives here from `contact_stats` (I-8/I-9) and is
 *    passed through verbatim.
 */

/* ========================================================================== */
/* Labelling — 09 §1.4                                                        */
/* ========================================================================== */

/**
 * "Two states: 'Drafted with AI' … until a human accepts/edits → 'Reviewed'."
 * `discarded` is not a third label: it is the absence of content, kept in the
 * machine so a rejection is a transition we can log rather than a silent unmount.
 */
export type AiLabelState = 'ai' | 'reviewed' | 'discarded'

/** What a person did to the output. `regenerate` produces a fresh unreviewed run. */
export type AiLabelEvent = 'accept' | 'edit' | 'reject' | 'regenerate'

/** The `ai_activity_log.resolution` values (02 §3.17) a human action maps to. */
export type AiResolution = 'pending' | 'accepted' | 'edited' | 'rejected'

export function nextLabel(state: AiLabelState, event: AiLabelEvent): AiLabelState {
  // A regenerate always lands back on unreviewed AI output, whatever came before:
  // the text on screen is new, so the label must stop claiming a human saw it.
  if (event === 'regenerate') return 'ai'
  if (state === 'discarded') return 'discarded'
  if (event === 'reject') return 'discarded'
  return 'reviewed'
}

export function labelText(state: AiLabelState): string {
  if (state === 'reviewed') return 'Reviewed'
  if (state === 'discarded') return 'Discarded'
  return 'Drafted with AI'
}

/** Only the three human verdicts write a resolution; a regenerate logs its own run. */
export function resolutionFor(event: AiLabelEvent): AiResolution {
  if (event === 'accept') return 'accepted'
  if (event === 'edit') return 'edited'
  if (event === 'reject') return 'rejected'
  return 'pending'
}

/* ========================================================================== */
/* Brief context assembly — 09 §3, §1.7                                       */
/* ========================================================================== */

export interface BriefViewer {
  id: string
  /** `team_members.can_see_amounts`, widened by role in `crm_can_see_amounts()`. */
  canSeeAmounts: boolean
}

export interface BriefContactRow {
  id: string
  title?: string | null
  first_name?: string | null
  last_name?: string | null
  hebrew_name?: string | null
  organization?: string | null
  position?: string | null
  city?: string | null
  stage?: string | null
  priority?: string | null
  tier?: string | null
  preferred_language?: string | null
  preferred_channel?: string | null
  best_time_to_contact?: string | null
  birthday?: string | null
  spouse_name?: string | null
  family_notes?: string | null
  things_to_remember?: string | null
  mutual_connections?: string | null
  known_since?: string | null
  relationship_strength?: number | null
  introduced_by_note?: string | null
  estimated_capacity?: number | null
  contact_frequency_days?: number | null
  engagement_score?: number | null
  engagement_tier?: string | null
  holding_line?: string | null
}

/** The `contact_stats` columns a brief narrates. Nulls mean "not known", never 0. */
export interface BriefStatsRow {
  lifetime_giving?: number | null
  giving_this_year?: number | null
  giving_last_year?: number | null
  gift_count?: number | null
  largest_gift?: number | null
  average_gift?: number | null
  first_gift_date?: string | null
  last_gift_date?: string | null
  last_gift_amount?: number | null
  pledge_balance?: number | null
  days_since_contact?: number | null
  last_meaningful_contact_at?: string | null
  last_meaningful_contact_kind?: string | null
  kit_due_on?: string | null
  open_task_count?: number | null
  next_action_title?: string | null
  next_action_due_on?: string | null
  flag?: string | null
  donor_status?: string | null
}

export interface BriefTimelineRow {
  occurred_at?: string | null
  kind?: string | null
  status?: string | null
  summary?: string | null
  outcome?: string | null
  location?: string | null
  ask_amount?: number | null
}

export interface BriefTaskRow {
  title?: string | null
  action_type?: string | null
  due_on?: string | null
  status?: string | null
}

export interface BriefNoteRow {
  category?: string | null
  body?: string | null
  is_private?: boolean | null
  created_by?: string | null
  created_at?: string | null
}

export interface BriefOpenItemRow {
  kind: 'pledge' | 'opportunity'
  label: string
  amount?: number | null
  stage?: string | null
  due_on?: string | null
}

export interface BriefInput {
  contact: BriefContactRow
  stats: BriefStatsRow | null
  /** Newest first. Capped to `TIMELINE_LIMIT` here, not by the caller. */
  timeline: BriefTimelineRow[]
  tasks: BriefTaskRow[]
  notes: BriefNoteRow[]
  openItems: BriefOpenItemRow[]
  tags: string[]
  viewer: BriefViewer
}

/** 09 §3: "last 15 timeline entries". */
export const TIMELINE_LIMIT = 15
/** Below this the brief must say "thin file" rather than pad (09 §3 failure modes). */
export const THIN_FILE_INTERACTIONS = 4

export interface BriefFacts {
  contact: Record<string, unknown>
  /** Every figure the model is permitted to state, already computed by SQL. */
  numbers: Record<string, unknown>
  timeline: Array<Record<string, unknown>>
  open_tasks: Array<Record<string, unknown>>
  open_items: Array<Record<string, unknown>>
  notes: Array<Record<string, unknown>>
  tags: string[]
  /** False for a restricted viewer — the prompt must then mention no figures. */
  amounts_visible: boolean
  /** Fewer than four interactions on record: say so, do not pad. */
  thin_file: boolean
  interaction_count: number
  current_holding_line: string | null
}

const clean = (value: unknown): boolean =>
  value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)

/** Drop empty keys so the prompt carries signal, not a wall of nulls. */
function compact(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(source)) if (clean(source[key])) out[key] = source[key]
  return out
}

/**
 * Turn the rows read through the caller's RLS into the exact object the prompt
 * carries — and drop, here and again, everything that caller may not see.
 *
 * The second pass is deliberate. RLS is the boundary (11 §2) and it already
 * filtered these rows; this function assumes it might one day not have, because
 * the cost of that assumption is a few lines and the cost of being wrong is a
 * private note in a model prompt.
 */
export function buildBriefFacts(input: BriefInput): BriefFacts {
  const { contact, stats, viewer } = input
  const money = viewer.canSeeAmounts

  const timeline = input.timeline.slice(0, TIMELINE_LIMIT).map((row) =>
    compact({
      at: row.occurred_at ?? null,
      kind: row.kind ?? null,
      status: row.status ?? null,
      summary: row.summary ?? null,
      outcome: row.outcome ?? null,
      location: row.location ?? null,
      // An ask is an amount. A restricted viewer sees the conversation, not the figure.
      ask_amount: money ? (row.ask_amount ?? null) : null,
    }),
  )

  const notes = input.notes
    // Defence in depth behind `notes_sel`: a private note belongs to its author
    // (an admin reading one is a UI privilege, never a prompt ingredient).
    .filter((note) => !note.is_private || note.created_by === viewer.id)
    .map((note) =>
      compact({ category: note.category ?? null, body: note.body ?? null, at: note.created_at ?? null }),
    )

  const interactionCount = input.timeline.length

  return {
    contact: compact({
      name: [contact.title, contact.first_name, contact.last_name].filter(Boolean).join(' ').trim() || null,
      hebrew_name: contact.hebrew_name ?? null,
      organization: contact.organization ?? null,
      position: contact.position ?? null,
      city: contact.city ?? null,
      stage: contact.stage ?? null,
      priority: contact.priority ?? null,
      tier: contact.tier ?? null,
      preferred_language: contact.preferred_language ?? null,
      preferred_channel: contact.preferred_channel ?? null,
      best_time_to_contact: contact.best_time_to_contact ?? null,
      birthday: contact.birthday ?? null,
      spouse: contact.spouse_name ?? null,
      family_notes: contact.family_notes ?? null,
      things_to_remember: contact.things_to_remember ?? null,
      mutual_connections: contact.mutual_connections ?? null,
      known_since: contact.known_since ?? null,
      relationship_strength: contact.relationship_strength ?? null,
      introduced_by: contact.introduced_by_note ?? null,
      keep_in_touch_days: contact.contact_frequency_days ?? null,
      engagement_score: contact.engagement_score ?? null,
      engagement_tier: contact.engagement_tier ?? null,
      // Capacity is a manual field from personal knowledge (09 §6), never screened.
      estimated_capacity: money ? (contact.estimated_capacity ?? null) : null,
    }),

    numbers: compact({
      lifetime_giving: money ? (stats?.lifetime_giving ?? null) : null,
      giving_this_year: money ? (stats?.giving_this_year ?? null) : null,
      giving_last_year: money ? (stats?.giving_last_year ?? null) : null,
      gift_count: money ? (stats?.gift_count ?? null) : null,
      largest_gift: money ? (stats?.largest_gift ?? null) : null,
      average_gift: money ? (stats?.average_gift ?? null) : null,
      first_gift_date: stats?.first_gift_date ?? null,
      last_gift_date: stats?.last_gift_date ?? null,
      last_gift_amount: money ? (stats?.last_gift_amount ?? null) : null,
      pledge_balance: money ? (stats?.pledge_balance ?? null) : null,
      // Not money: a restricted viewer still gets the relationship rhythm.
      days_since_contact: stats?.days_since_contact ?? null,
      last_contact_at: stats?.last_meaningful_contact_at ?? null,
      last_contact_kind: stats?.last_meaningful_contact_kind ?? null,
      keep_in_touch_due_on: stats?.kit_due_on ?? null,
      open_task_count: stats?.open_task_count ?? null,
      next_action: stats?.next_action_title ?? null,
      next_action_due_on: stats?.next_action_due_on ?? null,
      flag: stats?.flag ?? null,
      donor_status: stats?.donor_status ?? null,
    }),

    timeline,

    open_tasks: input.tasks.map((task) =>
      compact({
        title: task.title ?? null,
        type: task.action_type ?? null,
        due_on: task.due_on ?? null,
        status: task.status ?? null,
      }),
    ),

    open_items: input.openItems.map((item) =>
      compact({
        kind: item.kind,
        label: item.label,
        amount: money ? (item.amount ?? null) : null,
        stage: item.stage ?? null,
        due_on: item.due_on ?? null,
      }),
    ),

    notes,
    tags: input.tags.filter((tag) => tag !== ''),
    amounts_visible: money,
    thin_file: interactionCount < THIN_FILE_INTERACTIONS,
    interaction_count: interactionCount,
    current_holding_line: contact.holding_line ?? null,
  }
}

/* ========================================================================== */
/* Hard exclusion — 09 §1.6 (the Vanderbilt 2023 failure)                     */
/* ========================================================================== */

export type DraftPurpose = 'thank_you' | 'proposal_follow_up' | 'ga_declaration_request'

export const DRAFT_PURPOSES: DraftPurpose[] = [
  'thank_you',
  'proposal_follow_up',
  'ga_declaration_request',
]

export interface ExclusionInput {
  /** `tributes.tribute_type` for the gift in hand, if any. */
  tributeType?: string | null
  /**
   * Free text the draft would be grounded in — interaction summaries and
   * outcomes, visible notes, `things_to_remember`. Nulls are ignored.
   */
  texts: Array<string | null | undefined>
}

export interface ExclusionResult {
  excluded: true
  /** Shown to the fundraiser verbatim, so it reads as a sentence, not a code. */
  reason: string
  /** Which marker fired — logged, and shown under "why am I seeing this" (09 §1.8). */
  marker: string
}

/**
 * Bereavement and serious-illness markers.
 *
 * **The bias is deliberate.** A false positive costs a fundraiser one blank
 * compose box; a false negative is an AI-written condolence note, which is the
 * documented failure this rule exists to prevent. Where a phrase could be
 * innocent ("hospital wing"), the narrower form is listed ("in hospital",
 * "hospitalised") so the common fundraising usage does not trip it — but where
 * the choice is between over- and under-matching, this list over-matches.
 *
 * Anglo-charedi register included: the Hebrew/Yiddish words for a death and a
 * shiva house are how these events are actually written in this CRM.
 */
export const BEREAVEMENT_MARKERS: string[] = [
  'passed away',
  'passing of',
  'niftar',
  'nifter',
  'niftara',
  'petirah',
  'petira',
  'levaya',
  'levayah',
  'shiva',
  'shivah',
  'nichum aveilim',
  'avelus',
  'aveilus',
  'aveilut',
  'yahrzeit',
  'yohrtzeit',
  'bereaved',
  'bereavement',
  'condolence',
  'condolences',
  'funeral',
  'burial',
  'kevura',
  'kevurah',
  'died',
  'death',
  'deceased',
  'mourning',
  'widow',
  'widowed',
  'orphan',
  'a"h',
  'z"l',
  'zt"l',
  'ob"m',
  'r"l',
]

export const ILLNESS_MARKERS: string[] = [
  'seriously ill',
  'critically ill',
  'gravely ill',
  'terminally ill',
  'terminal',
  'palliative',
  'hospice',
  'in hospital',
  'hospitalised',
  'hospitalized',
  'intensive care',
  'icu',
  'cancer',
  'chemo',
  'chemotherapy',
  'radiotherapy',
  'stroke',
  'heart attack',
  'surgery',
  'operation on',
  'refuah',
  'refuah shleima',
  'refua shleima',
  'cholim',
  'choleh',
  'tehillim for',
  'not well at all',
  'very unwell',
  'diagnosed with',
  'diagnosis of',
]

const escapeForRegex = (marker: string): string => marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Word-boundary match, tolerant of the punctuation these markers actually carry.
 * `\b` is useless next to a quote (`z"l`), so a marker ending in a non-word
 * character is anchored on its left edge only.
 */
function markerPattern(marker: string): RegExp {
  const body = escapeForRegex(marker)
  const left = /^\w/.test(marker) ? '\\b' : ''
  const right = /\w$/.test(marker) ? '\\b' : ''
  return new RegExp(`${left}${body}${right}`, 'i')
}

const ALL_MARKERS: Array<{ marker: string; pattern: RegExp; kind: 'bereavement' | 'illness' }> = [
  ...BEREAVEMENT_MARKERS.map((marker) => ({ marker, pattern: markerPattern(marker), kind: 'bereavement' as const })),
  ...ILLNESS_MARKERS.map((marker) => ({ marker, pattern: markerPattern(marker), kind: 'illness' as const })),
]

/**
 * 09 §1.6 — condolence, bereavement and serious-illness messages are never
 * AI-drafted. Returns the refusal, or `null` when drafting may proceed.
 *
 * The tribute type is checked first because it is a *fact*, not a guess: a gift
 * recorded `in_memory` is by definition about a death.
 */
export function detectExclusion(input: ExclusionInput): ExclusionResult | null {
  if ((input.tributeType ?? '').toLowerCase() === 'in_memory') {
    return {
      excluded: true,
      reason:
        'This gift is recorded in memory of someone. Messages touching a bereavement are written by a person, never drafted by AI (09 §1.6).',
      marker: 'tribute:in_memory',
    }
  }

  for (const text of input.texts) {
    if (typeof text !== 'string' || text.trim() === '') continue
    for (const entry of ALL_MARKERS) {
      if (entry.pattern.test(text)) {
        return {
          excluded: true,
          reason:
            entry.kind === 'bereavement'
              ? `The record mentions a bereavement (“${entry.marker}”). Messages touching a death are written by a person, never drafted by AI (09 §1.6).`
              : `The record mentions a serious illness (“${entry.marker}”). Messages touching illness are written by a person, never drafted by AI (09 §1.6).`,
          marker: entry.marker,
        }
      }
    }
  }

  return null
}

/* ========================================================================== */
/* Drafting — 09 §4                                                           */
/* ========================================================================== */

/** One row of the grounding panel that renders beside every draft (09 §1.3). */
export interface DraftFact {
  label: string
  value: string
}

export interface DraftResponse {
  draft: string
  facts_used: DraftFact[]
  purpose: DraftPurpose
  excluded?: false
  model?: string
  ai_activity_id?: string | null
  latency_ms?: number | null
}

export interface DraftExcludedResponse {
  excluded: true
  reason: string
  marker: string
  purpose: DraftPurpose
}

export type DraftResult = DraftResponse | DraftExcludedResponse

export const isExcluded = (result: DraftResult | null | undefined): result is DraftExcludedResponse =>
  Boolean(result && (result as DraftExcludedResponse).excluded === true)

export const PURPOSE_LABEL: Record<DraftPurpose, string> = {
  thank_you: 'Thank-you',
  proposal_follow_up: 'Proposal follow-up',
  ga_declaration_request: 'Gift Aid declaration request',
}

/* ========================================================================== */
/* The brief itself — 09 §3                                                   */
/* ========================================================================== */

/** The five fixed bullets, in the spec's order. Never four, never six. */
export interface BriefBullets {
  who: string
  trajectory: string
  giving: string
  last_time: string
  talking_points: string
}

export const BRIEF_BULLET_ORDER: Array<{ key: keyof BriefBullets; label: string }> = [
  { key: 'who', label: 'Who & how you know him' },
  { key: 'trajectory', label: 'Trajectory' },
  { key: 'giving', label: 'Giving pattern & capacity signal' },
  { key: 'last_time', label: 'Last time & what was promised' },
  { key: 'talking_points', label: 'Talking points & the one thing not to forget' },
]

export interface BriefResponse {
  bullets: BriefBullets
  holding_line: string
  thin_file: boolean
  cached: boolean
  generated_at: string
  model?: string | null
  ai_activity_id?: string | null
  latency_ms?: number | null
}

/* ========================================================================== */
/* Digest composition — 08 §6 / 09 §5                                         */
/* ========================================================================== */

export interface DigestMeeting {
  contact_id: string
  contact_name: string
  at: string
  summary?: string | null
  location?: string | null
}

export interface DigestTask {
  id: string
  contact_id: string
  contact_name: string
  title: string
  action_type: string
  due_on: string | null
  /** Negative for future, 0 today, positive for overdue. Computed in SQL. */
  days_overdue?: number | null
}

export interface DigestSignal {
  contact_id: string
  contact_name: string
  rule_key: string
  reason: string
}

export interface DigestKitDue {
  contact_id: string
  contact_name: string
  due_on: string | null
}

export interface DigestInput {
  member: { id: string; full_name: string; email?: string | null }
  /** yyyy-mm-dd, the day being digested. */
  today: string
  meetings: DigestMeeting[]
  dueToday: DigestTask[]
  overdue: DigestTask[]
  signals: DigestSignal[]
  kitDue: DigestKitDue[]
  /** Base URL every line deep-links into (08 §6). No trailing slash required. */
  appUrl: string
}

export interface DigestGroup {
  type: string
  label: string
  items: DigestTask[]
}

export interface DigestPayload {
  date: string
  member_id: string
  member_name: string
  quiet: boolean
  counts: {
    meetings: number
    due_today: number
    overdue: number
    signals: number
    kit_due: number
  }
  meetings: DigestMeeting[]
  due_by_type: DigestGroup[]
  overdue_total: number
  overdue_top: DigestTask[]
  signals: DigestSignal[]
  kit_due: DigestKitDue[]
}

/** 08 §6: "overdue (count + top 3)". Three, so the digest stays readable. */
export const OVERDUE_TOP = 3

const ACTION_TYPE_LABEL: Record<string, string> = {
  call: 'Calls',
  whatsapp: 'WhatsApps',
  send_email: 'Emails',
  arrange_meeting: 'Meetings to arrange',
  send_proposal: 'Proposals to send',
  ask: 'Asks',
  follow_up_proposal: 'Proposal follow-ups',
  send_update: 'Updates to send',
  invite_event: 'Event invitations',
  thank_you: 'Thank-yous',
  send_receipt: 'Receipts',
  speak_to_introducer: 'Introducer conversations',
  keep_in_touch: 'Keep in touch',
  other: 'Other',
}

export const actionTypeLabel = (type: string): string =>
  ACTION_TYPE_LABEL[type] ?? type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

const trimUrl = (url: string): string => url.replace(/\/+$/, '')

/**
 * Assemble the digest from numbers SQL already produced (09 §5: "the digest's
 * numbers are assembled by SQL; the model writes only the two-sentence
 * narrative on top"). Nothing here counts anything the database did not.
 */
export function composeDigest(input: DigestInput): DigestPayload {
  const groups = new Map<string, DigestTask[]>()
  for (const task of input.dueToday) {
    const key = task.action_type || 'other'
    const bucket = groups.get(key)
    if (bucket) bucket.push(task)
    else groups.set(key, [task])
  }

  const dueByType: DigestGroup[] = [...groups.entries()]
    .map(([type, items]) => ({ type, label: actionTypeLabel(type), items }))
    .sort((a, b) => (b.items.length - a.items.length) || a.label.localeCompare(b.label))

  const overdueSorted = [...input.overdue].sort(
    (a, b) => (b.days_overdue ?? 0) - (a.days_overdue ?? 0),
  )

  const counts = {
    meetings: input.meetings.length,
    due_today: input.dueToday.length,
    overdue: input.overdue.length,
    signals: input.signals.length,
    kit_due: input.kitDue.length,
  }

  return {
    date: input.today,
    member_id: input.member.id,
    member_name: input.member.full_name,
    quiet: Object.values(counts).every((count) => count === 0),
    counts,
    meetings: input.meetings,
    due_by_type: dueByType,
    overdue_total: input.overdue.length,
    overdue_top: overdueSorted.slice(0, OVERDUE_TOP),
    signals: input.signals,
    kit_due: input.kitDue,
  }
}

export function digestSubject(payload: DigestPayload): string {
  if (payload.quiet) return `Your day — nothing due (${payload.date})`
  const parts: string[] = []
  if (payload.counts.meetings > 0) {
    parts.push(`${payload.counts.meetings} meeting${payload.counts.meetings === 1 ? '' : 's'}`)
  }
  if (payload.counts.due_today > 0) parts.push(`${payload.counts.due_today} due`)
  if (payload.counts.overdue > 0) parts.push(`${payload.counts.overdue} overdue`)
  if (parts.length === 0 && payload.counts.signals > 0) {
    parts.push(`${payload.counts.signals} nudge${payload.counts.signals === 1 ? '' : 's'}`)
  }
  if (parts.length === 0) parts.push(`${payload.counts.kit_due} to keep in touch with`)
  return `Your day — ${parts.join(' · ')} (${payload.date})`
}

/**
 * The plain-text body. Every line deep-links (08 §6).
 *
 * **A quiet day sends two lines, never silence** — the habit is the product, and
 * a digest that skips itself teaches the reader to stop opening it.
 */
export function digestText(payload: DigestPayload, narrative: string | null, appUrl: string): string {
  const base = trimUrl(appUrl)
  const link = (path: string): string => `${base}${path}`
  const person = (id: string, name: string): string => `${name} (${link(`/contacts/${id}`)})`
  const lines: string[] = []

  if (payload.quiet) {
    lines.push('Nothing is due today — no meetings, no tasks, no nudges, nobody overdue a hello.')
    lines.push(`A quiet day is still a day: ${link('/contacts?view=no-next-action')} if you want to pick someone up.`)
    return lines.join('\n')
  }

  if (narrative && narrative.trim() !== '') {
    lines.push(narrative.trim(), '')
  }

  if (payload.meetings.length > 0) {
    lines.push('MEETINGS TODAY')
    for (const meeting of payload.meetings) {
      const time = meeting.at.length >= 16 ? meeting.at.slice(11, 16) : meeting.at
      lines.push(
        `· ${time} — ${person(meeting.contact_id, meeting.contact_name)}${
          meeting.location ? ` · ${meeting.location}` : ''
        }`,
      )
    }
    lines.push('')
  }

  if (payload.due_by_type.length > 0) {
    lines.push(`DUE TODAY (${payload.counts.due_today})`)
    for (const group of payload.due_by_type) {
      lines.push(`${group.label} (${group.items.length})`)
      for (const task of group.items) {
        lines.push(`· ${task.title} — ${person(task.contact_id, task.contact_name)}`)
      }
    }
    lines.push('')
  }

  if (payload.overdue_total > 0) {
    lines.push(`OVERDUE (${payload.overdue_total})`)
    for (const task of payload.overdue_top) {
      const days = task.days_overdue ?? 0
      lines.push(
        `· ${task.title} — ${person(task.contact_id, task.contact_name)}${
          days > 0 ? ` · ${days}d late` : ''
        }`,
      )
    }
    if (payload.overdue_total > payload.overdue_top.length) {
      lines.push(`· …and ${payload.overdue_total - payload.overdue_top.length} more — ${link('/tasks?filter=overdue')}`)
    }
    lines.push('')
  }

  if (payload.signals.length > 0) {
    lines.push(`WORTH A LOOK (${payload.signals.length})`)
    for (const signal of payload.signals) {
      lines.push(`· ${person(signal.contact_id, signal.contact_name)} — ${signal.reason}`)
    }
    lines.push('')
  }

  if (payload.kit_due.length > 0) {
    lines.push(`KEEP IN TOUCH (${payload.kit_due.length})`)
    for (const kit of payload.kit_due) {
      lines.push(`· ${person(kit.contact_id, kit.contact_name)}${kit.due_on ? ` — due ${kit.due_on}` : ''}`)
    }
    lines.push('')
  }

  lines.push(`Open today: ${link('/')}`)
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
