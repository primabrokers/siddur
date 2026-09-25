/**
 * A small RFC 5545 reader — **tests only**.
 *
 * Deliberately independent of the serialiser it checks: it unfolds by the
 * spec's rule (a CRLF followed by a space or tab continues the previous line),
 * splits on the first unquoted colon, and unescapes TEXT values. If the writer
 * and the reader ever agreed on a shared helper, the tests would stop proving
 * anything about the bytes Google Calendar actually receives.
 *
 * It is strict about the two things a calendar client is strict about: it
 * refuses a payload with a bare LF, and it refuses one whose BEGIN/END blocks
 * do not nest.
 */

export interface IcsCalendar {
  /** Top-level VCALENDAR properties, last value wins. */
  properties: Record<string, string>
  /** One record per VEVENT, property name → unescaped value. */
  events: Array<Record<string, string>>
  /** Every component type seen, e.g. `['VCALENDAR', 'VEVENT']`. */
  components: string[]
}

/** Undo §3.3.11 escaping. `\\` last, or an escaped backslash would cascade. */
function unescapeText(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = value[i + 1]
    i += 1
    if (next === 'n' || next === 'N') out += '\n'
    else if (next === undefined) out += '\\'
    else out += next
  }
  return out
}

/** Unfold: CRLF + (space | tab) continues the line it follows (§3.1). */
export function unfold(body: string): string[] {
  if (/(?<!\r)\n/.test(body)) throw new Error('ICS payload contains a bare LF; every line must end CRLF')
  return body
    .replace(/\r\n[ \t]/g, '')
    .split('\r\n')
    .filter((line) => line !== '')
}

export function parseIcs(body: string): IcsCalendar {
  const lines = unfold(body)
  if (lines[0] !== 'BEGIN:VCALENDAR') throw new Error('ICS payload does not begin with VCALENDAR')

  const calendar: IcsCalendar = { properties: {}, events: [], components: [] }
  const stack: string[] = []
  let current: Record<string, string> | null = null

  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon < 0) throw new Error(`content line has no value: ${line}`)
    // `NAME;PARAM=x` — parameters are not needed by these tests, only the name.
    const name = line.slice(0, colon).split(';')[0] as string
    const value = line.slice(colon + 1)

    if (name === 'BEGIN') {
      stack.push(value)
      calendar.components.push(value)
      if (value === 'VEVENT') current = {}
      continue
    }

    if (name === 'END') {
      const opened = stack.pop()
      if (opened !== value) throw new Error(`END:${value} does not close BEGIN:${opened ?? 'nothing'}`)
      if (value === 'VEVENT' && current) {
        calendar.events.push(current)
        current = null
      }
      continue
    }

    if (current) current[name] = unescapeText(value)
    else calendar.properties[name] = unescapeText(value)
  }

  if (stack.length > 0) throw new Error(`unclosed component: ${stack.join(' > ')}`)
  return calendar
}
