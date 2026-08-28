/**
 * M9b unit tests — the two halves that have to be exactly right and cannot be
 * eyeballed: RFC 5545 serialisation, and journey step arithmetic.
 *
 * The ICS module under test is **the deployed file itself**
 * (`supabase/functions/ics-feed/ics.ts`), imported straight from the function
 * directory. It is written with no Deno globals precisely so this can happen:
 * the folding, the escaping and the CRLF endings Google Calendar sees are the
 * ones asserted here, not a copy that could drift.
 *
 * The scheduling module (`src/features/journeys/schedule.ts`) mirrors the SQL
 * engine's arithmetic for the attach preview and the profile card. These tests
 * pin the mirror; the live smoke test (rolled back) pinned the SQL. Both agree
 * on the same four rules: offset from `started_on`, `depends_on_previous`
 * waits for the previous task to be *done*, an unblocked step is never born
 * overdue, and a template with `exit_on_gift` ends on a qualifying gift.
 */

import { describe, expect, it } from 'vitest'
import {
  buildCalendar,
  escapeText,
  foldLine,
  toIcsUtc,
  tokensMatch,
  type IcsEvent,
} from '../supabase/functions/ics-feed/ics'
import {
  exitsOnGift,
  journeyProgress,
  scheduleSteps,
  stepDate,
} from '../src/features/journeys/schedule'
import type { JourneyStepRow, JourneyTaskState } from '../src/features/journeys/types'
import { parseIcs } from './support/ics-parser'

/* ------------------------------------------------------------------ ICS */

const utf8 = (value: string): number => new TextEncoder().encode(value).length

describe('ICS line folding (RFC 5545 §3.1)', () => {
  it('leaves a short line alone', () => {
    expect(foldLine('SUMMARY:Call Reuven')).toBe('SUMMARY:Call Reuven')
  })

  it('folds at 75 octets, continuations begin with one space', () => {
    const folded = foldLine(`DESCRIPTION:${'a'.repeat(200)}`)
    const lines = folded.split('\r\n')
    expect(lines.length).toBeGreaterThan(1)
    expect(utf8(lines[0]!)).toBe(75)
    for (const line of lines.slice(1)) {
      expect(line.startsWith(' ')).toBe(true)
      expect(utf8(line)).toBeLessThanOrEqual(75)
    }
    // Unfolding (drop CRLF + the one leading space) restores the original.
    expect(folded.replace(/\r\n /g, '')).toBe(`DESCRIPTION:${'a'.repeat(200)}`)
  })

  it('counts octets, not characters, and never splits a code point', () => {
    // Hebrew is two octets per character: 40 of them is 80 octets, so a
    // character-counting implementation would wrongly leave this unfolded.
    const line = `SUMMARY:${'א'.repeat(40)}`
    const lines = foldLine(line).split('\r\n')
    expect(lines.length).toBe(2)
    for (const part of lines) expect(utf8(part)).toBeLessThanOrEqual(75)
    expect(lines.join('').replace(/^ | (?=)/g, '')).not.toContain('�')
    expect(foldLine(line).replace(/\r\n /g, '')).toBe(line)
  })

  it('keeps an astral code point whole', () => {
    const line = `SUMMARY:${'😀'.repeat(30)}`
    expect(foldLine(line).replace(/\r\n /g, '')).toBe(line)
    for (const part of foldLine(line).split('\r\n')) expect(utf8(part)).toBeLessThanOrEqual(75)
  })
})

describe('ICS TEXT escaping (RFC 5545 §3.3.11)', () => {
  it('escapes backslash, semicolon, comma and newlines — and not the colon', () => {
    expect(escapeText('a\\b')).toBe('a\\\\b')
    expect(escapeText('Golders Green; NW11')).toBe('Golders Green\\; NW11')
    expect(escapeText('Adler Textiles, Brent Cross')).toBe('Adler Textiles\\, Brent Cross')
    expect(escapeText('one\ntwo')).toBe('one\\ntwo')
    expect(escapeText('one\r\ntwo')).toBe('one\\ntwo')
    expect(escapeText('14:00 sharp')).toBe('14:00 sharp')
  })

  it('escapes the backslash before anything else, so nothing double-escapes', () => {
    expect(escapeText('\\,')).toBe('\\\\\\,')
  })

  it('drops control characters rather than emitting them', () => {
    expect(escapeText('cleantext')).toBe('cleantext')
  })
})

describe('ICS UTC stamps (RFC 5545 §3.3.5)', () => {
  it('formats as YYYYMMDDTHHMMSSZ', () => {
    expect(toIcsUtc(new Date('2026-09-01T14:05:09.000Z'))).toBe('20260901T140509Z')
  })
  it('accepts an ISO string and refuses a non-date', () => {
    expect(toIcsUtc('2026-01-02T03:04:05Z')).toBe('20260102T030405Z')
    expect(() => toIcsUtc('not a date')).toThrow(RangeError)
  })
})

describe('buildCalendar', () => {
  const stamp = new Date('2026-08-28T09:00:00.000Z')
  const events: IcsEvent[] = [
    {
      uid: '4559a6c1-7280-4164-88dc-4cdc44558028@yeshiva-crm',
      start: new Date('2026-08-29T14:00:00.000Z'),
      end: new Date('2026-08-29T15:00:00.000Z'),
      summary: 'Meeting — Reuven Adler',
      description: 'Walk through the naming schedule\nOffice visit — building campaign proposal',
      location: 'Adler Textiles, Brent Cross',
      status: 'CONFIRMED',
    },
  ]

  it('ends every line with CRLF, including the last', () => {
    const body = buildCalendar(events, { name: 'Yeshiva CRM — Avi Braun', stamp })
    expect(body.endsWith('END:VCALENDAR\r\n')).toBe(true)
    // No bare LF anywhere: every \n in the payload is preceded by \r.
    expect(/(?<!\r)\n/.test(body)).toBe(false)
  })

  it('parses back into the calendar and event it describes', () => {
    const body = buildCalendar(events, {
      name: 'Yeshiva CRM — Avi Braun',
      description: 'Scheduled meetings from the Yeshiva Donor CRM. Read-only.',
      stamp,
    })
    const calendar = parseIcs(body)

    expect(calendar.properties.VERSION).toBe('2.0')
    expect(calendar.properties.METHOD).toBe('PUBLISH')
    expect(calendar.properties['X-WR-CALNAME']).toBe('Yeshiva CRM — Avi Braun')
    expect(calendar.events).toHaveLength(1)

    const event = calendar.events[0]!
    expect(event.UID).toBe('4559a6c1-7280-4164-88dc-4cdc44558028@yeshiva-crm')
    expect(event.DTSTART).toBe('20260829T140000Z')
    expect(event.DTEND).toBe('20260829T150000Z')
    expect(event.DTSTAMP).toBe('20260828T090000Z')
    expect(event.SUMMARY).toBe('Meeting — Reuven Adler')
    // Unescaped by the parser: the comma and the newline survive the round trip.
    expect(event.LOCATION).toBe('Adler Textiles, Brent Cross')
    expect(event.DESCRIPTION).toContain('\n')
    expect(event.STATUS).toBe('CONFIRMED')
  })

  it('emits VEVENTs only — no VTODO, VALARM or ATTENDEE (I-10: never sends)', () => {
    const body = buildCalendar(events, { name: 'feed', stamp })
    expect(body).not.toContain('BEGIN:VTODO')
    expect(body).not.toContain('BEGIN:VALARM')
    expect(body).not.toContain('ATTENDEE')
    expect(body).not.toContain('ORGANIZER')
  })

  it('is valid with no events at all', () => {
    const calendar = parseIcs(buildCalendar([], { name: 'empty', stamp }))
    expect(calendar.events).toHaveLength(0)
    expect(calendar.properties.VERSION).toBe('2.0')
  })
})

describe('tokensMatch', () => {
  it('matches identical tokens and nothing else', () => {
    const token = '8484414b-bd98-4f81-a645-8d00c004ee87'
    expect(tokensMatch(token, token)).toBe(true)
    expect(tokensMatch(token, token.replace('7', '8'))).toBe(false)
    expect(tokensMatch(token, `${token}x`)).toBe(false)
    expect(tokensMatch('', token)).toBe(false)
    expect(tokensMatch('', '')).toBe(true)
  })
})

/* ------------------------------------------------------------- journeys */

const step = (
  step_no: number,
  offset_days: number,
  extra: Partial<JourneyStepRow> = {},
): JourneyStepRow => ({
  id: `step-${step_no}`,
  template_id: 'tpl',
  step_no,
  offset_days,
  title: `Step ${step_no}`,
  action_type: 'call',
  details: null,
  depends_on_previous: false,
  ...extra,
})

const task = (id: string, status: string, due_on: string | null): JourneyTaskState => ({
  id,
  status,
  due_on,
  title: id,
})

/** New donor welcome, as seeded in 005: Day 1 call · Day 30 note · Day 90 invite. */
const WELCOME = [step(1, 1), step(2, 30), step(3, 90)]

describe('journey step dates', () => {
  it('is started_on + offset_days', () => {
    expect(stepDate('2026-08-28', 0)).toBe('2026-08-28')
    expect(stepDate('2026-08-28', 1)).toBe('2026-08-29')
    expect(stepDate('2026-08-28', 90)).toBe('2026-11-26')
  })

  it('crosses a month, a year and a leap day without drifting', () => {
    expect(stepDate('2026-12-30', 3)).toBe('2027-01-02')
    expect(stepDate('2028-02-27', 2)).toBe('2028-02-29')
  })

  it('gives the attach preview one dated row per step, in order', () => {
    const preview = scheduleSteps(WELCOME, '2026-08-28', { todayISO: '2026-08-28' })
    expect(preview.map((row) => row.dateISO)).toEqual([
      '2026-08-29',
      '2026-09-27',
      '2026-11-26',
    ])
    expect(preview.map((row) => row.state)).toEqual(['future', 'future', 'future'])
  })

  it('marks a Day-0 step due today — what the trigger creates on attach', () => {
    const preview = scheduleSteps([step(1, 0), step(2, 21)], '2026-08-28', {
      todayISO: '2026-08-28',
    })
    expect(preview[0]!.state).toBe('due')
    expect(preview[0]!.dateISO).toBe('2026-08-28')
    expect(preview[1]!.state).toBe('future')
  })
})

describe('depends_on_previous', () => {
  const steps = [step(1, 0), step(2, 21, { depends_on_previous: true }), step(3, 60)]

  it('blocks the step, and the whole tail with it, until the previous is done', () => {
    const rows = scheduleSteps(steps, '2026-07-29', {
      todayISO: '2026-08-28',
      tasksByStep: { 'step-1': task('t1', 'todo', '2026-07-29') },
    })
    expect(rows[1]!.state).toBe('blocked')
    // Even though step 3 has no dependency of its own, materialisation is
    // sequential: the engine cannot reach it while step 2 waits.
    expect(rows[2]!.state).toBe('blocked')
  })

  it('a cancelled predecessor does not unblock it — only "done" does', () => {
    const rows = scheduleSteps(steps, '2026-07-29', {
      todayISO: '2026-08-28',
      tasksByStep: { 'step-1': task('t1', 'cancelled', '2026-07-29') },
    })
    expect(rows[1]!.state).toBe('blocked')
  })

  it('never shows a waited-for step as already overdue', () => {
    // Offset day is 2026-08-19, thirty days after the start and nine days ago;
    // the engine dates the unblocked task today instead.
    const rows = scheduleSteps(steps, '2026-07-29', {
      todayISO: '2026-08-28',
      tasksByStep: { 'step-1': task('t1', 'todo', '2026-07-29') },
    })
    expect(rows[1]!.dateISO).toBe('2026-08-28')
  })

  it('unblocks once the previous task is done and dates it no earlier than today', () => {
    const rows = scheduleSteps(steps, '2026-07-29', {
      todayISO: '2026-08-28',
      tasksByStep: { 'step-1': task('t1', 'done', '2026-07-29') },
    })
    expect(rows[1]!.state).toBe('due')
    expect(rows[1]!.dateISO).toBe('2026-08-28')
    expect(rows[2]!.state).toBe('future')
    expect(rows[2]!.dateISO).toBe('2026-09-27')
  })

  it('takes a materialised task’s own due date over the arithmetic one', () => {
    const rows = scheduleSteps(steps, '2026-07-29', {
      todayISO: '2026-08-28',
      tasksByStep: {
        'step-1': task('t1', 'done', '2026-07-29'),
        'step-2': task('t2', 'todo', '2026-08-28'),
      },
    })
    expect(rows[1]!.state).toBe('open')
    expect(rows[1]!.dateISO).toBe('2026-08-28')
  })
})

describe('journeyProgress — the profile card line', () => {
  const entry = (tasksByStep: Record<string, JourneyTaskState>) => ({
    enrollment: {
      id: 'e1',
      contact_id: 'c1',
      template_id: 'tpl',
      started_on: '2026-08-01',
      status: 'active' as const,
      exited_reason: null,
      ended_at: null,
      assigned_to: null,
      created_by: null,
    },
    template: {
      id: 'tpl',
      key: 'new_donor_welcome',
      name: 'New donor welcome',
      description: null,
      exit_on_gift: false,
      is_active: true,
      steps: WELCOME,
    },
    tasksByStep,
  })

  it('reads "step 1 of 3" before anything is done', () => {
    const progress = journeyProgress(entry({}), { todayISO: '2026-08-28' })
    expect(progress.total).toBe(3)
    expect(progress.done).toBe(0)
    expect(progress.current).toBe(1)
    expect(progress.next?.step.step_no).toBe(1)
  })

  it('advances as steps are completed and names the next one with its date', () => {
    const progress = journeyProgress(
      entry({
        'step-1': task('t1', 'done', '2026-08-02'),
        'step-2': task('t2', 'todo', '2026-08-31'),
      }),
      { todayISO: '2026-08-28' },
    )
    expect(progress.done).toBe(1)
    expect(progress.current).toBe(2)
    expect(progress.next?.step.step_no).toBe(2)
    expect(progress.next?.dateISO).toBe('2026-08-31')
  })

  it('skips a cancelled step when looking for what is next', () => {
    const progress = journeyProgress(
      entry({
        'step-1': task('t1', 'done', '2026-08-02'),
        'step-2': task('t2', 'cancelled', '2026-08-31'),
      }),
      { todayISO: '2026-08-28' },
    )
    expect(progress.next?.step.step_no).toBe(3)
  })

  it('has no next step once every step is done', () => {
    const progress = journeyProgress(
      entry({
        'step-1': task('t1', 'done', '2026-08-02'),
        'step-2': task('t2', 'done', '2026-08-31'),
        'step-3': task('t3', 'done', '2026-10-30'),
      }),
      { todayISO: '2026-11-01' },
    )
    expect(progress.next).toBeNull()
    expect(progress.done).toBe(3)
  })
})

describe('exit_on_gift', () => {
  const template = { exit_on_gift: true }
  const enrollment = { started_on: '2026-08-01', created_at: '2026-08-01T09:00:00.000Z' }

  it('never fires for a template that does not opt in', () => {
    expect(
      exitsOnGift({ exit_on_gift: false }, enrollment, [
        { status: 'received', donated_on: '2026-08-10', created_at: '2026-08-10T09:00:00.000Z' },
      ]),
    ).toBe(false)
  })

  it('fires on a received gift given and recorded after the enrolment', () => {
    expect(
      exitsOnGift(template, enrollment, [
        { status: 'received', donated_on: '2026-08-10', created_at: '2026-08-10T09:00:00.000Z' },
      ]),
    ).toBe(true)
  })

  it('ignores the older gift that prompted the attach', () => {
    // A lapsed-reactivation journey is attached *because* they have not given
    // lately; last year's gift must not end it on the first night.
    expect(
      exitsOnGift(template, enrollment, [
        { status: 'received', donated_on: '2025-04-02', created_at: '2025-04-02T09:00:00.000Z' },
      ]),
    ).toBe(false)
  })

  it('ignores a gift back-dated into the window but entered before the enrolment', () => {
    expect(
      exitsOnGift(template, enrollment, [
        { status: 'received', donated_on: '2026-08-05', created_at: '2026-07-30T09:00:00.000Z' },
      ]),
    ).toBe(false)
  })

  it('ignores a pledged or refunded gift — only "received" counts', () => {
    expect(
      exitsOnGift(template, enrollment, [
        { status: 'refunded', donated_on: '2026-08-10', created_at: '2026-08-10T09:00:00.000Z' },
      ]),
    ).toBe(false)
  })
})
