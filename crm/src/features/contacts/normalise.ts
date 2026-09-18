/**
 * Data-quality rules at the door (02 §6): phone/WhatsApp normalised to E.164,
 * emails lowercased, and the create-time duplicate check.
 *
 * Everything here is a pure function so the rules are testable without a
 * database (tests/contacts-normalise.test.ts).
 */

import type { ContactRow } from './types'

/** UK default — the yeshiva's book is overwhelmingly +44 (02 §6). */
export const DEFAULT_DIALLING_CODE = '44'

/**
 * Normalise a phone number to E.164.
 *
 * - spaces, hyphens, brackets, dots and non-breaking spaces are stripped
 * - `+…` is kept as the caller wrote it (digits only after the plus)
 * - `00…` becomes `+…`
 * - a leading national `0` is replaced by the default dialling code
 * - bare digits already starting with the dialling code get a `+`
 *
 * Returns `null` for empty input, and the trimmed original when the value
 * carries no usable digits — mangling a half-typed number is worse than
 * storing it verbatim for a human to fix.
 */
export function normalisePhone(
  input: string | null | undefined,
  diallingCode: string = DEFAULT_DIALLING_CODE,
): string | null {
  if (input === null || input === undefined) return null
  const trimmed = input.trim()
  if (trimmed === '') return null

  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (digits === '') return trimmed

  if (hasPlus) return `+${digits}`
  if (digits.startsWith('00')) return `+${digits.slice(2).replace(/^0+/, '') || digits.slice(2)}`
  if (digits.startsWith('0')) return `+${diallingCode}${digits.replace(/^0+/, '')}`
  if (digits.startsWith(diallingCode)) return `+${digits}`
  return `+${diallingCode}${digits}`
}

/** Emails are lowercased and trimmed on save (02 §6). */
export function normaliseEmail(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null
  const value = input.trim().toLowerCase()
  return value === '' ? null : value
}

/** `+447700900123` → `447700900123`; used for wa.me deep links (10 §2). */
export function waNumber(phone: string | null | undefined): string | null {
  const normalised = normalisePhone(phone)
  if (!normalised) return null
  const digits = normalised.replace(/\D/g, '')
  return digits === '' ? null : digits
}

/** Empty strings become null so we never write `''` into a nullable column. */
export function nullable(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** `Rabbi Dovid Cohen` — title is not part of the matching name. */
export function fullName(
  contact: Pick<ContactRow, 'first_name' | 'last_name' | 'organization'> | null | undefined,
): string {
  if (!contact) return ''
  const person = [contact.first_name, contact.last_name].map((p) => (p ?? '').trim()).filter(Boolean).join(' ')
  return person || (contact.organization ?? '').trim()
}

/** Display name including the honorific, for headers and rows. */
export function displayName(
  contact: Pick<ContactRow, 'title' | 'first_name' | 'last_name' | 'organization'> | null | undefined,
): string {
  if (!contact) return ''
  const name = fullName(contact)
  const title = (contact.title ?? '').trim()
  return title ? `${title} ${name}`.trim() : name
}

function comparableName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function bigrams(value: string): string[] {
  const padded = ` ${value} `
  const out: string[] = []
  for (let i = 0; i < padded.length - 1; i += 1) out.push(padded.slice(i, i + 2))
  return out
}

/**
 * Trigram-ish name similarity, 0…1 — the client-side stand-in for Postgres
 * `similarity()` (02 §6 asks for ≥0.6). Dice coefficient over bigrams, so
 * "Dovid Cohen" vs "David Cohen" scores well above word-swap noise.
 */
export function nameSimilarity(a: string, b: string): number {
  const left = comparableName(a)
  const right = comparableName(b)
  if (left === '' || right === '') return 0
  if (left === right) return 1

  const leftGrams = bigrams(left)
  const rightPool = new Map<string, number>()
  for (const gram of bigrams(right)) rightPool.set(gram, (rightPool.get(gram) ?? 0) + 1)

  let hits = 0
  for (const gram of leftGrams) {
    const remaining = rightPool.get(gram) ?? 0
    if (remaining > 0) {
      hits += 1
      rightPool.set(gram, remaining - 1)
    }
  }

  const total = leftGrams.length + bigrams(right).length
  return total === 0 ? 0 : (2 * hits) / total
}

/** 02 §6's threshold for the create-time interstitial. */
export const NAME_MATCH_THRESHOLD = 0.6

export type DuplicateReason = 'email' | 'phone' | 'name'

export interface DuplicateSignals {
  first_name: string
  last_name?: string | null
  organization?: string | null
  /** Already normalised — pass the values that will be written. */
  email?: string | null
  phone?: string | null
  whatsapp?: string | null
}

export interface DuplicateMatch {
  contact: ContactRow
  reasons: DuplicateReason[]
  score: number
}

/**
 * Score one existing contact against the record about to be created.
 *
 * Exact normalised email or phone/WhatsApp match is a duplicate signal on its
 * own; otherwise the names must be ≥`NAME_MATCH_THRESHOLD` similar.
 */
export function scoreDuplicate(signals: DuplicateSignals, candidate: ContactRow): DuplicateMatch | null {
  const reasons: DuplicateReason[] = []

  const email = normaliseEmail(signals.email)
  if (email && normaliseEmail(candidate.email) === email) reasons.push('email')

  const phones = new Set(
    [signals.phone, signals.whatsapp]
      .map((p) => normalisePhone(p))
      .filter((p): p is string => Boolean(p)),
  )
  const candidatePhones = [candidate.phone, candidate.whatsapp]
    .map((p) => normalisePhone(p))
    .filter((p): p is string => Boolean(p))
  if (candidatePhones.some((p) => phones.has(p))) reasons.push('phone')

  const score = nameSimilarity(
    fullName({
      first_name: signals.first_name,
      last_name: signals.last_name ?? '',
      organization: signals.organization ?? null,
    }),
    fullName(candidate),
  )
  if (score >= NAME_MATCH_THRESHOLD) reasons.push('name')

  if (reasons.length === 0) return null
  return { contact: candidate, reasons, score }
}

/** Rank matches: contact-detail hits first, then by name similarity. */
export function rankDuplicates(matches: DuplicateMatch[]): DuplicateMatch[] {
  const weight = (m: DuplicateMatch) =>
    (m.reasons.includes('email') ? 4 : 0) + (m.reasons.includes('phone') ? 2 : 0) + m.score
  return [...matches].sort((a, b) => weight(b) - weight(a))
}

export const DUPLICATE_REASON_LABEL: Record<DuplicateReason, string> = {
  email: 'same email',
  phone: 'same phone number',
  name: 'a very similar name',
}
