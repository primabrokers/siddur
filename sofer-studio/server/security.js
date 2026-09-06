// server/security.js
// Host/Origin validation, content-type enforcement, per-session token, body limits.
// Never log tokens.

import { randomBytes } from 'node:crypto';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

// Validate the Host header is loopback (optionally with the bound port).
export function validateHost(req, boundPort) {
  const host = (req.headers.host || '').trim();
  if (!host) return { ok: false, reason: 'missing Host header' };
  let hostname = host;
  let port = null;
  // IPv6 literal
  if (host.startsWith('[')) {
    const m = host.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (!m) return { ok: false, reason: 'malformed Host header' };
    hostname = m[1];
    port = m[2] ? Number(m[2]) : null;
  } else if (host.includes(':')) {
    const idx = host.lastIndexOf(':');
    hostname = host.slice(0, idx);
    port = Number(host.slice(idx + 1));
  }
  if (!LOOPBACK_HOSTS.has(hostname.toLowerCase()) && !LOOPBACK_HOSTS.has(hostname)) {
    return { ok: false, reason: 'non-loopback Host header' };
  }
  // F-30: enforce the port when one is present in the Host header, using the same
  // effective bound port as Origin validation. A Host like 127.0.0.1:9999 on a
  // server bound elsewhere is rejected; a portless loopback Host stays allowed.
  if (port != null && port !== Number(boundPort)) {
    return { ok: false, reason: 'Host port mismatch' };
  }
  return { ok: true };
}

// Reject cross-origin state-changing requests. When an Origin header is present it
// must be the EXACT same-origin scheme+host+port as the bound server. The token is
// additional protection, never permission to ignore the Origin contract.
export function validateOrigin(req, boundPort) {
  const origin = req.headers.origin;
  if (!origin) return { ok: true }; // non-browser client (no Origin) is allowed
  if (origin === 'null') return { ok: false, reason: 'cross-origin request blocked (opaque origin)' };
  let u;
  try {
    u = new URL(origin);
  } catch {
    return { ok: false, reason: 'malformed Origin header' };
  }
  if (u.protocol !== 'http:') {
    return { ok: false, reason: 'cross-origin request blocked' };
  }
  const hostname = u.hostname.toLowerCase();
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
    return { ok: false, reason: 'cross-origin request blocked' };
  }
  const port = u.port ? Number(u.port) : 80; // http default
  if (port !== Number(boundPort)) {
    return { ok: false, reason: 'cross-origin request blocked (port mismatch)' };
  }
  return { ok: true };
}

// Mutation endpoints require application/json.
export function validateContentType(req) {
  const ct = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (ct !== 'application/json') {
    return { ok: false, reason: 'Content-Type must be application/json' };
  }
  return { ok: true };
}

// Per-session token (in-memory; lazily created on first session request).
let sessionToken = null;
export function getSessionToken() {
  if (!sessionToken) sessionToken = randomBytes(32).toString('hex');
  return sessionToken;
}

export function validateToken(req) {
  const supplied = req.headers['x-sofer-token'];
  if (!supplied) return { ok: false, reason: 'missing X-Sofer-Token' };
  if (supplied !== getSessionToken()) return { ok: false, reason: 'invalid X-Sofer-Token' };
  return { ok: true };
}
