import { describe, expect, it } from 'vitest'
import {
  NAME_MATCH_THRESHOLD,
  displayName,
  fullName,
  nameSimilarity,
  normaliseEmail,
  normalisePhone,
  nullable,
  rankDuplicates,
  scoreDuplicate,
  waNumber,
} from '../src/features/contacts/normalise'
import { cadenceLabel, compareByFlagThenName, mapContactStats } from '../src/features/contacts/stats'
import type { ContactRow } from '../src/features/contacts/types'

const contact = (over: Partial<ContactRow> = {}): ContactRow =>
  ({
    id: over.id ?? 'c1',
    title: null,
    first_name: 'Dovid',
    last_name: 'Cohen',
    hebrew_name: null,
    organization: null,
    position: null,
    industry: null,
    contact_kind: 'individual',
    is_organisation_self: false,
    photo_url: null,
    household_id: null,
    email: null,
    phone: null,
    whatsapp: null,
    preferred_language: 'en',
    preferred_channel: null,
    best_time_to_contact: null,
    assistant_name: null,
    assistant_contact: null,
    linkedin_url: null,
    website_url: null,
    address_line1: null,
    address_line2: null,
    city: null,
    postcode: null,
    country: 'United Kingdom',
    source: null,
    introduced_by_id: null,
    introduced_by_note: null,
    relationship_owner_id: null,
    relationship_strength: null,
    known_since: null,
    mutual_connections: null,
    birthday: null,
    spouse_name: null,
    family_notes: null,
    things_to_remember: null,
    stage: 'prospect',
    priority: 'medium',
    tier: null,
    estimated_capacity: null,
    contact_frequency_days: null,
    kit_paused_until: null,
    engagement_score: null,
    engagement_tier: 'unknown',
    pinned_note_id: null,
    is_archived: false,
    merged_into_id: null,
    ...over,
  }) as ContactRow

describe('normalisePhone — E.164 with a UK default (02 §6)', () => {
  it('turns a national UK number into +44', () => {
    expect(normalisePhone('07700 900123')).toBe('+447700900123')
    expect(normalisePhone('0207 123 4567')).toBe('+442071234567')
  })

  it('strips spaces, hyphens, dots and brackets', () => {
    expect(normalisePhone('(0770) 090-0123')).toBe('+447700900123')
    expect(normalisePhone('077.0090.0123')).toBe('+447700900123')
  })

  it('keeps an explicit international prefix', () => {
    expect(normalisePhone('+972 54 123 4567')).toBe('+972541234567')
    expect(normalisePhone('+1 (212) 555 0123')).toBe('+12125550123')
  })

  it('converts a 00 prefix to +', () => {
    expect(normalisePhone('0044 7700 900123')).toBe('+447700900123')
  })

  it('adds the dialling code to bare national digits and keeps an existing one', () => {
    expect(normalisePhone('7700900123')).toBe('+447700900123')
    expect(normalisePhone('447700900123')).toBe('+447700900123')
  })

  it('honours a non-UK default when asked', () => {
    expect(normalisePhone('054 123 4567', '972')).toBe('+972541234567')
  })

  it('returns null for empty input and leaves digitless text alone', () => {
    expect(normalisePhone('')).toBeNull()
    expect(normalisePhone('   ')).toBeNull()
    expect(normalisePhone(null)).toBeNull()
    expect(normalisePhone(undefined)).toBeNull()
    expect(normalisePhone('ask his office')).toBe('ask his office')
  })

  it('feeds wa.me with digits only', () => {
    expect(waNumber('07700 900123')).toBe('447700900123')
    expect(waNumber(null)).toBeNull()
  })
})

describe('normaliseEmail / nullable', () => {
  it('lowercases and trims', () => {
    expect(normaliseEmail('  Dovid.Cohen@Example.CO.UK ')).toBe('dovid.cohen@example.co.uk')
  })

  it('empties become null so we never store an empty string', () => {
    expect(normaliseEmail('   ')).toBeNull()
    expect(nullable('  ')).toBeNull()
    expect(nullable(' Hendon ')).toBe('Hendon')
  })
})

describe('names', () => {
  it('builds the person name, falling back to the organisation', () => {
    expect(fullName(contact())).toBe('Dovid Cohen')
    expect(fullName(contact({ first_name: '', last_name: '', organization: 'Feld Brothers Ltd' }))).toBe(
      'Feld Brothers Ltd',
    )
  })

  it('adds the honorific for display only', () => {
    expect(displayName(contact({ title: 'Rabbi' }))).toBe('Rabbi Dovid Cohen')
  })

  it('scores similar names above the 0.6 threshold and different ones below', () => {
    expect(nameSimilarity('Dovid Cohen', 'Dovid Cohen')).toBe(1)
    expect(nameSimilarity('Dovid Cohen', 'David Cohen')).toBeGreaterThanOrEqual(NAME_MATCH_THRESHOLD)
    expect(nameSimilarity('Dovid Cohen', "D. Cohen")).toBeGreaterThan(0.4)
    expect(nameSimilarity('Dovid Cohen', 'Chaim Lax')).toBeLessThan(NAME_MATCH_THRESHOLD)
    expect(nameSimilarity('Dovid Cohen', '')).toBe(0)
  })
})

describe('duplicate check at the door (02 §6)', () => {
  const signals = {
    first_name: 'Dovid',
    last_name: 'Cohen',
    email: 'dovid@example.com',
    phone: '07700 900123',
  }

  it('flags an exact normalised phone match even when the name differs', () => {
    const match = scoreDuplicate(
      { first_name: 'Yossi', last_name: 'Gross', phone: '+447700900123' },
      contact({ phone: '07700 900123' }),
    )
    expect(match?.reasons).toEqual(['phone'])
  })

  it('flags an email match case-insensitively', () => {
    const match = scoreDuplicate(signals, contact({ email: 'DOVID@example.com', last_name: 'Klein' }))
    expect(match?.reasons).toContain('email')
  })

  it('flags a near-identical name on its own', () => {
    const match = scoreDuplicate(signals, contact({ first_name: 'David', last_name: 'Cohen' }))
    expect(match?.reasons).toEqual(['name'])
    expect(match?.score).toBeGreaterThanOrEqual(NAME_MATCH_THRESHOLD)
  })

  it('matches the WhatsApp column too', () => {
    const match = scoreDuplicate(signals, contact({ first_name: 'Zev', last_name: 'Roth', whatsapp: '+447700900123' }))
    expect(match?.reasons).toEqual(['phone'])
  })

  it('returns null when nothing matches', () => {
    expect(scoreDuplicate(signals, contact({ first_name: 'Chaim', last_name: 'Lax' }))).toBeNull()
  })

  it('ranks contact-detail matches above name-only ones', () => {
    const byName = scoreDuplicate(signals, contact({ id: 'name', first_name: 'David' }))!
    const byEmail = scoreDuplicate(
      signals,
      contact({ id: 'email', first_name: 'Zev', last_name: 'Roth', email: 'dovid@example.com' }),
    )!
    expect(rankDuplicates([byName, byEmail]).map((m) => m.contact.id)).toEqual(['email', 'name'])
  })
})

describe('contact_stats mapping (02 §4.1)', () => {
  it('maps the canonical column names', () => {
    const stats = mapContactStats({
      contact_id: 'c1',
      lifetime_giving: '65000',
      this_year_giving: 15000,
      days_since_contact: 12,
      last_contact_kind: 'meeting',
      flag: 'overdue',
      donor_status: 'active',
      is_lybunt: false,
      next_action_title: 'Call re proposal',
    })
    expect(stats?.lifetime_giving).toBe(65000)
    expect(stats?.flag).toBe('overdue')
    expect(stats?.donor_status).toBe('active')
    expect(stats?.days_since_contact).toBe(12)
  })

  it('accepts the documented aliases and unknown flags degrade to yellow', () => {
    const stats = mapContactStats({ contact_id: 'c1', ytd_giving: 900, flag: 'no_next_action' })
    expect(stats?.this_year_giving).toBe(900)
    expect(stats?.flag).toBe('none')
    expect(mapContactStats({ contact_id: 'c1', flag: 'nonsense' })?.flag).toBe('none')
  })

  it('reads the live view\'s actual column names (checked against the applied migration)', () => {
    // Column list taken verbatim from information_schema for public.contact_stats.
    const stats = mapContactStats({
      contact_id: 'c1',
      household_id: 'h1',
      lifetime_giving: 65000,
      giving_this_year: 15000,
      giving_last_year: 20000,
      soft_lifetime_giving: 6500,
      soft_giving_this_year: 500,
      soft_giving_last_year: 250,
      gift_count: 7,
      largest_gift: 20000,
      average_gift: 9286,
      first_gift_date: '2019-05-02',
      first_gift_amount: 1000,
      last_gift_date: '2026-03-12',
      last_gift_amount: 15000,
      is_lybunt: false,
      is_sybunt: false,
      pledge_balance: 15000,
      last_meaningful_contact_at: '2026-08-11T10:00:00Z',
      last_meaningful_contact_kind: 'meeting',
      days_since_contact: 12,
      kit_due_on: '2026-10-11',
      open_task_count: 1,
      next_action_id: 't1',
      next_action_title: 'Call re proposal',
      next_action_due_on: '2026-08-21',
      next_action_type: 'call',
      flag: 'overdue',
      donor_status: 'active',
      household_lifetime_giving: 71500,
      household_gift_count: 9,
    })

    expect(stats).toMatchObject({
      lifetime_giving: 65000,
      this_year_giving: 15000,
      last_year_giving: 20000,
      soft_credit_lifetime: 6500,
      soft_credit_this_year: 500,
      first_gift_on: '2019-05-02',
      last_gift_on: '2026-03-12',
      last_contact_at: '2026-08-11T10:00:00Z',
      last_contact_kind: 'meeting',
      household_lifetime_giving: 71500,
      household_gift_count: 9,
      flag: 'overdue',
      donor_status: 'active',
    })
    // The view does not carry a Gift Aid flag; the profile reads declarations.
    expect(stats?.has_ga_declaration).toBeNull()
  })

  it('returns null without a contact id', () => {
    expect(mapContactStats(null)).toBeNull()
    expect(mapContactStats({ lifetime_giving: 1 })).toBeNull()
  })
})

describe('list ordering and cadence wording', () => {
  it('sorts red → orange → yellow → blue → grey, then by name (I-3)', () => {
    const rows = [
      { name: 'Zev', stats: mapContactStats({ contact_id: 'z', flag: 'future' }) },
      { name: 'Aron', stats: mapContactStats({ contact_id: 'a', flag: 'none' }) },
      { name: 'Chaim', stats: mapContactStats({ contact_id: 'c', flag: 'overdue' }) },
      { name: 'Beri', stats: mapContactStats({ contact_id: 'b', flag: 'none' }) },
    ]
    expect(rows.sort(compareByFlagThenName).map((r) => r.name)).toEqual(['Chaim', 'Aron', 'Beri', 'Zev'])
  })

  it('names the keep-in-touch presets', () => {
    expect(cadenceLabel(null)).toBe('None')
    expect(cadenceLabel(14)).toBe('every 14 days')
    expect(cadenceLabel(30)).toBe('Monthly')
    expect(cadenceLabel(60)).toBe('every 2 months')
    expect(cadenceLabel(90)).toBe('Quarterly')
    expect(cadenceLabel(365)).toBe('Annual')
  })
})
