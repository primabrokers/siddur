import { beforeEach, describe, expect, it } from 'vitest'
import {
  digitsOf,
  fold,
  matchKind,
  matchReason,
  rankResults,
  scoreContact,
} from '../src/features/search/searchModel'
import {
  RECENTS_LIMIT,
  clearRecents,
  readRecents,
  readUsage,
  recordUsage,
  rememberContact,
} from '../src/features/search/recents'
import { buildOrClause, phoneVariants, sanitiseTerm } from '../src/lib/queries/search'
import { fuzzyScore, rankCommands } from '../src/features/search/commands'
import type { ContactRow } from '../src/features/contacts/types'

const contact = (over: Partial<ContactRow> & { id: string; first_name: string }): ContactRow =>
  ({
    last_name: null,
    title: null,
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

const DOVID = contact({
  id: 'c1',
  first_name: 'Dovid',
  last_name: 'Cohen',
  hebrew_name: 'דוד הכהן',
  organization: 'Cohen & Partner',
  email: 'dovid.cohen@example.com',
  phone: '+447700900123',
  whatsapp: '+447700900123',
  city: 'Golders Green',
})
const COHENSON = contact({ id: 'c2', first_name: 'Yitzchok', last_name: 'Cohenson', city: 'Hendon' })
const MCOHEN = contact({ id: 'c3', first_name: 'Miri', last_name: 'Adler', organization: 'Cohen Bakery' })
const GREENFELD = contact({ id: 'c4', first_name: 'Aron', last_name: 'Greenfeld', city: 'Golders Green' })

describe('search: normalising', () => {
  it('reduces a phone number to digits however it was typed', () => {
    expect(digitsOf('+44 7700 900 123')).toBe('447700900123')
    expect(digitsOf('(020) 8123-4567')).toBe('02081234567')
    expect(digitsOf(null)).toBe('')
  })

  it('folds case, accents and runs of whitespace', () => {
    expect(fold('  Cháim   LAX ')).toBe('chaim lax')
  })
})

describe('search: the rank ladder (03 §3)', () => {
  it('grades startsWith above word-boundary above contains', () => {
    expect(matchKind('cohen', 'cohen')).toBe('exact')
    expect(matchKind('cohen & partner', 'cohen')).toBe('starts')
    expect(matchKind('dovid cohen', 'cohen')).toBe('word')
    expect(matchKind('cohenson', 'ohen')).toBe('contains')
    expect(matchKind('dovid', 'zzz')).toBeNull()
  })

  it('ranks people above organisations for the same kind of hit', () => {
    // "Cohen" is a surname for c2 and c4 (word hits on the name) and the start
    // of an organisation for c3. The person wins — that is the point of the
    // narrow gap between `starts` and `word` in the ladder.
    const ranked = rankResults(
      [MCOHEN, COHENSON].map((c) => ({ contact: c, stats: null })),
      'cohen',
    )
    expect(ranked.map((row) => row.contact.id)).toEqual(['c2', 'c3'])
    expect(ranked[0]?.field).toBe('name')
    expect(ranked[1]?.field).toBe('organization')
  })

  it('still puts the organisation first when its whole name is typed', () => {
    const ranked = rankResults(
      [MCOHEN, COHENSON].map((c) => ({ contact: c, stats: null })),
      'cohen bakery',
    )
    expect(ranked[0]?.contact.id).toBe('c3')
    expect(ranked[0]?.kind).toBe('exact')
  })

  it('ranks a first-name start above a surname hit', () => {
    const ranked = rankResults(
      [COHENSON, DOVID].map((c) => ({ contact: c, stats: null })),
      'dovid',
    )
    expect(ranked[0]?.contact.id).toBe('c1')
    expect(ranked[0]?.kind).toBe('starts')
  })

  it.each([
    ['07700900123', 'the UK trunk form'],
    ['+44 7700 900123', 'the stored international form'],
    ['7700900123', 'no prefix at all'],
    ['900123', 'just the tail'],
  ])('matches the phone number typed as %s (%s)', (typed) => {
    const scored = scoreContact(DOVID, typed)
    expect(scored?.field).toBe('phone')
  })

  it('does not treat a two-digit fragment as a phone search', () => {
    expect(scoreContact(DOVID, '12')).toBeNull()
  })

  it('matches the Hebrew name', () => {
    expect(scoreContact(DOVID, 'דוד')?.field).toBe('hebrew_name')
  })

  it('finds people by city and says so on the row', () => {
    const ranked = rankResults(
      [DOVID, GREENFELD].map((c) => ({ contact: c, stats: null })),
      'golders',
    )
    expect(ranked).toHaveLength(2)
    expect(matchReason(ranked[0]!)).toBe('Golders Green')
  })

  it('returns nothing for a term nobody matches', () => {
    expect(rankResults([{ contact: DOVID, stats: null }], 'zzzz')).toEqual([])
  })

  it('orders equal scores by name, so the list never reshuffles', () => {
    const a = contact({ id: 'x', first_name: 'Zeev', last_name: 'Stern', city: 'Hendon' })
    const b = contact({ id: 'y', first_name: 'Aaron', last_name: 'Stern', city: 'Hendon' })
    const ranked = rankResults([a, b].map((c) => ({ contact: c, stats: null })), 'hendon')
    expect(ranked.map((row) => row.contact.id)).toEqual(['y', 'x'])
  })
})

describe('search: the PostgREST clause', () => {
  it('strips the characters that would break the or() grammar', () => {
    expect(sanitiseTerm('cohen, (partner)*')).toBe('cohen partner')
  })

  it('covers every field the spec names', () => {
    const clause = buildOrClause('cohen')
    for (const column of ['first_name', 'last_name', 'hebrew_name', 'organization', 'email', 'city']) {
      expect(clause).toContain(`${column}.ilike.*cohen*`)
    }
  })

  it('tries a UK number with and without its trunk zero', () => {
    expect(phoneVariants('07700900123')).toEqual(
      expect.arrayContaining(['07700900123', '7700900123', '700900123']),
    )
    expect(phoneVariants('abc')).toEqual([])
    expect(buildOrClause('07700900123')).toContain('whatsapp.ilike.*7700900123*')
  })
})

describe('search: recently viewed', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('keeps the most recent first and caps the list at eight', () => {
    for (let i = 0; i < RECENTS_LIMIT + 4; i += 1) rememberContact(`c${i}`, `Person ${i}`, 1000 + i)
    const recents = readRecents()
    expect(recents).toHaveLength(RECENTS_LIMIT)
    expect(recents[0]?.id).toBe(`c${RECENTS_LIMIT + 3}`)
  })

  it('moves a re-opened contact back to the front without duplicating it', () => {
    rememberContact('a', 'A', 1)
    rememberContact('b', 'B', 2)
    rememberContact('a', 'A', 3)
    expect(readRecents().map((row) => row.id)).toEqual(['a', 'b'])
  })

  it('survives unreadable storage', () => {
    window.localStorage.setItem('crm.search.recents', 'not json')
    expect(readRecents()).toEqual([])
    clearRecents()
  })
})

describe('command palette ranking (03 §3)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('fuzzy-matches a subsequence and rejects a non-subsequence', () => {
    expect(fuzzyScore('Go to Contacts', 'gtc')).not.toBeNull()
    expect(fuzzyScore('Go to Contacts', 'zzz')).toBeNull()
  })

  it('finds Quick capture from the synonym "log"', () => {
    const ids = rankCommands('log').map((row) => row.command.id)
    expect(ids).toContain('capture.open')
  })

  it('puts the current screen’s actions first before any typing', () => {
    const onGiving = rankCommands('', { pathname: '/giving' }).map((row) => row.command.id)
    expect(onGiving.slice(0, 2)).toEqual(expect.arrayContaining(['gift.new', 'pledge.new']))
  })

  it('lets usage counts lift a command someone actually runs', () => {
    const before = rankCommands('', { pathname: '/settings' }).map((row) => row.command.id)
    for (let i = 0; i < 5; i += 1) recordUsage('task.new')
    const after = rankCommands('', { pathname: '/settings', usage: readUsage() }).map((row) => row.command.id)
    expect(after.indexOf('task.new')).toBeLessThan(before.indexOf('task.new'))
  })

  it('offers every action the spec lists', () => {
    const all = rankCommands('', { limit: 50 }).map((row) => row.command.id)
    for (const id of [
      'contact.new',
      'capture.open',
      'gift.new',
      'pledge.new',
      'task.new',
      'go.today',
      'go.contacts',
      'go.giving',
      'go.tasks',
      'go.settings',
      'account.signout',
    ]) {
      expect(all).toContain(id)
    }
  })

  it('shows the shortcut a command also has, so the palette teaches', () => {
    const goToday = rankCommands('today', { limit: 50 }).find((row) => row.command.id === 'go.today')
    expect(goToday?.command.shortcut).toBe('G T')
  })
})
