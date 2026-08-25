import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { SUPABASE_ANON_KEY, SUPABASE_URL, isConfigured } from './env'

/**
 * The single browser client. RLS is the security boundary — the client only
 * reflects it (11 §2); it never carries a service key.
 */
export type Client = SupabaseClient<Database>

// supabase-js refuses to construct with an empty key. When the publishable key
// has not been supplied we still build a client so the app renders (and shows
// the "not configured" notice) instead of crashing at import time.
const key = SUPABASE_ANON_KEY || 'anon-key-not-configured'

export const supabase: Client = createClient<Database>(SUPABASE_URL, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
})

export { isConfigured }
