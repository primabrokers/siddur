/**
 * The merge tool's arithmetic (06 §5) — winner, field picker, re-parent plan
 * and the guard that refuses to merge the organisation record (I-2).
 *
 * The re-parent list is asserted as *data* on purpose: the failure this test
 * is really guarding against is a table quietly gaining a `contact_id` and
 * nobody remembering to move its rows, which would leave a donor's history
 * stranded on a tombstone.
 */

import { describe, expect, it } from 'vitest'
import {
  buildFieldRows,
  buildMergePlan,
  CHILD_TABLES,
  completeness,
  defaultWinner,
  describePlan,
  mergeRefusal,
  patchFromChoices,
  REFERRING_COLUMNS,
} from '../src/features/dataquality/mergePlan'
import type { ContactRow } from '../src/features/contacts/types'

const contact = (over: Partial<ContactRow> & { id: string }): ContactRow =>
  ({
    title: null,
    first_name: 'Dovid',
    last_name: 'Cohen',
    hebrew_name: null,
    organization: null,
    position: null,
    email: null,
    phone: null,
    whatsapp: null,
    address_line1: null,
    address_line2: null,
    city: null,
    postcode: null,
    country: null,
    birthday: null,
    spouse_name: null,
    things_to_remember: null,
    source: null,
    relationship_owner_id: null,
    tier: null,
    household_id: null,
    photo_url: null,
    stage: 'prospect',
    priority: 'medium',
    is_archived: false,
    merged_into_id: null,
    is_organisation_self: false,
    ...over,
  }) as ContactRow

describe('completeness and the default winner', () => {
  it('counts the fields that are actually filled', () => {
    expect(completeness(contact({ id: 'a' }))).toBe(2) // first + last name
    expect(completeness(contact({ id: 'a', email: 'x@y.com', city: 'Hendon' }))).toBe(4)
  })

  it('ignores whitespace-only values', () => {
    expect(completeness(contact({ id: 'a', city: '   ' }))).toBe(2)
  })

  it('defaults the survivor to the more complete record', () => {
    const thin = contact({ id: 'thin' })
    const full = contact({ id: 'full', email: 'x@y.com', phone: '+447700900123', city: 'Hendon' })
    expect(defaultWinner(thin, full).id).toBe('full')
    expect(defaultWinner(full, thin).id).toBe('full')
  })

  it('breaks a tie in favour of the first record, which is the older id', () => {
    expect(defaultWinner(contact({ id: 'a' }), contact({ id: 'b' })).id).toBe('a')
  })
})

describe('mergeRefusal', () => {
  it('refuses the organisation-self record on either side (I-2)', () => {
    const org = contact({ id: 'org', is_organisation_self: true })
    expect(mergeRefusal(org, contact({ id: 'a' }))).toBe('organisation-self')
    expect(mergeRefusal(contact({ id: 'a' }), org)).toBe('organisation-self')
  })

  it('refuses a record merged into itself', () => {
    expect(mergeRefusal(contact({ id: 'a' }), contact({ id: 'a' }))).toBe('same-contact')
  })

  it('refuses a record that is already a tombstone', () => {
    expect(mergeRefusal(contact({ id: 'a', merged_into_id: 'z' }), contact({ id: 'b' }))).toBe(
      'already-merged',
    )
  })

  it('allows an ordinary pair', () => {
    expect(mergeRefusal(contact({ id: 'a' }), contact({ id: 'b' }))).toBeNull()
  })
})

describe('the field picker', () => {
  const winner = contact({ id: 'w', email: 'dovid@example.com', city: 'Hendon' })
  const loser = contact({ id: 'l', email: 'd.cohen@example.com', phone: '+447700900123' })
  const fields = buildFieldRows(winner, loser)
  const field = (name: string) => fields.find((row) => row.field === name)!

  it('marks a genuine disagreement as a conflict', () => {
    expect(field('email')).toMatchObject({ conflict: true, choice: 'winner' })
  })

  it('pre-fills a gap from the other record without calling it a conflict', () => {
    expect(field('phone')).toMatchObject({ conflict: false, choice: 'loser', loserValue: '+447700900123' })
  })

  it('leaves a field only the survivor has alone', () => {
    expect(field('city')).toMatchObject({ conflict: false, choice: 'winner', winnerValue: 'Hendon' })
  })

  it('patches only what the choices actually change', () => {
    expect(patchFromChoices(fields, winner)).toEqual({ phone: '+447700900123' })
  })

  it('takes the duplicate\'s value when the picker is flipped', () => {
    const flipped = fields.map((row) => (row.field === 'email' ? { ...row, choice: 'loser' as const } : row))
    expect(patchFromChoices(flipped, winner)).toMatchObject({ email: 'd.cohen@example.com' })
  })

  it('writes null rather than an empty string when a value is cleared', () => {
    const cleared = buildFieldRows(winner, contact({ id: 'l' })).map((row) =>
      row.field === 'city' ? { ...row, choice: 'loser' as const } : row,
    )
    expect(patchFromChoices(cleared, winner).city).toBeNull()
  })
})

describe('the re-parent plan', () => {
  const winner = contact({ id: 'w', first_name: 'Dovid', last_name: 'Cohen' })
  const loser = contact({ id: 'l', first_name: 'David', last_name: 'Cohen', phone: '+447700900123' })
  const plan = buildMergePlan(winner, loser, buildFieldRows(winner, loser))

  it('names every table that hangs off a contact', () => {
    const tables = CHILD_TABLES.map((child) => child.table)
    // Every table in the live schema carrying a `contact_id`. A table missing
    // from this list is one whose rows keep pointing at the tombstone.
    for (const table of [
      'interactions', 'donations', 'pledges', 'recurring_agreements', 'soft_credits',
      'gift_aid_declarations', 'opportunities', 'tasks', 'notes', 'documents', 'taggings',
      'signals', 'journey_enrollments',
    ]) {
      expect(tables).toContain(table)
    }
  })

  it('flags taggings as needing conflict handling, since (tag, contact) is unique', () => {
    expect(CHILD_TABLES.find((child) => child.table === 'taggings')?.uniqueWith).toEqual(['tag_id'])
  })

  it('flags soft credits too — (donation, contact, role) is unique, and households collide', () => {
    expect(CHILD_TABLES.find((child) => child.table === 'soft_credits')?.uniqueWith).toEqual([
      'donation_id',
      'role',
    ])
  })

  it('repoints the links that point back at a contact', () => {
    expect(REFERRING_COLUMNS.map((ref) => `${ref.table}.${ref.column}`)).toEqual([
      'contacts.introduced_by_id',
      'households.primary_contact_id',
      'tributes.honoree_contact_id',
      'tributes.acknowledgee_contact_id',
    ])
  })

  it('walks the children and the back-references in one sequence', () => {
    expect(plan.reparent).toHaveLength(CHILD_TABLES.length + REFERRING_COLUMNS.length)
  })

  it('tombstones the loser rather than deleting it', () => {
    expect(plan.tombstone).toEqual({ merged_into_id: 'w', is_archived: true })
    expect(plan.loserId).toBe('l')
  })

  it('leaves a note naming what was kept from the duplicate (11 §4)', () => {
    expect(plan.note).toContain('David Cohen')
    expect(plan.note).toContain('Kept from the duplicate: phone.')
    expect(plan.note).toContain('tombstone')
  })

  it('says so when nothing was taken from the duplicate', () => {
    const bare = buildMergePlan(winner, contact({ id: 'l2' }), buildFieldRows(winner, contact({ id: 'l2' })))
    expect(bare.note).toContain('No fields were taken from the duplicate.')
  })

  it('describes itself for the confirm dialog', () => {
    expect(describePlan(plan, winner, loser)).toContain('will become a tombstone pointing at')
    expect(describePlan(plan, winner, loser)).toContain('1 field change')
  })
})
