/**
 * Environment / connection defaults.
 *
 * The Supabase URL and the *publishable* (anon) key are safe to ship in the
 * client — RLS is the security boundary (11 §2). `VITE_SUPABASE_URL` /
 * `VITE_SUPABASE_ANON_KEY` override the defaults for local or preview builds.
 */

const fromEnv = (key: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY'): string => {
  const value = import.meta.env?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** eu-west-2 project `zyvhcnhablkgbsgtljma`. */
export const SUPABASE_URL = fromEnv('VITE_SUPABASE_URL') || 'https://zyvhcnhablkgbsgtljma.supabase.co'

/**
 * The publishable key is safe to ship client-side (CLAUDE.md · Backend); `VITE_SUPABASE_ANON_KEY` overrides it. Left overridable
 * on purpose so nothing half-configured silently talks to the wrong project.
 */
export const SUPABASE_ANON_KEY =
  fromEnv('VITE_SUPABASE_ANON_KEY') || 'sb_publishable_TUrSdmuJIrQ-YJCH5zDkJg_QDdFCZw-'

/** False until a publishable key is supplied; the UI degrades to a notice. */
export const isConfigured: boolean = SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0
