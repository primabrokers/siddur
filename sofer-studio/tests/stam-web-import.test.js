import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { startTestServer, request, jsonHeaders, bootstrap } from './helpers.js';
import { processSource } from '../engine/source.js';

const browser = { SS: { modules: {}, register() {} } };
vm.runInNewContext(readFileSync(new URL('../public/search.js', import.meta.url), 'utf8'), { window: browser, TextDecoder, Uint8Array });
const decode = browser.SS.decodeSourceFile;
const raw = 'HוV p אבsגדl הו';

test('actual browser decoder reads UTF-8 and Windows UTF-16 without losing controls', () => {
  const utf16 = Buffer.concat([Buffer.from([255, 254]), Buffer.from(raw, 'utf16le')]);
  assert.equal(decode(utf16), raw);
  assert.equal(decode(Buffer.from(raw)), raw);
  const bigEndian = Buffer.from(utf16).swap16();
  assert.equal(decode(bigEndian), raw);
  assert.throws(() => decode(Buffer.from([0xff, 0xf1, 0xfe])), /Cannot read/);
  assert.throws(() => processSource({ text: utf16.toString('utf8') }), /encoding error/);
});

test('browser-decoded txt survives HTTP import, storage and async layout with exact human marks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sofer-stam-web-'));
  const server = await startTestServer(join(dir, 'test.db'));
  try {
    const boot = await bootstrap(server);
    const headers = jsonHeaders(boot.token);
    const encoded = Buffer.concat([Buffer.from([255, 254]), Buffer.from(raw, 'utf16le')]);
    const imported = await request(server, 'POST', '/api/sources/import', { headers, body: { name: 'Human-marked file', format: 'txt', text: decode(encoded) } });
    assert.equal(imported.status, 200, imported.text);
    assert.equal(imported.json.section_breaks.petucha, 1);
    assert.equal(imported.json.section_breaks.setuma, 1);
    const result = await request(server, 'POST', '/api/layout/compute', { headers, body: { source_id: imported.json.id, profile_id: boot.profile_id, geometry_id: boot.geometry_id } });
    assert.equal(result.status, 200, result.text);
    const layout = await request(server, 'GET', '/api/layouts/' + result.json.layout_id);
    assert.equal(layout.status, 200, layout.text);
    assert.deepEqual(layout.json.lines[0].words[0].letters.map(l => [l.base, l.holy]), [['י', true], ['ו', false], ['ה', true]]);
    assert(layout.json.lines[0].petucha_end);
    assert(layout.json.lines[1].has_setuma);
    assert.equal(layout.json.lines[2].words.length, 0);
    assert.equal(layout.json.lines[3].words[0].text, 'הו');
    assert(!/[A-Za-z]/u.test(layout.json.lines.map(l => l.text).join(' ')));
  } finally { await server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('preview explicitly selects STAM Ashkenaz and exposes keyboard format', () => {
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../public/search.js', import.meta.url), 'utf8');
  assert.match(css, /@font-face\s*\{\s*font-family: 'Stam Ashkenaz CLM'/);
  assert.match(css, /--font-he: "Stam Ashkenaz CLM"/);
  assert.match(css, /StamAshkenazCLM\.ttf/);
  assert.match(css, /text-decoration-color: #fff/);
  assert.match(ui, /value: 'stam'/);
  assert.match(ui, /file\.arrayBuffer\(\)/);
});
