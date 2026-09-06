// db/db.js
// Database connection and small helpers. Synchronous (better-sqlite3).

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { applyMigrations } from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DB_PATH = new URL('../data/sofer.db', import.meta.url).pathname;

export function openDatabase(dbPath = DEFAULT_DB_PATH) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

export function getId() {
  return randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}
