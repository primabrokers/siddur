/**
 * Dedupe pass (06 §5, step 4) — against existing records *and* within the file.
 *
 * The signals are exactly the ones the create-time interstitial uses (02 §6,
 * `features/contacts/normalise.ts`): normalised email or phone is a match on
 * its own; otherwise the names must clear the trigram threshold. Using one
 * definition of "same person" everywhere is the point — an import must not be
 * a second, laxer door into the same book.
 *
 * The wizard proposes; the human disposes. Defaults are deliberately timid:
 *
 *   - a **contact-detail** match (email/phone) against an existing record
 *     defaults to `merge` — the same phone number is about as certain as this
 *     gets;
 *   - a **within-file repeat on a contact detail** defaults to `skip`, because
 *     the earlier row is already creating that person;
 *   - **anything matched on the name alone** defaults to `review`, which
 *     imports nothing this run. Two Cohens in Golders Green are usually two
 *     Cohens, and Shloimy and Rivky Fischer are certainly two Fischers — a
 *     surname is the single most common false positive in this whole file, so
 *     it never silently loses a row. That is the spec's "3 duplicates held for
 *     review".
 */

import { rankDuplicates, scoreDuplicate, type DuplicateReason } from '../contacts/normalise'
import type { ContactRow } from '../contacts/types'
import { isBlocked } from './normalisePreview'
import type {
  DedupeAction,
  ExistingMatch,
  NormalisedRow,
  Resolution,
  ResolutionMap,
  RowDuplicate,
} from './types'

/** The signal bundle a normalised row offers the matcher. */
export function rowSignals(row: NormalisedRow) {
  return {
    first_name: row.contact.first_name ?? '',
    last_name: row.contact.last_name ?? null,
    organization: row.contact.organization ?? null,
    email: row.contact.email ?? null,
    phone: row.contact.phone ?? null,
    whatsapp: row.contact.whatsapp ?? null,
  }
}

function bestExisting(row: NormalisedRow, existing: ContactRow[]): ExistingMatch | null {
  const signals = rowSignals(row)
  const matches = existing
    .filter((candidate) => !candidate.is_archived && !candidate.merged_into_id)
    .map((candidate) => scoreDuplicate(signals, candidate))
    .filter((m): m is NonNullable<typeof m> => m !== null)
  if (matches.length === 0) return null
  const [best] = rankDuplicates(matches)
  return { contact: best.contact, reasons: best.reasons, score: best.score }
}

/**
 * Find the earlier row in the same file this one duplicates, if any. Scored
 * with the same function by dressing the earlier row as a contact record —
 * one definition of sameness, two sources of candidates.
 */
function bestWithinFile(row: NormalisedRow, earlier: NormalisedRow[]): { index: number; reasons: DuplicateReason[] } | null {
  const signals = rowSignals(row)
  for (let i = earlier.length - 1; i >= 0; i -= 1) {
    const other = earlier[i]
    const asContact = {
      id: `row-${other.line}`,
      first_name: other.contact.first_name ?? '',
      last_name: other.contact.last_name ?? '',
      organization: other.contact.organization ?? null,
      email: other.contact.email ?? null,
      phone: other.contact.phone ?? null,
      whatsapp: other.contact.whatsapp ?? null,
      is_archived: false,
      merged_into_id: null,
    } as unknown as ContactRow
    const match = scoreDuplicate(signals, asContact)
    if (match) return { index: i, reasons: match.reasons }
  }
  return null
}

/** True when the reasons include a contact detail, not just a similar name. */
export const isStrongMatch = (reasons: DuplicateReason[]): boolean =>
  reasons.includes('email') || reasons.includes('phone')

/**
 * Scan every row against the existing book and against the rows before it.
 * `existing` is the candidate pool the query layer fetched — narrowing it is
 * the caller's job, scoring it is this module's.
 */
export function findDuplicates(rows: NormalisedRow[], existing: ContactRow[]): RowDuplicate[] {
  const out: RowDuplicate[] = []
  rows.forEach((row, index) => {
    if (isBlocked(row)) return
    const match = bestExisting(row, existing)
    const within = bestWithinFile(row, rows.slice(0, index))
    if (!match && !within) return
    out.push({
      index,
      existing: match,
      withinFile: within ? within.index : null,
      reasons: match ? match.reasons : (within?.reasons ?? []),
    })
  })
  return out
}

/** The wizard's opening proposal for one flagged row. */
export function defaultResolution(duplicate: RowDuplicate): Resolution {
  if (duplicate.existing && isStrongMatch(duplicate.existing.reasons)) {
    return { action: 'merge', targetId: duplicate.existing.contact.id, isDefault: true }
  }
  // A repeat inside the file is only skipped on the strength of a shared
  // contact detail. On a shared surname alone it is held, not discarded: two
  // siblings in one sheet must not become one person without a human saying so.
  if (duplicate.withinFile !== null && isStrongMatch(duplicate.reasons)) {
    return { action: 'skip', targetId: null, isDefault: true }
  }
  return { action: 'review', targetId: null, isDefault: true }
}

export function initialResolutions(duplicates: RowDuplicate[]): ResolutionMap {
  const map: ResolutionMap = {}
  for (const duplicate of duplicates) map[duplicate.index] = defaultResolution(duplicate)
  return map
}

/* ----------------------------------------------------------------- reducer */

export type ResolutionEvent =
  | { type: 'reset'; duplicates: RowDuplicate[] }
  | { type: 'set'; index: number; action: DedupeAction; targetId?: string | null }
  /** "Create all of them" / "hold all of them" from the step's header. */
  | { type: 'setAll'; action: DedupeAction; duplicates: RowDuplicate[] }

/**
 * The one place a resolution changes.
 *
 * Two rules it enforces so the commit plan can trust its input:
 *   1. `merge` without a target is meaningless — it degrades to `review`.
 *   2. a bulk `merge` only touches rows that actually have an existing match;
 *      the rest keep their own default rather than silently becoming creates.
 */
export function resolutionReducer(state: ResolutionMap, event: ResolutionEvent): ResolutionMap {
  switch (event.type) {
    case 'reset':
      return initialResolutions(event.duplicates)

    case 'set': {
      const targetId = event.targetId ?? state[event.index]?.targetId ?? null
      if (event.action === 'merge' && !targetId) {
        return { ...state, [event.index]: { action: 'review', targetId: null, isDefault: false } }
      }
      return {
        ...state,
        [event.index]: {
          action: event.action,
          targetId: event.action === 'merge' ? targetId : null,
          isDefault: false,
        },
      }
    }

    case 'setAll': {
      const next: ResolutionMap = { ...state }
      for (const duplicate of event.duplicates) {
        if (event.action === 'merge') {
          if (!duplicate.existing) continue
          next[duplicate.index] = { action: 'merge', targetId: duplicate.existing.contact.id, isDefault: false }
        } else {
          next[duplicate.index] = { action: event.action, targetId: null, isDefault: false }
        }
      }
      return next
    }

    default:
      return state
  }
}

/** Rows still parked for a human — the dry-run's "held for review" count. */
export const heldCount = (resolutions: ResolutionMap): number =>
  Object.values(resolutions).filter((r) => r.action === 'review').length

export const REASON_SENTENCE: Record<DuplicateReason, string> = {
  email: 'the same email address',
  phone: 'the same phone number',
  name: 'a very similar name',
}

export function describeReasons(reasons: DuplicateReason[]): string {
  const parts = reasons.map((r) => REASON_SENTENCE[r])
  if (parts.length === 0) return 'a possible match'
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
