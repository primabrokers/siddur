/**
 * RFC 5545 serialisation — the whole of it that a read-only feed needs.
 *
 * Kept as a **pure module with no Deno globals** for one reason: the vitest
 * suite (`crm/tests/journeys-ics.test.ts`) imports this exact file, so the
 * escaping, the folding and the CRLF endings that Google Calendar sees are the
 * ones under test. `index.ts` adds authentication and the database read and
 * nothing else.
 *
 * The three rules that break calendars when they are got wrong:
 *   §3.1 — every line ends CRLF, and no line exceeds 75 **octets**; longer
 *          lines are folded onto a continuation beginning with one space.
 *   §3.3.11 — inside a TEXT value, `\` `;` `,` and newlines are escaped. A
 *          colon is *not* escaped (a common and harmless-looking mistake that
 *          makes Outlook drop the property).
 *   §3.3.5 — UTC date-times are `YYYYMMDDTHHMMSSZ`, no punctuation.
 */

/** UTF-8 length of one code point, without allocating a buffer. */
function octets(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0
  if (cp < 0x80) return 1
  if (cp < 0x800) return 2
  if (cp < 0x10000) return 3
  return 4
}

/**
 * Fold one content line to 75 octets (§3.1). Continuations carry a leading
 * space, which counts toward the 75 — hence the 74 budget after the first
 * line. Folding happens between code points, never inside one, so a Hebrew
 * name or a curly quote survives the split.
 */
export function foldLine(line: string): string {
  const parts: string[] = []
  let current = ''
  let used = 0
  let limit = 75

  for (const ch of line) {
    const size = octets(ch)
    if (used + size > limit) {
      parts.push(current)
      current = ''
      used = 0
      limit = 74
    }
    current += ch
    used += size
  }
  parts.push(current)
  return parts.join('\r\n ')
}

/** Escape a TEXT value (§3.3.11). Backslash first, or the others double-escape. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
    // Control characters are not valid in a TEXT value; drop rather than mangle.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
}

/** `20260901T140000Z` (§3.3.5). Always UTC — no VTIMEZONE to get wrong. */
export function toIcsUtc(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new RangeError(`not a date: ${String(value)}`)
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  )
}

export interface IcsEvent {
  /** Stable for the life of the meeting — the interaction's id. */
  uid: string
  start: Date | string
  end: Date | string
  summary: string
  description?: string | null
  location?: string | null
  url?: string | null
  /** CONFIRMED (scheduled) · CANCELLED. */
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED'
}

export interface CalendarOptions {
  /** X-WR-CALNAME — what the subscriber sees in their calendar list. */
  name: string
  description?: string
  /** PRODID (§3.7.3). */
  prodId?: string
  /** DTSTAMP for every event; injectable so tests are deterministic. */
  stamp?: Date
}

const prop = (name: string, value: string): string => foldLine(`${name}:${value}`)

function event(item: IcsEvent, stamp: string): string[] {
  const lines = [
    'BEGIN:VEVENT',
    prop('UID', escapeText(item.uid)),
    prop('DTSTAMP', stamp),
    prop('DTSTART', toIcsUtc(item.start)),
    prop('DTEND', toIcsUtc(item.end)),
    prop('SUMMARY', escapeText(item.summary)),
  ]
  if (item.description) lines.push(prop('DESCRIPTION', escapeText(item.description)))
  if (item.location) lines.push(prop('LOCATION', escapeText(item.location)))
  // URL is a URI value, not TEXT: escaping it would corrupt the query string.
  if (item.url) lines.push(prop('URL', item.url))
  lines.push(prop('STATUS', item.status ?? 'CONFIRMED'))
  lines.push('END:VEVENT')
  return lines
}

/**
 * A complete VCALENDAR. Read-only by construction: `METHOD:PUBLISH` and no
 * ATTENDEE lines, so no calendar client ever emails a donor an invitation
 * (I-10 — automations never send).
 */
export function buildCalendar(events: IcsEvent[], options: CalendarOptions): string {
  const stamp = toIcsUtc(options.stamp ?? new Date())
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    prop('PRODID', options.prodId ?? '-//Yeshiva Donor CRM//Calendar feed//EN'),
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    prop('X-WR-CALNAME', escapeText(options.name)),
    // Hint to Google/Apple how often to re-fetch; both honour one of the two.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ]
  if (options.description) lines.push(prop('X-WR-CALDESC', escapeText(options.description)))
  for (const item of events) lines.push(...event(item, stamp))
  lines.push('END:VCALENDAR')
  return `${lines.join('\r\n')}\r\n`
}

/**
 * Constant-time string comparison for the feed token. Not `===`: a naive
 * compare returns early on the first differing byte, which leaks the shared
 * prefix length to anyone who can time the request.
 */
export function tokensMatch(a: string, b: string): boolean {
  // Compare a fixed number of characters so the loop count never depends on
  // where the strings diverge; the length check is folded into the result.
  const length = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}
