// tests/frontend.test.js — the first frontend coverage: a DOM shim smoke test
// that loads every public/*.js module and calls init({api}) (N-03), plus
// DOM assertions for the validation panel (N-01) and the stretch inspector
// (N-02), and HTTP assertions for stretch_candidates on GET, the persistable
// max_inter_word_gap_factor (N-04), and study-preview export refusal (F-02).
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { createRunner, ok, eq } from './harness.js';
import { createDomShim, PUBLIC_DIR } from './dom-shim.js';
import { startTestServer, request, jsonHeaders, bootstrap, compute } from './helpers.js';

const runner = createRunner();

// ---- DOM shim + module smoke test ------------------------------------------

const IDS = ['app','app-lock','app-status','appbar','btn-compute','btn-lock','calibration-body','compare-body','compare-mini-body','diff-body','drawer-body','drawer-chev','drawer-tabs','export-controls','first-run-modal','geometry-body','geometry-select','layouts-body','layouts-count','lower-bench','pane-compare','pane-diff','pane-layouts','pane-progress','panel-calibration','panel-compare-mini','panel-geometry','panel-passages','panel-search','panel-shemos','panel-tikkun','panel-validation','passages-body','phone-tabs','print-note','profile-select','progress-body','rail-left','rail-right','sargel','sargel-flag','sargel-ticks','sargel-window','search-body','search-input','shemos-body','source-select','stretch-inspector','tikkun-body','tikkun-ref','tikkun-region','tikkun-scroll','toast','validation-body','wordmark','workbench'];

const shim = createDomShim({ ids: IDS });
const { sandbox, load, byId } = shim;

const MODULES = [
  { file: 'calibration', key: 'calibration' },
  { file: 'geometry', key: 'geometry' },
  { file: 'tikkun', key: 'tikkun' },
  { file: 'shemos', key: 'shemos' },
  { file: 'passages', key: 'passages' },
  { file: 'validation', key: 'validation' },
  { file: 'layouts', key: 'layouts' },
  { file: 'progress', key: 'progress' },
  { file: 'diff', key: 'diff' },
  { file: 'stretch', key: 'stretch' },
  { file: 'search', key: 'search' },
  { file: 'compare', key: 'compare' },
  { file: 'export', key: 'export' },
  { file: 'first-run', key: 'firstRun' },
];

load(PUBLIC_DIR + '/core.js');
load(PUBLIC_DIR + '/api.js');
for (const m of MODULES) load(PUBLIC_DIR + '/' + m.file + '.js');
// app.js loads last and would auto-boot; defer its boot() so init runs under our control.
sandbox.document.readyState = 'loading';
load(PUBLIC_DIR + '/app.js');

const SS = sandbox.SS;

// Stub the API: modules only consult it in init via passages.getSource and
// search.listBuiltinSources; everything else is a no-op.
let getSourceCalls = [];
SS.api.getSource = async (id) => { getSourceCalls.push(id); return { unusual_letters: [] }; };
SS.api.listBuiltinSources = async () => [];
SS.api.listSources = async () => [];
SS.api.listProfiles = async () => [];
SS.api.listGeometries = async () => [];
SS.api.listPatterns = async () => [];
SS.api.listLayouts = async () => [];
SS.api.session = async () => ({});

const ctx = { api: SS.api, state: SS.state, bus: SS.bus, util: SS.util };
SS.state.active.sourceId = 'src-1';

runner.test('N-03: every public module inits without throwing (passages binds API)', () => {
  const failures = [];
  for (const m of MODULES) {
    try { SS[m.key].init(ctx); } catch (e) { failures.push(m.key + ': ' + (e && e.message ? e.message : String(e))); }
  }
  eq(failures, [], 'init threw for: ' + JSON.stringify(failures));
  eq(getSourceCalls.length > 0, true, 'passages.init actually called API.getSource');
});

runner.test('N-01: validation renders exactly two non-clean rows (1 error + 1 warning)', () => {
  const layout = {
    lines: [{ line_id: 'L1', line_index: 1, amud: 1, text: 'x', tokens: ['x'] }],
    summary: {},
    validation: {
      valid: false,
      spacing_errors: [],
      lines: [{ line_id: 'L1', valid: false, errors: ['line has 30 Hebrew letters'], warnings: ['underfull: 3.25mm leftover'] }],
    },
  };
  SS.bus.emit('layout:loaded', layout);
  const res = byId('validation-results');
  ok(res, 'validation-results element present');
  const errs = res.querySelectorAll('tr.sev-error').length;
  const warns = res.querySelectorAll('tr.sev-warn').length;
  eq(errs, 1, 'one error row');
  eq(warns, 1, 'one warning row');
  eq(errs + warns, 2, 'exactly two non-clean rows');
});

runner.test('N-01: clean count derived from lines[].valid, never hardcoded', () => {
  const layout = {
    lines: [{ line_id: 'L1', line_index: 1, amud: 1 }, { line_id: 'L2', line_index: 2, amud: 1 }],
    summary: {},
    validation: { valid: true, spacing_errors: [], lines: [
      { line_id: 'L1', valid: true, errors: [], warnings: [] },
      { line_id: 'L2', valid: true, errors: [], warnings: [] },
    ] },
  };
  SS.bus.emit('layout:loaded', layout);
  const txt = byId('validation-body').textContent;
  ok(txt.indexOf('2 of 2 lines clean') >= 0, 'derived clean count present: ' + JSON.stringify(txt));
  ok(txt.indexOf('41 lines clean') < 0, 'no hardcoded "41 lines clean"');
});

runner.test('N-02: stretch inspector renders steppers for a fetched line', () => {
  const line = {
    line_id: 'L1', leftover_mm: 5, stretch_decisions: [],
    stretch_candidates: [{ letter_occurrence_id: 'oc1', letter: 'ר', cap_mm: 1.8, word_final: false, line_end: true }],
  };
  SS.bus.emit('line:selected', { raw: line });
  const si = byId('stretch-inspector');
  ok(si, 'stretch-inspector present');
  eq(si.querySelectorAll('.si-cand').length, 1, 'one candidate stepper rendered');
});

// ---- HTTP boundary ---------------------------------------------------------

const dbPath = fileURLToPath(new URL('../data/_test_frontend.db', import.meta.url));
for (const ext of ['', '-wal', '-shm']) { try { rmSync(dbPath + ext); } catch {} }
const server = await startTestServer(dbPath);
const base = await bootstrap(server);

runner.test('N-02 HTTP: GET /api/layouts/:id lines carry stretch_candidates with cap_mm', async () => {
  const l = await compute(server, base.token, base);
  const get = await request(server, 'GET', '/api/layouts/' + l.layout_id);
  eq(get.status, 200);
  ok(Array.isArray(get.json.lines) && get.json.lines.length > 0, 'lines present');
  const hasField = get.json.lines.every((ln) => Object.prototype.hasOwnProperty.call(ln, 'stretch_candidates'));
  ok(hasField, 'every line carries stretch_candidates');
  const anyCand = get.json.lines.some((ln) => Array.isArray(ln.stretch_candidates) && ln.stretch_candidates.length > 0);
  ok(anyCand, 'at least one line has non-empty candidates');
  const capsOk = get.json.lines.every((ln) => (ln.stretch_candidates || []).every((c) => typeof c.cap_mm === 'number'));
  ok(capsOk, 'candidates carry numeric cap_mm');
  const pg = await request(server, 'GET', '/api/layouts/' + l.layout_id + '?from=0&limit=1');
  ok(Object.prototype.hasOwnProperty.call(pg.json.lines[0], 'stretch_candidates'), 'paginated line carries stretch_candidates');
});

runner.test('N-04 HTTP: max_inter_word_gap_factor persists and validates (0 < f < 1)', async () => {
  const g1 = await request(server, 'POST', '/api/geometries', { headers: jsonHeaders(base.token), body: { name: 'factor', line_width_mm: 80, lines_per_amud: 4, max_inter_word_gap_factor: 0.5 } });
  eq(g1.status, 200);
  ok(g1.json.max_inter_word_gap_factor === 0.5, 'factor present in create response: ' + JSON.stringify(g1.json.max_inter_word_gap_factor));
  const g2 = await request(server, 'GET', '/api/geometries/' + g1.json.id);
  ok(g2.json.max_inter_word_gap_factor === 0.5, 'factor persisted on GET');
  const bad = await request(server, 'POST', '/api/geometries', { headers: jsonHeaders(base.token), body: { name: 'bad', line_width_mm: 80, lines_per_amud: 4, max_inter_word_gap_factor: 1.5 } });
  eq(bad.status, 400, 'factor >= 1 rejected');
});

runner.test('F-02 HTTP: study-preview layout export is refused server-side (403)', async () => {
  const chapters = [];
  for (let i = 0; i < 14; i++) chapters.push([]);
  chapters.push(['אז ישיר משה ובני ישראל את השירה הזאת']);
  const src = await request(server, 'POST', '/api/sources/import', { headers: jsonHeaders(base.token), body: { name: 'ex15b', format: 'json', text: { books: [{ name: 'Exodus', chapters }] } } });
  eq(src.status, 200);
  const lay = await request(server, 'POST', '/api/layout/compute', { headers: jsonHeaders(base.token), body: { source_id: src.json.id, profile_id: base.profile_id, geometry_id: base.geometry_id, study_preview: true } });
  eq(lay.status, 200);
  const exp = await request(server, 'GET', '/api/layouts/' + lay.json.layout_id + '/export?format=json');
  eq(exp.status, 403, 'study-preview export refused server-side');
});

const okAll = await runner.run();
await server.close();
for (const ext of ['', '-wal', '-shm']) { try { rmSync(dbPath + ext); } catch {} }
process.exit(okAll ? 0 : 1);
