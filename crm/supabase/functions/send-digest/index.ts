/**
 * `send-digest` — the morning digest (08 §6) with the 09 §5 narrative on top.
 *
 * **The numbers are SQL's; the model writes two sentences.** Every section is
 * assembled by the queries below — meetings today, next actions due grouped by
 * type, overdue (count + top three), signals on my contacts, keep-in-touch due.
 * The model is handed those counts and asked for a two-sentence narrative. If
 * there is no API key, or the call fails, the digest goes out without it: the
 * narrative never blocks delivery (09 §5).
 *
 * **A quiet day sends two lines, never silence** (08 §6). The habit is the
 * product; a digest that skips itself teaches the reader to stop opening it.
 *
 * **Two callers, two behaviours.**
 * - *Service role* (the hourly `crm_digest_tick()` POST, or the dashboard
 *   schedule): composes for every active member whose `digest_hour` matches the
 *   requested UTC hour, writes `digest_log`, and sends mail when
 *   `RESEND_API_KEY` is set. The read side runs as the service role because a
 *   cron job has no user; the per-member scoping is in the queries themselves,
 *   and no section carries a money figure, so nothing here can leak an amount
 *   past `can_see_amounts` (11 §2).
 * - *A signed-in member*: a **preview of their own digest only**. Nothing is
 *   written and nothing is sent — a person looking at tomorrow's digest must
 *   not consume today's once-a-day slot.
 *
 * Note the deliberate asymmetry with `donor-brief` and `draft-message`: this
 * function does **not** return 503 without an API key. Per 09 §5 the digest is
 * SQL plus an optional sentence, so a missing key removes the sentence and
 * nothing else.
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.122.0'
import { createClient } from 'npm:@supabase/supabase-js@2.58.0'
import { composeDigest, digestSubject, digestText } from './core.ts'
import type { DigestPayload, DigestTask } from './core.ts'

/* ------------------------------------------------------------------ config */

const MODEL = 'claude-opus-5'
const MAX_TOKENS = 400
/** Past this the digest stops being a digest. */
const SECTION_LIMIT = 25

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })

const NARRATIVE_SYSTEM = `You write the two-sentence opening of a fundraiser's morning digest for an Anglo-charedi yeshiva in the UK.

Rules:
- Exactly two sentences. No greeting, no sign-off, no lists, no markdown.
- Use only the counts and names supplied. Never invent a number, a name or an event.
- Name at most two people, and only when a specific one is worth naming.
- Plain British English. Direct, unhurried, no cheerleading and no urgency theatre.
- Say what today asks for, then the one thing most at risk of being missed.`

/* ----------------------------------------------------------------- helpers */

interface Row {
  [key: string]: unknown
}

const rows = (result: { data: unknown }): Row[] => (Array.isArray(result.data) ? (result.data as Row[]) : [])

const isoDay = (date: Date): string => date.toISOString().slice(0, 10)

const addDays = (day: string, delta: number): string => {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + delta)
  return isoDay(date)
}

const daysBetween = (from: string | null, to: string): number => {
  if (!from) return 0
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

/** The `role` claim of the bearer token — `service_role` for the cron caller. */
function tokenRole(authorization: string): string {
  try {
    const token = authorization.replace(/^Bearer\s+/i, '')
    const payload = token.split('.')[1]
    if (!payload) return ''
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return String((JSON.parse(decoded) as { role?: unknown }).role ?? '')
  } catch {
    return ''
  }
}

/* --------------------------------------------------------------- one member */

interface MemberRow {
  id: string
  full_name: string
  email: string | null
  digest_hour: number
  digest_channel: string | null
}

async function gather(
  db: ReturnType<typeof createClient>,
  member: MemberRow,
  today: string,
  appUrl: string,
): Promise<DigestPayload> {
  const tomorrow = addDays(today, 1)

  const [meetingRows, taskRows, ownedRows] = await Promise.all([
    db
      .from('interactions')
      .select('contact_id, occurred_at, summary, location')
      .eq('team_member_id', member.id)
      .eq('status', 'scheduled')
      .gte('occurred_at', `${today}T00:00:00Z`)
      .lt('occurred_at', `${tomorrow}T00:00:00Z`)
      .order('occurred_at', { ascending: true })
      .limit(SECTION_LIMIT),
    db
      .from('tasks')
      .select('id, contact_id, title, action_type, due_on, status')
      .eq('assigned_to', member.id)
      .in('status', ['todo', 'waiting'])
      .not('due_on', 'is', null)
      .lte('due_on', today)
      .order('due_on', { ascending: true })
      .limit(SECTION_LIMIT * 4),
    // "signals for my contacts" and "KIT due" are both scoped by ownership, so
    // the owned-contact id list is fetched once and reused.
    db
      .from('contacts')
      .select('id, title, first_name, last_name, organization')
      .eq('relationship_owner_id', member.id)
      .eq('is_archived', false)
      .is('merged_into_id', null)
      .limit(2000),
  ])

  const owned = rows(ownedRows)
  const ownedIds = owned.map((row) => String(row.id))

  const [signalRows, kitRows] = await Promise.all([
    ownedIds.length > 0
      ? db
          .from('signals')
          .select('contact_id, rule_key, reason, created_at')
          .eq('state', 'open')
          .in('contact_id', ownedIds)
          .order('created_at', { ascending: false })
          .limit(SECTION_LIMIT)
      : Promise.resolve({ data: [] }),
    ownedIds.length > 0
      ? db
          .from('contact_stats')
          .select('contact_id, kit_due_on')
          .in('contact_id', ownedIds)
          .not('kit_due_on', 'is', null)
          .lte('kit_due_on', today)
          .order('kit_due_on', { ascending: true })
          .limit(SECTION_LIMIT)
      : Promise.resolve({ data: [] }),
  ])

  // Names for every contact any section mentions — the digest deep-links people,
  // not ids (08 §6).
  const wanted = new Set<string>([
    ...rows(meetingRows).map((row) => String(row.contact_id)),
    ...rows(taskRows).map((row) => String(row.contact_id)),
  ])
  for (const row of owned) wanted.delete(String(row.id))
  const extra =
    wanted.size > 0
      ? rows(
          await db
            .from('contacts')
            .select('id, title, first_name, last_name, organization')
            .in('id', [...wanted]),
        )
      : []

  const names = new Map<string, string>()
  for (const row of [...owned, ...extra]) {
    const name =
      [row.title, row.first_name, row.last_name].filter(Boolean).join(' ').trim() ||
      String(row.organization ?? '') ||
      'Unnamed contact'
    names.set(String(row.id), name)
  }
  const nameOf = (id: unknown): string => names.get(String(id)) ?? 'Unnamed contact'

  const tasks = rows(taskRows)
  const dueToday: DigestTask[] = []
  const overdue: DigestTask[] = []
  for (const row of tasks) {
    const dueOn = (row.due_on as string | null) ?? null
    const task: DigestTask = {
      id: String(row.id),
      contact_id: String(row.contact_id),
      contact_name: nameOf(row.contact_id),
      title: String(row.title ?? 'Untitled task'),
      action_type: String(row.action_type ?? 'other'),
      due_on: dueOn,
      days_overdue: daysBetween(dueOn, today),
    }
    if (dueOn === today) dueToday.push(task)
    else overdue.push(task)
  }

  return composeDigest({
    member: { id: member.id, full_name: member.full_name, email: member.email },
    today,
    meetings: rows(meetingRows).map((row) => ({
      contact_id: String(row.contact_id),
      contact_name: nameOf(row.contact_id),
      at: String(row.occurred_at ?? ''),
      summary: (row.summary as string | null) ?? null,
      location: (row.location as string | null) ?? null,
    })),
    dueToday,
    overdue,
    signals: rows(signalRows).map((row) => ({
      contact_id: String(row.contact_id),
      contact_name: nameOf(row.contact_id),
      rule_key: String(row.rule_key ?? ''),
      reason: String(row.reason ?? ''),
    })),
    kitDue: rows(kitRows).map((row) => ({
      contact_id: String(row.contact_id),
      contact_name: nameOf(row.contact_id),
      due_on: (row.kit_due_on as string | null) ?? null,
    })),
    appUrl,
  })
}

/** Two sentences, or nothing at all. Never throws into the delivery path. */
async function narrate(payload: DigestPayload, apiKey: string | undefined): Promise<string | null> {
  if (!apiKey) return null
  if (payload.quiet) return null
  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: 'low' },
      system: NARRATIVE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            `Today is ${payload.date}. You are writing for ${payload.member_name}.`,
            '',
            'COUNTS AND NAMES (the only things you know):',
            JSON.stringify(
              {
                counts: payload.counts,
                meetings: payload.meetings.map((m) => ({ who: m.contact_name, at: m.at })),
                due_by_type: payload.due_by_type.map((g) => ({ type: g.label, n: g.items.length })),
                overdue_top: payload.overdue_top.map((t) => ({
                  who: t.contact_name,
                  what: t.title,
                  days_late: t.days_overdue,
                })),
                signals: payload.signals.slice(0, 5).map((s) => ({ who: s.contact_name, why: s.reason })),
                keep_in_touch: payload.kit_due.slice(0, 5).map((k) => k.contact_name),
              },
              null,
              1,
            ),
          ].join('\n'),
        },
      ],
    })
    if (response.stop_reason === 'refusal') return null
    const text = (response.content as Array<{ type: string; text?: string }>)
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('')
      .trim()
    return text === '' ? null : text
  } catch (caught) {
    // 09 §5: "Failure → digest sends without narrative. Never blocks delivery."
    console.error('[send-digest] narrative skipped:', caught instanceof Error ? caught.message : caught)
    return null
  }
}

async function sendEmail(
  to: string,
  subject: string,
  text: string,
): Promise<{ ok: boolean; error: string | null }> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return { ok: false, error: 'no_provider' }
  const from = Deno.env.get('DIGEST_FROM') ?? 'CRM digest <onboarding@resend.dev>'
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
    })
    if (!response.ok) return { ok: false, error: `resend_${response.status}: ${(await response.text()).slice(0, 300)}` }
    return { ok: true, error: null }
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : 'send failed' }
  }
}

/* --------------------------------------------------------------- the handler */

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const authorization = req.headers.get('Authorization') ?? ''
  if (authorization === '') return json(401, { error: 'unauthorized' })

  let body: { hour?: unknown; member_id?: unknown; today?: unknown; scheduled?: unknown } = {}
  try {
    const raw = await req.text()
    if (raw.trim() !== '') body = JSON.parse(raw)
  } catch {
    return json(400, { error: 'bad_request', message: 'Body must be JSON.' })
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  const appUrl = Deno.env.get('APP_BASE_URL') ?? 'http://localhost:5180'
  const now = new Date()
  const today = typeof body.today === 'string' && body.today !== '' ? body.today : isoDay(now)
  const hour = typeof body.hour === 'number' ? body.hour : now.getUTCHours()

  const isService = tokenRole(authorization) === 'service_role'

  try {
    /* ------------------------------------------------- a member's own preview */

    if (!isService) {
      const caller = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } },
      )
      const { data: userData } = await caller.auth.getUser()
      const viewerId = userData?.user?.id ?? null
      if (!viewerId) return json(401, { error: 'unauthorized' })

      const member = await caller
        .from('team_members')
        .select('id, full_name, email, digest_hour, digest_channel')
        .eq('id', viewerId)
        .maybeSingle()
      if (!member.data) return json(403, { error: 'not_a_member' })

      const payload = await gather(caller, member.data as unknown as MemberRow, today, appUrl)
      const narrative = await narrate(payload, apiKey)
      return json(200, {
        preview: true,
        // Nothing written and nothing sent: a preview must not consume the
        // member's once-a-day digest_log slot.
        delivery: 'preview',
        narrative,
        narrative_available: Boolean(apiKey),
        subject: digestSubject(payload),
        body_text: digestText(payload, narrative, appUrl),
        payload,
      })
    }

    /* ------------------------------------------------------- the scheduled run */

    const db = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    )

    let query = db
      .from('team_members')
      .select('id, full_name, email, digest_hour, digest_channel')
      .eq('is_active', true)
    query = typeof body.member_id === 'string' && body.member_id !== ''
      ? query.eq('id', body.member_id)
      : query.eq('digest_hour', hour)

    const members = rows(await query) as unknown as MemberRow[]
    const results: Array<Record<string, unknown>> = []

    for (const member of members) {
      const payload = await gather(db, member, today, appUrl)
      const narrative = await narrate(payload, apiKey)
      const subject = digestSubject(payload)
      const text = digestText(payload, narrative, appUrl)

      let delivery = 'log'
      let error: string | null = null
      let deliveredAt: string | null = null

      if (member.email && member.digest_channel !== 'none') {
        const sent = await sendEmail(member.email, subject, text)
        if (sent.ok) {
          delivery = 'email'
          deliveredAt = new Date().toISOString()
        } else if (sent.error !== 'no_provider') {
          delivery = 'failed'
          error = sent.error
        }
      }

      // Upsert on (team_member_id, digest_on): the unique index is the
      // once-a-day idempotency key, so a double tick rewrites rather than
      // double-sends a row.
      await db.from('digest_log').upsert(
        {
          team_member_id: member.id,
          digest_on: today,
          payload: payload as never,
          narrative,
          subject,
          body_text: text,
          delivery,
          delivered_at: deliveredAt,
          error,
        },
        { onConflict: 'team_member_id,digest_on' },
      )

      if (narrative) {
        // The narrative is L0 and goes out unreviewed — there is no accept/reject
        // surface on an email — so the row stays `pending`. Settings' edit rate
        // is accepted-vs-edited, which a pending row does not distort (09 §1.5).
        await db.from('ai_activity_log').insert({
          feature: 'digest',
          model: MODEL,
          raw_input: `digest:${today}`,
          output: { narrative, counts: payload.counts } as never,
          resolution: 'pending',
          team_member_id: member.id,
        })
      }

      results.push({
        team_member_id: member.id,
        quiet: payload.quiet,
        delivery,
        error,
        narrative: Boolean(narrative),
      })
    }

    return json(200, { hour, today, members: members.length, results })
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Unknown error'
    console.error('[send-digest]', message)
    return json(500, { error: 'digest_failed', message })
  }
})
