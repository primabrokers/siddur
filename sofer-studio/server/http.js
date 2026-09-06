// server/http.js
// Response helpers and bounded body reader.

export const MAX_BODY_IMPORT = 20 * 1024 * 1024; // 20MB for source import
export const MAX_BODY_DEFAULT = 1 * 1024 * 1024; // 1MB otherwise

export function sendJson(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  res.end(body);
}

export function sendError(res, status, message) {
  // Safe errors: never leak stack traces or internal paths.
  sendJson(res, status, { error: String(message) });
}

export function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        if (!settled) {
          settled = true;
          // Do not destroy the socket here; drain and reject so the server can
          // still write a 413 response.
          reject(new BodyTooLargeError('request body too large'));
        }
        return; // keep consuming so the connection can cleanly complete
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
    req.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

export class BodyTooLargeError extends Error {}
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function parseJsonBody(text) {
  if (!text || !text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'malformed JSON body');
  }
}
