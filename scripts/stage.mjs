#!/usr/bin/env node
/* Stages the servable app into www/ — the one list of what actually ships.
 *
 * Capacitor's webDir was "." which made a native build copy the whole repo
 * into the app bundle: .git, node_modules, the test fixtures (live pages that
 * stub fetch), the SQL migration. This script is the fix, and doubles as the
 * single source of truth for every deploy target; the Pages workflow and
 * .vercelignore mirror the same list.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'www');

const FILES = ['index.html', 'siddur.html', 'chumash.html', 'tehillim.html', 'mishnayos.html',
               'offline.html', 'manifest.webmanifest', 'sw.js'];
const DIRS = ['icons', 'js'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const f of FILES) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
for (const d of DIRS) fs.cpSync(path.join(ROOT, d), path.join(OUT, d), { recursive: true });

const count = fs.readdirSync(OUT, { recursive: true }).length;
console.log(`Staged ${count} entries into www/`);
