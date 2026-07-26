/* Tests for js/api.js — auth token handling and REST request shaping.
 *
 * fetch is stubbed rather than hitting Supabase: what needs verifying is the
 * client's own logic (which key it sends, when it refreshes, whether it
 * refuses a dangerous delete), and a live backend would make those assertions
 * slower and less precise, not more truthful.
 *
 *   CHROME_PATH=... node test/api.test.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8098;
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

// A bare page: load only config.js and api.js, so nothing else can interfere.
await page.goto(`http://localhost:${PORT}/test/fixture.html`);

const results = await page.evaluate(async () => {
  const out = [];
  const t = (name, pass, detail) => out.push({ name, pass, detail: detail ?? '' });

  // --- fetch stub ---
  const calls = [];
  let nextResponse = () => ({ ok: true, status: 200, body: '{}' });
  window.fetch = (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const r = nextResponse(String(url), opts);
    return Promise.resolve({
      ok: r.ok, status: r.status,
      text: () => Promise.resolve(r.body),
      json: () => Promise.resolve(JSON.parse(r.body || 'null'))
    });
  };
  const lastCall = () => calls[calls.length - 1];
  const reset = () => { calls.length = 0; };

  localStorage.removeItem('luach:session');

  t('Auth and Api exposed', typeof Auth === 'object' && typeof Api === 'object');
  t('starts signed out', Auth.signedIn() === false);

  // --- requesting a code ---
  reset();
  nextResponse = () => ({ ok: true, status: 200, body: '{}' });
  await Auth.requestCode('  Yid@example.com  ');
  t('requestCode posts to /auth/v1/otp', lastCall().url.endsWith('/auth/v1/otp'),
    lastCall().url);
  const otpBody = JSON.parse(lastCall().opts.body);
  t('requestCode trims the email', otpBody.email === 'Yid@example.com', otpBody.email);
  t('requestCode allows first-time users', otpBody.create_user === true);

  // --- verifying a code establishes a session ---
  reset();
  nextResponse = () => ({ ok: true, status: 200, body: JSON.stringify({
    access_token: 'access-1', refresh_token: 'refresh-1',
    expires_in: 3600, user: { id: 'user-abc', email: 'yid@example.com' }
  }) });
  const user = await Auth.verifyCode('yid@example.com', ' 123456 ');
  t('verifyCode posts to /auth/v1/verify', calls[0].url.endsWith('/auth/v1/verify'));
  t('verifyCode sends type=email', JSON.parse(calls[0].opts.body).type === 'email');
  t('verifyCode trims the code', JSON.parse(calls[0].opts.body).token === '123456');
  t('verifyCode returns the user', user && user.id === 'user-abc');
  t('signedIn after verify', Auth.signedIn() === true);
  t('session survives reload (written to localStorage)',
    !!localStorage.getItem('luach:session'));

  // --- REST uses the session token, not the publishable key ---
  reset();
  nextResponse = () => ({ ok: true, status: 200, body: '[]' });
  await Api.select('luach_alarms', '?select=*');
  t('select hits /rest/v1/<table>', lastCall().url.includes('/rest/v1/luach_alarms'));
  t('signed-in request bearers the access token',
    lastCall().opts.headers.Authorization === 'Bearer access-1',
    lastCall().opts.headers.Authorization);
  t('apikey header is always the publishable key',
    lastCall().opts.headers.apikey.startsWith('sb_publishable_'));

  // --- upsert semantics ---
  reset();
  nextResponse = () => ({ ok: true, status: 200, body: '[]' });
  await Api.upsert('luach_profiles', { id: 'user-abc', nusach: 'sefard' });
  t('upsert asks PostgREST to merge duplicates',
    lastCall().opts.headers.Prefer.includes('resolution=merge-duplicates'),
    lastCall().opts.headers.Prefer);
  t('upsert wraps a single row in an array',
    Array.isArray(JSON.parse(lastCall().opts.body)));

  // --- an unfiltered delete must be refused, not sent ---
  reset();
  let refused = false;
  try { await Api.remove('luach_alarms', ''); } catch (e) { refused = true; }
  t('remove() refuses an unfiltered delete', refused && calls.length === 0,
    `sent ${calls.length} requests`);
  // Projection and paging parameters are not filters, however many '=' they
  // contain. Each of these would delete every row the caller can see.
  for (const q of ['?select=*', '?order=id', '?limit=10', '?select=id&order=created_at']) {
    reset(); refused = false;
    try { await Api.remove('luach_alarms', q); } catch (e) { refused = true; }
    t(`remove() refuses "${q}"`, refused && calls.length === 0,
      refused ? '' : 'REQUEST WAS SENT');
  }
  // A genuine row filter must still get through.
  reset();
  nextResponse = () => ({ ok: true, status: 204, body: '' });
  let allowed = true;
  try { await Api.remove('luach_alarms', '?id=eq.abc-123'); } catch (e) { allowed = false; }
  t('remove() allows a real row filter', allowed && calls.length === 1);

  // --- expiry triggers exactly one refresh, shared by concurrent callers ---
  reset();
  const stored = JSON.parse(localStorage.getItem('luach:session'));
  stored.expires_at = Date.now() - 1000;              // already expired
  localStorage.setItem('luach:session', JSON.stringify(stored));
  // Re-read the session by reloading the module's view of it.
  await page_reloadSession();

  let refreshCount = 0;
  nextResponse = (url) => {
    if (url.includes('grant_type=refresh_token')) {
      refreshCount++;
      return { ok: true, status: 200, body: JSON.stringify({
        access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600,
        user: { id: 'user-abc' }
      }) };
    }
    return { ok: true, status: 200, body: '[]' };
  };
  await Promise.all([
    Api.select('luach_alarms', '?select=*'),
    Api.select('luach_minyanim', '?select=*'),
    Api.select('luach_yahrzeits', '?select=*')
  ]);
  t('three concurrent calls trigger one refresh', refreshCount === 1,
    `refreshCount=${refreshCount}`);
  t('subsequent requests use the refreshed token',
    calls.filter(c => c.url.includes('/rest/v1/'))
         .every(c => c.opts.headers.Authorization === 'Bearer access-2'));

  // --- a rejected refresh token ends the session ---
  reset();
  const s2 = JSON.parse(localStorage.getItem('luach:session'));
  s2.expires_at = Date.now() - 1000;
  localStorage.setItem('luach:session', JSON.stringify(s2));
  await page_reloadSession();
  nextResponse = (url) => url.includes('grant_type=refresh_token')
    ? { ok: false, status: 400, body: '{"error":"invalid_grant"}' }
    : { ok: true, status: 200, body: '[]' };
  await Api.select('luach_alarms', '?select=*').catch(() => {});
  t('a 400 on refresh clears the session', Auth.signedIn() === false);

  // --- signed out falls back to the publishable key ---
  reset();
  nextResponse = () => ({ ok: true, status: 200, body: '[]' });
  await Api.select('luach_siddur_texts', '?select=ref');
  t('signed-out request bearers the publishable key',
    lastCall().opts.headers.Authorization.startsWith('Bearer sb_publishable_'),
    lastCall().opts.headers.Authorization);

  return out;

  // api.js reads localStorage once at load; reloading the page is heavier than
  // needed, so re-enter through the public surface by re-running the module's
  // session load. Exposed for tests only.
  async function page_reloadSession() {
    if (Auth._reloadSession) return Auth._reloadSession();
    // Fall back to a real reload if the hook is absent.
    throw new Error('Auth._reloadSession missing — test hook not present');
  }
});

console.log('\n  js/api.js\n  ' + '-'.repeat(62));
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
