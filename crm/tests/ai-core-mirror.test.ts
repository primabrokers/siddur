import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The three M9a edge functions run on Deno and cannot import from `src/`, so
 * each carries a copy of `src/features/ai/core.ts` next to its `index.ts`.
 *
 * A copy nobody checks is a copy that rots — and the two things this file
 * guards are the two that matter most: the bereavement/illness marker list
 * (09 §1.6) and the redaction rules (09 §1.7). A drifted mirror would mean the
 * tests above pass while the deployed function does something else.
 *
 * Regenerate a mirror with:
 *   { printf '<the four header lines>'; cat src/features/ai/core.ts; } \
 *     > supabase/functions/<name>/core.ts
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const CANONICAL = join(HERE, '..', 'src', 'features', 'ai', 'core.ts')
const FUNCTIONS = ['donor-brief', 'draft-message', 'send-digest'] as const

const read = (path: string): string => readFileSync(path, 'utf8')

describe('the edge-function mirrors of src/features/ai/core.ts', () => {
  const canonical = read(CANONICAL)

  it.each(FUNCTIONS)('%s/core.ts is the canonical file, byte for byte', (name) => {
    const mirror = read(join(HERE, '..', 'supabase', 'functions', name, 'core.ts'))
    expect(mirror.endsWith(canonical)).toBe(true)
  })

  it.each(FUNCTIONS)('%s/core.ts says it is generated, so nobody edits it in place', (name) => {
    const mirror = read(join(HERE, '..', 'supabase', 'functions', name, 'core.ts'))
    expect(mirror.split('\n')[0]).toContain('GENERATED MIRROR')
    expect(mirror).toContain('src/features/ai/core.ts')
  })

  it('the canonical file imports nothing — that is what makes it mirrorable', () => {
    expect(canonical).not.toMatch(/^\s*import\s/m)
    expect(canonical).not.toMatch(/\brequire\(/)
  })

  it.each(FUNCTIONS)('%s/index.ts imports the mirror rather than reimplementing it', (name) => {
    const index = read(join(HERE, '..', 'supabase', 'functions', name, 'index.ts'))
    expect(index).toContain("from './core.ts'")
  })
})
