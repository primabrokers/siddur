/**
 * The inbound webhook's parser (10 §3).
 *
 * A webhook is the one surface where the app cannot choose its input. What is
 * under test here is the promise the function makes: **Resend's shape is
 * understood exactly, a documented generic shape is understood too, and
 * anything else is refused without losing a message or crashing.** Everything
 * downstream — filing, threading, matching — is already covered by
 * comms-core.test.ts and the 011 trigger.
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_ATTACHMENT_BYTES,
  parseInboundPayload,
  type InboundEmail,
} from '../src/features/comms/core'

/** A realistic Resend inbound delivery. */
const resendPayload = {
  type: 'email.received',
  created_at: '2026-09-15T08:12:04.000Z',
  data: {
    email_id: 'e5b9f0c2-2f1e-4a8e-9c1a-1d4b6f0a2c33',
    from: 'Dovid Cohen <dovid.cohen@example.com>',
    to: ['office@yeshiva.org'],
    cc: ['rivky@example.com'],
    subject: 'Re: The building appeal',
    text: 'Thank you for the brochure — I would like to talk after Sukkos.',
    html: '<p>Thank you for the brochure — I would like to talk after Sukkos.</p>',
    headers: [
      { name: 'Message-ID', value: '<msg-2@example.com>' },
      { name: 'In-Reply-To', value: '<msg-1@yeshiva.org>' },
      { name: 'Subject', value: 'Re: The building appeal' },
    ],
    attachments: [],
  },
}

const parsed = (payload: unknown): InboundEmail => {
  const result = parseInboundPayload(payload)
  if (!result) throw new Error('expected the payload to parse')
  return result
}

describe('the Resend inbound shape', () => {
  it('reads the message out of `data`', () => {
    const email = parsed(resendPayload)
    expect(email.shape).toBe('resend')
    expect(email.from_addr).toBe('Dovid Cohen <dovid.cohen@example.com>')
    expect(email.to_addrs).toEqual(['office@yeshiva.org'])
    expect(email.cc_addrs).toEqual(['rivky@example.com'])
    expect(email.subject).toBe('Re: The building appeal')
    expect(email.body_text).toContain('after Sukkos')
    expect(email.body_html).toContain('<p>')
  })

  it('takes the ids from the header list, which is where Resend puts them', () => {
    const email = parsed(resendPayload)
    expect(email.rfc_message_id).toBe('<msg-2@example.com>')
    expect(email.in_reply_to).toBe('<msg-1@yeshiva.org>')
  })

  it('uses the provider id as the idempotency key', () => {
    expect(parsed(resendPayload).provider_message_id).toBe('e5b9f0c2-2f1e-4a8e-9c1a-1d4b6f0a2c33')
  })

  it('keeps the provider timestamp so the list sorts by when it was sent', () => {
    expect(parsed(resendPayload).occurred_at).toBe('2026-09-15T08:12:04.000Z')
  })

  it('reads `{name,email}` address objects as well as strings', () => {
    const email = parsed({
      type: 'email.received',
      data: {
        ...resendPayload.data,
        from: { name: 'Dovid Cohen', email: 'dovid.cohen@example.com' },
        to: [{ email: 'office@yeshiva.org' }],
      },
    })
    expect(email.from_addr).toBe('Dovid Cohen <dovid.cohen@example.com>')
    expect(email.to_addrs).toEqual(['office@yeshiva.org'])
  })

  it('splits a comma-joined recipient header without cutting a quoted name in half', () => {
    const email = parsed({
      type: 'email.received',
      data: { ...resendPayload.data, to: '"Cohen, Dovid" <d@x.com>, office@yeshiva.org' },
    })
    expect(email.to_addrs).toEqual(['"Cohen, Dovid" <d@x.com>', 'office@yeshiva.org'])
  })

  it('falls back to the stripped HTML when there is no text part', () => {
    const email = parsed({
      type: 'email.received',
      data: { ...resendPayload.data, text: '', html: '<p>Only HTML <b>here</b></p>' },
    })
    expect(email.body_text).toBe('Only HTML here')
  })
})

describe('the documented generic fallback', () => {
  const generic = {
    from: 'donor@example.com',
    to: ['office@yeshiva.org'],
    cc: [],
    subject: 'A question',
    text: 'Plain body.',
    message_id: '<generic-1@mail>',
    in_reply_to: '<generic-0@mail>',
  }

  it('reads a flat payload with no `data` envelope', () => {
    const email = parsed(generic)
    expect(email.shape).toBe('generic')
    expect(email.from_addr).toBe('donor@example.com')
    expect(email.subject).toBe('A question')
    expect(email.body_text).toBe('Plain body.')
    expect(email.rfc_message_id).toBe('<generic-1@mail>')
    expect(email.in_reply_to).toBe('<generic-0@mail>')
  })

  it('accepts the body_text/body_html aliases a hand-rolled forwarder uses', () => {
    const email = parsed({
      from: 'donor@example.com',
      to: 'office@yeshiva.org',
      body_text: 'Aliased.',
      body_html: '<p>Aliased.</p>',
    })
    expect(email.body_text).toBe('Aliased.')
    expect(email.body_html).toBe('<p>Aliased.</p>')
  })

  it('reads headers supplied as a plain object, case-insensitively', () => {
    const email = parsed({
      from: 'donor@example.com',
      headers: { 'message-id': '<obj-1@mail>', 'In-Reply-To': '<obj-0@mail>' },
    })
    expect(email.rfc_message_id).toBe('<obj-1@mail>')
    expect(email.in_reply_to).toBe('<obj-0@mail>')
  })

  it('falls back to the RFC Message-ID when the provider supplies no id of its own', () => {
    expect(parsed(generic).provider_message_id).toBe('<generic-1@mail>')
  })

  it('leaves the idempotency key null when there is genuinely no id', () => {
    const email = parsed({ from: 'donor@example.com', subject: 'No ids at all' })
    expect(email.provider_message_id).toBeNull()
    expect(email.rfc_message_id).toBeNull()
  })
})

describe('idempotency: the same delivery twice', () => {
  it('yields the same key both times, which is what the unique index needs', () => {
    const first = parsed(resendPayload)
    const second = parsed(JSON.parse(JSON.stringify(resendPayload)))
    expect(first.provider_message_id).toBe(second.provider_message_id)
    expect(first.provider_message_id).not.toBeNull()
  })

  it('distinguishes two genuinely different messages in the same thread', () => {
    const later = parsed({
      ...resendPayload,
      data: { ...resendPayload.data, email_id: 'different-id', headers: [{ name: 'Message-ID', value: '<msg-3@example.com>' }] },
    })
    expect(later.provider_message_id).not.toBe(parsed(resendPayload).provider_message_id)
  })
})

describe('malformed payloads', () => {
  it('refuses a body with no sender — the one field a message cannot be filed without', () => {
    expect(parseInboundPayload({ subject: 'Orphan', text: 'No from address' })).toBeNull()
    expect(parseInboundPayload({ type: 'email.received', data: { from: '   ' } })).toBeNull()
  })

  it('refuses a body that is not an object', () => {
    expect(parseInboundPayload(null)).toBeNull()
    expect(parseInboundPayload('a string')).toBeNull()
    expect(parseInboundPayload(42)).toBeNull()
    expect(parseInboundPayload([1, 2, 3])).toBeNull()
  })

  it('degrades instead of throwing when the optional fields are the wrong type', () => {
    const email = parsed({
      from: 'donor@example.com',
      to: 42,
      cc: { nonsense: true },
      subject: { not: 'a string' },
      text: null,
      attachments: 'not a list',
      headers: 99,
    })
    expect(email.to_addrs).toEqual([])
    expect(email.cc_addrs).toEqual([])
    expect(email.subject).toBe('')
    expect(email.body_text).toBe('')
    expect(email.attachments).toEqual([])
  })

  it('normalises a subject that arrives full of newlines', () => {
    expect(parsed({ from: 'a@b.com', subject: 'Two\n\nlines   here' }).subject).toBe('Two lines here')
  })
})

describe('attachments', () => {
  it('reads filename, type and an inline base64 payload', () => {
    const email = parsed({
      ...resendPayload,
      data: {
        ...resendPayload.data,
        attachments: [
          { filename: 'pledge.pdf', content_type: 'application/pdf', content: 'aGVsbG8gd29ybGQ=' },
        ],
      },
    })
    expect(email.attachments).toHaveLength(1)
    expect(email.attachments[0]?.filename).toBe('pledge.pdf')
    expect(email.attachments[0]?.content_type).toBe('application/pdf')
    expect(email.attachments[0]?.content).toBe('aGVsbG8gd29ybGQ=')
  })

  it('derives a size from the base64 when the provider declares none', () => {
    const email = parsed({
      from: 'a@b.com',
      attachments: [{ filename: 'x.txt', content: 'aGVsbG8gd29ybGQ=' }],
    })
    // "hello world" is 11 bytes.
    expect(email.attachments[0]?.size_bytes).toBe(11)
  })

  it('prefers the size the provider declares', () => {
    const email = parsed({
      from: 'a@b.com',
      attachments: [{ filename: 'x.pdf', size: 4096, content: 'aGVsbG8=' }],
    })
    expect(email.attachments[0]?.size_bytes).toBe(4096)
  })

  it('records a provider-hosted attachment as a URL', () => {
    const email = parsed({
      from: 'a@b.com',
      attachments: [{ filename: 'big.zip', url: 'https://provider.example/big.zip', size: 50_000_000 }],
    })
    expect(email.attachments[0]?.url).toBe('https://provider.example/big.zip')
    expect(email.attachments[0]?.content).toBeUndefined()
  })

  it('names the 10MB cap the function enforces', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024)
    const email = parsed({
      from: 'a@b.com',
      attachments: [{ filename: 'huge.pdf', size: MAX_ATTACHMENT_BYTES + 1, content: 'aGk=' }],
    })
    // The parser records it; the function is what declines to store it.
    expect(email.attachments[0]?.size_bytes).toBeGreaterThan(MAX_ATTACHMENT_BYTES)
  })

  it('gives an unnamed attachment a name rather than dropping it', () => {
    const email = parsed({ from: 'a@b.com', attachments: [{ content: 'aGk=' }] })
    expect(email.attachments[0]?.filename).toBe('attachment')
    expect(email.attachments[0]?.content_type).toBe('application/octet-stream')
  })

  it('skips entries that are not objects at all', () => {
    const email = parsed({ from: 'a@b.com', attachments: ['nope', null, 7] })
    expect(email.attachments).toEqual([])
  })
})
