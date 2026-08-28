import { describe, expect, it } from 'vitest'
import { addDays, format, subDays } from 'date-fns'
import {
  buildDoneSections,
  buildTodaySections,
  buildUpcomingSections,
  dueWording,
  streamMetrics,
} from '../src/features/stream/grouping'
import { nudgeRank, nudgeSpec } from '../src/features/stream/nudges'
import { isVisibleSignal } from '../src/lib/queries/signals'
import { EMPTY_BOARD, type TaskBoard, type TaskRecord } from '../src/features/tasks/types'
import type { ContactRow, ContactStats, InteractionRow } from '../src/features/contacts/types'

const NOW = new Date(2026, 7, 26, 9, 0, 0)
const iso = (date: Date) => format(date, 'yyyy-MM-dd')

function contact(id: string, first: string, last: string, extra: Partial<ContactRow> = {}): ContactRow {
  return {
    id,
    title: null,
    first_name: first,
    last_name: last,
    hebrew_name: null,
    organization: null,
    position: null,
    industry: null,
    contact_kind: 'individual',
    is_organisation_self: false,
    photo_url: null,
    household_id: null,
    email: null,
    phone: '+447700900123',
    whatsapp: '+447700900123',
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
    stage: 'cultivation',
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
    ...extra,
  }
}

function task(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: 'task',
    contact_id: 'c1',
    title: 'Call',
    action_type: 'call',
    details: null,
    assigned_to: 'braun',
    due_on: iso(NOW),
    priority: 'medium',
    status: 'todo',
    waiting_for: null,
    completed_at: null,
    origin: 'manual',
    queue_order: null,
    opportunity_id: null,
    ...overrides,
  }
}

const stats = (id: string, extra: Partial<ContactStats> = {}): ContactStats =>
  ({ contact_id: id, days_since_contact: 12, flag: 'none', ...extra }) as ContactStats

const meeting: InteractionRow = {
  id: 'm1',
  contact_id: 'adler',
  occurred_at: new Date(2026, 7, 26, 14, 0, 0).toISOString(),
  kind: 'meeting',
  status: 'scheduled',
  team_member_id: 'braun',
  summary: 'Office visit',
  outcome: null,
  is_meaningful: false,
  location: 'office',
  attendees: null,
  purpose: 'Building campaign proposal',
  ask_amount: null,
  source: 'manual',
}

const board: TaskBoard = {
  ...EMPTY_BOARD,
  tasks: [
    task({ id: 'overdue-1', contact_id: 'cohen', due_on: iso(subDays(NOW, 4)), priority: 'high' }),
    task({
      id: 'overdue-2',
      contact_id: 'feld',
      action_type: 'whatsapp',
      due_on: iso(subDays(NOW, 1)),
      priority: 'low',
      title: 'WhatsApp — dinner journal ad',
    }),
    task({ id: 'call-today', contact_id: 'frankel', due_on: iso(NOW), title: 'Call about the dinner' }),
    task({
      id: 'wa-today',
      contact_id: 'lax',
      action_type: 'whatsapp',
      due_on: iso(NOW),
      title: 'WhatsApp the invitation',
    }),
    task({
      id: 'kit-today',
      contact_id: 'goldstein',
      action_type: 'keep_in_touch',
      origin: 'auto:kit',
      due_on: iso(NOW),
      title: 'Keep in touch — every 2 months',
    }),
    task({
      id: 'waiting',
      contact_id: 'katz',
      status: 'waiting',
      due_on: iso(NOW),
      waiting_for: 'Gift Aid form sent 12 Aug',
      title: 'Gift Aid form',
    }),
    task({ id: 'future', contact_id: 'lax', due_on: iso(addDays(NOW, 2)), title: 'Dinner invite' }),
    task({ id: 'queued', contact_id: 'cohen', status: 'queued', due_on: null, queue_order: 1 }),
  ],
  doneToday: [
    task({ id: 'done-1', contact_id: 'weiss', status: 'done', completed_at: NOW.toISOString() }),
  ],
  meetings: [meeting],
  contacts: {
    cohen: contact('cohen', 'Dovid', 'Cohen', { stage: 'in_discussion' }),
    feld: contact('feld', 'Shmuel', 'Feld'),
    frankel: contact('frankel', 'Devorah', 'Frankel'),
    lax: contact('lax', 'Chaim', 'Lax'),
    goldstein: contact('goldstein', 'Moshe', 'Goldstein'),
    katz: contact('katz', 'Yanky', 'Katz'),
    adler: contact('adler', 'Reuven', 'Adler'),
    weiss: contact('weiss', 'Yaakov', 'Weiss'),
    reich: contact('reich', 'Baruch', 'Reich', { stage: 'active_donor' }),
  },
  stats: {
    cohen: stats('cohen', { flag: 'overdue', days_since_contact: 12 }),
    reich: stats('reich', { flag: 'none', days_since_contact: 40 }),
  },
  needsActionIds: ['reich'],
}

describe('Action Stream sections (04 §1)', () => {
  const sections = buildTodaySections(board, { now: NOW, actionLabels: { call: 'Call' } })

  it('renders the spec order: meetings → overdue → due by type → KIT → needs a next action', () => {
    expect(sections.map((s) => s.kind)).toEqual([
      'meetings',
      'overdue',
      'due',
      'due',
      'kit',
      'needs-action',
    ])
  })

  it('labels each group with its count', () => {
    expect(sections.map((s) => s.label)).toEqual([
      'MEETINGS TODAY',
      'OVERDUE · 2',
      'CALLS DUE · 2',
      'WHATSAPPS DUE · 1',
      'KEEP IN TOUCH DUE · 1',
      'NEEDS A NEXT ACTION · 1',
    ])
  })

  it('sorts inside a group by flag then priority (red → orange → yellow → blue)', () => {
    const overdue = sections.find((s) => s.kind === 'overdue')
    expect(overdue?.rows.map((r) => r.id)).toEqual(['overdue-1', 'overdue-2'])
    // The waiting row (blue) sorts after the orange due-today row in its group.
    const calls = sections.filter((s) => s.kind === 'due')[0]
    expect(calls?.rows.map((r) => r.flag)).toEqual(['today', 'waiting'])
  })

  it('carries the meeting time and folds the purpose into the line', () => {
    const meetings = sections[0]
    expect(meetings?.rows[0]?.time).toBe('14:00')
    expect(meetings?.rows[0]?.line).toBe('Building campaign proposal — office')
    expect(meetings?.rows[0]?.name).toBe('Reuven Adler')
  })

  it('surfaces the yellow section as dashed rows with the I-3 wording', () => {
    const yellow = sections.find((s) => s.kind === 'needs-action')
    expect(yellow?.dashed).toBe(true)
    expect(yellow?.rows[0]?.name).toBe('Baruch Reich')
    expect(yellow?.rows[0]?.flag).toBe('none')
    expect(yellow?.rows[0]?.line).toContain('no open action')
  })

  it('writes the overdue line in days-ago wording', () => {
    const overdue = sections.find((s) => s.kind === 'overdue')
    expect(overdue?.rows[1]?.line).toBe('WhatsApp — dinner journal ad — was due yesterday')
  })

  it('shows the waiting reason instead of a date', () => {
    const calls = sections.filter((s) => s.kind === 'due')[0]
    expect(calls?.rows[1]?.line).toBe('Waiting — Gift Aid form sent 12 Aug')
  })

  it('counts the metric strip from the same partition', () => {
    expect(streamMetrics(board, NOW)).toEqual({ dueToday: 3, overdue: 2, meetings: 1, doneToday: 1 })
  })

  it('drops the empty stream to nothing so the reward state can take over', () => {
    expect(buildTodaySections({ ...EMPTY_BOARD }, { now: NOW })).toEqual([])
  })
})

describe('Upcoming and Done tabs', () => {
  it('groups future tasks by day and parks the queue at the end', () => {
    const sections = buildUpcomingSections(board, NOW)
    expect(sections.map((s) => s.kind)).toEqual(['day', 'queued'])
    expect(sections[0]?.label).toBe('FRI 28 AUG · 1')
    expect(sections[1]?.label).toBe('QUEUED · 1')
  })

  it("collects today's completions", () => {
    const sections = buildDoneSections(board, NOW)
    expect(sections[0]?.label).toBe('DONE TODAY · 1')
    expect(sections[0]?.rows[0]?.name).toBe('Yaakov Weiss')
  })
})

describe('dueWording', () => {
  it('says what the row needs and nothing more', () => {
    expect(dueWording(iso(NOW), NOW)).toBe('due today')
    expect(dueWording(iso(addDays(NOW, 1)), NOW)).toBe('due tomorrow')
    expect(dueWording(iso(subDays(NOW, 1)), NOW)).toBe('was due yesterday')
    expect(dueWording(iso(subDays(NOW, 3)), NOW)).toBe('was due Sun')
    expect(dueWording(iso(subDays(NOW, 40)), NOW)).toBe('was due 17 Jul')
    expect(dueWording(null, NOW)).toBe('no date')
  })
})

describe('nudge rail mapping (04 §1)', () => {
  it('maps the rule keys the nightly run writes', () => {
    expect(nudgeSpec('first_gift_call')).toMatchObject({ accent: 'accent', title: 'FIRST GIFT THIS WEEK' })
    expect(nudgeSpec('recurring_failing')).toMatchObject({ accent: 'overdue' })
    expect(nudgeSpec('neglect_flags')).toMatchObject({ accent: 'today', primary: 'task' })
  })

  it('still renders an unknown rule rather than dropping it', () => {
    expect(nudgeSpec('brand_new_rule').title).toBe('BRAND NEW RULE')
  })

  it('ranks red before orange before teal', () => {
    expect(nudgeRank('recurring_failing')).toBeLessThan(nudgeRank('neglect_flags'))
    expect(nudgeRank('neglect_flags')).toBeLessThan(nudgeRank('first_gift_call'))
  })
})

describe('signal states (02 §3.18 / 03 §5.3)', () => {
  const base = {
    id: 's1',
    contact_id: 'c1',
    rule_key: 'neglect_flags',
    reason: 'No contact in 92 days',
    dedupe_key: 'neglect:c1',
    created_at: '2026-08-01T00:00:00Z',
    resolved_at: null,
    snoozed_until: null,
  }

  it('shows open signals and hides dismissed ones', () => {
    expect(isVisibleSignal({ ...base, state: 'open' }, '2026-08-26')).toBe(true)
    expect(isVisibleSignal({ ...base, state: 'dismissed' }, '2026-08-26')).toBe(false)
    expect(isVisibleSignal({ ...base, state: 'acted' }, '2026-08-26')).toBe(false)
  })

  it('returns a snoozed signal silently once its date passes', () => {
    const snoozed = { ...base, state: 'snoozed' as const, snoozed_until: '2026-09-02' }
    expect(isVisibleSignal(snoozed, '2026-08-26')).toBe(false)
    expect(isVisibleSignal(snoozed, '2026-09-02')).toBe(true)
    expect(isVisibleSignal(snoozed, '2026-09-10')).toBe(true)
  })
})
