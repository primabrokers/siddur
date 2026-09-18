/**
 * RLS conformance (spec 11 §1's capability matrix) — **LIVE=1 only**.
 *
 *   LIVE=1 NODE_USE_ENV_PROXY=1 npm test -- tests/acceptance/rls.live.test.ts
 *
 * Every assertion here is made against PostgREST with a real role's JWT, never
 * through the app's client, because the claim being tested is 11 §2's:
 * "the API physically cannot return what a role may not see; the UI only
 * reflects permissions, never implements them." A test that went through the
 * UI would prove the opposite of what it set out to.
 *
 * Two kinds of refusal both count, and the tests accept either, because
 * Postgres expresses them differently:
 *  - a **write** blocked by a policy returns `42501`;
 *  - a **read** blocked by a policy returns 200 with *no rows* — the row is
 *    not hidden from the response, it is not in the result set at all.
 *
 * Test credentials are documented in `tests/support/live.ts`. The viewer
 * (`viewer@demo.test`, `can_see_amounts = false`) is created by M5's seed step
 * if the database agent has not already made one.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { LIVE, LIVE_USERS, liveReachable, rest, signIn, userId } from '../support/live'

let reachable = false
beforeAll(async () => {
  reachable = await liveReachable()
})

const live = describe.runIf(LIVE)

live('RLS · roles and the API boundary (11 §1)', () => {
  it('signs in as all three roles', async () => {
    if (!reachable) return
    for (const role of ['admin', 'fundraiser', 'viewer'] as const) {
      const token = await signIn(role)
      expect(token, `${LIVE_USERS[role]} could not sign in`).toBeTruthy()
    }
  })

  it('lets every role read contacts — the shared baseline', async () => {
    if (!reachable) return
    for (const role of ['admin', 'fundraiser', 'viewer'] as const) {
      const response = await rest(role, 'contacts?select=id&limit=1')
      expect(response.status, `${role} cannot read contacts`).toBe(200)
    }
  })

  it('keeps private notes away from a viewer entirely (11 §2)', async () => {
    if (!reachable) return

    // Plant one private note as admin, on whatever contact exists.
    const contacts = await rest<Array<{ id: string }>>('admin', 'contacts?select=id&limit=1')
    const contactId = contacts.body?.[0]?.id
    expect(contactId, 'the project has no contacts to attach a note to').toBeTruthy()

    // `notes_ins` requires `created_by = auth.uid()` — the author is stamped,
    // never chosen (11 §2), so the probe has to say who it is.
    const adminId = await userId('admin')
    const created = await rest<Array<{ id: string }>>('admin', 'notes', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        contact_id: contactId,
        body: 'RLS conformance probe — private note, safe to delete',
        category: 'general',
        is_private: true,
        created_by: adminId,
      },
    })
    expect(created.status, `admin could not write the probe note: ${created.message ?? ''}`).toBe(201)
    const noteId = created.body?.[0]?.id
    expect(noteId).toBeTruthy()

    try {
      // The viewer's SELECT simply does not include it. Not redacted: absent.
      const asViewer = await rest<Array<{ id: string }>>('viewer', `notes?select=id&id=eq.${noteId}`)
      expect(asViewer.status).toBe(200)
      expect(asViewer.body, 'a viewer can read a private note').toEqual([])

      // And it is absent from an unfiltered list too, not just a direct fetch.
      const listed = await rest<Array<{ id: string; is_private: boolean }>>(
        'viewer',
        'notes?select=id,is_private&is_private=eq.true&limit=50',
      )
      expect(listed.status).toBe(200)
      expect((listed.body ?? []).length, 'private notes leak into a viewer list').toBe(0)

      // The admin who wrote it still sees it — the policy is selective, not a
      // blanket denial that would make the feature useless.
      const asAdmin = await rest<Array<{ id: string }>>('admin', `notes?select=id&id=eq.${noteId}`)
      expect(asAdmin.body).toHaveLength(1)
    } finally {
      await rest('admin', `notes?id=eq.${noteId}`, { method: 'DELETE' })
    }
  })

  it('keeps the donations base table away from a restricted viewer (11 §2)', async () => {
    if (!reachable) return

    const asViewer = await rest<Array<Record<string, unknown>>>('viewer', 'donations?select=id,amount&limit=5')
    // Either the policy refuses outright or it returns nothing; a viewer with
    // `can_see_amounts = false` must never receive an `amount`.
    if (asViewer.status === 200) {
      expect(asViewer.body, 'a restricted viewer received rows from `donations`').toEqual([])
    } else {
      expect(asViewer.status).toBeGreaterThanOrEqual(400)
    }

    // The redacted view is the path they are meant to use, and it carries no
    // amount column at all.
    const redacted = await rest<Array<Record<string, unknown>>>('viewer', 'donations_redacted?select=*&limit=5')
    expect(redacted.status).toBe(200)
    for (const row of redacted.body ?? []) {
      expect(Object.keys(row)).not.toContain('amount')
      expect(Object.keys(row)).not.toContain('amount_gbp')
    }
  })

  it('refuses a viewer’s writes across the board', async () => {
    if (!reachable) return
    const contacts = await rest<Array<{ id: string }>>('admin', 'contacts?select=id&limit=1')
    const contactId = contacts.body?.[0]?.id

    const attempts: Array<{ what: string; run: () => Promise<{ status: number; code: string | null }> }> = [
      {
        what: 'create a contact',
        run: () =>
          rest('viewer', 'contacts', {
            method: 'POST',
            body: { first_name: 'RLS', last_name: 'Probe', stage: 'prospect', priority: 'medium' },
          }),
      },
      {
        what: 'log an interaction',
        run: () =>
          rest('viewer', 'interactions', {
            method: 'POST',
            body: { contact_id: contactId, occurred_at: new Date().toISOString(), kind: 'call', summary: 'probe' },
          }),
      },
      {
        what: 'record a gift',
        run: () =>
          rest('viewer', 'donations', {
            method: 'POST',
            body: { contact_id: contactId, donated_on: new Date().toISOString().slice(0, 10), amount: 1, currency: 'GBP' },
          }),
      },
    ]

    for (const attempt of attempts) {
      const result = await attempt.run()
      expect(
        result.status === 401 || result.status === 403 || result.code === '42501',
        `a viewer was allowed to ${attempt.what} (status ${result.status})`,
      ).toBe(true)
    }
  })

  it('lets a viewer’s settings UPDATE match nothing rather than change anything', async () => {
    if (!reachable) return

    // An UPDATE with no rows visible to the policy is not an error in
    // PostgREST — it is a 204 that changed nothing. The refusal has to be
    // proven by reading the row back, not by reading the status code.
    const before = await rest<Array<{ is_enabled: boolean }>>(
      'admin',
      'automation_rules?select=is_enabled&rule_key=eq.kit_due',
    )
    const wasEnabled = before.body?.[0]?.is_enabled
    expect(wasEnabled, 'the kit_due rule is missing from the project').toBeDefined()

    await rest('viewer', 'automation_rules?rule_key=eq.kit_due', {
      method: 'PATCH',
      body: { is_enabled: !wasEnabled },
    })

    const after = await rest<Array<{ is_enabled: boolean }>>(
      'admin',
      'automation_rules?select=is_enabled&rule_key=eq.kit_due',
    )
    expect(after.body?.[0]?.is_enabled, 'a viewer changed an automation rule').toBe(wasEnabled)
  })

  it('refuses a fundraiser’s deletes, while allowing their edits (11 §1)', async () => {
    if (!reachable) return

    const contacts = await rest<Array<{ id: string }>>('admin', 'contacts?select=id&limit=1')
    const contactId = contacts.body?.[0]?.id
    expect(contactId).toBeTruthy()

    // A fundraiser may create a task…
    const created = await rest<Array<{ id: string }>>('fundraiser', 'tasks', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        contact_id: contactId,
        title: 'RLS conformance probe — safe to delete',
        due_on: new Date().toISOString().slice(0, 10),
        priority: 'low',
        status: 'todo',
        origin: 'manual',
      },
    })
    expect(created.status, `a fundraiser could not create a task: ${created.message ?? ''}`).toBe(201)
    const taskId = created.body?.[0]?.id

    try {
      // …and edit it…
      const patched = await rest('fundraiser', `tasks?id=eq.${taskId}`, {
        method: 'PATCH',
        body: { priority: 'medium' },
      })
      expect(patched.status).toBeLessThan(300)

      // …but deleting is admin-only (11 §1: "Delete, merge, import").
      const deleted = await rest<Array<unknown>>('fundraiser', `tasks?id=eq.${taskId}`, {
        method: 'DELETE',
        prefer: 'return=representation',
      })
      const refused = deleted.status === 401 || deleted.status === 403 || deleted.code === '42501'
      const deletedNothing = deleted.status === 200 && Array.isArray(deleted.body) && deleted.body.length === 0
      expect(refused || deletedNothing, `a fundraiser deleted a task (status ${deleted.status})`).toBe(true)

      // Proof it is still there.
      const still = await rest<Array<{ id: string }>>('admin', `tasks?select=id&id=eq.${taskId}`)
      expect(still.body, 'the probe task was deleted by a fundraiser').toHaveLength(1)
    } finally {
      await rest('admin', `tasks?id=eq.${taskId}`, { method: 'DELETE' })
    }
  })

  it('keeps Settings writes to admins (11 §1)', async () => {
    if (!reachable) return
    const asFundraiser = await rest('fundraiser', 'lookup_options', {
      method: 'POST',
      body: { list_name: 'stage', value: 'rls_probe', label: 'RLS probe', sort_order: 999 },
    })
    expect(
      asFundraiser.status === 401 || asFundraiser.status === 403 || asFundraiser.code === '42501',
      `a fundraiser added a lookup option (status ${asFundraiser.status})`,
    ).toBe(true)
  })
})

// A visible reminder when the suite runs in its default offline mode.
describe.runIf(!LIVE)('RLS · live conformance', () => {
  it.skip('runs only with LIVE=1 (see tests/support/live.ts for credentials)', () => {})
})
