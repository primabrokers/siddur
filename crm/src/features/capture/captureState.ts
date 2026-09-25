/**
 * The Quick Capture state machine — pure, so the flow is testable without a
 * browser or a database.
 *
 * Three panes inside one sheet (04 §4): **input → confirm → saved**, with the
 * manual form as a fourth face of the confirm pane that never needs AI. Two
 * invariants are enforced here rather than in the components:
 *
 *   1. The raw dictation survives every path. `state.text` is never cleared by
 *      a failure, and it is what prefills the manual summary.
 *   2. Every field the user touches after an AI proposal is recorded in
 *      `editedFields`, which becomes `ai_activity_log.edited_fields` and the
 *      accepted/edited resolution (09 §1.5 — the edit rate is the tuning alarm).
 */

import { addMinutes, format } from 'date-fns'
import { resolveDateExpression, type ResolvedDate } from '../../lib/jewish-dates'
import { classifyContact, type ContactChoice } from './contactMatch'
import { LOW_CONFIDENCE, type CaptureContact, type CaptureFailure, type CaptureParseResult } from './types'

/* ------------------------------------------------------------------- shapes */

export type CapturePane = 'input' | 'confirm' | 'saved'
/** `ai` = parsed and labelled "Drafted with AI"; `manual` = no model involved. */
export type CaptureSource = 'ai' | 'manual'

export interface NextActionDraft {
  /** Off means no task row is written at all. */
  enabled: boolean
  type: string
  title: string
  /** The phrase the model heard, kept even when it could not be resolved. */
  dateExpression: string | null
  /** The resolver's verdict, or null when the phrase was unreadable. */
  resolution: ResolvedDate | null
  /** `yyyy-MM-dd`, or '' — an empty due date saves the task as `queued`. */
  dueOn: string
}

export interface TagSuggestion {
  value: string
  /** Off by default — one tap to accept (04 §4). */
  accepted: boolean
}

export interface CaptureDraft {
  contact: ContactChoice
  kind: string
  /** `yyyy-MM-ddTHH:mm` for `<input type="datetime-local">`. */
  occurredAt: string
  location: string
  summary: string
  outcome: string
  /** Kept as text so a half-typed amount never becomes NaN. */
  askAmount: string
  isScheduled: boolean
  nextAction: NextActionDraft
  tags: TagSuggestion[]
}

/** The chips whose edits are worth logging (09 §1.5). */
export type EditableField =
  | 'contact'
  | 'kind'
  | 'occurred_at'
  | 'location'
  | 'summary'
  | 'outcome'
  | 'ask_amount'
  | 'is_scheduled'
  | 'next_action'
  | 'next_action_type'
  | 'next_action_title'
  | 'next_action_due_on'
  | 'suggested_updates'

export interface CaptureSaved {
  contactId: string
  contactName: string
  interactionId: string | null
  taskId: string | null
  isScheduled: boolean
  kindLabel: string
  taskTitle: string | null
  taskDueOn: string | null
  /** "after Sukkos" — the resolver's phrase, echoed back on the saved pane. */
  dateLabel: string | null
  tagCount: number
  /** True when the write went to the offline queue instead of the database. */
  queued: boolean
}

export interface CaptureState {
  pane: CapturePane
  source: CaptureSource
  /** The dictation, verbatim. Written to `interactions.ai_raw_input`. */
  text: string
  parsing: boolean
  failure: CaptureFailure | null
  parsed: CaptureParseResult | null
  draft: CaptureDraft
  /** The AI's proposal, for diffing edits. Null on the manual path. */
  baseline: CaptureDraft | null
  editedFields: EditableField[]
  saved: CaptureSaved | null
  saveError: string | null
  /** Set when opened from a profile's Log button — matching is skipped. */
  presetContactId: string | null
}

/* ------------------------------------------------------------------ helpers */

export const DEFAULT_KIND = 'call'
export const DEFAULT_ACTION_TYPE = 'call'

const localDateTime = (date: Date): string => format(date, "yyyy-MM-dd'T'HH:mm")

/** Round to the nearest 5 minutes so the chip reads "10:00", not "09:58". */
function roundedNow(now: Date): string {
  const rounded = addMinutes(now, -(now.getMinutes() % 5))
  return localDateTime(rounded)
}

export function emptyDraft(now: Date = new Date()): CaptureDraft {
  return {
    contact: { mode: 'none', contactId: null, name: '', candidates: [], query: '' },
    kind: DEFAULT_KIND,
    occurredAt: roundedNow(now),
    location: '',
    summary: '',
    outcome: '',
    askAmount: '',
    isScheduled: false,
    nextAction: {
      enabled: false,
      type: DEFAULT_ACTION_TYPE,
      title: '',
      dateExpression: null,
      resolution: null,
      dueOn: '',
    },
    tags: [],
  }
}

export function initialState(options: { contactId?: string | null; now?: Date } = {}): CaptureState {
  const { contactId = null, now = new Date() } = options
  const draft = emptyDraft(now)
  return {
    pane: 'input',
    source: 'ai',
    text: '',
    parsing: false,
    failure: null,
    parsed: null,
    draft: contactId
      ? { ...draft, contact: { mode: 'preset', contactId, name: '', candidates: [], query: '' } }
      : draft,
    baseline: null,
    editedFields: [],
    saved: null,
    saveError: null,
    presetContactId: contactId,
  }
}

/**
 * Build the confirm-pane draft from one parse.
 *
 * This is where the two deterministic steps happen — date resolution and
 * contact matching — and where a low-confidence parse is deliberately emptied
 * out: chips render blank rather than guessed, with the raw text still on
 * screen (09 §2 failure modes).
 */
export function draftFromParse(
  parsed: CaptureParseResult,
  options: { today?: Date; roster?: CaptureContact[]; presetContactId?: string | null; contactName?: string },
): CaptureDraft {
  const { today = new Date(), roster = [], presetContactId = null, contactName = '' } = options
  const base = emptyDraft(today)
  const lowConfidence = parsed.confidence < LOW_CONFIDENCE

  const contact: ContactChoice = presetContactId
    ? { mode: 'preset', contactId: presetContactId, name: contactName, candidates: [], query: parsed.contact_query ?? '' }
    : classifyContact(parsed.contact_query, roster)

  if (lowConfidence) {
    return { ...base, contact, summary: '' }
  }

  const interaction = parsed.interaction
  const nextAction = parsed.next_action
  const expression = nextAction?.date_expression ?? null
  const resolution = expression ? resolveDateExpression(expression, today) : null

  return {
    contact,
    kind: interaction.kind || DEFAULT_KIND,
    occurredAt: normaliseWallClock(interaction.occurred_at) ?? base.occurredAt,
    location: interaction.location ?? '',
    summary: interaction.summary ?? '',
    outcome: interaction.outcome ?? '',
    askAmount: interaction.ask_amount === null ? '' : String(interaction.ask_amount),
    isScheduled: Boolean(interaction.is_scheduled),
    nextAction: {
      enabled: Boolean(nextAction),
      type: nextAction?.type || DEFAULT_ACTION_TYPE,
      title: nextAction?.title ?? '',
      dateExpression: expression,
      resolution,
      dueOn: resolution?.date ?? '',
    },
    tags: (parsed.suggested_updates ?? [])
      .filter((update) => update.kind === 'add_tag' && update.value.trim() !== '')
      .map((update) => ({ value: update.value.trim(), accepted: false })),
  }
}

/**
 * The model may hand back `2026-08-27T10:00`, an ISO instant, or junk. Keep the
 * wall clock, drop anything unusable.
 */
export function normaliseWallClock(value: string | null | undefined): string | null {
  if (!value) return null
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(value.trim())
  if (!match) return null
  return `${match[1]}T${match[2]}:${match[3]}`
}

/** The manual path: the dictation becomes the summary, verbatim (04 §4). */
export function manualDraft(text: string, state: CaptureState, now: Date = new Date()): CaptureDraft {
  const base = emptyDraft(now)
  return {
    ...base,
    contact: state.draft.contact.mode === 'preset' ? state.draft.contact : base.contact,
    summary: text.trim(),
  }
}

/* ------------------------------------------------------------------ actions */

export type CaptureAction =
  | { type: 'open'; contactId?: string | null; now?: Date }
  | { type: 'set-text'; value: string }
  | { type: 'parse-start' }
  | {
      type: 'parse-ok'
      parsed: CaptureParseResult
      today?: Date
      roster?: CaptureContact[]
      contactName?: string
    }
  | { type: 'parse-fail'; failure: CaptureFailure; now?: Date }
  | { type: 'go-manual'; now?: Date }
  | { type: 'edit'; field: EditableField; patch: Partial<CaptureDraft> }
  | { type: 'set-date-expression'; expression: string; today?: Date }
  | { type: 'pick-contact'; contactId: string; name: string }
  | { type: 'create-new-contact' }
  | { type: 'toggle-tag'; value: string }
  | { type: 'back' }
  | { type: 'save-error'; message: string }
  | { type: 'saved'; saved: CaptureSaved }
  | { type: 'add-another'; now?: Date }

const withEdit = (state: CaptureState, field: EditableField): EditableField[] => {
  // Only the AI path has a proposal to diverge from; manual entry is not "edited".
  if (state.source !== 'ai' || !state.baseline) return state.editedFields
  return state.editedFields.includes(field) ? state.editedFields : [...state.editedFields, field]
}

export function captureReducer(state: CaptureState, action: CaptureAction): CaptureState {
  switch (action.type) {
    case 'open':
      return initialState({ contactId: action.contactId ?? null, now: action.now })

    case 'set-text':
      return { ...state, text: action.value, failure: null }

    case 'parse-start':
      return { ...state, parsing: true, failure: null, saveError: null }

    case 'parse-ok': {
      const draft = draftFromParse(action.parsed, {
        today: action.today,
        roster: action.roster,
        presetContactId: state.presetContactId,
        contactName: action.contactName,
      })
      return {
        ...state,
        pane: 'confirm',
        source: 'ai',
        parsing: false,
        failure: null,
        parsed: action.parsed,
        draft,
        baseline: draft,
        editedFields: [],
      }
    }

    // Every failure lands on the manual form with the dictation intact.
    case 'parse-fail':
      return {
        ...state,
        pane: 'confirm',
        source: 'manual',
        parsing: false,
        failure: action.failure,
        parsed: null,
        draft: manualDraft(state.text, state, action.now),
        baseline: null,
        editedFields: [],
      }

    case 'go-manual':
      return {
        ...state,
        pane: 'confirm',
        source: 'manual',
        parsing: false,
        failure: null,
        parsed: null,
        draft: manualDraft(state.text, state, action.now),
        baseline: null,
        editedFields: [],
      }

    case 'edit':
      return {
        ...state,
        draft: { ...state.draft, ...action.patch },
        editedFields: withEdit(state, action.field),
        saveError: null,
      }

    case 'set-date-expression': {
      const resolution = resolveDateExpression(action.expression, action.today ?? new Date())
      return {
        ...state,
        draft: {
          ...state.draft,
          nextAction: {
            ...state.draft.nextAction,
            dateExpression: action.expression,
            resolution,
            dueOn: resolution?.date ?? '',
          },
        },
        editedFields: withEdit(state, 'next_action_due_on'),
      }
    }

    case 'pick-contact':
      return {
        ...state,
        draft: {
          ...state.draft,
          contact: { ...state.draft.contact, mode: 'matched', contactId: action.contactId, name: action.name },
        },
        editedFields: withEdit(state, 'contact'),
      }

    case 'create-new-contact':
      return {
        ...state,
        draft: {
          ...state.draft,
          contact: {
            ...state.draft.contact,
            mode: 'create',
            contactId: null,
            name: state.draft.contact.name || state.draft.contact.query,
          },
        },
        editedFields: withEdit(state, 'contact'),
      }

    case 'toggle-tag':
      return {
        ...state,
        draft: {
          ...state.draft,
          tags: state.draft.tags.map((tag) =>
            tag.value === action.value ? { ...tag, accepted: !tag.accepted } : tag,
          ),
        },
        editedFields: withEdit(state, 'suggested_updates'),
      }

    case 'back':
      return { ...state, pane: 'input', failure: null, saveError: null }

    case 'save-error':
      return { ...state, saveError: action.message }

    case 'saved':
      return { ...state, pane: 'saved', saved: action.saved, saveError: null }

    case 'add-another': {
      // "Add another" keeps the preselected contact but nothing else.
      const fresh = initialState({ contactId: state.presetContactId, now: action.now })
      return fresh
    }

    default:
      return state
  }
}

/* ---------------------------------------------------------------- selectors */

/** I-5: contact + summary and nothing else may block the save. */
export function canSave(state: CaptureState): boolean {
  const { contact, summary } = state.draft
  const hasContact = contact.mode === 'preset' || contact.mode === 'matched' || contact.mode === 'create'
  return hasContact && summary.trim().length > 0
}

/** accepted vs edited — the guardrail KPI (09 §1.5). */
export function resolutionOf(state: CaptureState): 'accepted' | 'edited' {
  return state.editedFields.length > 0 ? 'edited' : 'accepted'
}

/** `20,000` → 20000; `''` → null. Never NaN into the database. */
export function parseAskAmount(value: string): number | null {
  const cleaned = value.replace(/[£,\s]/g, '')
  if (cleaned === '') return null
  const amount = Number(cleaned)
  return Number.isFinite(amount) ? amount : null
}
