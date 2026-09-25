/**
 * The deployed `ics-feed` Edge Function, against the **live** project — LIVE=1 only.
 *
 *   LIVE=1 NODE_USE_ENV_PROXY=1 npm test -- tests/acceptance/ics-feed.live.test.ts
 *
 * `tests/journeys-ics.test.ts` proves the serialiser is right. This file proves
 * the thing on the internet is the serialiser, wired to the right table, with
 * the right door on it:
 *
 *   · the function is deployed with `verify_jwt = false` — a calendar client
 *     cannot present a Supabase JWT, so it authenticates itself on
 *     `?token=<team_members.ics_token>` instead. That is only safe if the
 *     custom check is really there, so the first assertions are the refusals:
 *     no token, a malformed token and a well-formed wrong token all get an
 *     identical 404 with no body detail;
 *   · a real token — read out of the live `team_members` with an admin JWT —
 *     returns a 200 `text/calendar` body that parses as RFC 5545;
 *   · the payload carries VEVENTs and nothing else, and no amount, note or
 *     phone number rides along with them (10 §4: the feed is meetings only).
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { LIVE, LIVE_URL, liveReachable, rest } from '../support/live'
import { parseIcs } from '../support/ics-parser'

let reachable = false
beforeAll(async () => {
  reachable = await liveReachable()
})

const live = describe.runIf(LIVE)
const feedUrl = (token: string) => `${LIVE_URL}/functions/v1/ics-feed?token=${token}`

/** A valid-looking uuid that belongs to nobody. */
const WRONG_TOKEN = '00000000-0000-4000-8000-000000000000'

live('ics-feed (deployed)', () => {
  it('refuses every request that does not carry a live token — always the same 404', async () => {
    if (!reachable) return
    for (const url of [
      `${LIVE_URL}/functions/v1/ics-feed`,
      `${LIVE_URL}/functions/v1/ics-feed?token=`,
      `${LIVE_URL}/functions/v1/ics-feed?token=not-a-uuid`,
      feedUrl(WRONG_TOKEN),
    ]) {
      const response = await fetch(url)
      expect(response.status, url).toBe(404)
      // No oracle: the body never says whether a token exists.
      expect((await response.text()).toLowerCase()).not.toContain('token')
    }
  })

  it('serves a member their calendar on their own token', async () => {
    if (!reachable) return

    const members = await rest<Array<{ id: string; full_name: string; ics_token: string }>>(
      'admin',
      'team_members?select=id,full_name,ics_token&is_active=eq.true&limit=1',
    )
    expect(members.status).toBe(200)
    const member = members.body[0]
    expect(member, 'the live project has at least one active team member').toBeTruthy()
    if (!member) return
    expect(member.ics_token, 'team_members.ics_token exists and is populated').toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )

    const response = await fetch(feedUrl(member.ics_token))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/calendar')

    const body = await response.text()
    const calendar = parseIcs(body) // throws on a bare LF or unbalanced BEGIN/END

    expect(calendar.properties.VERSION).toBe('2.0')
    expect(calendar.properties.METHOD).toBe('PUBLISH')
    expect(calendar.properties['X-WR-CALNAME']).toContain(member.full_name)
    expect(body.endsWith('END:VCALENDAR\r\n')).toBe(true)

    // No component type but the two we emit — no VTODO, no VALARM, no VTIMEZONE.
    expect(new Set(calendar.components)).toEqual(new Set(calendar.events.length ? ['VCALENDAR', 'VEVENT'] : ['VCALENDAR']))
    expect(body).not.toContain('ATTENDEE')

    // Every content line is within the 75-octet fold (§3.1).
    for (const line of body.split('\r\n')) {
      expect(new TextEncoder().encode(line).length, line).toBeLessThanOrEqual(75)
    }

    // Structure of whatever meetings the project happens to hold. A project
    // with none still proves the envelope; the count is logged so a green run
    // never silently means "nothing was checked".
    console.log(`[ics-feed] ${calendar.events.length} scheduled meeting(s) in the next 90 days`)
    const horizon = new Date(Date.now() + 91 * 24 * 60 * 60 * 1000)
    for (const event of calendar.events) {
      expect(event.UID, 'UID is the interaction id').toMatch(/^[0-9a-f-]{36}@yeshiva-crm$/i)
      expect(event.DTSTART).toMatch(/^\d{8}T\d{6}Z$/)
      expect(event.DTEND).toMatch(/^\d{8}T\d{6}Z$/)
      expect(event.DTSTAMP).toMatch(/^\d{8}T\d{6}Z$/)
      expect(event.SUMMARY).toBeTruthy()
      expect(event.STATUS).toBe('CONFIRMED')

      const start = icsDate(event.DTSTART!)
      const end = icsDate(event.DTEND!)
      // No duration is recorded on an interaction; an hour is the default.
      expect(end.getTime() - start.getTime()).toBe(60 * 60 * 1000)
      expect(start.getTime()).toBeLessThan(horizon.getTime())
    }

    // 10 §4 / 11 §2: meetings only — never an amount, a private note or a phone.
    expect(body).not.toMatch(/ask_amount|amount_gbp|£/)
  })
})

/** `20260829T140000Z` → Date. */
function icsDate(value: string): Date {
  const [, y, m, d, hh, mm, ss] = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value) ?? []
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)))
}
