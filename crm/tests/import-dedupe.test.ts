/**
 * The dedupe pass and its resolution reducer (06 §5, step 4).
 *
 * The behaviour under test is the *policy*, not the matcher: which defaults
 * the wizard proposes, and what the reducer refuses to let a user express.
 * The matcher itself is `features/contacts/normalise.ts`, already covered by
 * `contacts-duplicates.test.ts` — the point of these tests is that an import
 * uses the same door as the create sheet (02 §6).
 */

import { describe, expect, it } from 'vitest'
import {
  defaultResolution,
  describeReasons,
  findDuplicates,
  heldCount,
  initialResolutions,
  isStrongMatch,
  resolutionReducer,
} from '../src/features/import/dedupe'
import { normalisePreview } from '../src/features/import/normalisePreview'
import type { ColumnMapping, RowDuplicate } from '../src/features/import/types'
import type { ContactRow } from '../src/features/contacts/types'

const contact = (over: Partial<ContactRow> & { id: string }): ContactRow =>
  ({
    first_name: '',
    last_name: '',
    organization: null,
    email: null,
    phone: null,
    whatsapp: null,
    city: null,
    is_archived: false,
    merged_into_id: null,
    is_organisation_self: false,
    ...over,
  }) as ContactRow

const MAPPING: ColumnMapping = ['first_name', 'last_name', 'email', 'phone']

const rowsFrom = (cells: string[][]) => normalisePreview(cells, MAPPING)

describe('findDuplicates · against existing records', () => {
  const existing = [
    contact({ id: 'c1', first_name: 'Dovid', last_name: 'Cohen', email: 'dovid@example.com' }),
    contact({ id: 'c2', first_name: 'Yaakov', last_name: 'Weiss', phone: '+447700900999' }),
  ]

  it('matches on a normalised email', () => {
    const rows = rowsFrom([['David', 'Cohen', 'DOVID@example.com', '']])
    const [found] = findDuplicates(rows, existing)
    expect(found.existing?.contact.id).toBe('c1')
    expect(found.reasons).toContain('email')
  })

  it('matches on a phone number the file wrote nationally', () => {
    const rows = rowsFrom([['Yankel', 'Weiss', '', '07700 900999']])
    const [found] = findDuplicates(rows, existing)
    expect(found.existing?.contact.id).toBe('c2')
    expect(found.reasons).toContain('phone')
  })

  it('matches a close name with no contact details', () => {
    const rows = rowsFrom([['Dovid', 'Cohen', '', '']])
    const [found] = findDuplicates(rows, existing)
    expect(found.reasons).toEqual(['name'])
  })

  it('finds nothing for a genuinely new person', () => {
    const rows = rowsFrom([['Shloimy', 'Fischer', 'shloimy@example.com', '']])
    expect(findDuplicates(rows, existing)).toEqual([])
  })

  it('ignores archived records and tombstones', () => {
    const dead = [
      contact({ id: 'x', first_name: 'Dovid', last_name: 'Cohen', is_archived: true }),
      contact({ id: 'y', first_name: 'Dovid', last_name: 'Cohen', merged_into_id: 'c1' }),
    ]
    expect(findDuplicates(rowsFrom([['Dovid', 'Cohen', '', '']]), dead)).toEqual([])
  })

  it('never flags a row it would refuse to write anyway', () => {
    // No name at all — blocked, so the dedupe pass skips it entirely.
    expect(findDuplicates(rowsFrom([['', '', 'dovid@example.com', '']]), existing)).toEqual([])
  })
})

describe('findDuplicates · within the file', () => {
  it('points a repeat at the earlier row, not at itself', () => {
    const rows = rowsFrom([
      ['Dovid', 'Cohen', 'dovid@example.com', ''],
      ['Dovid', 'Cohen', 'dovid@example.com', ''],
    ])
    const found = findDuplicates(rows, [])
    expect(found).toHaveLength(1)
    expect(found[0].index).toBe(1)
    expect(found[0].withinFile).toBe(0)
  })

  it('matches the nearest earlier duplicate when there are several', () => {
    const rows = rowsFrom([
      ['Dovid', 'Cohen', 'dovid@example.com', ''],
      ['Dovid', 'Cohen', 'dovid@example.com', ''],
      ['Dovid', 'Cohen', 'dovid@example.com', ''],
    ])
    const found = findDuplicates(rows, [])
    expect(found.map((f) => [f.index, f.withinFile])).toEqual([
      [1, 0],
      [2, 1],
    ])
  })
})

describe('default resolutions', () => {
  const withEmail: RowDuplicate = {
    index: 0,
    existing: { contact: contact({ id: 'c1' }), reasons: ['email'], score: 0.9 },
    withinFile: null,
    reasons: ['email'],
  }
  const nameOnly: RowDuplicate = {
    index: 1,
    existing: { contact: contact({ id: 'c2' }), reasons: ['name'], score: 0.72 },
    withinFile: null,
    reasons: ['name'],
  }
  const repeat: RowDuplicate = { index: 2, existing: null, withinFile: 0, reasons: ['email'] }
  const sameSurname: RowDuplicate = { index: 3, existing: null, withinFile: 0, reasons: ['name'] }

  it('fills in the existing record when a contact detail matches', () => {
    expect(defaultResolution(withEmail)).toEqual({ action: 'merge', targetId: 'c1', isDefault: true })
  })

  it('holds a name-only match for a human — the spec\'s "held for review"', () => {
    expect(defaultResolution(nameOnly)).toEqual({ action: 'review', targetId: null, isDefault: true })
  })

  it('skips a row the file already created earlier, on a shared contact detail', () => {
    expect(defaultResolution(repeat)).toEqual({ action: 'skip', targetId: null, isDefault: true })
  })

  it('never silently drops two siblings who share a surname', () => {
    // Shloimy Fischer and Rivky Fischer are two Fischers, not one.
    expect(defaultResolution(sameSurname)).toEqual({ action: 'review', targetId: null, isDefault: true })
  })

  it('counts the held rows for the dry-run sentence', () => {
    const state = initialResolutions([withEmail, nameOnly, repeat, sameSurname])
    expect(heldCount(state)).toBe(2)
  })

  it('knows a contact-detail match from a name one', () => {
    expect(isStrongMatch(['email'])).toBe(true)
    expect(isStrongMatch(['phone', 'name'])).toBe(true)
    expect(isStrongMatch(['name'])).toBe(false)
  })
})

describe('resolutionReducer', () => {
  const duplicates: RowDuplicate[] = [
    {
      index: 0,
      existing: { contact: contact({ id: 'c1' }), reasons: ['email'], score: 1 },
      withinFile: null,
      reasons: ['email'],
    },
    { index: 3, existing: null, withinFile: 1, reasons: ['email'] },
  ]

  it('resets to the wizard\'s own defaults', () => {
    const state = resolutionReducer({}, { type: 'reset', duplicates })
    expect(state[0].action).toBe('merge')
    expect(state[3].action).toBe('skip')
    expect(state[0].isDefault).toBe(true)
  })

  it('records an override and stops calling it a default', () => {
    let state = resolutionReducer({}, { type: 'reset', duplicates })
    state = resolutionReducer(state, { type: 'set', index: 0, action: 'create' })
    expect(state[0]).toEqual({ action: 'create', targetId: null, isDefault: false })
  })

  it('keeps the target when merging and drops it otherwise', () => {
    let state = resolutionReducer({}, { type: 'reset', duplicates })
    state = resolutionReducer(state, { type: 'set', index: 0, action: 'skip' })
    expect(state[0].targetId).toBeNull()
    state = resolutionReducer(state, { type: 'set', index: 0, action: 'merge', targetId: 'c1' })
    expect(state[0].targetId).toBe('c1')
  })

  it('refuses a merge with nowhere to merge into', () => {
    const state = resolutionReducer({}, { type: 'set', index: 3, action: 'merge', targetId: null })
    expect(state[3]).toEqual({ action: 'review', targetId: null, isDefault: false })
  })

  it('bulk-merges only the rows that have somewhere to merge into', () => {
    let state = resolutionReducer({}, { type: 'reset', duplicates })
    state = resolutionReducer(state, { type: 'setAll', action: 'merge', duplicates })
    expect(state[0]).toEqual({ action: 'merge', targetId: 'c1', isDefault: false })
    // Row 3 has no existing match, so it keeps its own default rather than
    // silently becoming a create.
    expect(state[3].action).toBe('skip')
  })

  it('bulk-holds everything', () => {
    let state = resolutionReducer({}, { type: 'reset', duplicates })
    state = resolutionReducer(state, { type: 'setAll', action: 'review', duplicates })
    expect(heldCount(state)).toBe(2)
  })
})

describe('describeReasons', () => {
  it('reads as a sentence', () => {
    expect(describeReasons(['email'])).toBe('the same email address')
    expect(describeReasons(['email', 'name'])).toBe('the same email address and a very similar name')
    expect(describeReasons([])).toBe('a possible match')
  })
})
