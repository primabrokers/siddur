/* Tests for js/sync.js — the offline-first user data layer.
 *
 * The behaviours worth proving are the ones that only show up when the network
 * is absent: that a write applies locally with no connection, that it survives
 * to be sent later, that a guest's setup is not lost when they sign in, and
 * that nothing opens a connection while the Shabbos gate is closed.
 *
 *   CHROME_PATH=... node test/sync.test.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8097;
const TYPES = { '.js': 'text/javascript', '.html': 'text/html' };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain' });
    res.end(data);
  });
});
await new Promise(r => server.listen(PORT, r));

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}
);
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}/test/fixture-sync.html`);

const results = await page.evaluate(async () => {
  const out = [];
  const t = (name, pass, detail) => out.push({ name, pass, detail: detail ?? '' });

  const calls = [];
  let online = false;   // start with no network at all
  window.fetch = (url, opts = {}) => {
    calls.push({ url: String(url), opts, method: opts.method || 'GET' });
    if (!online) return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve({
      ok: true, status: 200,
      text: () => Promise.resolve('[]'),
      json: () => Promise.resolve([])
    });
  };
  const reset = () => { calls.length = 0; };

  await Store.clear();
  localStorage.removeItem('luach:session');
  Auth._reloadSession();

  // ---- offline, signed out: the app must still work ----
  t('starts signed out', Auth.signedIn() === false);

  reset();
  const alarm = await Sync.alarms.add({ label: 'Shacharis', time_of_day: '07:15', scope: 'weekday' });
  t('alarm added while offline and signed out', !!alarm.id);
  t('add() issued no network request', calls.length === 0, `${calls.length} calls`);
  t('alarm readable straight back', (await Sync.alarms.list()).length === 1);
  t('guest row has no user_id yet', alarm.user_id === null);
  t('change is queued for later', (await Sync.pendingCount()) === 1);

  // ---- edits collapse rather than stacking ----
  await Sync.alarms.update(alarm.id, { time_of_day: '07:20' });
  await Sync.alarms.update(alarm.id, { time_of_day: '07:25' });
  t('repeated edits collapse to one queue entry', (await Sync.pendingCount()) === 1,
    `pending=${await Sync.pendingCount()}`);
  t('latest edit is the one held', (await Sync.alarms.list())[0].time_of_day === '07:25');

  // ---- a second collection, to prove they are independent ----
  await Sync.minyanim.add({ shul_name: 'Beis Medrash', tefillah: 'mincha', minyan_time: '13:30' });
  t('second collection stored separately', (await Sync.minyanim.list()).length === 1);
  t('both changes queued', (await Sync.pendingCount()) === 2);

  // ---- singleton ----
  await Sync.profile.set({ nusach: 'sefard', candle_offset_minutes: 22 });
  const prof = await Sync.profile.get();
  t('profile stored locally', prof.nusach === 'sefard' && prof.candle_offset_minutes === 22);

  // ---- push does nothing while signed out ----
  reset();
  const r1 = await Sync.push();
  t('push is a no-op when signed out', r1.pushed === 0 && calls.length === 0);

  // ---- sign in: guest data is adopted, not abandoned ----
  online = true;
  localStorage.setItem('luach:session', JSON.stringify({
    access_token: 'tok', refresh_token: 'ref',
    expires_at: Date.now() + 3600000, user: { id: 'user-xyz', email: 'y@example.com' }
  }));
  reset();
  Auth._reloadSession();
  t('signed in', Auth.signedIn() === true);

  // Signing in adopts the guest's rows and uploads them by itself. Wait for
  // that chain rather than driving it by hand — it is the real path, and
  // push() is single-flighted, so a manual call here would just receive the
  // in-flight promise and observe none of its requests.
  await new Promise(r => setTimeout(r, 150));

  t('guest rows adopted automatically on sign-in',
    (await Sync.alarms.list()).every(r => r.user_id === 'user-xyz'));
  t('queue drained by the sign-in sync', (await Sync.pendingCount()) === 0,
    `pending=${await Sync.pendingCount()}`);

  const posts = calls.filter(c => c.method === 'POST');
  t('rows uploaded via POST to /rest/v1/', posts.length >= 3, `${posts.length} posts`);
  t('every uploaded row carries a user_id',
    posts.every(c => { try { return JSON.parse(c.opts.body).every(r => r.user_id === 'user-xyz' || r.id === 'user-xyz'); } catch (e) { return false; } }));
  t('server state pulled after sign-in',
    calls.some(c => c.method === 'GET' && c.url.includes('/rest/v1/luach_alarms')));

  // ---- delete is sent even when an upsert is still queued ----
  const a2 = await Sync.alarms.add({ label: 'Mincha', time_of_day: '13:00' });
  await new Promise(r => setTimeout(r, 100));          // row reaches the server
  reset();
  await Sync.alarms.remove(a2.id);
  await new Promise(r => setTimeout(r, 100));          // let the auto-push run
  t('removed locally', (await Sync.alarms.list()).find(r => r.id === a2.id) === undefined);
  t('a delete still reaches the server',
    calls.some(c => c.method === 'DELETE' && c.url.includes('id=eq.' + a2.id)),
    calls.map(c => c.method).join(',') || 'no calls');

  // ---- the Shabbos gate ----
  Sync.gate(() => false);
  reset();
  await Sync.alarms.add({ label: 'Maariv', time_of_day: '21:00' });
  t('write still applies locally with the gate closed',
    (await Sync.alarms.list()).some(r => r.label === 'Maariv'));
  t('gate closed means no automatic request', calls.length === 0, `${calls.length} calls`);
  t('the change waits in the queue', (await Sync.pendingCount()) >= 1);
  Sync.gate(() => true);

  return out;
});

console.log('\n  js/sync.js\n  ' + '-'.repeat(62));
let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`  ${r.pass ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
}
console.log('  ' + '-'.repeat(62));
console.log(`  ${results.length - failed}/${results.length} passed\n`);

await browser.close();
server.close();
process.exit(failed ? 1 : 0);
