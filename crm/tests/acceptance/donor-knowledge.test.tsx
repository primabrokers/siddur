/**
 * ACCEPTANCE 2 — Donor knowledge (brief §34.2, spec 12 §2.2)
 *
 *   "Open a donor untouched for six months → the header, timeline and brief
 *    convey who they are, how we know them, their history, their interests,
 *    when we last spoke and what the next objective is — in under sixty
 *    seconds."
 *
 * The sixty seconds is a stopwatch a human holds; software cannot assert it.
 * What software *can* assert — and what the stopwatch depends on — is
 * **completeness**: that every one of those questions is answered on the first
 * screen, without a click, without a tab, without scrolling into the timeline.
 *
 * So this test enumerates the questions and demands an answer to each on
 * Dovid Cohen's profile, 184 days after anyone last spoke to him.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'

vi.mock('../../src/lib/supabase', async () => {
  const harness = await import('../support/harness')
  return { supabase: harness.supabase, isConfigured: true }
})
vi.mock('../../src/lib/env', () => ({
  SUPABASE_URL: 'http://fake.local',
  SUPABASE_ANON_KEY: 'fake',
  isConfigured: true,
}))

const { IDS, MONDAY, seededMondayTables } = await import('./fixtures')
const { freezeClock, installWorld, renderApp, resetWorld, thawClock } = await import('../support/harness')

/**
 * The six questions brief §34.2 asks, each paired with what must be on screen
 * to answer it. If one of these ever stops rendering, the sixty-second test
 * fails in the room — this fails it in CI first.
 */
const QUESTIONS: Array<{ question: string; expect: RegExp }> = [
  { question: 'Who is he?', expect: /Dovid Cohen/ },
  { question: 'Where does he sit with us?', expect: /In discussion/i },
  { question: 'What has he given?', expect: /£65,000/ },
  { question: 'When did he last give?', expect: /£15,000/ },
  { question: 'When did we last speak?', expect: /184 days ago/ },
  { question: 'What is the next objective?', expect: /Call re proposal/ },
]

describe('acceptance 2 · a donor untouched for six months is legible at a glance', () => {
  beforeEach(() => {
    freezeClock(MONDAY)
    window.localStorage.clear()
  })

  afterEach(() => {
    thawClock()
    resetWorld()
    vi.clearAllMocks()
  })

  it('answers every §34.2 question in the header, with no clicks', async () => {
    installWorld({ tables: seededMondayTables() })
    await renderApp(`/contacts/${IDS.dovid}`)

    const header = await screen.findByTestId('profile-header', {}, { timeout: 5000 })
    await within(header).findByText(/184 days ago/, {}, { timeout: 5000 })

    for (const item of QUESTIONS) {
      const hits = within(header).queryAllByText(item.expect)
      expect(hits.length, `Unanswered on the header: “${item.question}”`).toBeGreaterThan(0)
    }
  })

  it('carries the relationship context, not just the numbers', async () => {
    installWorld({ tables: seededMondayTables() })
    await renderApp(`/contacts/${IDS.dovid}`)

    const header = await screen.findByTestId('profile-header', {}, { timeout: 5000 })
    await within(header).findByText(/184 days ago/, {}, { timeout: 5000 })

    // How we know him, what he cares about, and that he matters.
    expect(within(header).getByText(/Introduced by/)).toBeInTheDocument()
    expect(within(header).getByRole('link', { name: /Weiss/ })).toBeInTheDocument()
    expect(within(header).getByText('Building project')).toBeInTheDocument()
    expect(within(header).getByText('VIP')).toBeInTheDocument()
    expect(within(header).getByText(/Tier A/)).toBeInTheDocument()
    expect(within(header).getByText(/High priority/)).toBeInTheDocument()
    // The Hebrew name, which is how he is addressed.
    expect(within(header).getByText('דוד הכהן')).toBeInTheDocument()
  })

  it('states the derived judgements the fundraiser would otherwise have to make', async () => {
    installWorld({ tables: seededMondayTables() })
    await renderApp(`/contacts/${IDS.dovid}`)

    const header = await screen.findByTestId('profile-header', {}, { timeout: 5000 })
    await within(header).findByText(/184 days ago/, {}, { timeout: 5000 })

    // Donor status and keep-in-touch cadence come from the view, never from a
    // person's arithmetic (I-8/I-9).
    expect(within(header).getByText(/Pre-lapsed · computed/)).toBeInTheDocument()
    expect(within(header).getByText(/every 2 months/)).toBeInTheDocument()
    expect(within(header).getByText(/on file|enduring/)).toBeInTheDocument()
  })

  it('shows the one thing to remember before calling him', async () => {
    installWorld({ tables: seededMondayTables() })
    await renderApp(`/contacts/${IDS.dovid}`)

    // The pinned note is the "do not get this wrong" line (04 §5.4). Its body
    // sits beside a bold label, so the assertion reads the whole bar.
    const pinned = await screen.findByTestId('pinned-note', {}, { timeout: 5000 })
    expect(pinned).toHaveTextContent(/never solicit at shul/i)
    expect(pinned).toHaveTextContent(/prefers calls after 8pm/i)
  })

  it('puts the last real conversation, and its outcome, on the timeline', async () => {
    installWorld({ tables: seededMondayTables() })
    await renderApp(`/contacts/${IDS.dovid}`)

    expect(
      await screen.findByText(/Strong interest in the building project/, {}, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.getByText(/wants to see the naming opportunities/)).toBeInTheDocument()
  })

  it('does not claim a next action he does not have', async () => {
    // Strip his open task: the header must say so in yellow, not fall silent.
    const tables = seededMondayTables()
    tables.tasks = (tables.tasks as Array<Record<string, unknown>>).filter(
      (task) => task.contact_id !== IDS.dovid,
    )
    tables.contact_stats = (tables.contact_stats as Array<Record<string, unknown>>).map((row) =>
      row.contact_id === IDS.dovid
        ? { ...row, next_action_id: null, next_action_title: null, next_action_due_on: null, flag: 'none' }
        : row,
    )
    installWorld({ tables })
    await renderApp(`/contacts/${IDS.dovid}`)

    const header = await screen.findByTestId('profile-header', {}, { timeout: 5000 })
    expect(await within(header).findByText(/none — add one/, {}, { timeout: 5000 })).toBeInTheDocument()
  })
})
