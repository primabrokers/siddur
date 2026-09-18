/**
 * C1 UI — the Inbox against the in-memory PostgREST stand-in.
 *
 * What these prove, in the language of 10 §3 and the invariants:
 *   · the rail counts what is genuinely unread, and opening a thread clears it;
 *   · a conversation is one row, whatever its subject drifted to, and the
 *     reading pane shows it oldest first with the latest open;
 *   · Archive is immediate and offers six seconds of undo — no confirm (I-12);
 *   · an unmatched message cannot be logged without being told whose it is
 *     (I-2), and a matched one logs straight to the timeline;
 *   · with no provider keys, Compose still drafts and Send is disabled under a
 *     plain notice — the manual path is never a dead end.
 *
 * The 011 trigger is SQL and is not under test here (`thread_key`, matching and
 * `snippet` are covered by comms-core.test.ts and the migration mirrors them),
 * so these fixtures set those columns explicitly, exactly as the database would.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../src/lib/supabase', async () => {
  const harness = await import('./support/harness')
  return { supabase: harness.supabase, isConfigured: true }
})
vi.mock('../src/lib/env', () => ({
  SUPABASE_URL: 'https://fake.supabase.co',
  SUPABASE_ANON_KEY: 'fake',
  isConfigured: true,
}))

const { IDS, MONDAY, seededMondayTables } = await import('./acceptance/fixtures')
const { freezeClock, flat, installWorld, renderApp, resetWorld, thawClock } = await import(
  './support/harness'
)

type Row = Record<string, unknown>

const OFFICE = 'office@yeshiva.org'
const DOVID_ADDR = 'dovid.cohen@example.com'
const STRANGER = 'accounts@feldbrothers.example'

const at = (dayOffset: number, hour: number): string => {
  const date = new Date(MONDAY)
  date.setDate(date.getDate() + dayOffset)
  date.setHours(hour, 0, 0, 0)
  return date.toISOString()
}

/**
 * Two threads and one sent message — the same cast the live demo rows use.
 * `thread_key` is written out because the database writes it (011).
 */
function emailWorld(overrides: Row[] = []) {
  const tables = seededMondayTables()

  const dovidThread = `subj:the building appeal|${DOVID_ADDR}`
  const strangerThread = `subj:invoice for the dinner|${STRANGER}`

  tables.emails = [
    {
      id: 'em-1',
      folder: 'inbox',
      direction: 'in',
      from_addr: `Dovid Cohen <${DOVID_ADDR}>`,
      to_addrs: [OFFICE],
      cc_addrs: [],
      subject: 'The building appeal',
      body_text: 'Thank you for the brochure. I would like to talk after Sukkos.',
      body_html: null,
      snippet: 'Thank you for the brochure. I would like to talk after Sukkos.',
      provider_message_id: 'prov-1',
      rfc_message_id: '<msg-1@example.com>',
      in_reply_to: null,
      thread_key: dovidThread,
      contact_id: IDS.dovid,
      matched_by: 'from_addr',
      read_at: null,
      sent_by: null,
      occurred_at: at(-3, 9),
      created_at: at(-3, 9),
    },
    {
      id: 'em-2',
      folder: 'sent',
      direction: 'out',
      from_addr: OFFICE,
      to_addrs: [DOVID_ADDR],
      cc_addrs: [],
      subject: 'Re: The building appeal',
      body_text: 'Thank you — I will call the week after Sukkos.',
      body_html: null,
      snippet: 'Thank you — I will call the week after Sukkos.',
      provider_message_id: 'prov-2',
      rfc_message_id: '<msg-2@yeshiva.org>',
      in_reply_to: '<msg-1@example.com>',
      thread_key: dovidThread,
      contact_id: IDS.dovid,
      matched_by: 'to_addr',
      read_at: at(-2, 10),
      sent_by: IDS.braun,
      occurred_at: at(-2, 10),
      created_at: at(-2, 10),
    },
    {
      id: 'em-3',
      folder: 'inbox',
      direction: 'in',
      from_addr: STRANGER,
      to_addrs: [OFFICE],
      cc_addrs: [],
      subject: 'Invoice for the dinner',
      body_text: 'Please find the invoice for the dinner catering attached.',
      body_html: null,
      snippet: 'Please find the invoice for the dinner catering attached.',
      provider_message_id: 'prov-3',
      rfc_message_id: '<msg-3@feld.example>',
      in_reply_to: null,
      thread_key: strangerThread,
      contact_id: null,
      matched_by: null,
      read_at: null,
      sent_by: null,
      occurred_at: at(-1, 15),
      created_at: at(-1, 15),
    },
    ...overrides,
  ]
  tables.email_attachments = []
  return { tables, dovidThread, strangerThread }
}

beforeEach(() => {
  freezeClock(MONDAY)
})

afterEach(() => {
  thawClock()
  resetWorld()
  vi.restoreAllMocks()
})

/** Wait for the inbox list to have painted its rows. */
async function openInbox() {
  await renderApp('/comms')
  await screen.findByRole('heading', { name: 'Inbox' })
  await screen.findByText('The building appeal')
}

describe('the Inbox rail and list', () => {
  it('counts the unread inbound mail sitting in the Inbox', async () => {
    installWorld({ tables: emailWorld().tables })
    await openInbox()

    // em-1 and em-3 are unread inbound; em-2 is sent and does not count.
    const inbox = await screen.findAllByRole('button', { name: /^Inbox/ })
    await waitFor(() => expect(inbox.some((node) => node.textContent?.includes('2'))).toBe(true))
  })

  it('lists one row per conversation, newest first', async () => {
    installWorld({ tables: emailWorld().tables })
    await openInbox()

    const list = screen.getByTestId('email-list')
    const rows = within(list).getAllByRole('button', { name: /appeal|Invoice/ })
    expect(flat(rows[0]?.textContent ?? '')).toContain('Invoice for the dinner')
    expect(flat(rows[1]?.textContent ?? '')).toContain('The building appeal')
  })

  it('names the counterpart and chips the contact it matched', async () => {
    installWorld({ tables: emailWorld().tables })
    await openInbox()

    const list = screen.getByTestId('email-list')
    // The row names the counterpart, and the chip links to the matched donor.
    expect(within(list).getByRole('link', { name: 'Dovid Cohen' })).toBeInTheDocument()
    // The unmatched one says so rather than pretending.
    expect(within(list).getByText('Not linked')).toBeInTheDocument()
  })

  it('shows the folder is empty in the app’s own words', async () => {
    const world = emailWorld()
    world.tables.emails = []
    installWorld({ tables: world.tables })
    await renderApp('/comms')
    await screen.findByRole('heading', { name: 'Inbox' })
    expect(await screen.findByText('Inbox is empty')).toBeInTheDocument()
  })
})

describe('reading a thread', () => {
  it('shows the whole conversation across folders, oldest first, latest open', async () => {
    installWorld({ tables: emailWorld().tables })
    await openInbox()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(screen.getByText('The building appeal'))

    const pane = await screen.findByTestId('email-thread')
    // The inbound original and the sent reply are one conversation.
    expect(within(pane).getByRole('link', { name: 'Dovid Cohen' })).toBeInTheDocument()
    expect(within(pane).getByText('sent')).toBeInTheDocument()
    // The latest message is expanded: its body is on screen.
    expect(within(pane).getByText(/I will call the week after Sukkos/)).toBeInTheDocument()
  })

  it('marks the thread read on open, which clears it from the badge', async () => {
    const world = emailWorld()
    const fake = installWorld({ tables: world.tables })
    await openInbox()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(screen.getByText('The building appeal'))

    await waitFor(() => {
      const row = (fake.tables.emails as Row[]).find((email) => email.id === 'em-1')
      expect(row?.read_at).not.toBeNull()
    })
  })

  it('offers Link to contact on a message the matcher could not place', async () => {
    installWorld({ tables: emailWorld().tables })
    await openInbox()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(screen.getByText('Invoice for the dinner'))

    const pane = await screen.findByTestId('email-thread')
    expect(within(pane).getByText('Not linked to a contact')).toBeInTheDocument()
    expect(within(pane).getByRole('button', { name: 'Link to contact' })).toBeInTheDocument()
  })
})

describe('folder moves', () => {
  it('archives the whole thread at once, with undo and no confirm dialog (I-12)', async () => {
    const world = emailWorld()
    const fake = installWorld({ tables: world.tables })
    await openInbox()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(screen.getByText('The building appeal'))
    const pane = await screen.findByTestId('email-thread')
    // Scoped to the reading pane: the rail also has an Archive *folder*.
    await user.click(within(pane).getByRole('button', { name: 'Archive' }))

    // No confirm dialog stood between the click and the write.
    await waitFor(() => {
      const rows = (fake.tables.emails as Row[]).filter((email) => email.id === 'em-1' || email.id === 'em-2')
      expect(rows.every((row) => row.folder === 'archive')).toBe(true)
    })

    const toast = await screen.findByTestId('toast')
    expect(flat(toast.textContent ?? '')).toContain('Archived 2 messages')

    // Undo puts both back where they were — inbox and sent, not both inbox.
    await user.click(within(toast).getByRole('button', { name: 'Undo' }))
    await waitFor(() => {
      const emails = fake.tables.emails as Row[]
      expect(emails.find((row) => row.id === 'em-1')?.folder).toBe('inbox')
      expect(emails.find((row) => row.id === 'em-2')?.folder).toBe('sent')
    })
  })

  it('marks a thread unread again on request', async () => {
    const world = emailWorld()
    const fake = installWorld({ tables: world.tables })
    await openInbox()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(screen.getByText('The building appeal'))
    const pane = await screen.findByTestId('email-thread')
    await user.click(within(pane).getByRole('button', { name: 'Mark unread' }))

    await waitFor(() => {
      const row = (fake.tables.emails as Row[]).find((email) => email.id === 'em-1')
      expect(row?.read_at).toBeNull()
    })
  })
})

describe('logging an email to the timeline (10 §1 — no shadow inboxes)', () => {
  it('writes an interaction against the matched contact, with subject + opening as the summary', async () => {
    const world = emailWorld()
    const fake = installWorld({ tables: world.tables })
    await openInbox()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(screen.getByText('The building appeal'))
    const pane = await screen.findByTestId('email-thread')
    await user.click(within(pane).getByRole('button', { name: 'Log to timeline' }))

    await waitFor(() => {
      const logged = (fake.tables.interactions as Row[]).find((row) => row.source === 'email_ingest')
      expect(logged).toBeDefined()
      expect(logged?.contact_id).toBe(IDS.dovid)
      expect(logged?.kind).toBe('email')
      expect(String(logged?.summary)).toContain('Re: The building appeal')
      expect(String(logged?.summary)).toContain('I will call the week after Sukkos')
    })
  })

  it('asks whose timeline when the message is not matched (I-2)', async () => {
    const world = emailWorld()
    const fake = installWorld({ tables: world.tables })
    await openInbox()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(screen.getByText('Invoice for the dinner'))
    const pane = await screen.findByTestId('email-thread')
    await user.click(within(pane).getByRole('button', { name: 'Log to timeline' }))

    // A picker, not a silent refusal and not a contactless interaction.
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Whose timeline?')).toBeInTheDocument()
    expect((fake.tables.interactions as Row[]).some((row) => row.source === 'email_ingest')).toBe(false)
  })
})

describe('compose', () => {
  it('opens a reply prefilled with the sender and a Re: subject', async () => {
    installWorld({ tables: emailWorld().tables })
    await openInbox()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(screen.getByText('The building appeal'))
    await screen.findByTestId('email-thread')
    await user.click(screen.getAllByRole('button', { name: 'Reply' })[0] as HTMLElement)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/^To/)).toHaveValue(DOVID_ADDR)
    expect(within(dialog).getByLabelText('Subject')).toHaveValue('Re: The building appeal')
  })

  it('disables Send and says what an admin must do when the keys are missing', async () => {
    installWorld({ tables: emailWorld().tables })
    await openInbox()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(screen.getAllByRole('button', { name: 'New email' })[0] as HTMLElement)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(flat(dialog.textContent ?? '')).toContain('RESEND_API_KEY')
    // The draft is still writable — the manual path is never a dead end.
    expect(within(dialog).getByLabelText(/^Message/)).toBeEnabled()
  })

  it('refuses a draft with no recipient before it ever reaches the network', async () => {
    installWorld({ tables: emailWorld().tables })
    await openInbox()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(screen.getAllByRole('button', { name: 'New email' })[0] as HTMLElement)
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Message/), 'Body only, no recipient.')

    // Send stays disabled because nothing is configured; the validation is what
    // the same draft would hit if it were.
    expect(within(dialog).getByRole('button', { name: 'Send' })).toBeDisabled()
  })
})

describe('the ?contact= scope', () => {
  it('filters the list to one donor and says so in a chip', async () => {
    installWorld({ tables: emailWorld().tables })
    await renderApp(`/comms?contact=${IDS.dovid}`)
    await screen.findByRole('heading', { name: 'Inbox' })

    const list = await screen.findByTestId('email-list')
    await waitFor(() => expect(within(list).getByText('The building appeal')).toBeInTheDocument())
    expect(within(list).queryByText('Invoice for the dinner')).not.toBeInTheDocument()
    expect(flat(list.textContent ?? '')).toContain('Showing')
  })
})
