/**
 * The merge tool's arithmetic (06 §5, "merge & import").
 *
 * A merge is three decisions and one long list of updates:
 *
 *   1. **which record survives** — defaulted to the more complete one, because
 *      the winner keeps its id and every external link that points at it;
 *   2. **which value wins per field** — a side-by-side picker, defaulted to the
 *      winner's own value except where it is empty and the loser has one
 *      (nobody merges in order to lose a phone number);
 *   3. **what happens to the loser** — never deleted. It becomes a tombstone
 *      carrying `merged_into_id`, so an old link, a bookmark or a printed
 *      report still resolves to the surviving record.
 *
 * The child re-parenting list is the part that must not be forgotten, so it
 * lives here as data rather than as a sequence of calls: every table with a
 * `contact_id` is named once, and the executor walks the list.
 */

import { displayName, fullName } from '../contacts/normalise'
import type { ContactRow } from '../contacts/types'

/* ----------------------------------------------------------- child tables */

export interface ChildTable {
  table: string
  column: string
  label: string
  /**
   * A unique constraint that a naive re-parent would violate: `taggings` is
   * unique on (tag_id, contact_id), so a tag both records carry must be
   * de-duplicated rather than moved.
   */
  uniqueWith?: string
}

/**
 * Every table hanging off a contact (schema 02 §3). Order matters only for
 * legibility — the executor runs them sequentially so a failure stops at a
 * known point rather than half-moving a donor's history.
 */
export const CHILD_TABLES: ChildTable[] = [
  { table: 'interactions', column: 'contact_id', label: 'conversations' },
  { table: 'donations', column: 'contact_id', label: 'gifts' },
  { table: 'pledges', column: 'contact_id', label: 'pledges' },
  { table: 'recurring_agreements', column: 'contact_id', label: 'recurring gifts' },
  { table: 'soft_credits', column: 'contact_id', label: 'soft credits' },
  { table: 'gift_aid_declarations', column: 'contact_id', label: 'Gift Aid declarations' },
  { table: 'opportunities', column: 'contact_id', label: 'opportunities' },
  { table: 'tasks', column: 'contact_id', label: 'tasks' },
  { table: 'notes', column: 'contact_id', label: 'notes' },
  { table: 'documents', column: 'contact_id', label: 'documents' },
  { table: 'taggings', column: 'contact_id', label: 'tags', uniqueWith: 'tag_id' },
]

/** Contacts pointing *at* the loser, which would otherwise dangle. */
export const REFERRING_COLUMNS: ChildTable[] = [
  { table: 'contacts', column: 'introduced_by_id', label: 'introductions' },
  { table: 'households', column: 'primary_contact_id', label: 'household head' },
]

/* ------------------------------------------------------------ completeness */

/** Fields that make a record "more complete" — identity and reachability. */
export const COMPLETENESS_FIELDS: Array<keyof ContactRow> = [
  'title', 'first_name', 'last_name', 'hebrew_name', 'organization', 'position',
  'email', 'phone', 'whatsapp', 'address_line1', 'address_line2', 'city',
  'postcode', 'country', 'birthday', 'spouse_name', 'things_to_remember',
  'source', 'relationship_owner_id', 'tier', 'household_id', 'photo_url',
]

export function completeness(contact: ContactRow): number {
  let score = 0
  for (const field of COMPLETENESS_FIELDS) {
    const value = contact[field]
    if (value !== null && value !== undefined && String(value).trim() !== '') score += 1
  }
  return score
}

/* ------------------------------------------------------------------ guard */

export type MergeRefusal = 'organisation-self' | 'same-contact' | 'already-merged' | 'archived-winner'

export const REFUSAL_MESSAGE: Record<MergeRefusal, string> = {
  'organisation-self':
    'The organisation record anchors admin tasks and cannot be merged (I-2). Archive the duplicate instead.',
  'same-contact': 'A record cannot be merged into itself.',
  'already-merged': 'One of these records is already a tombstone pointing somewhere else.',
  'archived-winner': 'The surviving record must not be an archived one — swap the sides first.',
}

/**
 * Refuse before anything is written. The organisation-self contact is the one
 * record the whole app assumes exists (I-2: every task needs a contact, and
 * admin work hangs off this one), so it is never a merge participant on either
 * side — not as loser (it would be archived away) and not as winner (a merge
 * would pour a donor's history into the house record).
 */
export function mergeRefusal(a: ContactRow, b: ContactRow): MergeRefusal | null {
  if (a.id === b.id) return 'same-contact'
  if (a.is_organisation_self || b.is_organisation_self) return 'organisation-self'
  if (a.merged_into_id || b.merged_into_id) return 'already-merged'
  return null
}

/* ------------------------------------------------------------- field plan */

export interface MergeFieldRow {
  field: keyof ContactRow
  label: string
  winnerValue: string
  loserValue: string
  /** True when the two records disagree and a human must choose. */
  conflict: boolean
  /** Which side the picker starts on. */
  choice: 'winner' | 'loser'
}

/** The fields the picker shows, in the order the profile shows them (04 §5). */
export const MERGE_FIELDS: Array<{ field: keyof ContactRow; label: string }> = [
  { field: 'title', label: 'Title' },
  { field: 'first_name', label: 'First name' },
  { field: 'last_name', label: 'Last name' },
  { field: 'hebrew_name', label: 'Hebrew name' },
  { field: 'organization', label: 'Organisation' },
  { field: 'position', label: 'Position' },
  { field: 'email', label: 'Email' },
  { field: 'phone', label: 'Phone' },
  { field: 'whatsapp', label: 'WhatsApp' },
  { field: 'address_line1', label: 'Address line 1' },
  { field: 'address_line2', label: 'Address line 2' },
  { field: 'city', label: 'City' },
  { field: 'postcode', label: 'Postcode' },
  { field: 'country', label: 'Country' },
  { field: 'birthday', label: 'Birthday' },
  { field: 'spouse_name', label: 'Spouse' },
  { field: 'things_to_remember', label: 'Things to remember' },
  { field: 'stage', label: 'Stage' },
  { field: 'priority', label: 'Priority' },
  { field: 'tier', label: 'Tier' },
  { field: 'source', label: 'Source' },
  { field: 'relationship_owner_id', label: 'Owner' },
  { field: 'household_id', label: 'Household' },
]

const text = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).trim()

/**
 * Default winner: the more complete record; ties broken by the older one,
 * because it is the id more links already point at.
 */
export function defaultWinner(a: ContactRow, b: ContactRow): ContactRow {
  const byCompleteness = completeness(b) - completeness(a)
  if (byCompleteness !== 0) return byCompleteness > 0 ? b : a
  return a
}

export function buildFieldRows(winner: ContactRow, loser: ContactRow): MergeFieldRow[] {
  return MERGE_FIELDS.map(({ field, label }) => {
    const winnerValue = text(winner[field])
    const loserValue = text(loser[field])
    // Empty winner + populated loser is not a conflict, it is a gap the merge
    // fills; the picker still shows it, pre-set to the loser's value.
    const choice: 'winner' | 'loser' = winnerValue === '' && loserValue !== '' ? 'loser' : 'winner'
    return {
      field,
      label,
      winnerValue,
      loserValue,
      conflict: winnerValue !== '' && loserValue !== '' && winnerValue !== loserValue,
      choice,
    }
  })
}

/** The winner's patch, from the picker's current choices. */
export function patchFromChoices(rows: MergeFieldRow[], winner: ContactRow): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const row of rows) {
    const value = row.choice === 'loser' ? row.loserValue : row.winnerValue
    const current = text(winner[row.field])
    if (value === current) continue
    patch[row.field as string] = value === '' ? null : value
  }
  return patch
}

/* -------------------------------------------------------------- full plan */

export interface MergePlan {
  winnerId: string
  loserId: string
  /** Field values to write onto the winner. */
  patch: Record<string, unknown>
  /** Sequential child re-parents: `update <table> set <column> = winner`. */
  reparent: ChildTable[]
  /** The tombstone write. */
  tombstone: { merged_into_id: string; is_archived: true }
  /** The human-readable audit note left on the winner (11 §4). */
  note: string
}

export function buildMergePlan(
  winner: ContactRow,
  loser: ContactRow,
  fieldRows: MergeFieldRow[],
): MergePlan {
  const taken = fieldRows.filter((row) => row.choice === 'loser' && row.loserValue !== '')
  const detail =
    taken.length === 0
      ? 'No fields were taken from the duplicate.'
      : `Kept from the duplicate: ${taken.map((r) => r.label.toLowerCase()).join(', ')}.`

  return {
    winnerId: winner.id,
    loserId: loser.id,
    patch: patchFromChoices(fieldRows, winner),
    reparent: [...CHILD_TABLES, ...REFERRING_COLUMNS],
    tombstone: { merged_into_id: winner.id, is_archived: true },
    note:
      `Merged duplicate record "${displayName(loser) || fullName(loser) || loser.id}" into this one. ` +
      `${detail} All conversations, gifts, pledges, tasks, notes, documents, tags and declarations were moved across; ` +
      'the duplicate is kept as a tombstone so old links still resolve here.',
  }
}

/** One-line preview for the confirm dialog (I-12: merges always confirm). */
export function describePlan(plan: MergePlan, winner: ContactRow, loser: ContactRow): string {
  const changed = Object.keys(plan.patch).length
  const fields = changed === 0 ? 'no field changes' : `${changed} field ${changed === 1 ? 'change' : 'changes'}`
  return (
    `"${displayName(loser) || loser.id}" will become a tombstone pointing at ` +
    `"${displayName(winner) || winner.id}", with ${fields}. This cannot be undone in one click.`
  )
}
