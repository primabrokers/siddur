import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile } from '../engine/profile.js';
import { startTestServer, getToken, jsonHeaders, request } from './helpers.js';

test('HTTP computes direct row units for both new and older average profiles, preserving saved inputs and layout snapshots', async () => {
  const server = await startTestServer(':memory:');
  try {
    const headers = jsonHeaders(await getToken(server));
    const post = async (path, body) => {
      const r = await request(server, 'POST', path, { headers, body });
      assert.equal(r.status, 200, r.text);
      return r.json;
    };
    const geometry = await post('/api/geometries', { name: 'Unit regression', line_width_mm: 186, max_letters_per_line: 0 });
    const source = await post('/api/sources/import', { name: 'Synthetic unit regression', format: 'txt', text: Array(64).fill('א').join(' ') });
    for (const unit_basis of ['line_units', 'average_letter']) {
      const p = await post('/api/profiles', { ...defaultProfile(), name: unit_basis, unit_basis,
        stroke_mm: 0, stretch_policy: null, gaps: { inter_letter: 0, inter_word: 0 } });
      const profilePath = '/api/profiles/' + p.id;
      const original = (await request(server, 'GET', profilePath)).json;
      const computed = await post('/api/layout/compute', { profile_id: p.id, geometry_id: geometry.id, source_id: source.id });
      const layoutPath = '/api/layouts/' + computed.layout_id;
      const saved = (await request(server, 'GET', layoutPath)).json;
      assert.deepEqual(saved.lines.map(l => l.words.reduce((n, w) => n + w.letters.length, 0)), [31, 31, 2]);
      assert.equal(saved.snapshot.profile.unit_basis, 'line_units');
      assert.deepEqual((await request(server, 'GET', profilePath)).json, original);
      const update = await request(server, 'PUT', profilePath, { headers, body: { ...original, units_per_row: 80 } });
      assert.equal(update.status, 200, update.text);
      assert.deepEqual((await request(server, 'GET', layoutPath)).json, saved);
    }
  } finally { await server.close(); }
});
