// server.js — Sofer Studio entry point (Node 22, built-in http, better-sqlite3).

import { fileURLToPath } from 'node:url';
import { openDatabase } from './db/db.js';
import { createApp } from './server/app.js';

const PORT = Number(process.env.SOFER_PORT) || 4247;
const dbPath = process.env.SOFER_DB || fileURLToPath(new URL('./data/sofer.db', import.meta.url));
const PUBLIC_DIR = fileURLToPath(new URL('./public', import.meta.url));

const db = openDatabase(dbPath);
const server = createApp({ db, publicDir: PUBLIC_DIR, port: PORT });

server.listen(PORT, '127.0.0.1', () => {
  console.log('Sofer Studio server listening on http://127.0.0.1:' + PORT);
});

server.on('error', (err) => {
  console.error('server error', err);
});

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });

export { server, db };
