/* Browser tests for js/store.js — the offline text cache.
 *
 * Worth testing in a real browser rather than a shim: the properties that
 * matter (IndexedDB transaction durability, the localStorage quota ceiling,
 * navigator.storage reporting) only exist in a browser, and the failure this
 * module was written to prevent was a silent one.
 *
 *   npm install && npx playwright install chromium
 *   npm test
 *
 * Set CHROME_PATH to use an already-installed Chromium instead of Playwright's.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8099;
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const rel = req.url === '/' ? 'index.html' : req.url.split('?')[0];
  const file = path.join(ROOT, rel);
  // Keep the static server inside the repo root.
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise(r => server.listen(PORT, r));

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}
);
const page = await browser.newPage();

// Seed legacy localStorage entries so migrate() has real data to move.
await page.goto(`http://localhost:${PORT}/siddur.html`);
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('txt:Legacy Section', JSON.stringify({ he: ['שלום'], text: ['peace'] }));
  localStorage.setItem('idx:Siddur Ashkenaz', JSON.stringify({ schema: { title: 'x' } }));
  localStorage.setItem('unrelated:keep', 'should survive');
});

const results = await page.evaluate(async () => {
  const out = [];
  const t = (name, pass, detail) => out.push({ name, pass, detail: detail ?? '' });

  t('Store is exposed globally', typeof window.Store === 'object');

  // --- migration off localStorage ---
  const moved = await Store.migrate();
  t('migrate moves legacy keys', moved === 2, `moved=${moved}`);
  t('migrated text is readable',
    JSON.stringify((await Store.get('txt:Legacy Section'))?.he) === JSON.stringify(['שלום']));
  t('migrated index is readable', !!(await Store.get('idx:Siddur Ashkenaz')));
  t('migrated keys freed from localStorage', localStorage.getItem('txt:Legacy Section') === null);
  t('unrelated localStorage keys untouched',
    localStorage.getItem('unrelated:keep') === 'should survive');
  t('migrate is idempotent', (await Store.migrate()) === 0);

  // --- basic contract ---
  await Store.set('txt:Round Trip', { he: ['א'], text: ['a'] });
  t('set/get round trip', (await Store.get('txt:Round Trip')).he[0] === 'א');
  t('absent key resolves null, not undefined', (await Store.get('txt:nope')) === null);
  t('keys() lists stored refs', (await Store.keys()).includes('txt:Round Trip'));
  await Store.del('txt:Round Trip');
  t('del removes', (await Store.get('txt:Round Trip')) === null);

  const est = await Store.estimate();
  t('estimate reports usage and quota',
    est && typeof est.usage === 'number' && est.quota > 0,
    est ? `${Math.round(est.quota / 1048576)}MB quota` : 'null');

  // --- the regression this module exists to prevent ---
  // A section-sized payload, written in bulk. Under localStorage this threw
  // QuotaExceededError and the old caller swallowed it, so the cache stopped
  // filling with no symptom until the user was offline.
  const blob = {
    he: Array(200).fill('בְּרֵאשִׁית בָּרָא אֱלֹהִים'),
    text: Array(200).fill('In the beginning')
  };

  let wrote = 0, idbErr = null;
  for (let i = 0; i < 400; i++) {
    try { await Store.set('txt:Bulk ' + i, blob); wrote++; }
    catch (e) { idbErr = String(e); break; }
  }
  t('IndexedDB takes 400 sections', wrote === 400 && !idbErr,
    `wrote=${wrote}${idbErr ? ' err=' + idbErr : ''}`);

  const after = await Store.estimate();
  t('usage grows measurably', after && after.usage > (est?.usage ?? 0),
    after ? `${Math.round(after.usage / 1024)}KB used` : 'null');

  // Measure localStorage's ceiling with the same payload, for the record.
  const payload = JSON.stringify(blob);
  let lsBytes = 0, lsCount = 0, lsErr = null;
  try {
    for (let i = 0; i < 5000; i++) {
      localStorage.setItem('probe:' + i, payload);
      lsBytes += payload.length; lsCount++;
    }
  } catch (e) { lsErr = e.name; }
  t('localStorage hits a ceiling IndexedDB did not', lsErr !== null,
    lsErr ? `${lsErr} at ${lsCount} sections / ${Math.round(lsBytes / 1024)}KB`
          : `no failure in ${lsCount}`);

  return out;
});

console.log('\n  js/store.js\n  ' + '-'.repeat(62));
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
