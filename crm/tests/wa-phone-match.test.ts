import { describe, expect, it } from 'vitest'
import { normalisePhone } from '../src/features/contacts/normalise'
import { normaliseWaId, waIdDigits } from '../src/features/whatsapp/core'

/**
 * Phone matching (10 §2 Tier 2 · 02 §6).
 *
 * The rule exists in three places by necessity: `contacts/normalise.ts` for the
 * app, `whatsapp/core.ts` for the two Deno edge functions (which cannot import
 * from `src/`), and `crm_wa_normalise()` in migration 012 for the BEFORE INSERT
 * matcher. This file pins the first two together on a table of inputs, so a
 * change to one that is not made to the other fails here rather than silently
 * filing a donor's messages against nobody.
 *
 * The SQL third is exercised live (the demo conversations in 012's wake match
 * seeded donors by phone and by WhatsApp number).
 */

const CASES: Array<[label: string, input: string, expected: string]> = [
  ['the digits Meta sends', '447700900123', '+447700900123'],
  ['the same number as the donor record holds it', '+44 7700 900123', '+447700900123'],
  ['a UK national number', '07700 900123', '+447700900123'],
  ['a national number with punctuation', '(07700) 900-123', '+447700900123'],
  ['an international prefix', '00447700900123', '+447700900123'],
  ['a plus with spaces', '+44 (0)7700 900123', '+4407700900123'],
  ['an Israeli number', '+972 50 123 4567', '+972501234567'],
  ['a bare local number', '7700900123', '+447700900123'],
]

describe('normaliseWaId mirrors contacts/normalise.ts', () => {
  it.each(CASES)('%s', (_label, input, expected) => {
    expect(normaliseWaId(input)).toBe(expected)
    // The point of the file: the two implementations must agree, always.
    expect(normaliseWaId(input)).toBe(normalisePhone(input))
  })

  it.each([null, undefined, '', '   '])('returns null for %s, as the contacts rule does', (value) => {
    expect(normaliseWaId(value as string | null)).toBe(normalisePhone(value as string | null))
    expect(normaliseWaId(value as string | null)).toBeNull()
  })

  it('leaves a half-typed value alone rather than mangling it', () => {
    expect(normaliseWaId('ask his son')).toBe('ask his son')
    expect(normaliseWaId('ask his son')).toBe(normalisePhone('ask his son'))
  })

  it('honours a non-UK default dialling code when one is given', () => {
    expect(normaliseWaId('0501234567', '972')).toBe('+972501234567')
  })
})

describe('the wa_id the Graph API wants', () => {
  it('is digits only', () => {
    expect(waIdDigits('+447700900123')).toBe('447700900123')
    expect(waIdDigits('07700 900123')).toBe('447700900123')
  })

  it('is null when there is nothing to send to', () => {
    expect(waIdDigits(null)).toBeNull()
    expect(waIdDigits('')).toBeNull()
  })
})

describe('the matching a conversation performs', () => {
  const donor = { whatsapp: '+44 7700 900123', phone: '020 7946 0000' }

  it('matches the WhatsApp field first', () => {
    expect(normaliseWaId('447700900123')).toBe(normalisePhone(donor.whatsapp))
  })

  it('falls through to the phone field', () => {
    expect(normaliseWaId('442079460000')).toBe(normalisePhone(donor.phone))
  })

  it('does not match a different donor’s number', () => {
    expect(normaliseWaId('447700900999')).not.toBe(normalisePhone(donor.whatsapp))
  })
})
