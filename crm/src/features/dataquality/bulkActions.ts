/**
 * Bulk actions on a contacts selection (03 §4, 06 §1).
 *
 * Bulk is the exception to "undo, not confirm" (I-12 / 03 §5.2): forty records
 * changing at once is not something a 6-second toast can honestly reverse, so
 * every verb here states its effect and confirms first. The toast still
 * appears afterwards — as a *report*, not an offer.
 *
 * Each verb is a sequence of small writes rather than one statement, which is
 * how the rest of this codebase talks to PostgREST, and means a partial
 * failure is reported honestly ("34 of 40") instead of silently rolled back.
 */

import { supabase } from '../../lib/supabase'
import type { ContactListRow } from '../contacts/types'
import { displayName } from '../contacts/normalise'

export type BulkVerb = 'tag' | 'owner' | 'priority' | 'task' | 'export'

export interface BulkOutcome {
  changed: number
  failed: number
  message: string
}

const CHUNK = 100

function chunk<T>(values: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

/** "40 contacts" / "1 contact" — used in every confirm sentence. */
export const countPhrase = (n: number): string => `${n} ${n === 1 ? 'contact' : 'contacts'}`

/* -------------------------------------------------------------- set fields */

async function updateContacts(ids: string[], patch: Record<string, unknown>): Promise<BulkOutcome> {
  let changed = 0
  let failed = 0
  for (const part of chunk(ids)) {
    const { error } = await supabase.from('contacts').update(patch).in('id', part)
    if (error) failed += part.length
    else changed += part.length
  }
  return {
    changed,
    failed,
    message: failed === 0 ? `${countPhrase(changed)} updated` : `${changed} updated, ${failed} could not be`,
  }
}

export const setOwner = (ids: string[], ownerId: string | null): Promise<BulkOutcome> =>
  updateContacts(ids, { relationship_owner_id: ownerId })

export const setPriority = (ids: string[], priority: string): Promise<BulkOutcome> =>
  updateContacts(ids, { priority })

/* -------------------------------------------------------------------- tags */

/**
 * Add one tag to every selected contact.
 *
 * `taggings` is unique on (tag_id, contact_id), so contacts that already carry
 * the tag are filtered out first rather than relying on a conflict clause the
 * PostgREST client does not expose cleanly.
 */
export async function addTag(ids: string[], tagId: string): Promise<BulkOutcome> {
  const { data: existing, error: readError } = await supabase
    .from('taggings')
    .select('contact_id')
    .eq('tag_id', tagId)
    .in('contact_id', ids.slice(0, 1000))
  if (readError) return { changed: 0, failed: ids.length, message: readError.message }

  const already = new Set(((existing ?? []) as Array<{ contact_id: string }>).map((r) => r.contact_id))
  const todo = ids.filter((id) => !already.has(id))
  if (todo.length === 0) {
    return { changed: 0, failed: 0, message: 'They all had that tag already' }
  }

  let changed = 0
  let failed = 0
  for (const part of chunk(todo)) {
    const { error } = await supabase
      .from('taggings')
      .insert(part.map((contact_id) => ({ contact_id, tag_id: tagId })))
    if (error) failed += part.length
    else changed += part.length
  }
  return {
    changed,
    failed,
    message: failed === 0 ? `Tagged ${countPhrase(changed)}` : `Tagged ${changed}, ${failed} failed`,
  }
}

/* ------------------------------------------------------------------- tasks */

export interface BulkTaskInput {
  title: string
  dueOn: string | null
  actionType: string | null
  assignedTo: string | null
}

/**
 * One task per selected contact — I-2's rule holds even in bulk: a task
 * without a `contact_id` cannot exist, so this creates N tasks rather than one
 * task about N people.
 */
export async function createTaskEach(ids: string[], input: BulkTaskInput): Promise<BulkOutcome> {
  let changed = 0
  let failed = 0
  for (const part of chunk(ids)) {
    const { error } = await supabase.from('tasks').insert(
      part.map((contact_id) => ({
        contact_id,
        title: input.title.trim(),
        due_on: input.dueOn,
        action_type: input.actionType,
        assigned_to: input.assignedTo,
        status: 'open',
        priority: 'medium',
        origin: 'bulk',
      })),
    )
    if (error) failed += part.length
    else changed += part.length
  }
  return {
    changed,
    failed,
    message: failed === 0 ? `Task added to ${countPhrase(changed)}` : `${changed} created, ${failed} failed`,
  }
}

/* ------------------------------------------------------------------ export */

const escape = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

/**
 * CSV of the selection. Admin-only (11 §1: export is an admin capability) and
 * deliberately built from the rows already on screen — an export must not be a
 * back door around the redacted views a viewer would otherwise be reading
 * (11 §2, CLAUDE.md rule 7): if the amount is not in the row, it is not in the
 * file.
 */
export function selectionCsv(rows: ContactListRow[]): string {
  const header = [
    'Name', 'Organisation', 'Email', 'Phone', 'City', 'Stage', 'Priority',
    'Days since contact', 'This year', 'Lifetime', 'Donor status',
  ]
  const lines = rows.map((row) =>
    [
      displayName(row.contact),
      row.contact.organization ?? '',
      row.contact.email ?? '',
      row.contact.phone ?? '',
      row.contact.city ?? '',
      row.contact.stage ?? '',
      row.contact.priority ?? '',
      row.stats?.days_since_contact === null || row.stats?.days_since_contact === undefined
        ? ''
        : String(row.stats.days_since_contact),
      row.stats?.this_year_giving === null || row.stats?.this_year_giving === undefined
        ? ''
        : String(row.stats.this_year_giving),
      row.stats?.lifetime_giving === null || row.stats?.lifetime_giving === undefined
        ? ''
        : String(row.stats.lifetime_giving),
      row.stats?.donor_status ?? '',
    ].map((cell) => escape(String(cell))),
  )
  return [header.join(','), ...lines.map((line) => line.join(','))].join('\n')
}

/** The confirm sentence each verb shows before it runs. */
export function describeBulk(verb: BulkVerb, count: number, detail: string): string {
  switch (verb) {
    case 'tag':
      return `Adds the tag "${detail}" to ${countPhrase(count)}.`
    case 'owner':
      return `Makes ${detail} the relationship owner for ${countPhrase(count)}.`
    case 'priority':
      return `Sets priority to ${detail} on ${countPhrase(count)}.`
    case 'task':
      return `Creates one task ("${detail}") for each of ${countPhrase(count)} — ${count} tasks in all.`
    case 'export':
      return `Downloads ${countPhrase(count)} as a CSV, including any amounts visible to you.`
    default:
      return ''
  }
}
