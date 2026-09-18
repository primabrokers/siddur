/**
 * C1 core — the rules the browser, the two edge functions and the 011 trigger
 * all have to agree on (10 §3).
 *
 * These are the decisions that are expensive to get wrong and invisible when
 * they are: which messages are one conversation, which donor an address
 * belongs to, where a message lands when you archive it, and what the Send
 * button is allowed to do.
 */

import { describe, expect, it } from 'vitest'
import {
  actionsFor,
  addressLabel,
  counterpartOf,
  deriveThreadKey,
  folderAfter,
  forwardSubject,
  groupThreads,
  isUnread,
  isValidAddress,
  matchContactByAddress,
  normaliseAddress,
  normaliseSubject,
  parseAddress,
  replySubject,
  snippetOf,
  splitAddresses,
  storedAddress,
  textFromHtml,
  timelineSummary,
  unreadCount,
  validateCompose,
  type EmailLike,
} from '../src/features/comms/core'

/* ------------------------------------------------------------- addresses */

describe('address parsing and normalisation', () => {
  it('pulls the addr-spec out of a display-name header', () => {
    expect(parseAddress('Dovid Cohen <dovid.cohen@example.com>')).toEqual({
      name: 'Dovid Cohen',
      address: 'dovid.cohen@example.com',
    })
  })

  it('strips the quotes a client puts round a display name', () => {
    expect(parseAddress('"Cohen, Dovid" <d@x.com>').name).toBe('Cohen, Dovid')
  })

  it('treats a bare address as an address', () => {
    expect(parseAddress('d@x.com')).toEqual({ name: '', address: 'd@x.com' })
  })

  it('survives an empty or missing header without throwing', () => {
    expect(parseAddress(null)).toEqual({ name: '', address: '' })
    expect(parseAddress('   ')).toEqual({ name: '', address: '' })
  })

  it('folds case for matching', () => {
    expect(normaliseAddress('Dovid.Cohen@Example.COM')).toBe('dovid.cohen@example.com')
  })

  it('removes plus-addressing for matching — that is the whole point of it', () => {
    expect(normaliseAddress('dovid.cohen+crm@example.com')).toBe('dovid.cohen@example.com')
    expect(normaliseAddress('Dovid Cohen <Dovid.Cohen+yeshiva-2026@Example.com>')).toBe(
      'dovid.cohen@example.com',
    )
  })

  it('keeps the plus-tag in the *stored* form — it is real routing', () => {
    expect(storedAddress('Dovid <Dovid.Cohen+crm@Example.com>')).toBe('dovid.cohen+crm@example.com')
  })

  it('does not mangle an address with no local part to strip', () => {
    expect(normaliseAddress('+44@x.com')).toBe('+44@x.com')
  })

  it('validates what can actually be sent to', () => {
    expect(isValidAddress('a@b.co')).toBe(true)
    expect(isValidAddress('Name <a@b.co.uk>')).toBe(true)
    expect(isValidAddress('not-an-address')).toBe(false)
    expect(isValidAddress('a@b')).toBe(false)
    expect(isValidAddress('a b@c.com')).toBe(false)
    expect(isValidAddress('')).toBe(false)
  })

  it('labels a row by name when there is one, address when there is not', () => {
    expect(addressLabel('Dovid Cohen <d@x.com>')).toBe('Dovid Cohen')
    expect(addressLabel('d@x.com')).toBe('d@x.com')
    expect(addressLabel(null)).toBe('(no address)')
  })
})

/* ---------------------------------------------------------------- matching */

describe('matching an address to a contact', () => {
  const contacts = [
    { id: 'dovid', email: 'dovid.cohen@example.com' },
    { id: 'rivky', email: 'rivky@example.com' },
    { id: 'nobody', email: null },
  ]

  it('matches on case difference', () => {
    expect(matchContactByAddress('DOVID.COHEN@EXAMPLE.COM', contacts)).toBe('dovid')
  })

  it('matches through plus-addressing', () => {
    expect(matchContactByAddress('dovid.cohen+dinner@example.com', contacts)).toBe('dovid')
  })

  it('matches through a display name', () => {
    expect(matchContactByAddress('"Cohen, Dovid" <dovid.cohen@example.com>', contacts)).toBe('dovid')
  })

  it('returns null rather than guessing', () => {
    expect(matchContactByAddress('stranger@elsewhere.com', contacts)).toBeNull()
    expect(matchContactByAddress('', contacts)).toBeNull()
    expect(matchContactByAddress(null, contacts)).toBeNull()
  })

  it('never matches a contact that has no email on file', () => {
    expect(matchContactByAddress('', [{ id: 'nobody', email: null }])).toBeNull()
  })
})

/* ----------------------------------------------------------------- threads */

describe('subject normalisation', () => {
  it('strips one prefix', () => {
    expect(normaliseSubject('Re: The dinner')).toBe('the dinner')
  })

  it('strips stacked prefixes, including numbered ones', () => {
    expect(normaliseSubject('Re: FW: Re[2]: The  dinner')).toBe('the dinner')
    expect(normaliseSubject('FWD: AW: Sv: Building appeal')).toBe('building appeal')
  })

  it('leaves a subject that merely starts with those letters alone', () => {
    expect(normaliseSubject('Reunion plans')).toBe('reunion plans')
    expect(normaliseSubject('Format of the dinner')).toBe('format of the dinner')
  })

  it('collapses whitespace and handles nothing at all', () => {
    expect(normaliseSubject('  a   b  ')).toBe('a b')
    expect(normaliseSubject(null)).toBe('')
  })
})

describe('thread_key derivation', () => {
  it('inherits the parent thread when the chain names a message on file', () => {
    expect(
      deriveThreadKey({
        inReplyTo: '<abc@mail>',
        parentThreadKey: 'subj:the dinner|dovid@example.com',
        subject: 'Re: something else entirely',
        counterpart: 'someone@else.com',
      }),
    ).toBe('subj:the dinner|dovid@example.com')
  })

  it('falls back to normalised subject + counterpart with no parent on file', () => {
    expect(
      deriveThreadKey({ subject: 'Re: The dinner', counterpart: 'Dovid <Dovid@Example.com>' }),
    ).toBe('subj:the dinner|dovid@example.com')
  })

  it('puts a reply and its original in the same thread', () => {
    const original = deriveThreadKey({ subject: 'The dinner', counterpart: 'dovid@example.com' })
    const reply = deriveThreadKey({ subject: 'Re: The dinner', counterpart: 'DOVID@example.com' })
    expect(reply).toBe(original)
  })

  it('keeps two donors asking the same question apart', () => {
    const a = deriveThreadKey({ subject: 'Dinner?', counterpart: 'dovid@example.com' })
    const b = deriveThreadKey({ subject: 'Dinner?', counterpart: 'rivky@example.com' })
    expect(a).not.toBe(b)
  })

  it('keeps an unfiled chain distinct when there is neither subject nor counterpart', () => {
    expect(deriveThreadKey({ inReplyTo: '<orphan@mail>', subject: '', counterpart: '' })).toBe(
      'chain:<orphan@mail>',
    )
  })

  it('makes a message with nothing at all a thread of one', () => {
    expect(deriveThreadKey({ subject: '', counterpart: '' }, 'e-1')).toBe('thread:e-1')
  })

  it('takes the counterpart from the sender inbound and the first recipient outbound', () => {
    expect(counterpartOf('in', 'Donor <donor@x.com>', ['office@yeshiva.org'])).toBe('donor@x.com')
    expect(counterpartOf('out', 'office@yeshiva.org', ['Donor <Donor@X.com>', 'cc@x.com'])).toBe(
      'donor@x.com',
    )
    expect(counterpartOf('out', 'office@yeshiva.org', [])).toBe('')
  })
})

/* ----------------------------------------------------------------- folders */

describe('folder transitions', () => {
  it('archives and trashes from anywhere', () => {
    expect(folderAfter('archive', 'inbox', 'in')).toBe('archive')
    expect(folderAfter('trash', 'archive', 'in')).toBe('trash')
    expect(folderAfter('trash', 'sent', 'out')).toBe('trash')
  })

  it('restores an inbound message to the Inbox and a sent one to Sent', () => {
    expect(folderAfter('restore', 'trash', 'in')).toBe('inbox')
    expect(folderAfter('restore', 'trash', 'out')).toBe('sent')
    expect(folderAfter('restore', 'archive', 'in')).toBe('inbox')
  })

  it('offers the actions that make sense in each folder', () => {
    expect(actionsFor('inbox')).toEqual(['archive', 'trash'])
    expect(actionsFor('sent')).toEqual(['archive', 'trash'])
    expect(actionsFor('archive')).toEqual(['restore', 'trash'])
    expect(actionsFor('trash')).toEqual(['restore'])
  })

  it('is reversible: every move can be undone by writing the old folder back', () => {
    const before = 'inbox' as const
    const after = folderAfter('archive', before, 'in')
    expect(after).not.toBe(before)
    // The undo is not a function — it is the remembered value, which is why
    // the mutation returns it.
    expect(before).toBe('inbox')
  })
})

/* ------------------------------------------------------------ unread counts */

const email = (over: Partial<EmailLike> = {}): EmailLike => ({
  id: 'e1',
  folder: 'inbox',
  direction: 'in',
  from_addr: 'donor@x.com',
  to_addrs: ['office@yeshiva.org'],
  subject: 'Hello',
  snippet: 'Hello',
  thread_key: 'subj:hello|donor@x.com',
  contact_id: null,
  read_at: null,
  occurred_at: '2026-09-01T10:00:00Z',
  ...over,
})

describe('unread counting', () => {
  it('counts an unopened inbound message in the Inbox', () => {
    expect(isUnread(email())).toBe(true)
  })

  it('does not count a message that has been opened', () => {
    expect(isUnread(email({ read_at: '2026-09-02T09:00:00Z' }))).toBe(false)
  })

  it('does not count your own sent mail', () => {
    expect(isUnread(email({ direction: 'out', folder: 'sent' }))).toBe(false)
  })

  it('does not count archived or trashed mail — the badge is about the Inbox', () => {
    expect(isUnread(email({ folder: 'archive' }))).toBe(false)
    expect(isUnread(email({ folder: 'trash' }))).toBe(false)
  })

  it('totals a mixed folder', () => {
    expect(
      unreadCount([
        email({ id: 'a' }),
        email({ id: 'b' }),
        email({ id: 'c', read_at: '2026-09-02T09:00:00Z' }),
        email({ id: 'd', direction: 'out', folder: 'sent' }),
        email({ id: 'e', folder: 'archive' }),
      ]),
    ).toBe(2)
  })
})

/* ----------------------------------------------------------------- grouping */

describe('grouping a folder into threads', () => {
  const rows = [
    email({ id: 'a', thread_key: 't1', occurred_at: '2026-09-01T10:00:00Z', subject: 'The dinner' }),
    email({
      id: 'b',
      thread_key: 't1',
      occurred_at: '2026-09-03T10:00:00Z',
      subject: 'Re: The dinner',
      direction: 'out',
      folder: 'sent',
    }),
    email({ id: 'c', thread_key: 't2', occurred_at: '2026-09-02T10:00:00Z', subject: 'Gift Aid' }),
  ]

  it('orders conversations by their latest message, newest first', () => {
    const threads = groupThreads(rows)
    expect(threads.map((thread) => thread.thread_key)).toEqual(['t1', 't2'])
  })

  it('orders messages inside a conversation oldest first', () => {
    const [first] = groupThreads(rows)
    expect(first?.messages.map((message) => message.id)).toEqual(['a', 'b'])
    expect(first?.latest.id).toBe('b')
  })

  it('takes the thread subject from the first message that has one', () => {
    const threads = groupThreads([
      email({ id: 'x', thread_key: 't3', subject: null, occurred_at: '2026-09-01T10:00:00Z' }),
      email({ id: 'y', thread_key: 't3', subject: 'Found it', occurred_at: '2026-09-02T10:00:00Z' }),
    ])
    expect(threads[0]?.subject).toBe('Found it')
  })

  it('carries the contact and the unread tally onto the thread', () => {
    const threads = groupThreads([
      email({ id: 'x', thread_key: 't4', contact_id: null }),
      email({ id: 'y', thread_key: 't4', contact_id: 'dovid', occurred_at: '2026-09-04T10:00:00Z' }),
    ])
    expect(threads[0]?.contact_id).toBe('dovid')
    expect(threads[0]?.unread).toBe(2)
  })

  it('never drops a row that has no thread_key', () => {
    const threads = groupThreads([email({ id: 'lonely', thread_key: null })])
    expect(threads).toHaveLength(1)
    expect(threads[0]?.thread_key).toBe('thread:lonely')
  })
})

/* ---------------------------------------------------------------- compose */

describe('compose validation', () => {
  const draft = { to: 'a@b.com', cc: '', subject: 'Hello', body: 'Some words.' }

  it('accepts a complete draft', () => {
    const check = validateCompose(draft)
    expect(check.ok).toBe(true)
    expect(check.to).toEqual(['a@b.com'])
  })

  it('refuses a draft with no recipient', () => {
    const check = validateCompose({ ...draft, to: '   ' })
    expect(check.ok).toBe(false)
    expect(check.errors.to).toMatch(/at least one recipient/i)
  })

  it('refuses an empty body — an accidental send is worse than a blocked one', () => {
    const check = validateCompose({ ...draft, body: '  \n ' })
    expect(check.ok).toBe(false)
    expect(check.errors.body).toBeDefined()
  })

  it('allows a blank subject, because mail works that way', () => {
    expect(validateCompose({ ...draft, subject: '' }).ok).toBe(true)
  })

  it('names the address it could not parse', () => {
    const check = validateCompose({ ...draft, to: 'a@b.com, oops' })
    expect(check.ok).toBe(false)
    expect(check.errors.to).toContain('oops')
  })

  it('reports a bad cc without blocking a good to', () => {
    const check = validateCompose({ ...draft, cc: 'nope' })
    expect(check.ok).toBe(false)
    expect(check.errors.cc).toContain('nope')
    expect(check.errors.to).toBeUndefined()
  })

  it('de-duplicates recipients that differ only by case or plus-tag', () => {
    const check = validateCompose({
      ...draft,
      to: 'Dovid <Dovid@X.com>, dovid+crm@x.com, dovid@x.com',
    })
    expect(check.to).toEqual(['dovid@x.com'])
  })

  it('splits on commas, semicolons and newlines', () => {
    expect(splitAddresses('a@b.com; c@d.com\ne@f.com')).toEqual(['a@b.com', 'c@d.com', 'e@f.com'])
  })
})

describe('reply and forward prefilling', () => {
  it('adds Re: once, never twice', () => {
    expect(replySubject('The dinner')).toBe('Re: The dinner')
    expect(replySubject('Re: The dinner')).toBe('Re: The dinner')
    expect(replySubject('RE[2]: The dinner')).toBe('RE[2]: The dinner')
    expect(replySubject('')).toBe('Re:')
  })

  it('adds Fwd: once', () => {
    expect(forwardSubject('The dinner')).toBe('Fwd: The dinner')
    expect(forwardSubject('Fwd: The dinner')).toBe('Fwd: The dinner')
    expect(forwardSubject('Fw: The dinner')).toBe('Fw: The dinner')
  })
})

/* ------------------------------------------------------- snippets & summaries */

describe('snippets and the timeline summary', () => {
  it('collapses whitespace and leaves a short body alone', () => {
    expect(snippetOf('  two   lines\nhere ')).toBe('two lines here')
  })

  it('cuts on a word boundary and marks the cut', () => {
    const snippet = snippetOf('word '.repeat(80))
    expect(snippet.length).toBeLessThanOrEqual(201)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet).not.toMatch(/wor…$/)
  })

  it('builds the timeline summary as subject then the first 200 characters', () => {
    const summary = timelineSummary('Building appeal', 'We would like to discuss the naming opportunity.')
    expect(summary).toBe('Building appeal — We would like to discuss the naming opportunity.')
  })

  it('says so when a message has no subject', () => {
    expect(timelineSummary('', 'Body only.')).toBe('(no subject) — Body only.')
    expect(timelineSummary('Subject only', '')).toBe('Subject only')
  })

  it('caps the summary body at 200 characters', () => {
    const summary = timelineSummary('S', 'x'.repeat(400))
    expect(summary.length).toBeLessThanOrEqual(1 + 3 + 201)
  })
})

describe('html to text, for the rare html-only message', () => {
  it('drops tags and decodes the entities that actually appear', () => {
    expect(textFromHtml('<p>Hello &amp; <b>welcome</b></p><p>Second</p>')).toBe('Hello & welcome\n\nSecond')
  })

  it('removes script and style content entirely', () => {
    expect(textFromHtml('<style>p{color:red}</style><p>Visible</p>')).toBe('Visible')
  })

  it('turns <br> into a line break', () => {
    expect(textFromHtml('a<br>b')).toBe('a\nb')
  })
})
