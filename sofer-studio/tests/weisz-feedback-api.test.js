import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startTestServer, getToken, jsonHeaders, request } from './helpers.js';
import { defaultProfile } from '../engine/profile.js';
import * as store from '../server/store.js';

test('word movement persists exact source order and signed overflow; deletion removes only the chosen layout and candidates', async () => {
  const server = await startTestServer(':memory:');
  try {
    const headers = jsonHeaders(await getToken(server));
    const post = async (path, body) => {
      const r = await request(server, 'POST', path, { headers, body }); assert.equal(r.status, 200, r.text); return r.json;
    };
    const p = await post('/api/profiles', { ...defaultProfile(), units_per_row: null, letter_height_units: null,
      reference_height_mm: 3, letter_height_mm: 3, unit_mm: 1 });
    const g = await post('/api/geometries', { line_width_mm: 9, lines_per_amud: 1 });
    const src = await post('/api/sources/import', { text: 'אב גד הו זח טי כל מנ סא עת', format: 'stam' });
    const compute = () => post('/api/layout/compute', { source_id: src.id, profile_id: p.id, geometry_id: g.id });
    const first = await compute(), other = await compute();
    const get = async id => (await request(server, 'GET', '/api/layouts/' + id)).json;
    let layout = await get(first.layout_id);
    const ids = layout.lines.flatMap(l => l.letter_occurrence_ids);
    const body = { line_id: layout.lines[0].line_id, direction: 'up', line_key: layout.lines[0].line_key, next_line_key: layout.lines[1].line_key };
    await post('/api/layouts/' + layout.id + '/move-word', body);
    layout = await get(layout.id);
    assert(layout.lines[0].base_leftover_mm < 0); assert(layout.lines[0].leftover_mm < 0);
    assert.deepEqual(layout.lines.flatMap(l => l.letter_occurrence_ids), ids);
    const stale = await request(server, 'POST', '/api/layouts/' + layout.id + '/move-word', { headers, body });
    assert.equal(stale.status, 409);
    await post('/api/layouts/' + layout.id + '/move-word', { line_id: layout.lines[0].line_id, direction: 'down', line_key: layout.lines[0].line_key, next_line_key: layout.lines[1].line_key });
    layout = await get(layout.id); assert(layout.lines[0].base_leftover_mm >= 0);
    await post('/api/layouts/' + layout.id + '/lock', {});
    const locked = await request(server, 'POST', '/api/layouts/' + layout.id + '/move-word', { headers, body }); assert.equal(locked.status, 409);
    const beforeOther = JSON.stringify(await get(other.layout_id));
    store.saveCandidate(server.db, layout.id, { profile_id: p.id, geometry_id: g.id, source_id: src.id, lines_snapshot: [] });
    store.saveCandidate(server.db, other.layout_id, { profile_id: p.id, geometry_id: g.id, source_id: src.id, lines_snapshot: [] });
    const unauthorised = await request(server, 'DELETE', '/api/layouts/' + layout.id); assert.equal(unauthorised.status, 401);
    const deleted = await request(server, 'DELETE', '/api/layouts/' + layout.id, { headers }); assert.equal(deleted.status, 200);
    assert.equal((await request(server, 'GET', '/api/layouts/' + layout.id)).status, 404);
    assert.equal(server.db.prepare('SELECT COUNT(*) n FROM layout_lines WHERE layout_id=?').get(layout.id).n, 0);
    assert.equal(server.db.prepare('SELECT COUNT(*) n FROM candidates WHERE parent_layout_id=?').get(layout.id).n, 0);
    assert.equal(server.db.prepare('SELECT COUNT(*) n FROM candidates WHERE parent_layout_id=?').get(other.layout_id).n, 1);
    assert.equal(JSON.stringify(await get(other.layout_id)), beforeOther);
    assert(store.getProfile(server.db, p.id)); assert(store.getSource(server.db, src.id));
  } finally { await server.close(); }
});

test('attached preset and secondary policy survive authenticated profile save and reload', async () => {
  const server = await startTestServer(':memory:');
  try {
    const headers = jsonHeaders(await getToken(server));
    const preset = JSON.parse(readFileSync(new URL('../public/profiles/4mm-yad.profile.json', import.meta.url), 'utf8'));
    const asset = await request(server, 'GET', '/profiles/4mm-yad.profile.json'); assert.equal(asset.status, 200); assert.deepEqual(asset.json, preset);
    preset.stretch_policy.secondary = { caps_percent: { 'א': 100, word_space: 75 }, priorities: { 'א': 1, word_space: 2 } };
    const saved = await request(server, 'POST', '/api/profiles', { headers, body: preset }); assert.equal(saved.status, 200, saved.text);
    const loaded = await request(server, 'GET', '/api/profiles/' + saved.json.id);
    assert.deepEqual(loaded.json.letter_widths, preset.letter_widths);
    assert.equal(loaded.json.units_per_row, 73.3); assert.equal(loaded.json.name, '4mm yad');
    assert.deepEqual(loaded.json.stretch_policy.secondary, preset.stretch_policy.secondary);
    const bad = structuredClone(preset); bad.stretch_policy.secondary.priorities['א'] = -1;
    assert.equal((await request(server, 'PUT', '/api/profiles/' + saved.json.id, { headers, body: bad })).status, 400);
    assert.deepEqual((await request(server, 'GET', '/api/profiles/' + saved.json.id)).json.stretch_policy.secondary, preset.stretch_policy.secondary);
  } finally { await server.close(); }
});
