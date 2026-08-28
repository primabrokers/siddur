/**
 * Talking to the live Supabase project from a test — **LIVE=1 only**.
 *
 * Deliberately raw `fetch` against GoTrue and PostgREST rather than
 * `supabase-js`: an RLS conformance test has to prove that *the API* refuses,
 * not that a client library declined to ask. A 403 or an empty body from
 * PostgREST is the evidence; anything a wrapper could paper over is not.
 *
 * Running these:
 *
 *   LIVE=1 NODE_USE_ENV_PROXY=1 npm test -- tests/acceptance
 *
 * `NODE_USE_ENV_PROXY=1` matters in this sandbox: outbound HTTPS goes through
 * an authenticated proxy that Node only honours with that flag set.
 *
 * TEST CREDENTIALS (demo project `zyvhcnhablkgbsgtljma`, invented data only):
 *   admin@demo.test       · YeshivaCrm-demo1 · role admin
 *   fundraiser@demo.test  · YeshivaCrm-demo1 · role fundraiser
 *   viewer@demo.test      · YeshivaCrm-demo1 · role viewer, can_see_amounts=false
 * Override with LIVE_PASSWORD if the project's demo password is rotated.
 */

export const LIVE = process.env.LIVE === '1'

export const LIVE_URL = (process.env.VITE_SUPABASE_URL ?? 'https://zyvhcnhablkgbsgtljma.supabase.co').replace(
  /\/$/,
  '',
)

export const LIVE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_TUrSdmuJIrQ-YJCH5zDkJg_QDdFCZw-'

const PASSWORD = process.env.LIVE_PASSWORD ?? 'YeshivaCrm-demo1'

export type LiveRole = 'admin' | 'fundraiser' | 'viewer'

export const LIVE_USERS: Record<LiveRole, string> = {
  admin: 'admin@demo.test',
  fundraiser: 'fundraiser@demo.test',
  viewer: 'viewer@demo.test',
}

/** One sign-in per role per run; a token is good for an hour. */
const tokens = new Map<LiveRole, string>()

export async function signIn(role: LiveRole): Promise<string> {
  const cached = tokens.get(role)
  if (cached) return cached

  const response = await fetch(`${LIVE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: LIVE_ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: LIVE_USERS[role], password: PASSWORD }),
  })
  const body = (await response.json()) as { access_token?: string; error_description?: string; msg?: string }
  if (!response.ok || !body.access_token) {
    throw new Error(
      `sign-in failed for ${LIVE_USERS[role]}: ${response.status} ${body.error_description ?? body.msg ?? ''}`,
    )
  }
  tokens.set(role, body.access_token)
  return body.access_token
}

/** The `sub` claim — the caller's `auth.users.id`, which policies compare on. */
export async function userId(role: LiveRole): Promise<string> {
  const token = await signIn(role)
  const payload = token.split('.')[1] ?? ''
  const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  return (JSON.parse(json) as { sub: string }).sub
}

export interface RestResponse<T = unknown> {
  status: number
  ok: boolean
  body: T
  /** PostgREST's error code, when the body carries one (`42501` = RLS deny). */
  code: string | null
  message: string | null
}

export async function rest<T = unknown>(
  role: LiveRole,
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<RestResponse<T>> {
  const token = await signIn(role)
  const headers: Record<string, string> = {
    apikey: LIVE_ANON_KEY,
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  }
  if (init.prefer) headers.prefer = init.prefer

  const response = await fetch(`${LIVE_URL}/rest/v1/${path}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })

  const text = await response.text()
  let parsed: unknown = null
  try {
    parsed = text === '' ? null : JSON.parse(text)
  } catch {
    parsed = text
  }
  const asError = parsed as { code?: string; message?: string } | null

  return {
    status: response.status,
    ok: response.ok,
    body: parsed as T,
    code: typeof asError?.code === 'string' ? asError.code : null,
    message: typeof asError?.message === 'string' ? asError.message : null,
  }
}

/** True when the project answers at all — used to skip rather than fail. */
export async function liveReachable(): Promise<boolean> {
  if (!LIVE) return false
  try {
    const response = await fetch(`${LIVE_URL}/rest/v1/`, { headers: { apikey: LIVE_ANON_KEY } })
    return response.status < 500
  } catch {
    return false
  }
}
