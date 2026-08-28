import { describe, expect, it } from 'vitest'
import {
  BEREAVEMENT_MARKERS,
  BRIEF_BULLET_ORDER,
  ILLNESS_MARKERS,
  OVERDUE_TOP,
  THIN_FILE_INTERACTIONS,
  TIMELINE_LIMIT,
  buildBriefFacts,
  composeDigest,
  detectExclusion,
  digestSubject,
  digestText,
  labelText,
  nextLabel,
  resolutionFor,
  type BriefInput,
  type DigestInput,
  type DigestTask,
} from '../src/features/ai/core'

/**
 * The decisions M9a makes *without* a model: what may enter a prompt, what may
 * never be drafted, what the morning digest says, and what the label claims.
 *
 * These are the four places where the AI features can do real harm — leak a
 * private note, write a condolence, go silent on a quiet day, or tell a
 * fundraiser a machine's words were checked by a person — so they are the four
 * places tested exhaustively and without a network.
 */

/* ========================================================================== */
/* 1. Context assembly & redaction — 09 §1.7, §3                              */
/* ========================================================================== */

const briefInput = (over: Partial<BriefInput> = {}): BriefInput => ({
  contact: {
    id: 'dovid',
    title: 'R’',
    first_name: 'Dovid',
    last_name: 'Cohen',
    organization: 'Cohen & Partner',
    city: 'Golders Green',
    stage: 'active_donor',
    estimated_capacity: 250_000,
    things_to_remember: 'Prefers a call before Mincha',
    holding_line: 'Waiting on the naming pack.',
  },
  stats: {
    lifetime_giving: 42_500,
    giving_this_year: 5_000,
    gift_count: 11,
    largest_gift: 20_000,
    average_gift: 3_863,
    last_gift_amount: 5_000,
    last_gift_date: '2026-06-02',
    pledge_balance: 15_000,
    days_since_contact: 34,
    last_meaningful_contact_kind: 'meeting',
    kit_due_on: '2026-09-01',
    donor_status: 'active',
    flag: 'today',
  },
  timeline: [
    { occurred_at: '2026-06-02T10:00:00Z', kind: 'meeting', summary: 'Met in London', ask_amount: 20_000 },
    { occurred_at: '2026-05-01T10:00:00Z', kind: 'call', summary: 'Quick call' },
  ],
  tasks: [{ title: 'Call re building project', action_type: 'call', due_on: '2026-09-03', status: 'todo' }],
  notes: [
    { category: 'general', body: 'Loves the dinner', is_private: false, created_by: 'braun' },
    { category: 'private', body: 'Marriage under strain', is_private: true, created_by: 'someone-else' },
    { category: 'private', body: 'My own private note', is_private: true, created_by: 'me' },
  ],
  openItems: [{ kind: 'pledge', label: 'Open pledge from 2025-10-01', amount: 25_000 }],
  tags: ['Building Project', ''],
  viewer: { id: 'me', canSeeAmounts: true },
  ...over,
})

describe('buildBriefFacts — what may enter a prompt (09 §1.7)', () => {
  it('passes SQL figures through untouched, so the model can only echo them', () => {
    const facts = buildBriefFacts(briefInput())
    expect(facts.numbers.lifetime_giving).toBe(42_500)
    expect(facts.numbers.largest_gift).toBe(20_000)
    expect(facts.numbers.average_gift).toBe(3_863)
    // Nothing derived, nothing rounded, nothing summed (I-8/I-9).
    expect(Object.keys(facts.numbers)).not.toContain('total')
  })

  it('strips every money field for a viewer without can_see_amounts', () => {
    const facts = buildBriefFacts(briefInput({ viewer: { id: 'me', canSeeAmounts: false } }))
    expect(facts.amounts_visible).toBe(false)
    for (const key of [
      'lifetime_giving',
      'giving_this_year',
      'gift_count',
      'largest_gift',
      'average_gift',
      'last_gift_amount',
      'pledge_balance',
    ]) {
      expect(facts.numbers[key]).toBeUndefined()
    }
    expect(facts.contact.estimated_capacity).toBeUndefined()
    expect(facts.timeline[0]?.ask_amount).toBeUndefined()
    expect(facts.open_items[0]?.amount).toBeUndefined()
  })

  it('keeps the relationship rhythm for a restricted viewer — it is not money', () => {
    const facts = buildBriefFacts(briefInput({ viewer: { id: 'me', canSeeAmounts: false } }))
    expect(facts.numbers.days_since_contact).toBe(34)
    expect(facts.numbers.last_contact_kind).toBe('meeting')
    expect(facts.numbers.donor_status).toBe('active')
    expect(facts.timeline[0]?.summary).toBe('Met in London')
  })

  it('drops another author’s private note even when RLS handed it over', () => {
    const facts = buildBriefFacts(briefInput())
    const bodies = facts.notes.map((note) => note.body)
    expect(bodies).toContain('Loves the dinner')
    expect(bodies).toContain('My own private note')
    expect(bodies).not.toContain('Marriage under strain')
  })

  it('caps the timeline at the fifteen entries 09 §3 asks for', () => {
    const many = Array.from({ length: 40 }, (_v, index) => ({
      occurred_at: `2026-01-${String((index % 28) + 1).padStart(2, '0')}T09:00:00Z`,
      kind: 'call',
      summary: `Call ${index}`,
    }))
    const facts = buildBriefFacts(briefInput({ timeline: many }))
    expect(facts.timeline).toHaveLength(TIMELINE_LIMIT)
    expect(facts.timeline[0]?.summary).toBe('Call 0')
    expect(facts.interaction_count).toBe(40)
    expect(facts.thin_file).toBe(false)
  })

  it('flags a thin file rather than letting the model pad it', () => {
    const facts = buildBriefFacts(briefInput({ timeline: [{ kind: 'call', summary: 'One call' }] }))
    expect(facts.thin_file).toBe(true)
    expect(THIN_FILE_INTERACTIONS).toBe(4)
  })

  it('drops empty values so the prompt carries signal, not a wall of nulls', () => {
    const facts = buildBriefFacts(
      briefInput({ contact: { id: 'x', first_name: 'Yaakov', spouse_name: null, family_notes: '' } }),
    )
    expect(facts.contact).not.toHaveProperty('spouse')
    expect(facts.contact).not.toHaveProperty('family_notes')
    expect(facts.contact.name).toBe('Yaakov')
    expect(facts.tags).toEqual(['Building Project'])
  })

  it('carries the current holding line so a rewrite is a rewrite, not a restart', () => {
    expect(buildBriefFacts(briefInput()).current_holding_line).toBe('Waiting on the naming pack.')
  })

  it('names five bullets, in the spec’s order', () => {
    expect(BRIEF_BULLET_ORDER.map((bullet) => bullet.key)).toEqual([
      'who',
      'trajectory',
      'giving',
      'last_time',
      'talking_points',
    ])
  })
})

/* ========================================================================== */
/* 2. The hard exclusion — 09 §1.6                                            */
/* ========================================================================== */

describe('detectExclusion — the messages AI never writes (09 §1.6)', () => {
  it('refuses on a tribute recorded in memory, before any text is read', () => {
    const result = detectExclusion({ tributeType: 'in_memory', texts: ['A perfectly ordinary gift note'] })
    expect(result?.excluded).toBe(true)
    expect(result?.marker).toBe('tribute:in_memory')
    expect(result?.reason).toMatch(/in memory/i)
  })

  it('allows a tribute in honour of someone living', () => {
    expect(detectExclusion({ tributeType: 'in_honor', texts: ['For his son’s bar mitzvah'] })).toBeNull()
  })

  it.each([
    ['his father was niftar last week', 'niftar'],
    ['sitting shiva until Thursday', 'shiva'],
    ['the levaya is tomorrow morning', 'levaya'],
    // Word-boundary matching, so the plural needs its own entry — and has one.
    ['send condolences', 'condolences'],
    ['R’ Moshe a"h founded the shul', 'a"h'],
    ['she passed away in March', 'passed away'],
  ])('refuses on a bereavement marker: %s', (text, marker) => {
    const result = detectExclusion({ texts: [text] })
    expect(result?.excluded).toBe(true)
    expect(result?.marker).toBe(marker)
    expect(result?.reason).toMatch(/bereavement|death/i)
  })

  it.each([
    ['starting chemo next month', 'chemo'],
    ['he is in hospital again', 'in hospital'],
    ['please say tehillim for his wife', 'tehillim for'],
    ['recently diagnosed with something serious', 'diagnosed with'],
    ['surgery booked for the 14th', 'surgery'],
  ])('refuses on an illness marker: %s', (text, marker) => {
    const result = detectExclusion({ texts: [text] })
    expect(result?.excluded).toBe(true)
    expect(result?.marker).toBe(marker)
    expect(result?.reason).toMatch(/illness/i)
  })

  it('reads every supplied text, not only the first', () => {
    const result = detectExclusion({
      texts: ['Lovely meeting', null, undefined, '', 'mentioned the yahrzeit is next week'],
    })
    expect(result?.marker).toBe('yahrzeit')
  })

  it('lets an ordinary thank-you through', () => {
    expect(
      detectExclusion({
        tributeType: null,
        texts: [
          'Gave £5,000 to the building fund after the dinner.',
          'Wants the naming pack. Very warm about the new wing.',
          'Will call after Sukkos.',
        ],
      }),
    ).toBeNull()
  })

  it('does not fire on innocent words that merely contain a marker', () => {
    // "died" inside "studied", "shiva" inside a surname-like token.
    expect(detectExclusion({ texts: ['He studied in Gateshead and now funds a shiur'] })).toBeNull()
  })

  it('keeps the Anglo-charedi register in the marker list', () => {
    for (const marker of ['niftar', 'levaya', 'shiva', 'yahrzeit', 'nichum aveilim']) {
      expect(BEREAVEMENT_MARKERS).toContain(marker)
    }
    for (const marker of ['refuah', 'cholim', 'tehillim for']) {
      expect(ILLNESS_MARKERS).toContain(marker)
    }
  })
})

/* ========================================================================== */
/* 3. Digest composition — 08 §6                                              */
/* ========================================================================== */

const task = (over: Partial<DigestTask> = {}): DigestTask => ({
  id: 't1',
  contact_id: 'dovid',
  contact_name: 'Dovid Cohen',
  title: 'Call re building',
  action_type: 'call',
  due_on: '2026-08-28',
  days_overdue: 0,
  ...over,
})

const digestInput = (over: Partial<DigestInput> = {}): DigestInput => ({
  member: { id: 'braun', full_name: "R' Braun", email: 'braun@example.test' },
  today: '2026-08-28',
  meetings: [],
  dueToday: [],
  overdue: [],
  signals: [],
  kitDue: [],
  appUrl: 'https://crm.test/',
  ...over,
})

describe('composeDigest — the numbers are SQL’s (08 §6 / 09 §5)', () => {
  it('groups today’s actions by type, busiest group first', () => {
    const payload = composeDigest(
      digestInput({
        dueToday: [
          task({ id: 'a', action_type: 'call' }),
          task({ id: 'b', action_type: 'call', contact_name: 'Klein' }),
          task({ id: 'c', action_type: 'send_email', title: 'Email the pack' }),
        ],
      }),
    )
    expect(payload.due_by_type.map((group) => [group.label, group.items.length])).toEqual([
      ['Calls', 2],
      ['Emails', 1],
    ])
    expect(payload.counts.due_today).toBe(3)
    expect(payload.quiet).toBe(false)
  })

  it('reports the overdue count in full and only the top three, latest first', () => {
    const payload = composeDigest(
      digestInput({
        overdue: [
          task({ id: '1', days_overdue: 3 }),
          task({ id: '2', days_overdue: 22 }),
          task({ id: '3', days_overdue: 9 }),
          task({ id: '4', days_overdue: 1 }),
          task({ id: '5', days_overdue: 40 }),
        ],
      }),
    )
    expect(payload.overdue_total).toBe(5)
    expect(payload.overdue_top).toHaveLength(OVERDUE_TOP)
    expect(payload.overdue_top.map((row) => row.days_overdue)).toEqual([40, 22, 9])
  })

  it('counts nothing the database did not send it', () => {
    const payload = composeDigest(
      digestInput({
        meetings: [{ contact_id: 'dovid', contact_name: 'Dovid Cohen', at: '2026-08-28T10:30:00Z' }],
        signals: [{ contact_id: 'k', contact_name: 'Klein', rule_key: 'neglect_flags', reason: '92 days quiet' }],
        kitDue: [{ contact_id: 'w', contact_name: 'Weiss', due_on: '2026-08-20' }],
      }),
    )
    expect(payload.counts).toEqual({ meetings: 1, due_today: 0, overdue: 0, signals: 1, kit_due: 1 })
  })

  it('a quiet day is quiet — and still sends exactly two lines, never silence', () => {
    const payload = composeDigest(digestInput())
    expect(payload.quiet).toBe(true)

    const text = digestText(payload, null, 'https://crm.test')
    const lines = text.split('\n').filter((line) => line.trim() !== '')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/Nothing is due today/)
    expect(lines[1]).toContain('https://crm.test/contacts?view=no-next-action')
    expect(digestSubject(payload)).toMatch(/nothing due/i)
  })

  it('drops the narrative on a quiet day rather than inventing weather', () => {
    // A narrative supplied for a quiet day is ignored: the two lines are fixed.
    const text = digestText(composeDigest(digestInput()), 'Three relationships need rescuing.', 'https://crm.test')
    expect(text).not.toContain('rescuing')
  })

  it('puts the narrative on top when there is something to say', () => {
    const payload = composeDigest(digestInput({ dueToday: [task()] }))
    const text = digestText(payload, 'Two calls today; the Reuven proposal has been quiet 12 days.', 'https://crm.test')
    expect(text.split('\n')[0]).toBe('Two calls today; the Reuven proposal has been quiet 12 days.')
  })

  it('deep-links every person, and trims a trailing slash on the base URL', () => {
    const payload = composeDigest(digestInput({ dueToday: [task()] }))
    const text = digestText(payload, null, 'https://crm.test/')
    expect(text).toContain('https://crm.test/contacts/dovid')
    expect(text).not.toContain('https://crm.test//')
  })

  it('names the “and N more” tail rather than silently truncating overdue work', () => {
    const payload = composeDigest(
      digestInput({ overdue: Array.from({ length: 7 }, (_v, i) => task({ id: `o${i}`, days_overdue: i + 1 })) }),
    )
    const text = digestText(payload, null, 'https://crm.test')
    expect(text).toContain('OVERDUE (7)')
    expect(text).toContain('…and 4 more')
  })

  it('summarises the day in the subject line', () => {
    const payload = composeDigest(
      digestInput({
        meetings: [{ contact_id: 'd', contact_name: 'Dovid', at: '2026-08-28T09:00:00Z' }],
        dueToday: [task()],
        overdue: [task({ id: 'x', days_overdue: 5 })],
      }),
    )
    expect(digestSubject(payload)).toBe('Your day — 1 meeting · 1 due · 1 overdue (2026-08-28)')
  })
})

/* ========================================================================== */
/* 4. The label state machine — 09 §1.4                                       */
/* ========================================================================== */

describe('nextLabel — “Drafted with AI” until a person touches it (09 §1.4)', () => {
  it('starts as AI and says so', () => {
    expect(labelText('ai')).toBe('Drafted with AI')
    expect(labelText('reviewed')).toBe('Reviewed')
  })

  it('accepting and editing both mean a person read it', () => {
    expect(nextLabel('ai', 'accept')).toBe('reviewed')
    expect(nextLabel('ai', 'edit')).toBe('reviewed')
  })

  it('rejecting discards — there is no third label, only absent content', () => {
    expect(nextLabel('ai', 'reject')).toBe('discarded')
    expect(labelText('discarded')).toBe('Discarded')
  })

  it('regenerating always returns to unreviewed, whatever came before', () => {
    expect(nextLabel('ai', 'regenerate')).toBe('ai')
    expect(nextLabel('reviewed', 'regenerate')).toBe('ai')
    // …including from discarded: the new words have not been seen either.
    expect(nextLabel('discarded', 'regenerate')).toBe('ai')
  })

  it('never silently un-reviews content a person already kept', () => {
    expect(nextLabel('reviewed', 'accept')).toBe('reviewed')
    expect(nextLabel('reviewed', 'edit')).toBe('reviewed')
    expect(nextLabel('reviewed', 'reject')).toBe('discarded')
  })

  it('discarded stays discarded under every verdict', () => {
    for (const event of ['accept', 'edit', 'reject'] as const) {
      expect(nextLabel('discarded', event)).toBe('discarded')
    }
  })

  it('maps each verdict onto the ledger value 09 §1.5 requires', () => {
    expect(resolutionFor('accept')).toBe('accepted')
    expect(resolutionFor('edit')).toBe('edited')
    expect(resolutionFor('reject')).toBe('rejected')
    // A regenerate is a new run, not a verdict on the old one.
    expect(resolutionFor('regenerate')).toBe('pending')
  })
})
