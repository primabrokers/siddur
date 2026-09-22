// server/static.js
// Serve static files from a directory (the frontend's public/ tree), with path
// traversal protection and a small MIME map.

import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8',
};

export async function serveStatic(req, res, publicDir) {
  let pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (pathname === '/') pathname = '/index.html';
  // Prevent traversal
  const norm = normalize(pathname).replace(/^([.\/\s]+)/, '');
  const filePath = join(publicDir, norm);
  if (!filePath.startsWith(normalize(publicDir) + sep) && filePath !== normalize(publicDir)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  let data;
  try {
    if (extname(filePath).toLowerCase() === '.zip') {
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error('Not a file');
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': info.size,
        'Content-Disposition': 'attachment; filename="Sofer-Studio-Windows-x64.zip"' });
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(filePath);
      stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy());
      stream.pipe(res); return;
    }
    data = await readFile(filePath);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const ext = extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(data);
}
