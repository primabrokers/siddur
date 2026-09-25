import { describe, expect, it } from 'vitest'
import {
  WA_WINDOW_MS,
  buildGraphPayload,
  renderTemplatePreview,
  templateComponents,
  templatePlaceholderCount,
  timelinePrefill,
  validateSendRequest,
  type WaSendAccepted,
} from '../src/features/whatsapp/core'

/**
 * `wa-send`'s rules (10 §2 Tier 2 · I-10).
 *
 * `validateSendRequest` is the server-side gate: the composer prevents the
 * mistake, this prevents the *bypass*. Every case below is one a stale browser
 * tab or a hand-rolled request could produce.
 */

const T0 = Date.parse('2026-09-18T09:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

const open = { lastInboundAt: iso(T0 - 60_000), nowMs: T0, conversationExists: true }
const closed = { lastInboundAt: iso(T0 - WA_WINDOW_MS), nowMs: T0, conversationExists: true }
const never = { lastInboundAt: null, nowMs: T0, conversationExists: true }

describe('free-form messages', () => {
  it('are allowed inside the 24-hour window', () => {
    const result = validateSendRequest({ conversation_id: 'c1', body: 'Thank you — see you Sunday.' }, open)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.kind).toBe('free_form')
      expect(result.body).toBe('Thank you — see you Sunday.')
    }
  })

  it('are refused with 409 window_closed outside it', () => {
    const result = validateSendRequest({ conversation_id: 'c1', body: 'Quick question' }, closed)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.error).toBe('window_closed')
      expect(result.message).toContain('approved template')
    }
  })

  it('are refused when the donor has never written to us', () => {
    const result = validateSendRequest({ conversation_id: 'c1', body: 'Hello' }, never)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.message).toContain('never messaged us')
    }
  })

  it('are refused at exactly 24 hours — the boundary belongs to "closed"', () => {
    const result = validateSendRequest(
      { conversation_id: 'c1', body: 'Hello' },
      { lastInboundAt: iso(T0 - WA_WINDOW_MS), nowMs: T0, conversationExists: true },
    )
    expect(result.ok).toBe(false)
  })

  it('are allowed one millisecond before it', () => {
    const result = validateSendRequest(
      { conversation_id: 'c1', body: 'Hello' },
      { lastInboundAt: iso(T0 - WA_WINDOW_MS + 1), nowMs: T0, conversationExists: true },
    )
    expect(result.ok).toBe(true)
  })

  it('cannot open a conversation that does not exist yet', () => {
    const result = validateSendRequest(
      { to_wa_id: '447700900999', body: 'Hello' },
      { lastInboundAt: null, nowMs: T0, conversationExists: false },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.message).toContain('approved template')
    }
  })
})

describe('templates', () => {
  it('are allowed outside the window — that is what they are for', () => {
    const result = validateSendRequest({ conversation_id: 'c1', template_name: 'dinner_invite_2026' }, closed)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.kind).toBe('template')
  })

  it('are allowed to a number nobody has ever written from', () => {
    const result = validateSendRequest(
      { to_wa_id: '+44 7700 900999', template_name: 'yahrzeit_reminder' },
      { lastInboundAt: null, nowMs: T0, conversationExists: false },
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.toWaId).toBe('+447700900999')
  })

  it('default to en_GB, and keep an explicit language', () => {
    const fallback = validateSendRequest({ conversation_id: 'c1', template_name: 't' }, closed)
    const explicit = validateSendRequest({ conversation_id: 'c1', template_name: 't', language: 'he' }, closed)
    expect(fallback.ok && fallback.language).toBe('en_GB')
    expect(explicit.ok && explicit.language).toBe('he')
  })

  it('carry their parameters in order, coercing loose values to strings', () => {
    const result = validateSendRequest(
      { conversation_id: 'c1', template_name: 't', params: ['Dovid', 5000, null] },
      closed,
    )
    expect(result.ok && result.params).toEqual(['Dovid', '5000', ''])
  })
})

describe('malformed requests', () => {
  it('need a conversation or a number', () => {
    const result = validateSendRequest({ body: 'hello' }, open)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('need a body or a template', () => {
    const result = validateSendRequest({ conversation_id: 'c1' }, open)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('bad_request')
  })

  it('refuse to be both at once', () => {
    const result = validateSendRequest({ conversation_id: 'c1', body: 'hi', template_name: 't' }, open)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('never both')
  })

  it('treat whitespace as empty', () => {
    const result = validateSendRequest({ conversation_id: 'c1', body: '   ' }, open)
    expect(result.ok).toBe(false)
  })
})

describe('the Graph API payload', () => {
  const accepted = (over: Partial<WaSendAccepted>): WaSendAccepted => ({
    ok: true,
    kind: 'free_form',
    conversationId: 'c1',
    toWaId: null,
    body: 'Hello',
    templateName: '',
    language: 'en_GB',
    params: [],
    ...over,
  })

  it('sends text as a text message with link previews off', () => {
    const payload = buildGraphPayload(accepted({}), '447700900123')
    expect(payload).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '447700900123',
      type: 'text',
      text: { preview_url: false, body: 'Hello' },
    })
  })

  it('sends a template with its language and body parameters', () => {
    const payload = buildGraphPayload(
      accepted({ kind: 'template', templateName: 'dinner_invite_2026', params: ['Dovid', '18 November'] }),
      '447700900123',
    ) as Record<string, any>
    expect(payload.type).toBe('template')
    expect(payload.template.name).toBe('dinner_invite_2026')
    expect(payload.template.language).toEqual({ code: 'en_GB' })
    expect(payload.template.components[0].parameters).toEqual([
      { type: 'text', text: 'Dovid' },
      { type: 'text', text: '18 November' },
    ])
  })

  it('omits the components array entirely for a template with no parameters', () => {
    const payload = buildGraphPayload(accepted({ kind: 'template', templateName: 't' }), '447700900123') as Record<
      string,
      any
    >
    expect(payload.template.components).toEqual([])
  })
})

describe('template parameters', () => {
  it('counts the highest placeholder, not the number of them', () => {
    expect(templatePlaceholderCount('Dear {{1}}, the dinner is on {{2}}.')).toBe(2)
    expect(templatePlaceholderCount('{{1}} and {{1}} again')).toBe(1)
    expect(templatePlaceholderCount('Hello {{2}}')).toBe(2)
    expect(templatePlaceholderCount('No parameters here')).toBe(0)
    expect(templatePlaceholderCount(null)).toBe(0)
  })

  it('tolerates the spaced spelling Meta allows', () => {
    expect(templatePlaceholderCount('Dear {{ 1 }}')).toBe(1)
  })

  it('previews with the values filled in, and leaves unfilled slots visible', () => {
    expect(renderTemplatePreview('Dear {{1}}, the dinner is on {{2}}.', ['Dovid'])).toBe(
      'Dear Dovid, the dinner is on {{2}}.',
    )
  })

  it('builds exactly one body component', () => {
    expect(templateComponents(['a', 'b'])).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
    ])
    expect(templateComponents([])).toEqual([])
  })
})

describe('the timeline prefill', () => {
  const messages = [
    { direction: 'out' as const, body: 'Good morning — are you around this week?', occurred_at: iso(T0 - 7_200_000) },
    { direction: 'in' as const, body: 'Thursday works', occurred_at: iso(T0 - 7_000_000) },
    { direction: 'out' as const, body: '11am at the yeshiva?', occurred_at: iso(T0 - 6_800_000) },
    { direction: 'in' as const, body: 'Perfect. I’ll bring the cheque.', occurred_at: iso(T0 - 6_600_000) },
  ]

  it('offers the last few messages, attributed, for a human to rewrite', () => {
    const prefill = timelinePrefill(messages)
    expect(prefill.split('\n')).toHaveLength(4)
    expect(prefill).toContain('Them: Perfect. I’ll bring the cheque.')
    expect(prefill).toContain('Us: 11am at the yeshiva?')
  })

  it('takes only the tail', () => {
    expect(timelinePrefill(messages, 2).split('\n')).toHaveLength(2)
  })

  it('skips messages with no text, so an attachment does not leave a blank line', () => {
    expect(timelinePrefill([{ direction: 'in', body: null, occurred_at: iso(T0) }])).toBe('')
  })
})
