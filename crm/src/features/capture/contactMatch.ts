/**
 * Contact matching for Quick Capture — deterministic, never silent (09 §2).
 *
 * The model hands over `contact_query` as the user said it; the *matching* is
 * arithmetic, reusing M1's trigram-ish `nameSimilarity` (the client-side stand-in
 * for Postgres `similarity()`, 02 §6) over the cached roster. Three outcomes,
 * and only three:
 *
 *   - one strong match      → a teal ✓ chip
 *   - several plausible     → an inline picker of the top 3
 *   - nothing               → an explicit "Create new: ⟨name⟩?" chip
 *
 * A contact is never created without that chip being tapped ▸ Fireflies, adapted.
 */

import { fullName, nameSimilarity, normaliseEmail, normalisePhone } from '../contacts/normalise'
import type { CaptureContact } from './types'

export interface ContactMatch {
  contact: CaptureContact
  score: number
  /** Why it matched — shown under the chip so the user can judge it. */
  reason: 'name' | 'organisation' | 'email' | 'phone'
}

/** One match at or above this, clear of the runner-up, is taken as *the* one. */
export const STRONG_MATCH_SCORE = 0.8
/** Below this a candidate is not worth showing at all. */
export const CANDIDATE_SCORE = 0.55
/** A strong match must beat the second candidate by this much to stand alone. */
export const STRONG_MATCH_MARGIN = 0.12
/** The picker shows at most three (04 §4). */
export const PICKER_LIMIT = 3

const looksLikeEmail = (value: string): boolean => /\S+@\S+\.\S+/.test(value)
const looksLikePhone = (value: string): boolean => /\d[\d\s()+-]{6,}/.test(value)

/** Rank the roster against the query. Highest score first; ties by name. */
export function matchContacts(query: string | null | undefined, roster: CaptureContact[]): ContactMatch[] {
  const term = (query ?? '').trim()
  if (term === '') return []

  // Contact-detail hits are exact, not fuzzy: they win outright.
  if (looksLikeEmail(term)) {
    const email = normaliseEmail(term)
    const hit = roster.filter((c) => normaliseEmail(c.email) === email)
    if (hit.length > 0) return hit.map((contact) => ({ contact, score: 1, reason: 'email' as const }))
  }
  if (looksLikePhone(term)) {
    const phone = normalisePhone(term)
    const hit = roster.filter(
      (c) => normalisePhone(c.phone) === phone || normalisePhone(c.whatsapp) === phone,
    )
    if (hit.length > 0) return hit.map((contact) => ({ contact, score: 1, reason: 'phone' as const }))
  }

  const matches: ContactMatch[] = []
  for (const contact of roster) {
    const name = fullName(contact)
    const byName = nameSimilarity(term, name)
    const byOrg = contact.organization ? nameSimilarity(term, contact.organization) : 0
    const score = Math.max(byName, byOrg)
    if (score < CANDIDATE_SCORE) continue
    matches.push({ contact, score, reason: byOrg > byName ? 'organisation' : 'name' })
  }

  matches.sort((a, b) => b.score - a.score || fullName(a.contact).localeCompare(fullName(b.contact)))
  return matches
}

export type ContactChoiceMode = 'preset' | 'matched' | 'ambiguous' | 'create' | 'none'

export interface ContactChoice {
  mode: ContactChoiceMode
  /** Set for `preset` and `matched`; null while ambiguous or creating. */
  contactId: string | null
  /** Display name (matched) or the name to create (create). */
  name: string
  /** Populated for `ambiguous` — the top three, in order. */
  candidates: ContactMatch[]
  /** The phrase the model heard, kept for provenance and for "create new". */
  query: string
}

/**
 * `Dovid cohen` → `Dovid Cohen`. Titles are left alone: the honorific belongs
 * in `contacts.title`, and guessing one is worse than omitting it.
 */
export function titleCaseName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => (word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join(' ')
}

/** `Dovid Cohen` → `{ first_name: 'Dovid', last_name: 'Cohen' }`. */
export function splitName(value: string): { first_name: string; last_name: string } {
  const parts = titleCaseName(value).split(' ').filter(Boolean)
  if (parts.length === 0) return { first_name: '', last_name: '' }
  if (parts.length === 1) return { first_name: parts[0]!, last_name: '' }
  return { first_name: parts.slice(0, -1).join(' '), last_name: parts[parts.length - 1]! }
}

/** Turn ranked matches into the one of three states the chip can be in. */
export function classifyContact(query: string | null | undefined, roster: CaptureContact[]): ContactChoice {
  const term = (query ?? '').trim()
  if (term === '') {
    return { mode: 'none', contactId: null, name: '', candidates: [], query: '' }
  }

  const matches = matchContacts(term, roster)
  const best = matches[0]

  if (best) {
    const runnerUp = matches[1]
    const standsAlone = !runnerUp || best.score - runnerUp.score >= STRONG_MATCH_MARGIN
    if (best.score >= STRONG_MATCH_SCORE && standsAlone) {
      return {
        mode: 'matched',
        contactId: best.contact.id,
        name: fullName(best.contact),
        candidates: matches.slice(0, PICKER_LIMIT),
        query: term,
      }
    }
    return {
      mode: 'ambiguous',
      contactId: null,
      name: '',
      candidates: matches.slice(0, PICKER_LIMIT),
      query: term,
    }
  }

  return { mode: 'create', contactId: null, name: titleCaseName(term), candidates: [], query: term }
}

/** The sub-line under a matched chip: "matched · Golders Green · Tier A". */
export function matchSubtitle(match: ContactMatch): string {
  const bits = [match.reason === 'name' ? 'matched' : `matched on ${match.reason}`]
  if (match.contact.city) bits.push(match.contact.city)
  if (match.contact.tier) bits.push(`Tier ${match.contact.tier}`)
  return bits.join(' · ')
}
