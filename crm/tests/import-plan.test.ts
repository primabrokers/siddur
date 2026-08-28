/**
 * The dry run, the commit plan and the batch-undo rule (06 §5 steps 5–7, 11 §7).
 *
 * These are the tests that stand between "the wizard said 142 contacts" and
 * "the wizard wrote 142 contacts": the summary and the plan are computed by
 * the same function, so a screen that lies about what it will do would have to
 * lie here first.
 */

import { describe, expect, it } from 'vitest'
import {
  buildCommitPlan,
  describeUndo,
  fillBlanksPatch,
  matchFund,
  planBatchUndo,
  summarySentence,
  undoAvailable,
  UNTOUCHED_MS,
} from '../src/features/import/plan'
import { normalisePreview } from '../src/features/import/normalisePreview'
import type {
  ColumnMapping,
  FundRow,
  ImportBatchRow,
  ResolutionMap,
} from '../src/features/import/types'
import type { UndoCandidate } from '../src/features/import/plan'

const MAPPING: ColumnMapping = ['first_name', 'last_name', 'email', 'gift_amount', 'gift_date', 'gift_fund']

const FUNDS: FundRow[] = [
  { id: 'f-general', name: 'General', code: 'GEN', is_active: true },
  { id: 'f-building', name: 'Building Fund', code: null, is_active: true },
]

const rows = (cells: string[][]) => normalisePreview(cells, MAPPING)

const resolve = (entries: Record<number, ResolutionMap[number]>): ResolutionMap => entries

describe('matchFund', () => {
  it('matches by name, case-insensitively', () => {
    expect(matchFund(FUNDS, 'general')?.id).toBe('f-general')
    expect(matchFund(FUNDS, '  Building Fund ')?.id).toBe('f-building')
  })

  it('falls back to the code', () => {
    expect(matchFund(FUNDS, 'GEN')?.id).toBe('f-general')
  })

  it('returns null for an unknown or absent name', () => {
    expect(matchFund(FUNDS, 'Kollel')).toBeNull()
    expect(matchFund(FUNDS, null)).toBeNull()
  })
})

describe('buildCommitPlan', () => {
  it('creates everything a clean file asks for', () => {
    const plan = buildCommitPlan({
      rows: rows([
        ['Dovid', 'Cohen', 'dovid@example.com', '500', '15/03/2024', 'General'],
        ['Rivky', 'Cohen', 'rivky@example.com', '', '', ''],
      ]),
      resolutions: {},
      funds: FUNDS,
    })

    expect(plan.summary).toMatchObject({ contacts: 2, merged: 0, held: 0, skipped: 0, gifts: 1, blocked: 0 })
    expect(plan.creates).toHaveLength(2)
    // The gift belongs to a contact that does not exist yet, so it carries the
    // position in `creates` whose returned id it will be given.
    expect(plan.gifts[0]).toMatchObject({ targetId: null, createIndex: 0 })
  })

  it('honours each resolution', () => {
    const plan = buildCommitPlan({
      rows: rows([
        ['A', 'One', '', '', '', ''],
        ['B', 'Two', '', '', '', ''],
        ['C', 'Three', '', '', '', ''],
        ['D', 'Four', '', '', '', ''],
      ]),
      resolutions: resolve({
        0: { action: 'merge', targetId: 'existing-1', isDefault: false },
        1: { action: 'skip', targetId: null, isDefault: false },
        2: { action: 'review', targetId: null, isDefault: true },
      }),
      funds: FUNDS,
    })

    expect(plan.summary).toMatchObject({ contacts: 1, merged: 1, held: 1, skipped: 1 })
    expect(plan.merges[0].targetId).toBe('existing-1')
    expect(plan.creates.map((r) => r.displayName)).toEqual(['D Four'])
  })

  it('hangs a merged row\'s gift off the existing contact', () => {
    const plan = buildCommitPlan({
      rows: rows([['Dovid', 'Cohen', '', '500', '15/03/2024', 'General']]),
      resolutions: resolve({ 0: { action: 'merge', targetId: 'existing-1', isDefault: false } }),
      funds: FUNDS,
    })
    expect(plan.gifts[0]).toMatchObject({ targetId: 'existing-1', createIndex: null })
  })

  it('writes nothing for a held row, gift included', () => {
    const plan = buildCommitPlan({
      rows: rows([['Dovid', 'Cohen', '', '500', '15/03/2024', 'General']]),
      resolutions: resolve({ 0: { action: 'review', targetId: null, isDefault: true } }),
      funds: FUNDS,
    })
    expect(plan.creates).toEqual([])
    expect(plan.gifts).toEqual([])
    expect(plan.summary.held).toBe(1)
  })

  it('counts unusable rows separately and never writes them', () => {
    const plan = buildCommitPlan({
      rows: rows([
        ['', '', 'nobody@example.com', '', '', ''],
        ['Dovid', 'Cohen', '', '', '', ''],
      ]),
      resolutions: {},
      funds: FUNDS,
    })
    expect(plan.summary).toMatchObject({ blocked: 1, contacts: 1 })
  })

  it('collects fund names it does not recognise, de-duplicated and sorted', () => {
    const plan = buildCommitPlan({
      rows: rows([
        ['A', 'One', '', '100', '01/01/2024', 'Kollel'],
        ['B', 'Two', '', '100', '01/01/2024', 'Simcha Hall'],
        ['C', 'Three', '', '100', '01/01/2024', 'Kollel'],
        ['D', 'Four', '', '100', '01/01/2024', 'General'],
      ]),
      resolutions: {},
      funds: FUNDS,
    })
    expect(plan.summary.unknownFunds).toEqual(['Kollel', 'Simcha Hall'])
  })

  it('does not promise a gift it has nowhere to file', () => {
    const plan = buildCommitPlan({
      rows: rows([
        ['A', 'One', '', '100', '01/01/2024', 'Kollel'],
        ['B', 'Two', '', '100', '01/01/2024', 'General'],
      ]),
      resolutions: {},
      funds: FUNDS,
    })
    // Two contacts, but only the General gift is going to be written.
    expect(plan.summary).toMatchObject({ contacts: 2, gifts: 1, giftsWithoutFund: 1 })
    expect(plan.gifts).toHaveLength(1)
  })

  it('counts the gift once its fund is agreed to be created', () => {
    const plan = buildCommitPlan({
      rows: rows([['A', 'One', '', '100', '01/01/2024', 'Kollel']]),
      resolutions: {},
      funds: FUNDS,
      createFunds: ['Kollel'],
    })
    expect(plan.summary).toMatchObject({ gifts: 1, giftsWithoutFund: 0 })
  })

  it('files no gift at all when the sheet never named a fund', () => {
    const plan = buildCommitPlan({
      rows: rows([['A', 'One', '', '100', '01/01/2024', '']]),
      resolutions: {},
      funds: FUNDS,
    })
    expect(plan.summary).toMatchObject({ gifts: 0, giftsWithoutFund: 1, unknownFunds: [] })
  })
})

describe('summarySentence', () => {
  it('reads like the spec\'s own example', () => {
    expect(
      summarySentence({
        contacts: 142,
        merged: 0,
        held: 3,
        skipped: 0,
        gifts: 890,
        giftsWithoutFund: 0,
        blocked: 0,
        unknownFunds: [],
      }),
    ).toBe('142 contacts, 3 held for review, 890 gifts')
  })

  it('says only what happened', () => {
    expect(
      summarySentence({
        contacts: 1, merged: 0, held: 0, skipped: 0, gifts: 0, giftsWithoutFund: 0, blocked: 0, unknownFunds: [],
      }),
    ).toBe('1 contact')
  })
})

describe('fillBlanksPatch', () => {
  const row = rows([['Dovid', 'Cohen', 'dovid@example.com', '', '', '']])[0]

  it('fills only the fields the existing record has left empty', () => {
    expect(fillBlanksPatch(row, { first_name: 'Dovid', last_name: 'Cohen', email: null })).toEqual({
      email: 'dovid@example.com',
    })
  })

  it('never overwrites a value somebody has already typed', () => {
    expect(
      fillBlanksPatch(row, { first_name: 'Dovid', last_name: 'Cohen', email: 'corrected@example.com' }),
    ).toEqual({})
  })

  it('treats a whitespace-only value as empty', () => {
    expect(
      fillBlanksPatch(row, { first_name: 'Dovid', last_name: 'Cohen', email: '   ' }),
    ).toEqual({ email: 'dovid@example.com' })
  })
})

/* ------------------------------------------------------------------- undo */

const candidate = (over: Partial<UndoCandidate> & { id: string }): UndoCandidate => ({
  import_batch: 'batch-1',
  created_at: '2026-08-01T10:00:00Z',
  updated_at: '2026-08-01T10:00:00Z',
  merged_into_id: null,
  foreignChildren: 0,
  ...over,
})

describe('planBatchUndo', () => {
  it('removes what the import made and nobody has touched', () => {
    const plan = planBatchUndo('batch-1', [candidate({ id: 'a' }), candidate({ id: 'b' })], ['g1', 'g2'])
    expect(plan.deleteContactIds).toEqual(['a', 'b'])
    expect(plan.deleteDonationIds).toEqual(['g1', 'g2'])
    expect(plan.kept).toEqual([])
  })

  it('keeps a contact edited since the import', () => {
    const plan = planBatchUndo(
      'batch-1',
      [candidate({ id: 'a', updated_at: '2026-08-05T09:00:00Z' })],
      [],
    )
    expect(plan.deleteContactIds).toEqual([])
    expect(plan.kept).toEqual([{ id: 'a', reason: 'edited since the import' }])
  })

  it('tolerates the trigger stamping updated_at a moment after created_at', () => {
    const created = '2026-08-01T10:00:00.000Z'
    const updated = new Date(Date.parse(created) + UNTOUCHED_MS - 1).toISOString()
    const plan = planBatchUndo('batch-1', [candidate({ id: 'a', created_at: created, updated_at: updated })], [])
    expect(plan.deleteContactIds).toEqual(['a'])
  })

  it('keeps a contact that has gained activity of its own', () => {
    const plan = planBatchUndo('batch-1', [candidate({ id: 'a', foreignChildren: 1 })], [])
    expect(plan.kept).toEqual([{ id: 'a', reason: 'has activity logged since the import' }])
  })

  it('keeps a contact that has since been merged away', () => {
    const plan = planBatchUndo('batch-1', [candidate({ id: 'a', merged_into_id: 'other' })], [])
    expect(plan.kept).toEqual([{ id: 'a', reason: 'merged into another record since' }])
  })

  it('never touches a row belonging to a different batch', () => {
    const plan = planBatchUndo('batch-1', [candidate({ id: 'a', import_batch: 'batch-2' })], [])
    expect(plan.deleteContactIds).toEqual([])
    expect(plan.kept[0].reason).toBe('not created by this import')
  })

  it('describes itself honestly for the confirm dialog', () => {
    const plan = planBatchUndo(
      'batch-1',
      [candidate({ id: 'a' }), candidate({ id: 'b', foreignChildren: 2 })],
      ['g1'],
    )
    expect(describeUndo(plan)).toBe('Removes 1 contact and 1 gift; 1 kept because they have been used since.')
  })
})

describe('undoAvailable', () => {
  const batch = (over: Partial<ImportBatchRow>): ImportBatchRow => ({
    id: 'b',
    filename: 'book.csv',
    started_by: null,
    created_at: '2026-08-27T10:00:00Z',
    contact_count: 5,
    donation_count: 0,
    status: 'committed',
    undone_at: null,
    ...over,
  })

  it('offers undo for a fresh committed batch', () => {
    expect(undoAvailable(batch({}), new Date('2026-08-28T10:00:00Z'))).toBe(true)
  })

  it('never offers it twice', () => {
    expect(undoAvailable(batch({ status: 'undone' }), new Date('2026-08-28T10:00:00Z'))).toBe(false)
  })

  it('stops offering it after the window', () => {
    expect(undoAvailable(batch({}), new Date('2026-10-28T10:00:00Z'))).toBe(false)
  })
})
