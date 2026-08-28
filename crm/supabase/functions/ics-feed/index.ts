/**
 * `ics-feed` — the read-only calendar feed (10 §4).
 *
 * One URL per team member, no OAuth, nothing to install: paste it into Google
 * Calendar's "From URL" box and every scheduled CRM meeting appears within the
 * refresh window. `[P2]` in the integration register precisely because it is
 * the cheap tier — two-way sync stays a decision point (10 §8).
 *
 * ## Why `verify_jwt = false`
 *
 * A calendar client cannot present a Supabase JWT. Google fetches the URL from
 * its own servers, unauthenticated, on its own schedule. So the gateway's JWT
 * check is turned off and this function implements its **own** authentication:
 * the URL carries `?token=<team_members.ics_token>` — a v4 uuid, unguessable,
 * per member, revocable from Settings — matched with a constant-time compare.
 * Anything that does not match gets an identical **404** with no body detail,
 * so the endpoint cannot be used to confirm that a token exists.
 *
 * That makes the token a bearer credential in a URL, which is the accepted
 * trade of every ICS feed ever shipped (Google, Outlook, Basecamp): the
 * mitigation is scope, not secrecy. The feed carries meetings only — never an
 * amount, never a private note, never a phone number — and it is read-only:
 * there is no code path here that writes.
 *
 * ## Why the service role, and what stops it over-sharing
 *
 * There is no user JWT to forward, so the query runs with the service-role key
 * and therefore **bypasses RLS**. It is scoped by hand to exactly what the
 * matched member could read for themselves under 11 §2:
 *
 *   `interactions` policy (002_rls.sql) — `select … using (crm_is_member())`.
 *   Every active team member may read every interaction; there is no per-owner
 *   restriction on that table. So "all scheduled interactions" *is* the
 *   RLS-equivalent answer for any active member, and inactive members are
 *   refused here because `crm_is_member()` would refuse them too.
 *
 * If that policy ever narrows (say interactions become owner-scoped), this
 * function must narrow with it — the equivalence is asserted by hand, and this
 * comment is the only thing holding it. Columns are listed explicitly for the
 * same reason: `select *` would silently start publishing `ask_amount` the day
 * someone adds a field.
 */

import { buildCalendar, tokensMatch, type IcsEvent } from './ics.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
/** Optional: makes each event link back to the donor profile. */
const APP_URL = (Deno.env.get('CRM_APP_URL') ?? '').replace(/\/+$/, '')

/** 10 §4 — "every scheduled CRM meeting"; a quarter ahead is the useful window. */
const WINDOW_DAYS = 90
const HOUR_MS = 60 * 60 * 1000

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
}

/** Every rejection looks the same from outside: no oracle, no timing tell. */
const notFound = (): Response =>
  new Response('Not found\n', {
    status: 404,
    headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })

interface MemberRow {
  id: string
  full_name: string
  ics_token: string
}

interface InteractionRow {
  id: string
  contact_id: string
  occurred_at: string
  kind: string | null
  summary: string | null
  location: string | null
  purpose: string | null
}

interface ContactRow {
  id: string
  first_name: string | null
  last_name: string | null
  organization: string | null
}

async function rest<T>(path: string): Promise<T[]> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      accept: 'application/json',
    },
  })
  if (!response.ok) throw new Error(`postgrest ${response.status}: ${await response.text()}`)
  return (await response.json()) as T[]
}

const KIND_LABEL: Record<string, string> = {
  call: 'Call',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
  meeting: 'Meeting',
  event: 'Event',
  letter: 'Letter',
  video_call: 'Video call',
  receipt_sent: 'Receipt',
  other: 'Meeting',
}

function contactName(contact: ContactRow | undefined): string {
  if (!contact) return 'a contact'
  const person = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim()
  return person || contact.organization || 'a contact'
}

/** uuid v4 shape. Cheap filter so a junk token never reaches the table. */
const looksLikeToken = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed\n', {
      status: 405,
      headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD, OPTIONS' },
    })
  }

  if (SUPABASE_URL === '' || SERVICE_KEY === '') {
    console.error('ics-feed: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
    return new Response('Unavailable\n', { status: 503, headers: CORS })
  }

  const token = new URL(request.url).searchParams.get('token') ?? ''
  if (!looksLikeToken(token)) return notFound()

  try {
    /* ------------------------------------------------------ authenticate */
    // The whole (tiny) active roster is fetched and every row compared, so the
    // work done is independent of which token was supplied — an eq-filter on
    // the token would push the comparison into an index and time it for us.
    const members = await rest<MemberRow>(
      'team_members?select=id,full_name,ics_token&is_active=eq.true',
    )
    let member: MemberRow | null = null
    for (const candidate of members) {
      if (tokensMatch(candidate.ics_token ?? '', token)) member = candidate
    }
    if (!member) return notFound()

    /* ------------------------------------------------------------- read */
    const from = new Date()
    from.setUTCHours(0, 0, 0, 0) // keep today's earlier meetings visible
    const to = new Date(from.getTime() + WINDOW_DAYS * 24 * HOUR_MS)

    const interactions = await rest<InteractionRow>(
      'interactions?select=id,contact_id,occurred_at,kind,summary,location,purpose' +
        '&status=eq.scheduled' +
        `&occurred_at=gte.${from.toISOString()}` +
        `&occurred_at=lte.${to.toISOString()}` +
        '&order=occurred_at.asc&limit=1000',
    )

    const contactIds = [...new Set(interactions.map((row) => row.contact_id))]
    const contacts = contactIds.length
      ? await rest<ContactRow>(
          `contacts?select=id,first_name,last_name,organization&id=in.(${contactIds.join(',')})`,
        )
      : []
    const byId = new Map(contacts.map((row) => [row.id, row]))

    /* ------------------------------------------------------------ render */
    const events: IcsEvent[] = interactions.map((row) => {
      const who = contactName(byId.get(row.contact_id))
      const start = new Date(row.occurred_at)
      const kind = KIND_LABEL[row.kind ?? 'meeting'] ?? 'Meeting'
      const description = [row.purpose, row.summary].filter(Boolean).join('\n') || null
      return {
        uid: `${row.id}@yeshiva-crm`,
        start,
        // Interactions carry no duration; an hour is the honest default and
        // the block is what the fundraiser actually needs to see.
        end: new Date(start.getTime() + HOUR_MS),
        summary: `${kind} — ${who}`,
        description,
        location: row.location,
        url: APP_URL ? `${APP_URL}/contacts/${row.contact_id}` : null,
        status: 'CONFIRMED',
      }
    })

    const body = buildCalendar(events, {
      name: `Yeshiva CRM — ${member.full_name}`,
      description: 'Scheduled meetings from the Yeshiva Donor CRM. Read-only.',
    })

    const headers = {
      ...CORS,
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="yeshiva-crm.ics"',
      // Google re-fetches on its own schedule; a short cache protects the API
      // without making the feed feel stale.
      'cache-control': 'public, max-age=900',
    }
    return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers })
  } catch (error) {
    console.error('ics-feed failed:', error)
    return new Response('Unavailable\n', {
      status: 503,
      headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8' },
    })
  }
})
