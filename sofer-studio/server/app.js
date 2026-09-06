// server/app.js
// Request handler and server factory. Separated from server.js so tests can build
// an app against a temp database and random port.

import { createServer } from 'node:http';
import { matchRoute, isMutation, hasBody, bodyLimitFor } from './router.js';
import { validateHost, validateOrigin, validateContentType, validateToken, getSessionToken } from './security.js';
import { serveStatic } from './static.js';
import { sendError, readBody, parseJsonBody, MAX_BODY_IMPORT, MAX_BODY_DEFAULT, HttpError, BodyTooLargeError } from './http.js';

// F-36: a concise, non-path-bearing error log. We never print e.stack (which can
// embed absolute filesystem paths) or the error object wholesale.
function logUnexpected(e) {
  const msg = e && e.message ? String(e.message) : String(e);
  console.error('[sofer-studio] unexpected error:', msg);
}

export function createApp({ db, publicDir, port }) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const pathname = url.pathname;

      // Use the actual bound port (localPort) so same-origin compares against the
      // real listening port even when the server was started on port 0 in tests.
      const effectivePort = (req.socket && req.socket.localPort) ? req.socket.localPort : port;
      const hostCheck = validateHost(req, effectivePort);
      if (!hostCheck.ok) { sendError(res, 400, hostCheck.reason); return; }

      if (!pathname.startsWith('/api/')) {
        await serveStatic(req, res, publicDir);
        return;
      }

      const m = matchRoute(req.method, pathname);
      if (!m) { sendError(res, 404, 'not found'); return; }
      const { route, params } = m;
      const query = Object.fromEntries(url.searchParams);

      let body = {};
      if (isMutation(req.method)) {
        const tok = validateToken(req);
        if (!tok.ok) { sendError(res, 401, tok.reason); return; }
        const origin = validateOrigin(req, effectivePort);
        if (!origin.ok) { sendError(res, 403, origin.reason); return; }

        if (hasBody(req.method)) {
          const ct = validateContentType(req);
          if (!ct.ok) { sendError(res, 415, ct.reason); return; }
          const limit = bodyLimitFor(route) === 'import' ? MAX_BODY_IMPORT : MAX_BODY_DEFAULT;
          try {
            const raw = await readBody(req, limit);
            body = parseJsonBody(raw);
          } catch (e) {
            if (e instanceof BodyTooLargeError) { sendError(res, 413, 'request body too large'); return; }
            if (e instanceof HttpError) { sendError(res, e.status, e.message); return; }
            sendError(res, 400, 'bad request'); return;
          }
        }
      }

      await route.handler({ db, req, res, params, query, body, security: { getSessionToken } });
    } catch (e) {
      if (e instanceof HttpError) { sendError(res, e.status, e.message); return; }
      // F-36: log a concise, non-path-bearing message for unexpected errors. The
      // full stack (which can embed absolute filesystem paths) is never written in
      // normal operation; the client already receives only a generic 500.
      logUnexpected(e);
      sendError(res, 500, 'internal error');
    }
  });
}
