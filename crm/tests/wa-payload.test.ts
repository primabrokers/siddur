import { describe, expect, it } from 'vitest'
import {
  WA_STATUS_RANK,
  advanceStatus,
  parseWebhook,
  waTimestampToIso,
} from '../src/features/whatsapp/core'

/**
 * What arrives on the webhook (10 §2 Tier 2).
 *
 * The payloads below are the Cloud API's real shapes. Two properties matter
 * more than the parsing itself:
 *
 *   - nothing unreadable may throw — Meta retries anything that is not a 200,
 *     forever, so a payload we do not understand must degrade to `ignored`;
 *   - a message we cannot render must still be recorded, because a thread with
 *     a silent hole in it is worse than one that says "[location message]".
 */

const NOW = Date.parse('2026-09-18T12:00:00.000Z')
const seconds = (iso: string) => String(Math.floor(Date.parse(iso) / 1000))

const envelope = (value: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '102290129340398', changes: [{ field: 'messages', value }] }],
})

const textMessage = envelope({
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: '442038089000', phone_number_id: '106540352242922' },
  contacts: [{ profile: { name: 'Dovid Cohen' }, wa_id: '447700900123' }],
  messages: [
    {
      from: '447700900123',
      id: 'wamid.HBgLNDQ3NzAwOTAwMTIzFQIAEhgg',
      timestamp: seconds('2026-09-18T11:58:00.000Z'),
      type: 'text',
      text: { body: 'Thank you — I’ll transfer the £5,000 on Sunday bez"H' },
    },
  ],
})

describe('parsing inbound messages', () => {
  it('reads a text message, its sender, its id and its instant', () => {
    const parsed = parseWebhook(textMessage, NOW)
    expect(parsed.messages).toHaveLength(1)
    const [message] = parsed.messages
    expect(message.wa_id).toBe('+447700900123')
    expect(message.profile_name).toBe('Dovid Cohen')
    expect(message.wa_message_id).toBe('wamid.HBgLNDQ3NzAwOTAwMTIzFQIAEhgg')
    expect(message.msg_type).toBe('text')
    expect(message.body).toContain('£5,000')
    expect(message.occurred_at).toBe('2026-09-18T11:58:00.000Z')
  })

  it('normalises the bare digits Meta sends into the E.164 the contacts table holds', () => {
    // This is the whole matching story: Meta says `447700900123`, the donor
    // record says `+44 7700 900123`.
    expect(parseWebhook(textMessage, NOW).messages[0].wa_id).toBe('+447700900123')
  })

  it('records media by reference — id and mime type, never the file', () => {
    const parsed = parseWebhook(
      envelope({
        contacts: [{ profile: { name: 'Yehuda Klein' }, wa_id: '447700900456' }],
        messages: [
          {
            from: '447700900456',
            id: 'wamid.media1',
            timestamp: seconds('2026-09-18T10:00:00.000Z'),
            type: 'image',
            image: { id: '1521321321', mime_type: 'image/jpeg', sha256: 'abc', caption: 'The invitation' },
          },
        ],
      }),
      NOW,
    )
    const [message] = parsed.messages
    expect(message.msg_type).toBe('media')
    expect(message.media_id).toBe('1521321321')
    expect(message.media_mime).toBe('image/jpeg')
    expect(message.body).toBe('The invitation')
  })

  it('gives a captionless attachment a readable placeholder, so no list row is blank', () => {
    const parsed = parseWebhook(
      envelope({
        messages: [
          {
            from: '447700900456',
            id: 'wamid.media2',
            timestamp: seconds('2026-09-18T10:00:00.000Z'),
            type: 'document',
            document: { id: '99', mime_type: 'application/pdf' },
          },
        ],
      }),
      NOW,
    )
    expect(parsed.messages[0].body).toBe('[document]')
  })

  it('records an unsupported type rather than dropping it', () => {
    const parsed = parseWebhook(
      envelope({
        messages: [
          {
            from: '447700900789',
            id: 'wamid.loc1',
            timestamp: seconds('2026-09-18T10:00:00.000Z'),
            type: 'location',
            location: { latitude: 51.58, longitude: -0.19 },
          },
        ],
      }),
      NOW,
    )
    expect(parsed.messages[0].msg_type).toBe('unsupported')
    expect(parsed.messages[0].body).toContain('location')
  })

  it('takes the text out of a button or interactive reply', () => {
    const parsed = parseWebhook(
      envelope({
        messages: [
          {
            from: '447700900789',
            id: 'wamid.btn1',
            timestamp: seconds('2026-09-18T10:00:00.000Z'),
            type: 'button',
            button: { text: 'Count me in', payload: 'YES' },
          },
        ],
      }),
      NOW,
    )
    expect(parsed.messages[0].msg_type).toBe('unsupported')
    expect(parsed.messages[0].body).toBe('Count me in')
  })

  it('reads several messages from one delivery', () => {
    const parsed = parseWebhook(
      envelope({
        contacts: [{ profile: { name: 'Dovid' }, wa_id: '447700900123' }],
        messages: [
          { from: '447700900123', id: 'wamid.a', timestamp: seconds('2026-09-18T10:00:00.000Z'), type: 'text', text: { body: 'one' } },
          { from: '447700900123', id: 'wamid.b', timestamp: seconds('2026-09-18T10:01:00.000Z'), type: 'text', text: { body: 'two' } },
        ],
      }),
      NOW,
    )
    expect(parsed.messages.map((m) => m.body)).toEqual(['one', 'two'])
  })
})

describe('parsing status receipts', () => {
  const statusEnvelope = (status: string, extra: Record<string, unknown> = {}) =>
    envelope({
      statuses: [
        {
          id: 'wamid.out1',
          status,
          timestamp: seconds('2026-09-18T11:00:00.000Z'),
          recipient_id: '447700900123',
          ...extra,
        },
      ],
    })

  it.each(['sent', 'delivered', 'read'])('reads a %s receipt', (status) => {
    const parsed = parseWebhook(statusEnvelope(status), NOW)
    expect(parsed.statuses).toHaveLength(1)
    expect(parsed.statuses[0].status).toBe(status)
    expect(parsed.statuses[0].wa_message_id).toBe('wamid.out1')
    expect(parsed.statuses[0].recipient_wa_id).toBe('+447700900123')
  })

  it('keeps the reason a failure failed', () => {
    const parsed = parseWebhook(
      statusEnvelope('failed', {
        errors: [
          {
            code: 131047,
            title: 'Re-engagement message',
            error_data: { details: 'Message failed to send because more than 24 hours have passed.' },
          },
        ],
      }),
      NOW,
    )
    expect(parsed.statuses[0].status).toBe('failed')
    expect(parsed.statuses[0].error_detail).toContain('131047')
    expect(parsed.statuses[0].error_detail).toContain('24 hours')
  })

  it('ignores a status it does not know rather than inventing one', () => {
    const parsed = parseWebhook(statusEnvelope('warp-speed'), NOW)
    expect(parsed.statuses).toHaveLength(0)
    expect(parsed.ignored).toBe(1)
  })
})

describe('the status ladder', () => {
  it('ranks the ticks in order, with failure on top', () => {
    expect(WA_STATUS_RANK.sent).toBeLessThan(WA_STATUS_RANK.delivered)
    expect(WA_STATUS_RANK.delivered).toBeLessThan(WA_STATUS_RANK.read)
    expect(WA_STATUS_RANK.read).toBeLessThan(WA_STATUS_RANK.failed)
  })

  it('walks forward', () => {
    expect(advanceStatus('sent', 'delivered')).toBe('delivered')
    expect(advanceStatus('delivered', 'read')).toBe('read')
  })

  it('never walks backwards — receipts arrive out of order', () => {
    expect(advanceStatus('read', 'delivered')).toBe('read')
    expect(advanceStatus('delivered', 'sent')).toBe('delivered')
  })

  it('lets a failure outrank anything', () => {
    expect(advanceStatus('read', 'failed')).toBe('failed')
  })

  it('takes the receipt when there is nothing to compare with', () => {
    expect(advanceStatus(null, 'delivered')).toBe('delivered')
    expect(advanceStatus(undefined, 'sent')).toBe('sent')
  })
})

describe('tolerance — a webhook that cannot be understood must not be retried forever', () => {
  it.each([
    ['null', null],
    ['a string', 'nonsense'],
    ['an empty object', {}],
    ['entry without changes', { entry: [{ id: '1' }] }],
    ['a change with no value', { entry: [{ changes: [{ field: 'messages' }] }] }],
  ])('survives %s', (_label, payload) => {
    const parsed = parseWebhook(payload, NOW)
    expect(parsed.messages).toHaveLength(0)
    expect(parsed.statuses).toHaveLength(0)
  })

  it('counts a non-message field as ignored, not as an error', () => {
    const parsed = parseWebhook(
      { entry: [{ changes: [{ field: 'account_update', value: { event: 'VERIFIED' } }] }] },
      NOW,
    )
    expect(parsed.ignored).toBe(1)
  })

  it('skips a message with no id or no sender', () => {
    const parsed = parseWebhook(envelope({ messages: [{ type: 'text', text: { body: 'orphan' } }] }), NOW)
    expect(parsed.messages).toHaveLength(0)
    expect(parsed.ignored).toBe(1)
  })
})

describe('timestamps', () => {
  it('reads Meta’s unix seconds', () => {
    expect(waTimestampToIso('1789041480', NOW)).toBe(new Date(1789041480 * 1000).toISOString())
  })

  it('falls back to now rather than to 1970', () => {
    expect(waTimestampToIso(undefined, NOW)).toBe(new Date(NOW).toISOString())
    expect(waTimestampToIso('not-a-number', NOW)).toBe(new Date(NOW).toISOString())
    expect(waTimestampToIso('0', NOW)).toBe(new Date(NOW).toISOString())
  })
})
