import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The two WhatsApp edge functions run on Deno and cannot import from `src/`, so
 * each carries a copy of `src/features/whatsapp/core.ts` next to its
 * `index.ts`.
 *
 * A copy nobody checks is a copy that rots — and what rots here is the
 * compliance rule itself: the 24-hour window, the signature check and the send
 * validation all live in that file. A drifted mirror would mean these tests
 * pass while the deployed function enforces something else.
 *
 * Regenerate a mirror with:
 *   { printf '<the four header lines>'; cat src/features/whatsapp/core.ts; } \
 *     > supabase/functions/<name>/core.ts
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const CANONICAL = join(HERE, '..', 'src', 'features', 'whatsapp', 'core.ts')
const FUNCTIONS = ['wa-webhook', 'wa-send'] as const

const read = (path: string): string => readFileSync(path, 'utf8')

describe('the edge-function mirrors of src/features/whatsapp/core.ts', () => {
  const canonical = read(CANONICAL)

  it.each(FUNCTIONS)('%s/core.ts is the canonical file, byte for byte', (name) => {
    const mirror = read(join(HERE, '..', 'supabase', 'functions', name, 'core.ts'))
    expect(mirror.endsWith(canonical)).toBe(true)
  })

  it.each(FUNCTIONS)('%s/core.ts says it is generated, so nobody edits it in place', (name) => {
    const mirror = read(join(HERE, '..', 'supabase', 'functions', name, 'core.ts'))
    expect(mirror.split('\n')[0]).toContain('GENERATED MIRROR')
    expect(mirror).toContain('src/features/whatsapp/core.ts')
  })

  it('the canonical file imports nothing — that is what makes it mirrorable', () => {
    expect(canonical).not.toMatch(/^\s*import\s/m)
    expect(canonical).not.toMatch(/\brequire\(/)
  })

  it.each(FUNCTIONS)('%s/index.ts imports the mirror rather than reimplementing it', (name) => {
    const index = read(join(HERE, '..', 'supabase', 'functions', name, 'index.ts'))
    expect(index).toContain("from './core.ts'")
  })

  it('the webhook never sends — I-10 is checked, not just promised', () => {
    const index = read(join(HERE, '..', 'supabase', 'functions', 'wa-webhook', 'index.ts'))
    expect(index).not.toContain('graph.facebook.com')
  })

  it('wa-send builds its client from the caller’s token, never the service role', () => {
    const index = read(join(HERE, '..', 'supabase', 'functions', 'wa-send', 'index.ts'))
    expect(index).toContain('SUPABASE_ANON_KEY')
    expect(index).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('neither function reaches WhatsApp by anything but the official Cloud API (10 §2 Tier 3 is rejected)', () => {
    for (const name of FUNCTIONS) {
      const index = read(join(HERE, '..', 'supabase', 'functions', name, 'index.ts'))
      expect(index).not.toMatch(/web\.whatsapp\.com|puppeteer|playwright|baileys|whatsapp-web\.js/i)
    }
  })
})
