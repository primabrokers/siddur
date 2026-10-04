import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { defaultProfile, normalizeProfile } from '../engine/profile.js';
import { processSource } from '../engine/source.js';
import { computeLayout, computeLayoutAsync, normalizeGeometry, stretchCandidatesOf, computeYerios } from '../engine/layout.js';
import { effectiveProfile } from '../engine/stretch-policy.js';
import { publicLine } from '../server/handlers.js';
import { documentOptionsErrors } from '../engine/document-options.js';
const profile = normalizeProfile({ ...defaultProfile(), units_per_row: 62 });
const geometry = extra => normalizeGeometry({ line_width_mm: 62, lines_per_amud: 4, document_flow: {}, ...extra });
const calc = (text, extra) => computeLayout(processSource({ text }), profile, geometry(extra));
const ids = result => result.lines.flatMap(line => line.letter_occurrence_ids);
const asset = name => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');

test('Davidovitch v can be followed or ignored without changing text, capital V, or t markers', async () => {
  const text = 'אבvגד Vtוזvחט', source = processSource({ text });
  const ignored = calc(text), followed = calc(text, { document_flow: { follow_reference_pages: true } });
  assert.equal(ignored.amudim.length, 2); assert.equal(followed.amudim.length, 4);
  assert.deepEqual(ids(ignored), ids(followed));
  assert.deepEqual(followed.lines.filter(line => line.page_start).map(line => line.segment_start_id), ['v-0','t-0','v-1']);
  assert(followed.lines[1].words[1].letters[0].holy);
  assert.deepEqual(followed, await computeLayoutAsync(source, profile, geometry({ document_flow: { follow_reference_pages: true } })));
});

test('geg keeps separately measured gaps on opposite sides of an explicit line end', () => {
  const result = calc('אבgegגד', { document_flow: { gaps: { 'g-0': { preset:'custom', units:3 }, 'g-1': { preset:'custom', units:7 } } } });
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].items.at(-1).width_mm, 3);
  assert.equal(result.lines[1].items[0].width_mm, 7);
  assert(result.lines[0].manual_line_end); assert.deepEqual(ids(result), ['occ-0','occ-1','occ-2','occ-3']);
});

test('one word suffices before petucha and on either side of setuma', () => {
  assert.equal(calc('אבpגד').lines[0].words.length, 1);
  const result = calc('אבsגד'); assert.equal(result.lines.length, 1); assert.equal(result.lines[0].words.length, 2);
  assert(!result.lines[0].setuma_at_edge);
});

test('holy cap intersects normal caps, including secondary rules; old saved policies stay protected', () => {
  const p = normalizeProfile({ ...defaultProfile(), units_per_row:62, non_stretchable:[], stretch_policy: {
    ...defaultProfile().stretch_policy, holy_name_percent:50, caps_percent:{ ה:'unlimited', ו:0, ל:25 },
    secondary:{ caps_percent:{ה:'unlimited',ו:0,ל:40},priorities:{} }, word_space_percent:0 } });
  const g = geometry(), line = computeLayout(processSource({text:'KVU'}), p, g).lines[0];
  const candidates = stretchCandidatesOf(line, effectiveProfile(p,g));
  assert.equal(candidates.find(c=>c.letter==='ה').cap_mm, 1); assert(!candidates.some(c=>c.letter==='ו'));
  assert(candidates.find(c=>c.letter==='ל').cap_mm <= .8);
  delete p.stretch_policy.holy_name_percent;
  assert.equal(stretchCandidatesOf(line, normalizeProfile(p)).length, 0);
});

test('segment balancing rounds page count, uses integral units and preserves all source occurrences', async () => {
  for (const count of [35,63,87,117,210]) {
    const text = ('אב גד הוז חטיכ למן סע עפצ קרשת '.repeat(count));
    const baseline = calc(text), balanced = calc(text, { document_flow:{ balance_segments:true } });
    assert.equal(balanced.amudim.length, Math.max(1,Math.round(baseline.lines.length/4)), 'repeat '+count);
    assert.deepEqual(ids(balanced), ids(baseline));
    assert(balanced.lines.every(line=>Number.isInteger(line.column_width_mm)));
    assert(balanced.lines.every(line=>line.width_mm <= line.column_width_mm + .001));
    for(let i=0;i<balanced.lines.length-1;i++) {
      const line=balanced.lines[i], next=balanced.lines[i+1];
      if (!next.flow_page_start) assert(line.width_mm + 1 + next.words[0].width_mm > line.column_width_mm, 'a fitting word was left on the next row');
    }
    assert.deepEqual(balanced, await computeLayoutAsync(processSource({text}), profile, geometry({document_flow:{balance_segments:true}})));
  }
  assert(documentOptionsErrors({document_flow:{fit_last_page:true,balance_segments:true}}).length);
});

test('total length includes every column, the initial margin and final margin', () => {
  const g=geometry({amudim_per_yeria:4,partial_final_yeria:'exact',outer_margin_mm:30,initial_margin_mm:80,final_margin_mm:90,inter_column_gap_mm:10});
  const result=computeYerios(5,g,profile,[62,63,64,65,66]);
  assert.equal(result.yeria_widths_mm.reduce((sum,width)=>sum+width,0),80+62+10+63+10+64+10+65+30+30+66+90);
});

test('margin circles, independent holy labels, collision placement, footer and sample marks render', async () => {
  const dom=new JSDOM(asset('index.html'),{runScripts:'outside-only',pretendToBeVisual:true});
  try {
    const w=dom.window; w.HTMLElement.prototype.scrollIntoView=function(){}; w.eval(asset('core.js'));
    const SS=w.SS; SS.activeProfile=()=>null;SS.activeGeometry=()=>null;SS.activeSource=()=>null;
    w.eval(asset('tikkun.js')); SS.tikkun.init({});
    const g=geometry({baseline_pitch_mm:4}), p=effectiveProfile(profile,g), result=calc('(first)אב AVם C V HVUV');
    const layout={id:'v23',status:'draft',snapshot:{profile:p,geometry:g},summary:result.summary,lines:result.lines.map(line=>publicLine(line,p))};
    SS.state.layout=layout;SS.state.active.layoutId=layout.id; SS.bus.emit('layout:loaded',layout);
    await new Promise(resolve=>setTimeout(resolve,30));
    const d=w.document;
    assert.equal(d.querySelectorAll('.margin-comment').length,1); assert.equal(d.querySelectorAll('.holy-name-note').length,3);
    assert.equal(d.querySelectorAll('.holy-note-anchor').length,3); assert.equal(d.querySelectorAll('.note-anchor').length,4);
    assert.equal(d.querySelector('.holy-name-note').textContent,'° ספק');
    assert(d.querySelector('.page-copyright').textContent.includes('Yehuda Weisz'));
    assert.equal(SS.tikkun.notePosition(95,20,100,[]),80);
    assert.equal(SS.tikkun.notePosition(40,20,100,[{top:40,height:20}]),63);
    SS.tikkun.prepareSamplePaper('A4-landscape');
    assert.equal(d.querySelectorAll('.sample-cut-mark').length,4);
    assert(d.querySelector('.sample-copyright').textContent.includes('without paying'));
  } finally {dom.window.close();}
});

test('compact Setup preserves editable main measurements, selector navigation, and mutually exclusive fitting', async () => {
  const dom = new JSDOM(asset('index.html'), {runScripts:'outside-only',pretendToBeVisual:true,url:'http://127.0.0.1/'});
  try {
    const w=dom.window;w.HTMLElement.prototype.scrollIntoView=function(){};w.confirm=()=>true;w.eval(asset('core.js'));
    const SS=w.SS;SS.api={listSources:async()=>[],listProfiles:async()=>[],listGeometries:async()=>[],listPatterns:async()=>[],listLayouts:async()=>[],session:async()=>({})};
    for(const name of ['calibration.js','document-settings.js','geometry.js'])w.eval(asset(name));
    const ready=new Promise(resolve=>SS.bus.on('app:ready',resolve));w.eval(asset('app.js'));await ready;
    const d=w.document;
    assert.equal(d.querySelectorAll('#view-setup .workspace-subnav').length,0);
    const input=d.querySelector('[data-field="letter_height_units"]');
    assert(input.closest('.setup-main-measurements'));input.value='3.2';input.dispatchEvent(new w.Event('input'));
    assert.equal(SS.calibration.getDraft().letter_height_units,3.2);
    d.getElementById('profile-select').dispatchEvent(new w.Event('focus'));
    assert.equal(d.getElementById('section-setup-calibration').hidden,false);
    assert(d.querySelector('[data-measurement="holy_name"]'));
    d.getElementById('geometry-select').dispatchEvent(new w.Event('focus'));
    assert.equal(d.getElementById('section-setup-geometry').hidden,false);
    assert.equal(d.getElementById('geom-document-mode'),null);
    for(const n of [4,7,11,21,22]) assert(d.querySelector('[data-lines="'+n+'"]'));
    const fit=d.getElementById('flow-page-fit');fit.value='balance';fit.dispatchEvent(new w.Event('change'));
    assert.equal(SS.geometry.getDraft().document_flow.balance_segments,true);
    fit.value='last';fit.dispatchEvent(new w.Event('change'));
    assert.equal(SS.geometry.getDraft().document_flow.balance_segments,false);
    assert.equal(SS.geometry.getDraft().document_flow.fit_last_page,true);
    assert(d.getElementById('geom-derived').closest('#setup-summary'));
  } finally {dom.window.close();}
});
