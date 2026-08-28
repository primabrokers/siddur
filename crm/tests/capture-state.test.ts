import { describe, expect, it } from 'vitest'
import {
  canSave,
  captureReducer,
  draftFromParse,
  initialState,
  manualDraft,
  normaliseWallClock,
  parseAskAmount,
  resolutionOf,
  type CaptureAction,
  type CaptureState,
} from '../src/features/capture/captureState'
import {
  classifyContact,
  matchContacts,
  splitName,
  titleCaseName,
} from '../src/features/capture/contactMatch'
import type { CaptureContact, CaptureParseResult } from '../src/features/capture/types'

/**
 * The pane flow, the edited-fields ledger and the deterministic matching —
 * the parts of Quick Capture that must hold without a browser or a database.
 */

const TODAY = new Date(2026, 7, 25, 10, 3) // Tue 25 Aug 2026, 10:03

const contact = (over: Partial<CaptureContact> & { id: string }): CaptureContact => ({
  first_name: 'Dovid',
  last_name: 'Cohen',
  organization: null,
  city: null,
  tier: null,
  email: null,
  phone: null,
  whatsapp: null,
  ...over,
})

const ROSTER: CaptureContact[] = [
  contact({ id: 'c1', first_name: 'Dovid', last_name: 'Cohen', city: 'Golders Green', tier: 'A' }),
  contact({ id: 'c2', first_name: 'Rivky', last_name: 'Cohen', city: 'Golders Green' }),
  contact({ id: 'c3', first_name: 'Yaakov', last_name: 'Weiss', city: 'Hendon' }),
  contact({ id: 'c4', first_name: 'Feld Brothers', last_name: 'Ltd', organization: 'Feld Brothers Ltd' }),
]

const PARSED: CaptureParseResult = {
  contact_query: 'dovid cohen',
  confidence: 0.93,
  interaction: {
    kind: 'meeting',
    occurred_at: '2026-08-25T10:00',
    location: 'London',
    summary: 'Met in London. Very warm. Strong interest in the building project; discussed £20,000.',
    outcome: 'Wants to see the naming opportunities',
    ask_amount: 20000,
    is_scheduled: false,
  },
  next_action: {
    type: 'call',
    title: 'Call re building project / £20k',
    date_expression: 'after sukkos',
    resolved_due_on: null,
  },
  suggested_updates: [{ kind: 'add_tag', value: 'Building project' }],
  unparsed_remainder: null,
  model: 'claude-opus-5',
  latency_ms: 1840,
  usage: { input_tokens: 1500, output_tokens: 300 },
}

const RAW =
  'met dovid cohen in london this morning, very warm, strong interest in the building project, discussed twenty k, he wants me to call him after sukkos'

/** Drive the reducer over a list of actions from a fresh state. */
function run(actions: CaptureAction[], start?: CaptureState): CaptureState {
  return actions.reduce(captureReducer, start ?? initialState({ now: TODAY }))
}

/* ------------------------------------------------------------- matching */

describe('contact matching', () => {
  it('takes a clear winner as a strong match', () => {
    const choice = classifyContact('dovid cohen', ROSTER)
    expect(choice.mode).toBe('matched')
    expect(choice.contactId).toBe('c1')
    expect(choice.name).toBe('Dovid Cohen')
  })

  it('tolerates the spelling drift of dictation', () => {
    expect(classifyContact('david cohen', ROSTER).contactId).toBe('c1')
    expect(classifyContact('Dovid  Cohen', ROSTER).contactId).toBe('c1')
  })

  it('offers a picker rather than choosing when two are close', () => {
    const choice = classifyContact('cohen', ROSTER)
    expect(choice.mode).toBe('ambiguous')
    expect(choice.candidates.length).toBeGreaterThan(1)
    expect(choice.candidates.length).toBeLessThanOrEqual(3)
    expect(choice.candidates.map((c) => c.contact.id)).toContain('c2')
  })

  it('never creates silently — no match means an explicit create chip', () => {
    const choice = classifyContact('shloimy katz', ROSTER)
    expect(choice.mode).toBe('create')
    expect(choice.name).toBe('Shloimy Katz')
    expect(choice.contactId).toBeNull()
  })

  it('matches an organisation by its name', () => {
    expect(classifyContact('feld brothers ltd', ROSTER).contactId).toBe('c4')
  })

  it('lets an exact phone or email beat the fuzzy scores', () => {
    const roster = [...ROSTER, contact({ id: 'c9', first_name: 'Zev', last_name: 'Klein', phone: '+447700900123' })]
    const byPhone = matchContacts('07700 900123', roster)
    expect(byPhone[0]?.contact.id).toBe('c9')
    expect(byPhone[0]?.reason).toBe('phone')
  })

  it('returns nothing at all for an empty query', () => {
    expect(matchContacts('', ROSTER)).toEqual([])
    expect(classifyContact(null, ROSTER).mode).toBe('none')
  })

  it('splits and title-cases a dictated name', () => {
    expect(titleCaseName('dovid  cohen')).toBe('Dovid Cohen')
    expect(splitName('dovid cohen')).toEqual({ first_name: 'Dovid', last_name: 'Cohen' })
    expect(splitName('moishe ben zion stern')).toEqual({ first_name: 'Moishe Ben Zion', last_name: 'Stern' })
    expect(splitName('yanky')).toEqual({ first_name: 'Yanky', last_name: '' })
  })
})

/* ------------------------------------------------------- draft from parse */

describe('draftFromParse', () => {
  it('resolves the date expression deterministically, not from the model', () => {
    const draft = draftFromParse(PARSED, { today: TODAY, roster: ROSTER })
    expect(PARSED.next_action?.resolved_due_on).toBeNull()
    expect(draft.nextAction.dateExpression).toBe('after sukkos')
    expect(draft.nextAction.resolution?.date).toBe('2026-10-06')
    expect(draft.nextAction.dueOn).toBe('2026-10-06')
    expect(draft.nextAction.enabled).toBe(true)
  })

  it('carries the interaction chips across', () => {
    const draft = draftFromParse(PARSED, { today: TODAY, roster: ROSTER })
    expect(draft.kind).toBe('meeting')
    expect(draft.occurredAt).toBe('2026-08-25T10:00')
    expect(draft.location).toBe('London')
    expect(draft.askAmount).toBe('20000')
    expect(draft.isScheduled).toBe(false)
    expect(draft.summary).toContain('Strong interest')
  })

  it('leaves an unreadable date expression unresolved rather than guessing', () => {
    const parsed: CaptureParseResult = {
      ...PARSED,
      next_action: { type: 'call', title: 'Call him', date_expression: 'before the dinner', resolved_due_on: null },
    }
    const draft = draftFromParse(parsed, { today: TODAY, roster: ROSTER })
    expect(draft.nextAction.resolution).toBeNull()
    expect(draft.nextAction.dueOn).toBe('')
    expect(draft.nextAction.dateExpression).toBe('before the dinner')
  })

  it('offers suggested tags off by default (04 §4)', () => {
    const draft = draftFromParse(PARSED, { today: TODAY, roster: ROSTER })
    expect(draft.tags).toEqual([{ value: 'Building project', accepted: false }])
  })

  it('empties the chips when confidence is low, keeping the note (09 §2)', () => {
    const draft = draftFromParse({ ...PARSED, confidence: 0.3 }, { today: TODAY, roster: ROSTER })
    expect(draft.summary).toBe('')
    expect(draft.location).toBe('')
    expect(draft.nextAction.enabled).toBe(false)
    // The contact chip still matches — that step is arithmetic, not the model.
    expect(draft.contact.contactId).toBe('c1')
  })

  it('skips matching entirely when a contact was preselected', () => {
    const draft = draftFromParse(PARSED, {
      today: TODAY,
      roster: ROSTER,
      presetContactId: 'c7',
      contactName: 'Chaim Lax',
    })
    expect(draft.contact.mode).toBe('preset')
    expect(draft.contact.contactId).toBe('c7')
    expect(draft.contact.name).toBe('Chaim Lax')
  })

  it('normalises whatever wall clock the model returns', () => {
    expect(normaliseWallClock('2026-08-25T10:00')).toBe('2026-08-25T10:00')
    expect(normaliseWallClock('2026-08-25T10:00:00Z')).toBe('2026-08-25T10:00')
    expect(normaliseWallClock('2026-08-25 10:00')).toBe('2026-08-25T10:00')
    expect(normaliseWallClock('this morning')).toBeNull()
    expect(normaliseWallClock(null)).toBeNull()
  })
})

/* ----------------------------------------------------------- the pane flow */

describe('the pane flow', () => {
  it('walks input → confirm → saved', () => {
    let state = run([
      { type: 'set-text', value: RAW },
      { type: 'parse-start' },
    ])
    expect(state.pane).toBe('input')
    expect(state.parsing).toBe(true)

    state = captureReducer(state, { type: 'parse-ok', parsed: PARSED, today: TODAY, roster: ROSTER })
    expect(state.pane).toBe('confirm')
    expect(state.source).toBe('ai')
    expect(state.parsing).toBe(false)
    expect(state.draft.contact.contactId).toBe('c1')

    state = captureReducer(state, {
      type: 'saved',
      saved: {
        contactId: 'c1',
        contactName: 'Dovid Cohen',
        interactionId: 'i1',
        taskId: 't1',
        isScheduled: false,
        kindLabel: 'Meeting',
        taskTitle: 'Call re building project / £20k',
        taskDueOn: '2026-10-06',
        dateLabel: 'after Sukkos',
        tagCount: 0,
        queued: false,
      },
    })
    expect(state.pane).toBe('saved')
    expect(state.saved?.taskDueOn).toBe('2026-10-06')
  })

  it('keeps the dictation through Back', () => {
    const state = run([
      { type: 'set-text', value: RAW },
      { type: 'parse-ok', parsed: PARSED, today: TODAY, roster: ROSTER },
      { type: 'back' },
    ])
    expect(state.pane).toBe('input')
    expect(state.text).toBe(RAW)
  })

  it('"Add another" clears everything but the preselected contact', () => {
    const start = initialState({ contactId: 'c1', now: TODAY })
    const state = run(
      [
        { type: 'set-text', value: RAW },
        { type: 'parse-ok', parsed: PARSED, today: TODAY, roster: ROSTER },
        { type: 'add-another', now: TODAY },
      ],
      start,
    )
    expect(state.pane).toBe('input')
    expect(state.text).toBe('')
    expect(state.parsed).toBeNull()
    expect(state.presetContactId).toBe('c1')
    expect(state.draft.contact.mode).toBe('preset')
  })

  it('only lets a save through with a contact and a summary (I-5)', () => {
    let state = run([{ type: 'go-manual', now: TODAY }])
    expect(canSave(state)).toBe(false)

    state = captureReducer(state, {
      type: 'edit',
      field: 'contact',
      patch: { contact: { mode: 'create', contactId: null, name: 'Shloimy Katz', candidates: [], query: 'shloimy katz' } },
    })
    expect(canSave(state)).toBe(false)

    state = captureReducer(state, { type: 'edit', field: 'summary', patch: { summary: 'Spoke about the dinner.' } })
    expect(canSave(state)).toBe(true)

    // Nothing else is required: no date, no next action, no amount.
    expect(state.draft.nextAction.enabled).toBe(false)
    expect(state.draft.askAmount).toBe('')
  })
})

/* ------------------------------------------------------- the AI fallbacks */

describe('failure lands on the manual form with the dictation intact', () => {
  it.each(['unconfigured', 'timeout', 'offline', 'error'] as const)('handles %s', (failure) => {
    const state = run([
      { type: 'set-text', value: RAW },
      { type: 'parse-start' },
      { type: 'parse-fail', failure, now: TODAY },
    ])
    expect(state.pane).toBe('confirm')
    expect(state.source).toBe('manual')
    expect(state.failure).toBe(failure)
    expect(state.parsing).toBe(false)
    // The dictation is never lost — verbatim in state and prefilled as summary.
    expect(state.text).toBe(RAW)
    expect(state.draft.summary).toBe(RAW)
    expect(state.parsed).toBeNull()
  })

  it('keeps a preselected contact through the fallback', () => {
    const start = initialState({ contactId: 'c1', now: TODAY })
    const state = run([{ type: 'set-text', value: RAW }, { type: 'parse-fail', failure: 'unconfigured' }], start)
    expect(state.draft.contact.mode).toBe('preset')
    expect(state.draft.contact.contactId).toBe('c1')
  })

  it('prefills the manual form from the raw text on the explicit route too', () => {
    const state = run([{ type: 'set-text', value: RAW }, { type: 'go-manual', now: TODAY }])
    expect(state.source).toBe('manual')
    expect(state.failure).toBeNull()
    expect(manualDraft(RAW, state, TODAY).summary).toBe(RAW)
  })
})

/* ------------------------------------------------------- edited_fields log */

describe('edited_fields tracking (09 §1.5)', () => {
  const parsedState = () =>
    run([
      { type: 'set-text', value: RAW },
      { type: 'parse-ok', parsed: PARSED, today: TODAY, roster: ROSTER },
    ])

  it('is empty — and the resolution "accepted" — when nothing is touched', () => {
    const state = parsedState()
    expect(state.editedFields).toEqual([])
    expect(resolutionOf(state)).toBe('accepted')
  })

  it('records each chip the user changes, once', () => {
    let state = parsedState()
    state = captureReducer(state, { type: 'edit', field: 'summary', patch: { summary: 'Shorter.' } })
    state = captureReducer(state, { type: 'edit', field: 'summary', patch: { summary: 'Shorter still.' } })
    state = captureReducer(state, { type: 'edit', field: 'kind', patch: { kind: 'call' } })
    expect(state.editedFields).toEqual(['summary', 'kind'])
    expect(resolutionOf(state)).toBe('edited')
  })

  it('records a refused date resolution', () => {
    let state = parsedState()
    expect(state.draft.nextAction.dueOn).toBe('2026-10-06')
    state = captureReducer(state, {
      type: 'edit',
      field: 'next_action_due_on',
      patch: { nextAction: { ...state.draft.nextAction, dueOn: '2026-10-12', resolution: null } },
    })
    expect(state.editedFields).toEqual(['next_action_due_on'])
    expect(state.draft.nextAction.dueOn).toBe('2026-10-12')
  })

  it('re-resolves when the user retypes the expression', () => {
    let state = parsedState()
    state = captureReducer(state, { type: 'set-date-expression', expression: 'in three months', today: TODAY })
    expect(state.draft.nextAction.dueOn).toBe('2026-11-25')
    expect(state.editedFields).toEqual(['next_action_due_on'])
  })

  it('records picking a contact from the picker and creating a new one', () => {
    let state = parsedState()
    state = captureReducer(state, { type: 'pick-contact', contactId: 'c2', name: 'Rivky Cohen' })
    expect(state.draft.contact.contactId).toBe('c2')
    expect(state.editedFields).toEqual(['contact'])

    state = captureReducer(state, { type: 'create-new-contact' })
    expect(state.draft.contact.mode).toBe('create')
    expect(state.editedFields).toEqual(['contact'])
  })

  it('records accepting a suggested tag', () => {
    let state = parsedState()
    state = captureReducer(state, { type: 'toggle-tag', value: 'Building project' })
    expect(state.draft.tags[0]?.accepted).toBe(true)
    expect(state.editedFields).toEqual(['suggested_updates'])
  })

  it('does not treat manual entry as an edit — there is no proposal to edit', () => {
    let state = run([{ type: 'set-text', value: RAW }, { type: 'parse-fail', failure: 'unconfigured' }])
    state = captureReducer(state, { type: 'edit', field: 'summary', patch: { summary: 'Rewritten by hand.' } })
    expect(state.editedFields).toEqual([])
  })
})

/* --------------------------------------------------------------- amounts */

describe('parseAskAmount', () => {
  it('reads what a human types and never yields NaN', () => {
    expect(parseAskAmount('20000')).toBe(20000)
    expect(parseAskAmount('£20,000')).toBe(20000)
    expect(parseAskAmount(' 20 000 ')).toBe(20000)
    expect(parseAskAmount('')).toBeNull()
    expect(parseAskAmount('twenty k')).toBeNull()
  })
})
