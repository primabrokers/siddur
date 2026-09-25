/**
 * Column mapping (06 §5, step 2) — the guesser and the saved templates.
 *
 * The guesser is the difference between a five-minute import and an afternoon
 * of dropdowns, so these tests are written against headers of the kind the
 * yeshiva's own spreadsheet uses ("Mobile", "Amount (£)", "Date Given") rather
 * than against the synonym table itself.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyTemplate,
  deleteTemplate,
  giftMappingProblems,
  guessField,
  guessMapping,
  headerKey,
  loadTemplates,
  mappingHasGifts,
  mappingIsUsable,
  saveTemplate,
  TEMPLATE_KEY,
} from '../src/features/import/mapping'

describe('headerKey', () => {
  it('strips everything that is not a letter or digit', () => {
    expect(headerKey('  Mobile Number ')).toBe('mobilenumber')
    expect(headerKey('Amount (£)')).toBe('amount')
    expect(headerKey('E-mail Address')).toBe('emailaddress')
  })
})

describe('guessField', () => {
  it('matches an exact synonym', () => {
    expect(guessField('Surname')).toBe('last_name')
    expect(guessField('Postcode')).toBe('postcode')
  })

  it('matches a header that starts or ends with a synonym', () => {
    expect(guessField('Mobile Phone')).toBe('phone')
    expect(guessField('Donation Amount')).toBe('gift_amount')
  })

  it('will not match a short synonym inside an unrelated word', () => {
    // "wa" is a WhatsApp synonym; "Warmth" is not a WhatsApp column.
    expect(guessField('Warmth')).toBeNull()
    // "tel" must not match "Clientele".
    expect(guessField('Clientele')).toBeNull()
  })

  it('never returns a field that is already taken', () => {
    const taken = new Set(['phone' as const])
    expect(guessField('Telephone', taken)).not.toBe('phone')
  })

  it('returns null for an empty header', () => {
    expect(guessField('   ')).toBeNull()
  })
})

describe('guessMapping', () => {
  it('maps a realistic sheet end to end', () => {
    const headers = [
      'Title', 'First Name', 'Surname', 'Organisation', 'E-mail Address',
      'Mobile', 'Address 1', 'Town', 'Postcode', 'Notes',
    ]
    expect(guessMapping(headers)).toEqual([
      'title', 'first_name', 'last_name', 'organization', 'email',
      'phone', 'address_line1', 'city', 'postcode', 'things_to_remember',
    ])
  })

  it('maps gift columns alongside contact columns', () => {
    const headers = ['First Name', 'Surname', 'Amount (£)', 'Date Given', 'Fund']
    expect(guessMapping(headers)).toEqual([
      'first_name', 'last_name', 'gift_amount', 'gift_date', 'gift_fund',
    ])
  })

  it('claims each field once, so a second phone column does not double-write', () => {
    const mapping = guessMapping(['Phone', 'Phone 2', 'Telephone'])
    expect(mapping[0]).toBe('phone')
    expect(mapping.filter((field) => field === 'phone')).toHaveLength(1)
  })

  it('lets an exact header win the field over a looser earlier one', () => {
    // "Name" would otherwise take first_name from the real "First Name".
    const mapping = guessMapping(['Name', 'First Name'])
    expect(mapping[1]).toBe('first_name')
    expect(mapping[0]).not.toBe('first_name')
  })

  it('leaves unrecognised columns unmapped rather than guessing wildly', () => {
    const mapping = guessMapping(['Internal Ref XYZ', 'First Name'])
    expect(mapping[0]).toBeNull()
  })
})

describe('mapping validity', () => {
  it('needs a name or an organisation to be usable', () => {
    expect(mappingIsUsable(['email', 'phone'])).toBe(false)
    expect(mappingIsUsable(['email', 'last_name'])).toBe(true)
    expect(mappingIsUsable(['organization'])).toBe(true)
  })

  it('spots gift columns and the ones they need', () => {
    expect(mappingHasGifts(['first_name'])).toBe(false)
    expect(mappingHasGifts(['first_name', 'gift_amount'])).toBe(true)
    expect(giftMappingProblems(['first_name'])).toEqual([])
    expect(giftMappingProblems(['first_name', 'gift_amount'])).toEqual([
      expect.stringContaining('no date column'),
    ])
    expect(giftMappingProblems(['first_name', 'gift_date'])).toEqual([
      expect.stringContaining('no amount column'),
    ])
    expect(giftMappingProblems(['first_name', 'gift_amount', 'gift_date'])).toEqual([])
  })
})

describe('mapping templates', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('round-trips a template through localStorage', () => {
    const headers = ['First Name', 'Surname', 'Mobile']
    saveTemplate('Yeshiva sheet', headers, ['first_name', 'last_name', 'phone'])

    const [template] = loadTemplates()
    expect(template.name).toBe('Yeshiva sheet')
    expect(template.byHeader).toEqual({
      'First Name': 'first_name',
      Surname: 'last_name',
      Mobile: 'phone',
    })
    expect(window.localStorage.getItem(TEMPLATE_KEY)).toContain('Yeshiva sheet')
  })

  it('replaces a template of the same name rather than piling them up', () => {
    saveTemplate('Sheet', ['A'], ['first_name'])
    saveTemplate('Sheet', ['B'], ['last_name'])
    const templates = loadTemplates()
    expect(templates).toHaveLength(1)
    expect(templates[0].byHeader).toEqual({ B: 'last_name' })
  })

  it('applies by header text, so a reordered export still maps', () => {
    saveTemplate('Sheet', ['First Name', 'Surname', 'Mobile'], ['first_name', 'last_name', 'phone'])
    const [template] = loadTemplates()

    // Same sheet, columns swapped around.
    expect(applyTemplate(template, ['Mobile', 'Surname', 'First Name'])).toEqual([
      'phone',
      'last_name',
      'first_name',
    ])
  })

  it('falls back to the guesser for headers the template does not know', () => {
    saveTemplate('Sheet', ['First Name'], ['first_name'])
    const [template] = loadTemplates()
    expect(applyTemplate(template, ['First Name', 'Postcode'])).toEqual(['first_name', 'postcode'])
  })

  it('forgets a template on request', () => {
    saveTemplate('Sheet', ['A'], ['first_name'])
    const [template] = loadTemplates()
    expect(deleteTemplate(template.id)).toEqual([])
    expect(loadTemplates()).toEqual([])
  })

  it('survives corrupt storage instead of throwing', () => {
    window.localStorage.setItem(TEMPLATE_KEY, '{not json')
    expect(loadTemplates()).toEqual([])
  })
})
