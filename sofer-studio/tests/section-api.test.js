import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, bootstrap, compute, request, jsonHeaders } from './helpers.js';

test('HTTP imports count attached breaks; saved layout and whole-book stretch preserve their positions', async () => {
  const server = await startTestServer(':memory:');
  try {
    const seed = await bootstrap(server), headers = jsonHeaders(seed.token);
    const missing = await request(server, 'GET', '/api/sources/' + seed.source_id);
    assert.deepEqual(missing.json.section_breaks, { petucha: 0, setuma: 0, present: false, verified: false });
    const source = await request(server, 'POST', '/api/sources/import', { headers, body: { name: 'Attached section fixture', text: 'אבגד{פ}דהוז(ס)חטיכל' } });
    assert.equal(source.status, 200, source.text);
    const summary = { petucha: 1, setuma: 1, present: true, verified: false };
    assert.deepEqual(source.json.section_breaks, summary);
    assert.deepEqual((await request(server, 'GET', '/api/sources/' + source.json.id)).json.section_breaks, summary);
    const geometry = await request(server, 'POST', '/api/geometries', { headers, body: { name: 'Section fixture', line_width_mm: 150, lines_per_amud: 42 } });
    const result = await compute(server, seed.token, { ...seed, source_id: source.json.id, geometry_id: geometry.json.id });
    assert(result.layout_id, JSON.stringify(result));
    const path = '/api/layouts/' + result.layout_id;
    const saved = await request(server, 'GET', path);
    assert.equal(saved.json.lines.length, 2);
    assert.equal(saved.json.lines[0].petucha_end, true);
    assert.equal(saved.json.lines[0].last_word, 'אבגד');
    assert.equal(saved.json.lines[1].has_setuma, true);
    assert.deepEqual(saved.json.lines[1].items.map(i => i.type), ['word', 'setuma_gap', 'word']);
    assert(saved.json.lines.every(l => l.spacing_metadata_complete));
    const preview = await request(server, 'POST', path + '/stretch-book', { headers, body: { action: 'preview' } });
    assert.equal(preview.status, 200, preview.text);
    assert.equal(preview.json.entries.length, 0);
    assert.equal(preview.json.skipped.length, 2);
    const apply = await request(server, 'POST', path + '/stretch-book', { headers, body: { action: 'apply', confirm: true, revision: preview.json.revision } });
    assert.equal(apply.status, 200, apply.text);
    assert.deepEqual((await request(server, 'GET', path)).json.lines, saved.json.lines);
  } finally { await server.close(); }
});
