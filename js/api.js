/* Supabase auth + REST, written against the HTTP API directly.
 *
 * No supabase-js: this is a zero-build static PWA whose service worker
 * precaches its own shell, and a CDN script is both a build step and a runtime
 * dependency the offline case cannot satisfy. The surface actually needed here
 * is small — sign in, refresh, and CRUD on seven tables.
 *
 * Sign-in is a 6-digit emailed code rather than a magic link. Magic links
 * require deep-link handling to return into a Capacitor app, and a code works
 * identically on web and native. This needs one change in Supabase:
 *   Authentication -> Emails -> Magic Link, include {{ .Token }} in the body.
 * Without it the email still arrives, but as a link instead of a code.
 *
 * Every call assumes it may fail. The app is offline-first by design — on
 * Shabbos there is no network by intent — so callers treat a rejection as
 * "not now" and fall back to local state rather than surfacing an error.
 */
(function (global) {
  'use strict';

  const CFG = global.CONFIG;
  const SESSION_KEY = 'luach:session';
  // Refresh this far ahead of expiry, so a request in flight does not race it.
  const REFRESH_MARGIN_MS = 60 * 1000;

  let session = null;
  let refreshing = null;          // single-flight guard
  const listeners = new Set();

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveSession(s) {
    session = s;
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* private mode: session lasts the tab, which is survivable */ }
    listeners.forEach(fn => { try { fn(s); } catch (e) {} });
  }

  session = loadSession();

  /* A second tab signing in or out rewrites the stored session under us. The
     storage event fires only in the *other* tabs, which is exactly what is
     wanted: re-read so every tab agrees on who is signed in. */
  function reloadSession() {
    session = loadSession();
    listeners.forEach(fn => { try { fn(session); } catch (e) {} });
  }
  if (global.addEventListener) {
    global.addEventListener('storage', e => {
      if (e.key === SESSION_KEY) reloadSession();
    });
  }

  function normalise(raw) {
    if (!raw || !raw.access_token) throw new Error('malformed session response');
    return {
      access_token: raw.access_token,
      refresh_token: raw.refresh_token,
      // expires_at is seconds in the API; keep milliseconds internally.
      expires_at: raw.expires_at ? raw.expires_at * 1000
                                 : Date.now() + ((raw.expires_in || 3600) * 1000),
      user: raw.user || null
    };
  }

  async function authFetch(path, body, query) {
    const res = await fetch(CFG.SUPABASE_URL + '/auth/v1' + path + (query || ''), {
      method: 'POST',
      headers: {
        apikey: CFG.SUPABASE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) {}
    if (!res.ok) {
      const msg = (data && (data.error_description || data.msg || data.message)) || ('HTTP ' + res.status);
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* Returns a usable access token, refreshing if it is close to expiry.
     Resolves null when nobody is signed in — callers then use the publishable
     key and get whatever RLS grants anonymous readers. */
  async function accessToken() {
    if (!session) return null;
    if (Date.now() < session.expires_at - REFRESH_MARGIN_MS) return session.access_token;

    // Concurrent callers share one refresh rather than racing to rotate the
    // refresh token, which would invalidate each other's copy.
    if (!refreshing) {
      refreshing = authFetch('/token', { refresh_token: session.refresh_token }, '?grant_type=refresh_token')
        .then(raw => { const s = normalise(raw); saveSession(s); return s.access_token; })
        .catch(err => {
          // A refresh token rejected by the server is spent — the session is
          // genuinely over. Anything else (offline, 5xx) is transient, so keep
          // the session and let the caller retry later.
          if (err.status === 400 || err.status === 401) saveSession(null);
          throw err;
        })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  const Auth = {
    /* Ask for a code. create_user lets first-time users in without a separate
       sign-up path — there is no distinction worth making in this app. */
    requestCode(email) {
      return authFetch('/otp', { email: String(email).trim(), create_user: true })
        .then(() => true);
    },

    verifyCode(email, code) {
      return authFetch('/verify', {
        email: String(email).trim(),
        token: String(code).trim(),
        type: 'email'
      }).then(raw => { const s = normalise(raw); saveSession(s); return s.user; });
    },

    signOut() {
      const token = session && session.access_token;
      saveSession(null);
      if (!token) return Promise.resolve();
      // Best effort: the local session is already gone, which is what the user
      // asked for. A failed server revoke should not surface as an error.
      return fetch(CFG.SUPABASE_URL + '/auth/v1/logout', {
        method: 'POST',
        headers: { apikey: CFG.SUPABASE_KEY, Authorization: 'Bearer ' + token }
      }).then(() => undefined).catch(() => undefined);
    },

    user() { return session && session.user; },
    signedIn() { return !!session; },

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    // Exposed for the sync layer and tests; not part of the app-facing surface.
    _accessToken: accessToken,
    _reloadSession: reloadSession
  };

  /* ---- REST ---- */

  async function rest(method, table, { query = '', body = null, prefer = '' } = {}) {
    const token = await accessToken().catch(() => null);
    const headers = {
      apikey: CFG.SUPABASE_KEY,
      Authorization: 'Bearer ' + (token || CFG.SUPABASE_KEY),
      'Content-Type': 'application/json'
    };
    if (prefer) headers.Prefer = prefer;

    const res = await fetch(CFG.SUPABASE_URL + '/rest/v1/' + table + query, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const err = new Error(`${method} ${table} -> HTTP ${res.status}${detail ? ': ' + detail : ''}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  /* PostgREST query parameters that shape a result rather than restrict which
     rows it covers. A DELETE carrying only these is unfiltered. */
  const NOT_FILTERS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

  function hasFilter(query) {
    if (!query) return false;
    try {
      for (const [k, v] of new URLSearchParams(query.replace(/^\?/, ''))) {
        if (!NOT_FILTERS.has(k) && v !== '') return true;
      }
    } catch (e) { return false; }
    return false;
  }

  const Api = {
    select(table, query) { return rest('GET', table, { query: query || '' }); },

    /* merge-duplicates makes this an upsert on the table's primary key.
       representation returns the stored rows, so callers see server defaults
       rather than guessing at them. */
    upsert(table, rows) {
      return rest('POST', table, {
        body: Array.isArray(rows) ? rows : [rows],
        prefer: 'resolution=merge-duplicates,return=representation'
      });
    },

    insert(table, rows) {
      return rest('POST', table, {
        body: Array.isArray(rows) ? rows : [rows],
        prefer: 'return=representation'
      });
    },

    update(table, query, patch) {
      return rest('PATCH', table, { query, body: patch, prefer: 'return=representation' });
    },

    remove(table, query) {
      // PostgREST deletes every row it can see when no filter is given, so an
      // unfiltered DELETE must never leave here. Checking for '=' is not
      // enough: '?select=*' contains one and filters nothing, which would wipe
      // the caller's whole table.
      if (!hasFilter(query)) {
        return Promise.reject(new Error(
          'remove() requires a row filter, e.g. ?id=eq.<uuid> — refusing to delete unfiltered'));
      }
      return rest('DELETE', table, { query });
    }
  };

  global.Auth = Auth;
  global.Api = Api;
})(typeof window !== 'undefined' ? window : this);
