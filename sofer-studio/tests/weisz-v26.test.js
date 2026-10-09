import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile, normalizeProfile } from '../engine/profile.js';
import { processSource } from '../engine/source.js';
import { computeLayout, computeLayoutAsync, normalizeGeometry, needsSecondaryStretch, autoSuggestLine } from '../engine/layout.js';
import { effectiveProfile } from '../engine/stretch-policy.js';
import { measurementUnitMm } from '../engine/width.js';
import { paragraphSlack } from '../engine/document-flow.js';
import { moveWord } from '../engine/line-edit.js';
import { startTestServer, getToken, jsonHeaders, request } from './helpers.js';

const profile = extra => normalizeProfile({ ...defaultProfile(), units_per_row: 125, ...extra });
const geometry = extra => normalizeGeometry({ name: '45 cm Torah', line_width_mm: 125, baseline_pitch_mm: 7.5, lines_per_amud: 6, ...extra });
const ids = lines => lines.flatMap(l => l.letter_occurrence_ids);

test('font settings and automatic names belong to each document, including polled computes; saved Kulmus is unchanged', async () => {
  const server = await startTestServer(':memory:');
  try {
    const headers = jsonHeaders(await getToken(server));
    const post = async (path, body) => { const r = await request(server, 'POST', path, { headers, body }); assert.equal(r.status, 200, r.text); return r.json; };
    const p = await post('/api/profiles', profile({ name: 'Yehuda Kulmus' }));
    const g = await post('/api/geometries', geometry());
    const s = await post('/api/sources/import', { name: 'Torah text', text: 'אב גד '.repeat(30) });
    const before = (await request(server, 'GET', '/api/profiles/' + p.id)).text;
    for (const poll of [false, true]) {
      const body = { source_id: s.id, profile_id: p.id, geometry_id: g.id, poll, rendering: { font: poll ? 'stam' : 'asirit', overlap_percent: { stam: -20, asirit: 20 } } };
      let result = await post('/api/layout/compute', body);
      if (poll) {
        const job = result.job_id;
        for (let n = 0; n < 100; n++) { result = (await request(server, 'GET', '/api/layout/compute-job/' + job)).json; if (result.status !== 'running') break; await new Promise(r => setTimeout(r, 5)); }
        assert.equal(result.status, 'done', result.error);
      }
      const saved = (await request(server, 'GET', '/api/layouts/' + result.layout_id)).json;
      assert.equal(saved.name, 'Torah text + Yehuda Kulmus + 45 cm Torah');
      assert.equal(saved.snapshot.profile.document_rendering.font, poll ? 'stam' : 'asirit');
      assert.equal(saved.snapshot.profile.letter_height_mm, poll ? 6 : 9);
      assert.equal((await request(server, 'GET', '/api/profiles/' + p.id)).text, before);
      if (!poll) {
        await post('/api/layouts/' + result.layout_id + '/lock', {});
        const candidate = await post('/api/layouts/' + result.layout_id + '/candidate', { profile_id: p.id, geometry_id: g.id });
        const adopted = await post('/api/layouts/' + result.layout_id + '/adopt-candidate', { candidate_id: candidate.candidate_id });
        const copy = (await request(server, 'GET', '/api/layouts/' + adopted.new_layout_id)).json;
        assert.equal(copy.snapshot.profile.document_rendering.font, 'asirit');
      }
    }
    const legacy = await post('/api/profiles', profile({name:'Legacy Kulmus',stretch_policy:null}));
    const legacyLayout = await post('/api/layout/compute', {source_id:s.id,profile_id:legacy.id,geometry_id:g.id,rendering:{font:'asirit',overlap_percent:{asirit:20}}});
    const legacySaved = (await request(server,'GET','/api/layouts/'+legacyLayout.layout_id)).json;
    assert.equal(legacySaved.snapshot.profile.stretch_policy,null);
    assert.equal(legacySaved.snapshot.profile.letter_height_mm,9);
    const invalid = await request(server, 'POST', '/api/layout/compute', { headers, body: { source_id: s.id, profile_id: p.id, geometry_id: g.id, rendering: { font: 'asirit', overlap_percent: { asirit: -100 } } } });
    assert.equal(invalid.status, 400);
  } finally { await server.close(); }
});

test('hyphens produce Hebrew side notes and keep adjacent words together in sync, async and balanced wrapping', async () => {
  for (const text of ['אב אב וחרה- אף אב אב', 'אב אב וחרה - אף אב אב', 'אב אב וחרה-אף אב אב', 'אב אב וחרה־אף אב אב']) {
    const source = processSource({ text }), p = profile({ units_per_row: 16 }), g = geometry({ line_width_mm: 16 });
    const result = computeLayout(source, p, g);
    assert.deepEqual(result, await computeLayoutAsync(source, p, g));
    const words = result.lines.flatMap(l => l.words), notes = words.flatMap(w => w.hyphen_notes || []);
    assert(notes.includes('וחרה אף בחד שיטה'), text);
    for (const line of result.lines) { assert(!line.words.at(-1)?.keep_with_next); assert(!line.words[0]?.keep_with_previous); }
    assert.equal(ids(result.lines).length, source.letter_count);
  }
  const source = processSource({ format: 'stam', text: 'אב וחרה- אף גד הו '.repeat(40) }), p = profile(), g = geometry({ document_flow: { balance_segments: true } });
  const result = computeLayout(source, p, g);
  assert.equal(ids(result.lines).length, source.letter_count);
  assert(result.lines.every(l => !l.words.at(-1)?.keep_with_next && !l.words[0]?.keep_with_previous));
  const paired = result.lines.find(l => l.words.at(-1)?.keep_with_previous);
  if (paired) {
    const index = result.lines.indexOf(paired);
    assert.throws(() => moveWord({ ...result, snapshot: { profile: effectiveProfile(p, g), geometry: g } }, { line_id: paired.line_id, line_key: paired.line_key, next_line_key: result.lines[index + 1]?.line_key, direction: 'down' }), /Hyphenated/);
  }
});

test('only third-stage stretching colours a line orange', () => {
  for (const [width, stage, orange] of [[7, 1, false], [9, 2, false], [10, 3, true]]) {
    const p = profile({ units_per_row: width, stretch_policy: { ...defaultProfile().stretch_policy, stages: [{ caps_percent: { א: 50 } }, { caps_percent: { ב: 100 } }, { caps_percent: { ה: 'unlimited' } }] } });
    const g = geometry({ line_width_mm: width }), ep = effectiveProfile(p, g), line = computeLayout(processSource({ text: 'אבה' }), p, g).lines[0];
    assert.equal(autoSuggestLine(line, ep).stretch_stage, stage);
    assert.equal(needsSecondaryStretch(line, ep), orange);
  }
});

test('paragraph estimates use the requested half-line and quarter-group formulas', () => {
  const p = effectiveProfile(profile(), geometry()), gap = { type: 'setuma_gap', width_mm: 20 };
  assert.equal(paragraphSlack({ type: 'end', petucha: true }, null, null, p, 125), 62.5);
  assert.equal(paragraphSlack(gap, { width_mm: 6 }, { width_mm: 8 }, { ...p, parsha_mode: 'rambam' }, 125), 7.25);
  assert.equal(paragraphSlack(gap, { width_mm: 6 }, { width_mm: 8 }, { ...p, parsha_mode: 'rambam_rosh' }, 125), 8.75);
});

test('balanced segments fill every row at whole-unit and tenth-mm precision, preserving all letter IDs', () => {
  const source = processSource({ text: ('אב גד הוז חט יכל מנ סעפ צק רשת '.repeat(6) + 'אבsגד אבpהו ').repeat(12) });
  for (const mode of ['rambam', 'rambam_rosh']) for (const precision of ['units', '0.1mm']) {
    const p = profile({ units_per_row: 73 }), g = geometry({ parsha_mode: mode, document_flow: { balance_segments: true, balance_width_step: precision } });
    const base = computeLayout(source, p, { ...g, document_flow: {} }), result = computeLayout(source, p, g);
    assert.deepEqual(ids(result.lines), ids(base.lines));
    assert.deepEqual(result.summary.flow_warnings || [], []);
    assert(result.amudim.every(page => page.length === g.lines_per_amud));
    assert(result.lines.every(line => line.leftover_mm >= -.001));
    const step = precision === '0.1mm' ? .1 : measurementUnitMm(effectiveProfile(p, g));
    for (const page of result.amudim) assert(Math.abs(page[0].column_width_mm / step - Math.round(page[0].column_width_mm / step)) < 1e-6);
    assert.equal(result.amudim.length, Math.max(1, Math.round(base.lines.length / g.lines_per_amud)));
  }
});
