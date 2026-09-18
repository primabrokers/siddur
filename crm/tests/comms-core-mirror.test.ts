import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `email-inbound` and `email-send` run on Deno and cannot import from `src/`,
 * so each carries a copy of `src/features/comms/core.ts` next to its
 * `index.ts` — the same arrangement the three M9a AI functions use.
 *
 * A copy nobody checks is a copy that rots, and what would rot here is the
 * worst possible thing to have two versions of: the thread key and the address
 * matching. A drifted mirror means the browser groups a conversation one way
 * and the webhook files it another, and nothing fails loudly.
 *
 * Regenerate a mirror with:
 *   { printf '<the four header lines>'; cat src/features/comms/core.ts; } \
 *     > supabase/functions/<name>/core.ts
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const CANONICAL = join(HERE, '..', 'src', 'features', 'comms', 'core.ts')
const FUNCTIONS = ['email-inbound', 'email-send'] as const

const read = (path: string): string => readFileSync(path, 'utf8')

describe('the edge-function mirrors of src/features/comms/core.ts', () => {
  const canonical = read(CANONICAL)

  it.each(FUNCTIONS)('%s/core.ts is the canonical file, byte for byte', (name) => {
    const mirror = read(join(HERE, '..', 'supabase', 'functions', name, 'core.ts'))
    expect(mirror.endsWith(canonical)).toBe(true)
  })

  it.each(FUNCTIONS)('%s/core.ts says it is generated, so nobody edits it in place', (name) => {
    const mirror = read(join(HERE, '..', 'supabase', 'functions', name, 'core.ts'))
    expect(mirror.split('\n')[0]).toContain('GENERATED MIRROR')
    expect(mirror).toContain('src/features/comms/core.ts')
  })

  it('the canonical file imports nothing — that is what makes it mirrorable', () => {
    expect(canonical).not.toMatch(/^\s*import\s/m)
  })

  it('the migration mirrors the same two rules in SQL', () => {
    const sql = read(join(HERE, '..', 'supabase', 'migrations', '011_email.sql'))
    // Plus-addressing stripped for matching, and the same `subj:<subject>|<counterpart>` key.
    expect(sql).toContain("regexp_replace(split_part(a, '@', 1), '\\+.*$', '')")
    expect(sql).toContain("return 'subj:' || v_subject || '|' || v_counterpart;")
    expect(canonical).toContain('return `subj:${subject}|${counterpart}`')
  })
})
