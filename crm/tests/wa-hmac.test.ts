import { createHmac, webcrypto } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  constantTimeEquals,
  handshakeDecision,
  hmacSha256Hex,
  parseSignatureHeader,
  timingSafeEqualHex,
  verifyWebhookSignature,
} from '../src/features/whatsapp/core'

/**
 * Webhook authentication (10 §2 Tier 2).
 *
 * `wa-webhook` runs with `verify_jwt = false` — Meta's servers have no Supabase
 * token — so these two checks *are* the authentication. Node's own `crypto`
 * generates the expected digests independently of the implementation under
 * test, so a bug in `hmacSha256Hex` cannot agree with itself and pass.
 *
 */

// The suite runs under jsdom (the shared `vitest.setup.ts` needs a `window`),
// and jsdom's `crypto` may carry no WebCrypto `subtle`. Deno and Supabase's
// edge runtime always do, so lending Node's here exercises the real code path
// rather than working around it.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

const SECRET = 'meta-app-secret-9f2b'
const nodeHmac = (secret: string, body: string) => createHmac('sha256', secret).update(body, 'utf8').digest('hex')

describe('HMAC-SHA256 over the raw body', () => {
  it('matches Node’s own digest for a realistic payload', async () => {
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '1234' }] })
    expect(await hmacSha256Hex(SECRET, raw)).toBe(nodeHmac(SECRET, raw))
  })

  it('matches the RFC-style empty-message case', async () => {
    expect(await hmacSha256Hex(SECRET, '')).toBe(nodeHmac(SECRET, ''))
  })

  it('is sensitive to whitespace — which is why the RAW body is hashed', async () => {
    // `JSON.parse` then `JSON.stringify` would produce the second string from
    // the first and the digest would never match again.
    const compact = '{"a":1,"b":2}'
    const spaced = '{"a": 1, "b": 2}'
    expect(await hmacSha256Hex(SECRET, compact)).not.toBe(await hmacSha256Hex(SECRET, spaced))
  })

  it('is sensitive to key order for the same reason', async () => {
    expect(await hmacSha256Hex(SECRET, '{"a":1,"b":2}')).not.toBe(await hmacSha256Hex(SECRET, '{"b":2,"a":1}'))
  })

  it('handles non-ASCII bodies as UTF-8', async () => {
    const raw = JSON.stringify({ text: { body: 'תזכו למצוות — כתיבה וחתימה טובה' } })
    expect(await hmacSha256Hex(SECRET, raw)).toBe(nodeHmac(SECRET, raw))
  })

  it('changes completely with the secret', async () => {
    const raw = '{"x":1}'
    expect(await hmacSha256Hex(SECRET, raw)).not.toBe(await hmacSha256Hex(`${SECRET}!`, raw))
  })
})

describe('the X-Hub-Signature-256 header', () => {
  const digest = 'a'.repeat(64)

  it('accepts the documented shape', () => {
    expect(parseSignatureHeader(`sha256=${digest}`)).toBe(digest)
  })

  it('lowercases, so an upper-case digest still compares', () => {
    expect(parseSignatureHeader(`sha256=${'A'.repeat(64)}`)).toBe(digest)
  })

  it.each([
    ['missing', null],
    ['empty', ''],
    ['unprefixed', digest],
    ['wrong algorithm', `sha1=${digest}`],
    ['short', 'sha256=abc'],
    ['non-hex', `sha256=${'z'.repeat(64)}`],
  ])('refuses a %s header', (_label, header) => {
    expect(parseSignatureHeader(header as string | null)).toBeNull()
  })
})

describe('constant-time comparison', () => {
  it('is true only for identical digests', () => {
    expect(timingSafeEqualHex('abcd', 'abcd')).toBe(true)
    expect(timingSafeEqualHex('abcd', 'abce')).toBe(false)
  })

  it('is false for a null side or a length mismatch', () => {
    expect(timingSafeEqualHex(null, 'abcd')).toBe(false)
    expect(timingSafeEqualHex('abcd', null)).toBe(false)
    expect(timingSafeEqualHex('abcd', 'abcde')).toBe(false)
  })

  it('compares verify tokens the same way', () => {
    expect(constantTimeEquals('hello-yeshiva', 'hello-yeshiva')).toBe(true)
    expect(constantTimeEquals('hello-yeshiva', 'hello-yeshivb')).toBe(false)
    expect(constantTimeEquals('', '')).toBe(true)
  })
})

describe('verifyWebhookSignature — the whole check', () => {
  const raw = JSON.stringify({ entry: [{ changes: [{ field: 'messages', value: {} }] }] })

  it('accepts a correctly signed body', async () => {
    const header = `sha256=${nodeHmac(SECRET, raw)}`
    expect(await verifyWebhookSignature(SECRET, raw, header)).toBe(true)
  })

  it('refuses a body that was altered after signing', async () => {
    const header = `sha256=${nodeHmac(SECRET, raw)}`
    expect(await verifyWebhookSignature(SECRET, `${raw} `, header)).toBe(false)
  })

  it('refuses a signature made with a different secret', async () => {
    const header = `sha256=${nodeHmac('not-our-secret', raw)}`
    expect(await verifyWebhookSignature(SECRET, raw, header)).toBe(false)
  })

  it('refuses a missing signature outright', async () => {
    expect(await verifyWebhookSignature(SECRET, raw, null)).toBe(false)
  })
})

describe('the GET subscription handshake', () => {
  const VERIFY = 'yeshiva-verify-token'

  it('echoes the challenge verbatim when the token matches', () => {
    const decision = handshakeDecision({
      verifyToken: VERIFY,
      mode: 'subscribe',
      token: VERIFY,
      challenge: '1158201444',
    })
    expect(decision).toEqual({ status: 200, body: '1158201444', contentType: 'text/plain' })
  })

  it('answers 503 when no verify token is configured — the honest unset state', () => {
    expect(
      handshakeDecision({ verifyToken: '', mode: 'subscribe', token: 'anything', challenge: '1' }).status,
    ).toBe(503)
    expect(
      handshakeDecision({ verifyToken: null, mode: 'subscribe', token: 'anything', challenge: '1' }).status,
    ).toBe(503)
  })

  it('answers 403 with no detail on a wrong token', () => {
    const decision = handshakeDecision({
      verifyToken: VERIFY,
      mode: 'subscribe',
      token: 'guess',
      challenge: '1',
    })
    expect(decision.status).toBe(403)
    expect(decision.body).toBe('Forbidden')
  })

  it('answers 403 on the wrong mode or a missing challenge', () => {
    expect(handshakeDecision({ verifyToken: VERIFY, mode: 'unsubscribe', token: VERIFY, challenge: '1' }).status).toBe(403)
    expect(handshakeDecision({ verifyToken: VERIFY, mode: 'subscribe', token: VERIFY, challenge: null }).status).toBe(403)
  })
})
