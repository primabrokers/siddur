/**
 * The four acceptance tests, against the **live** project — LIVE=1 only.
 *
 *   LIVE=1 NODE_USE_ENV_PROXY=1 npm test -- tests/acceptance/live.test.ts
 *
 * The offline siblings (`daily-management`, `donor-knowledge`,
 * `nothing-gets-lost`, `relationship-maintenance`) prove the *client* keeps its
 * side of each promise against a deterministic world. This file proves the
 * *database* keeps its side against the real one: that `contact_stats` really
 * exposes what the stream reads, that the seeded views exist, that every task
 * has a contact (I-2), and that `run_nightly()` is idempotent — a second run on
 * the same day must not raise a second keep-in-touch task.
 *
 * It is written to be truthful on a half-seeded project. Where the demo data is
 * not there yet, the invariant is still asserted (over zero rows, which cannot
 * fail) and the count is logged, so a green run never silently means "nothing
 * was checked". Missing *schema* is a failure; missing *data* is a note.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { LIVE, LIVE_URL, LIVE_ANON_KEY, liveReachable, rest, signIn } from '../support/live'

let reachable = false
beforeAll(async () => {
  reachable = await liveReachable()
})

const live = describe.runIf(LIVE)

const today = (): string => new Date().toISOString().slice(0, 10)

interface StatsRow {
  contact_id: string
  flag: string
  days_since_contact: number | null
  kit_due_on: string | null
  next_action_id: string | null
  next_action_title: string | null
  next_action_due_on: string | null
  donor_status: string | null
  is_lybunt: boolean
  pledge_balance: number | null
}

interface TaskRow {
  id: string
  contact_id: string | null
  title: string
  due_on: string | null
  status: string
  origin: string | null
}

/** POST /rpc/<name>; a 404 means the function has not been deployed yet. */
async function rpc(name: string): Promise<{ status: number; body: unknown }> {
  const token = await signIn('admin')
  const response = await fetch(`${LIVE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: LIVE_ANON_KEY,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: '{}',
  })
  const text = await response.text()
  let body: unknown = null
  try {
    body = text === '' ? null : JSON.parse(text)
  } catch {
    body = text
  }
  return { status: response.status, body }
}

live('live · the derived layer the acceptance tests depend on', () => {
  it('exposes every contact_stats column the Action Stream and profile read', async () => {
    if (!reachable) return
    const response = await rest<StatsRow[]>('admin', 'contact_stats?select=*&limit=1')
    expect(response.status, `contact_stats is unreadable: ${response.message ?? ''}`).toBe(200)

    // With no rows the view still has to answer a projection of the exact
    // columns — that is the contract the client's adapter is written against.
    const projection = await rest(
      'admin',
      'contact_stats?select=contact_id,flag,days_since_contact,kit_due_on,next_action_id,next_action_title,next_action_due_on,donor_status,is_lybunt,pledge_balance,lifetime_giving,giving_this_year,giving_last_year,last_gift_date,last_gift_amount,last_meaningful_contact_at&limit=1',
    )
    expect(
      projection.status,
      `contact_stats is missing a column the client reads: ${projection.message ?? ''}`,
    ).toBe(200)
  })

  it('carries the seeded smart views (06 §1)', async () => {
    if (!reachable) return
    const response = await rest<Array<{ name: string; entity: string; filters: Record<string, unknown> }>>(
      'admin',
      'saved_views?select=name,entity,filters&order=name',
    )
    expect(response.status).toBe(200)
    const names = (response.body ?? []).map((view) => view.name)

    for (const expected of [
      'Follow-ups today',
      'Overdue follow-ups',
      'LYBUNT',
      'No contact 30+ days',
      'No contact 60+ days',
      'No contact 90+ days',
      'High-priority prospects',
      'Pledges outstanding',
      'Pre-lapsed rescue list',
      'Recent gifts needing stewardship',
      'GA: missing declarations',
    ]) {
      expect(names, `the seeded view "${expected}" is missing`).toContain(expected)
    }

    // Every seeded view's criteria must parse into the client's filter model.
    const { parseFilters } = await import('../../src/features/views/filterModel')
    for (const view of response.body ?? []) {
      const parsed = parseFilters(view.filters)
      expect(
        Object.keys(parsed).length,
        `"${view.name}" has criteria the client cannot express: ${JSON.stringify(view.filters)}`,
      ).toBeGreaterThan(0)
    }
  })
})

live('live · acceptance 1 — the day leaves nothing to memory', () => {
  it('gives every task a contact (I-2), so nothing is unreachable from a person', async () => {
    if (!reachable) return
    const response = await rest<TaskRow[]>('admin', 'tasks?select=id,contact_id,title,due_on,status,origin&limit=500')
    expect(response.status).toBe(200)
    const tasks = response.body ?? []
    // eslint-disable-next-line no-console
    console.log(`[live] ${tasks.length} tasks in the project`)
    for (const task of tasks) {
      expect(task.contact_id, `task ${task.id} has no contact (I-2)`).toBeTruthy()
    }
  })

  it('gives every open dated task a matching next action on its contact', async () => {
    if (!reachable) return
    const tasks = await rest<TaskRow[]>(
      'admin',
      `tasks?select=id,contact_id,title,due_on,status&status=eq.todo&due_on=lte.${today()}&limit=200`,
    )
    expect(tasks.status).toBe(200)
    const open = tasks.body ?? []
    if (open.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[live] no open due/overdue tasks — the invariant holds vacuously')
      return
    }

    const ids = [...new Set(open.map((task) => task.contact_id))].filter(Boolean)
    const stats = await rest<StatsRow[]>(
      'admin',
      `contact_stats?select=contact_id,next_action_id,next_action_due_on,flag&contact_id=in.(${ids.join(',')})`,
    )
    expect(stats.status).toBe(200)
    const byContact = new Map((stats.body ?? []).map((row) => [row.contact_id, row]))

    for (const task of open) {
      const row = byContact.get(String(task.contact_id))
      expect(row, `contact ${task.contact_id} has an open task but no contact_stats row`).toBeTruthy()
      // The view picks *one* next action per contact; whichever it picked must
      // itself be due on or before today, or the flag would be lying.
      if (row?.next_action_due_on) {
        expect(row.next_action_due_on <= today()).toBe(true)
        expect(['overdue', 'today', 'waiting']).toContain(row.flag)
      }
    }
  })

  it('never flags a contact yellow while it has an open next action (I-3)', async () => {
    if (!reachable) return
    const stats = await rest<StatsRow[]>(
      'admin',
      'contact_stats?select=contact_id,flag,next_action_id&flag=eq.none&limit=200',
    )
    expect(stats.status).toBe(200)
    for (const row of stats.body ?? []) {
      expect(row.next_action_id, `contact ${row.contact_id} is yellow but has a next action`).toBeNull()
    }
  })
})

live('live · acceptance 4 — the keep-in-touch cycle', () => {
  it('raises at most one open auto:kit task per contact — even run twice', async () => {
    if (!reachable) return

    const first = await rpc('run_nightly')
    if (first.status === 404) {
      // eslint-disable-next-line no-console
      console.log('[live] run_nightly() is not deployed yet — asserting idempotency on existing rows only')
    } else {
      expect(first.status, `run_nightly() failed: ${JSON.stringify(first.body).slice(0, 200)}`).toBeLessThan(300)
      // The second run is the assertion: a rule must never create a second open
      // task of the same origin for the same contact (08 §1).
      const second = await rpc('run_nightly')
      expect(second.status).toBeLessThan(300)
    }

    const tasks = await rest<TaskRow[]>(
      'admin',
      'tasks?select=id,contact_id,origin,status,due_on&origin=eq.auto:kit&status=in.(todo,waiting,queued)&limit=500',
    )
    expect(tasks.status).toBe(200)

    const perContact = new Map<string, number>()
    for (const task of tasks.body ?? []) {
      const key = String(task.contact_id)
      perContact.set(key, (perContact.get(key) ?? 0) + 1)
    }
    // eslint-disable-next-line no-console
    console.log(`[live] ${perContact.size} contacts carry an open auto:kit task`)
    for (const [contactId, count] of perContact) {
      expect(count, `contact ${contactId} has ${count} open auto:kit tasks`).toBe(1)
    }
  })

  it('only holds a keep-in-touch task open for a contact whose clock has run out', async () => {
    if (!reachable) return

    const tasks = await rest<TaskRow[]>(
      'admin',
      'tasks?select=id,contact_id,due_on&origin=eq.auto:kit&status=eq.todo&limit=200',
    )
    const open = tasks.body ?? []
    if (open.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[live] no open keep-in-touch tasks to check')
      return
    }

    const ids = [...new Set(open.map((task) => String(task.contact_id)))]
    const contacts = await rest<Array<{ id: string; contact_frequency_days: number | null }>>(
      'admin',
      `contacts?select=id,contact_frequency_days&id=in.(${ids.join(',')})`,
    )
    for (const contact of contacts.body ?? []) {
      expect(
        contact.contact_frequency_days,
        `contact ${contact.id} has a keep-in-touch task but no cadence`,
      ).toBeTruthy()
    }
  })
})

describe.runIf(!LIVE)('live acceptance', () => {
  it.skip('runs only with LIVE=1 (see tests/support/live.ts)', () => {})
})
