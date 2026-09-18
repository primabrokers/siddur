/**
 * Global search: matching and ranking (03 §3, brief §21).
 *
 * The database does the *narrowing* (ilike over the indexed columns); this
 * module does the *ordering*, because relevance is a product decision and must
 * be testable without a network. The rank ladder is the one the spec asks for:
 *
 *   startsWith  >  word-boundary  >  contains
 *
 * with the field itself as the tie-break (name beats organisation beats city),
 * and an exact digit match on a phone number ranked above everything — typing
 * a number you were just called from should surface that person first.
 *
 * Nothing here recomputes a derived number; the result row's stage/flag/last
 * gift/last contact/next action all come from `contact_stats` (I-8/I-9).
 */

import type { ContactRow, ContactStats } from '../contacts/types'
import { displayName, fullName } from '../contacts/normalise'

export type MatchField = 'name' | 'hebrew_name' | 'organization' | 'phone' | 'email' | 'city'

export type MatchKind = 'exact' | 'starts' | 'word' | 'contains'

export interface SearchResult {
  contact: ContactRow
  stats: ContactStats | null
  /** Best field/kind pair found, for the ranking and the "why" subtitle. */
  field: MatchField
  kind: MatchKind
  score: number
}

/* ------------------------------------------------------------ normalising */

/** Digits only — "+44 7700 900123", "07700900123" and "900123" all compare. */
export const digitsOf = (value: string | null | undefined): string =>
  (value ?? '').replace(/\D+/g, '')

/** Lower-cased, accent-folded, whitespace-collapsed. */
export function fold(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** A term of 4+ digits is treated as a phone-number search. */
export const isPhoneTerm = (term: string): boolean => digitsOf(term).length >= 4

/**
 * Every digit form one number can legitimately take, so a *stored* number and
 * a *typed* one are compared on equal terms: as given, without a UK trunk `0`,
 * without the `44` country code, and as the last nine (the subscriber part).
 *
 * `+44 7700 900123`, `07700 900123` and `900123` all share a key, which is the
 * whole point — nobody types a number the way it was saved.
 */
export function phoneKeys(value: string | null | undefined): string[] {
  const digits = digitsOf(value)
  if (digits.length < 4) return []
  const keys = new Set<string>([digits])
  if (digits.startsWith('0')) keys.add(digits.slice(1))
  if (digits.startsWith('44')) keys.add(digits.slice(2))
  if (digits.length > 9) keys.add(digits.slice(-9))
  return [...keys]
}

/* ---------------------------------------------------------------- ranking */

/**
 * The kind ladder. `starts` and `word` sit close together on purpose: both
 * mean "this term is a whole word of that field", and the gap between them is
 * narrower than the gap between a person's name and an organisation's — so
 * typing "cohen" surfaces Dovid Cohen above Cohen Bakery, while typing the
 * bakery's full name still puts the bakery first.
 */
const KIND_SCORE: Record<MatchKind, number> = {
  exact: 1000,
  starts: 700,
  word: 650,
  contains: 300,
}

/** Field weight — which field matched, once the match kind is settled. */
const FIELD_SCORE: Record<MatchField, number> = {
  name: 120,
  hebrew_name: 100,
  phone: 90,
  organization: 60,
  email: 40,
  city: 20,
}

/** `null` when the haystack does not contain the needle at all. */
export function matchKind(haystack: string, needle: string): MatchKind | null {
  if (needle === '' || haystack === '') return null
  if (haystack === needle) return 'exact'
  if (haystack.startsWith(needle)) return 'starts'
  const index = haystack.indexOf(needle)
  if (index < 0) return null
  // Word boundary: the character before the hit is a separator.
  return /[\s'’\-.,/]/.test(haystack[index - 1] ?? '') ? 'word' : 'contains'
}

interface Candidate {
  field: MatchField
  value: string
}

function candidatesOf(contact: ContactRow): Candidate[] {
  const out: Candidate[] = [{ field: 'name', value: fold(fullName(contact)) }]
  // The display name (with title) is searched too, but scores as the same field.
  const display = fold(displayName(contact))
  if (display && display !== out[0]?.value) out.push({ field: 'name', value: display })
  if (contact.hebrew_name) out.push({ field: 'hebrew_name', value: fold(contact.hebrew_name) })
  if (contact.organization) out.push({ field: 'organization', value: fold(contact.organization) })
  if (contact.email) out.push({ field: 'email', value: fold(contact.email) })
  if (contact.city) out.push({ field: 'city', value: fold(contact.city) })
  return out
}

/**
 * Score one contact against the term. Returns `null` for a non-match, so the
 * caller can filter and sort in one pass.
 */
export function scoreContact(
  contact: ContactRow,
  term: string,
): { field: MatchField; kind: MatchKind; score: number } | null {
  const needle = fold(term)
  if (needle === '') return null

  let best: { field: MatchField; kind: MatchKind; score: number } | null = null
  const consider = (field: MatchField, kind: MatchKind) => {
    const score = KIND_SCORE[kind] + FIELD_SCORE[field]
    if (!best || score > best.score) best = { field, kind, score }
  }

  for (const candidate of candidatesOf(contact)) {
    const kind = matchKind(candidate.value, needle)
    if (kind) consider(candidate.field, kind)
  }

  // Phone/WhatsApp: digit-normalised on *both* sides (03 §3). Comparing the
  // raw digits alone would miss the common case — a number saved as +44… and
  // typed as 07… — so both are reduced to their shared keys first.
  const typed = phoneKeys(term)
  if (typed.length > 0) {
    for (const raw of [contact.phone, contact.whatsapp]) {
      const stored = phoneKeys(raw)
      if (stored.length === 0) continue
      if (stored.some((key) => typed.includes(key))) consider('phone', 'exact')
      else if (stored.some((key) => typed.some((t) => key.endsWith(t) || key.startsWith(t))))
        consider('phone', 'starts')
      else if (stored.some((key) => typed.some((t) => key.includes(t)))) consider('phone', 'contains')
    }
  }

  return best
}

/**
 * Rank a candidate set. Equal scores fall back to the name, so the order is
 * stable between renders (and between test runs).
 */
export function rankResults(
  rows: Array<{ contact: ContactRow; stats: ContactStats | null }>,
  term: string,
  limit = 12,
): SearchResult[] {
  const out: SearchResult[] = []
  for (const row of rows) {
    const scored = scoreContact(row.contact, term)
    if (!scored) continue
    out.push({ contact: row.contact, stats: row.stats, ...scored })
  }
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return fullName(a.contact).localeCompare(fullName(b.contact), 'en-GB')
  })
  return out.slice(0, limit)
}

/** "Golders Green" · "Cohen & Partner" — why this row matched, when it is not the name. */
export function matchReason(result: SearchResult): string | null {
  switch (result.field) {
    case 'organization':
      return result.contact.organization
    case 'city':
      return result.contact.city
    case 'email':
      return result.contact.email
    case 'phone':
      return result.contact.phone ?? result.contact.whatsapp
    case 'hebrew_name':
      return result.contact.hebrew_name
    default:
      return null
  }
}
