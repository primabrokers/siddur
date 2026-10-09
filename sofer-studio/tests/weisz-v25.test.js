import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { defaultProfile, normalizeProfile } from '../engine/profile.js';
import { processSource } from '../engine/source.js';
import { computeLayout, computeLayoutAsync, normalizeGeometry, autoSuggestLine, applyStretch, stretchCandidatesOf } from '../engine/layout.js';
import { effectiveProfile } from '../engine/stretch-policy.js';
import { totalWidth } from '../engine/width.js';
import { validateLine } from '../engine/validate.js';
import { moveWord } from '../engine/line-edit.js';
import { lineMeasurementProfile } from '../engine/line-measurement.js';
import { petuchaGapMm } from '../engine/layout.js';
import { publicLine } from '../server/handlers.js';
import { validateProfileInput, validateGeometryInput } from '../server/validation.js';
import { startTestServer, getToken, jsonHeaders, request } from './helpers.js';

const profile = extra => normalizeProfile({ ...defaultProfile(), ...extra });
const geometry = extra => normalizeGeometry({line_width_mm:62,baseline_pitch_mm:7.5,lines_per_amud:4,...extra});
const source = text => processSource({text});
const stages = [{caps_percent:{א:50}}, {caps_percent:{ב:100}}, {caps_percent:{ה:'unlimited'}}];
const rules = {reference_units:12,recommended_units:14,max_units:16,stretch_units:12};
const asset = name => readFileSync(new URL('../public/'+name,import.meta.url),'utf8');

test('three stages exhaust earlier allowances before later targets, preserving total and holy caps', () => {
  const p=profile({units_per_row:20,stretch_policy:{...defaultProfile().stretch_policy,stages,holy_name_percent:25}}), g=geometry({line_width_mm:20});
  const ep=effectiveProfile(p,g), line=computeLayout(source('אבה'),p,g).lines[0];
  const plan=autoSuggestLine(line,ep);
  assert.equal(plan.stretch_stage,3);assert.equal(plan.shortfall_mm,0);
  assert.deepEqual(plan.suggestions.map(d=>d.stretch_mm),[1,2,11]);
  applyStretch(line,plan.suggestions,ep);assert.equal(line.leftover_mm,0);
  line.words[0].letters[0].holy=true;
  assert.equal(stretchCandidatesOf(line,ep).find(c=>c.letter==='א').cap_mm,.5);
  assert.throws(()=>applyStretch(line,[{letter_occurrence_id:'occ-0',stretch_mm:1}],ep),/cap/);
  const firstOnly=structuredClone(p); firstOnly.stretch_policy.stages[0].caps_percent.א='unlimited';
  const first=autoSuggestLine(computeLayout(source('אבה'),firstOnly,g).lines[0],effectiveProfile(firstOnly,g));
  assert.equal(first.stretch_stage,1);assert.equal(first.suggestions.length,1);
});

test('millimetre widths remain fixed when line width or font height changes; line units scale', () => {
  const p=profile({stretch_policy:{...defaultProfile().stretch_policy,width_mode:'millimetres',rendering:{font:'asirit',overlap_percent:{asirit:20}}}});
  for(const width of [62,125])for(const pitch of [5,10]){
    const ep=effectiveProfile(p,geometry({line_width_mm:width,baseline_pitch_mm:pitch}));
    assert.equal(totalWidth('א',ep),2);assert.equal(ep.letter_height_mm,pitch*1.2);assert.equal(ep.units_per_row,width);
  }
  assert.equal(totalWidth('א',effectiveProfile(profile(),geometry({line_width_mm:124}))),4);
});

test('nearest whole-word wrapping respects maximum, squeezes equally and keeps reference units before squeezing', async () => {
  const p=profile({stretch_policy:{...defaultProfile().stretch_policy,width_mode:'millimetres'}}), g=geometry({line_width_mm:12,line_measurement:rules});
  const text='אב אב אב אב אב אב אב אב אב', result=computeLayout(source(text),p,g), ep=effectiveProfile(p,g);
  assert.deepEqual(result.lines.map(l=>l.words.length),[3,3,3]);
  for(const line of result.lines){
    assert.equal(line.line_measurement.original_units,14);assert.equal(line.line_measurement.reference_units,12);
    assert.equal(line.width_mm,12);assert.equal(line.leftover_mm,0);
    const pub=publicLine(line,ep);assert(Math.abs(pub.words[0].letters[0].width_mm-2*12/14)<1e-8);
    assert(Math.abs(pub.inter_word_gap_mm-12/14)<1e-8);assert.equal(autoSuggestLine(line,ep).suggestions.length,0);
  }
  assert.deepEqual(result,await computeLayoutAsync(source(text),p,g));
  const capped=computeLayout(source(text),p,geometry({line_width_mm:12,line_measurement:{...rules,max_units:13,recommended_units:12}}));
  assert(capped.lines.every(line=>line.line_measurement.original_units<=13));
  assert.throws(()=>computeLayout(source('אבגדהוזחטיכ'),p,g),/exceeds the maximum/);
});

test('Rambam-only allows a leading setuma followed by a word; default retains both adjacent words', () => {
  const p=profile({units_per_row:27}), s=source('אב אב אבsג');
  const normal=computeLayout(s,p,geometry({line_width_mm:27}));
  assert(normal.lines.every(line=>line.items[0].type!=='setuma_gap'));
  const g=geometry({line_width_mm:27,parsha_mode:'rambam'}), ep=effectiveProfile(p,g), result=computeLayout(s,p,g);
  const leading=result.lines.find(line=>line.items[0].type==='setuma_gap');assert(leading);
  assert.equal(leading.setuma_at_edge,false);assert.equal(leading.words.length,1);
  assert(!validateLine(leading,ep,g).errors.some(error=>error.includes('edge')));
  assert.deepEqual(result.lines.flatMap(l=>l.letter_occurrence_ids),normal.lines.flatMap(l=>l.letter_occurrence_ids));
});

test('moving words between uniformly fitted lines reuses original widths without cumulative scaling', () => {
  const p=profile({stretch_policy:{...defaultProfile().stretch_policy,width_mode:'millimetres'}});
  const g=geometry({line_width_mm:12,line_measurement:{...rules,max_units:21}}), ep=effectiveProfile(p,g);
  const result=computeLayout(source('אב אב אב אב אב אב אב אב אב'),p,g);
  const layout={...result,snapshot:{profile:ep,geometry:g}};
  const args=lines=>({line_id:lines[0].line_id,line_key:lines[0].line_key,next_line_key:lines[1].line_key});
  const moved=moveWord(layout,{...args(layout.lines),direction:'down'});
  assert.deepEqual(moved.lines.map(l=>l.line_measurement.original_units),[9,19,14]);
  const restored=moveWord({...layout,...moved},{...args(moved.lines),direction:'up'});
  assert.deepEqual(restored.lines.map(l=>l.line_measurement.original_units),[14,14,14]);
  assert.deepEqual(restored.lines.flatMap(l=>l.letter_occurrence_ids),layout.lines.flatMap(l=>l.letter_occurrence_ids));
  assert(restored.lines.every(l=>Math.abs(l.width_mm-12)<1e-8));
});

test('permitted longer paragraph lines fit while preserving setumah and petuchah spaces', () => {
  const p=profile({stretch_policy:{...defaultProfile().stretch_policy,width_mode:'millimetres'}});
  const g=geometry({line_width_mm:25,line_measurement:{reference_units:25,recommended_units:29,max_units:35,stretch_units:25}}), ep=effectiveProfile(p,g);
  const setuma=computeLayout(source('אבsגד'),p,g).lines[0];
  assert(setuma.has_setuma);assert(setuma.line_measurement.scale<1);assert(Math.abs(setuma.leftover_mm)<1e-8);
  const petucha=computeLayout(source('אב אבpהו'),p,g).lines[0];
  assert(petucha.petucha_end);assert(petucha.line_measurement.scale<1);
  assert(Math.abs(petucha.leftover_mm-petuchaGapMm(lineMeasurementProfile(ep,petucha)))<1e-8);
  assert(!validateLine(petucha,ep,g).errors.some(error=>/petucha|overfull/i.test(error)));
  const balanced=computeLayout(source('אב אב אבsגד אב אבp'.repeat(20)),p,{...g,document_flow:{balance_segments:true}});
  assert(balanced.lines.every(line=>line.leftover_mm>=-.001));
});

test('new options reject malformed inputs without changing old normalization', () => {
  const p=profile();assert(!p.stretch_policy.stages);assert(!p.stretch_policy.rendering);
  assert(validateProfileInput({...p,stretch_policy:{...p.stretch_policy,stages:[{}]}}).length);
  assert(validateProfileInput({...p,stretch_policy:{...p.stretch_policy,rendering:{font:'asirit',overlap_percent:{asirit:-100}}}}).length);
  assert(validateGeometryInput({line_measurement:{...rules,max_units:10}}).length);
  assert(validateGeometryInput({parsha_mode:'unknown'}).length);
});

test('API saves new font, stages, dimensions and scaled lines; later profile edits leave snapshots intact', async () => {
  const server=await startTestServer(':memory:');
  try{
    const headers=jsonHeaders(await getToken(server));
    const post=async(path,body)=>{const r=await request(server,'POST',path,{headers,body});assert.equal(r.status,200,r.text);return r.json;};
    const p=await post('/api/profiles',profile({name:'October Kulmus',stretch_policy:{...defaultProfile().stretch_policy,stages,width_mode:'millimetres',rendering:{font:'asirit',overlap_percent:{asirit:20,stam:0}}}}));
    const g=await post('/api/geometries',geometry({name:'October Klaf',line_width_mm:12,baseline_pitch_mm:5,line_measurement:rules,parsha_mode:'rambam'}));
    const s=await post('/api/sources/import',{name:'Regression text',format:'txt',text:'אב אב אב אב אב אב'});
    const result=await post('/api/layout/compute',{source_id:s.id,profile_id:p.id,geometry_id:g.id});
    const path='/api/layouts/'+result.layout_id, saved=(await request(server,'GET',path)).json;
    assert.equal(saved.snapshot.profile.letter_height_mm,6);assert.deepEqual(saved.snapshot.profile.stretch_policy.stages,stages);
    assert.equal(saved.lines[0].line_measurement.original_units,14);assert.equal(saved.snapshot.geometry.parsha_mode,'rambam');
    assert.equal((await request(server,'GET','/api/profiles/'+p.id)).json.stretch_policy.rendering.font,'asirit');
    assert.equal((await request(server,'PUT','/api/profiles/'+p.id,{headers,body:{...p,name:'Changed later'}})).status,200);
    assert.deepEqual((await request(server,'GET',path)).json,saved);
  }finally{await server.close();}
});

test('Kulmus controls hide inactive percentages, preserve three-stage choices, and keep font-specific overlap', async () => {
  const dom=new JSDOM(asset('index.html'),{runScripts:'outside-only',pretendToBeVisual:true,url:'http://127.0.0.1/'});
  try{
    const w=dom.window;w.confirm=()=>true;w.HTMLElement.prototype.scrollIntoView=function(){};w.eval(asset('core.js'));
    const SS=w.SS;SS.api={listSources:async()=>[],listProfiles:async()=>[],listGeometries:async()=>[],listPatterns:async()=>[],listLayouts:async()=>[],session:async()=>({})};
    for(const name of ['document-font.js','calibration.js','document-settings.js','geometry.js'])w.eval(asset(name));
    const ready=new Promise(resolve=>SS.bus.on('app:ready',resolve));w.eval(asset('app.js'));await ready;
    const d=w.document;
    assert.equal(d.querySelectorAll('#cal-letter-rows tr').length,14);assert.equal(d.querySelectorAll('#cal-letter-rows-end tr').length,13);
    assert(!d.querySelector('.stretch-priority'));assert(!d.querySelector('.kulmus-tables').textContent.includes('Total mm'));
    const select=d.querySelector('[aria-label="stretch limit type for third stage א"]');select.value='percent';select.dispatchEvent(new w.Event('change'));
    const amount=d.querySelector('[aria-label="stretch cap for third stage א"]');assert(!amount.hidden);amount.value='75';amount.dispatchEvent(new w.Event('input'));
    assert.equal(SS.calibration.getDraft().stretch_policy.stages[2].caps_percent.א,75);
    select.value='none';select.dispatchEvent(new w.Event('change'));assert(amount.hidden);
    const font=d.getElementById('cal-font'), overlap=d.getElementById('cal-letter-overlap');
    assert(font.closest('.setup-main-measurements'));font.value='asirit';font.dispatchEvent(new w.Event('change'));
    overlap.value='20';overlap.dispatchEvent(new w.Event('input'));assert.equal(SS.documentFont.height(7.5),9);
    font.value='stam';font.dispatchEvent(new w.Event('change'));font.value='asirit';font.dispatchEvent(new w.Event('change'));assert.equal(overlap.value,'20');
    const mode=d.getElementById('cal-width-mode');mode.value='millimetres';mode.dispatchEvent(new w.Event('change'));
    assert(d.getElementById('cal-units-per-row').readOnly);assert.equal(d.getElementById('cal-units-per-row').value,'125');
    assert(d.getElementById('cal-units-per-row').closest('#geom-line-measurements'));
    [...d.querySelectorAll('button')].find(b=>b.textContent==='Use requested stretch rules').click();
    assert.equal(SS.calibration.getDraft().stretch_policy.width_mode,'millimetres');
    assert.equal(SS.documentFont.get().font,'asirit');
    assert.equal(SS.documentFont.get().overlap_percent.asirit,20);
  }finally{dom.window.close();}
});

test('Tikkun renders size notes and selects Unicode font with a stable height', async () => {
  const dom=new JSDOM(asset('index.html'),{runScripts:'outside-only',pretendToBeVisual:true});
  try{
    const w=dom.window;w.HTMLElement.prototype.scrollIntoView=function(){};w.eval(asset('core.js'));
    const SS=w.SS;SS.activeProfile=()=>null;SS.activeGeometry=()=>null;w.eval(asset('tikkun.js'));SS.tikkun.init({});
    const p=profile({stretch_policy:{...defaultProfile().stretch_policy,rendering:{font:'asirit',overlap_percent:{asirit:20}}}}), g=geometry({baseline_pitch_mm:5});
    const ep=effectiveProfile(p,g), result=computeLayout(source('rב zז אב'),p,g);
    const layout={id:'v25',status:'draft',snapshot:{profile:ep,geometry:g},summary:result.summary,lines:result.lines.map(l=>publicLine(l,ep))};
    SS.state.layout=layout;SS.bus.emit('layout:loaded',layout);await new Promise(resolve=>setTimeout(resolve,30));
    assert.deepEqual([...w.document.querySelectorAll('.size-note')].map(n=>n.textContent),['ב׳ רבתי','ז׳ זעירא']);
    assert.equal(SS.tikkun.selectedFont().family,'Sofer Asirit Unicode');
    assert(Math.abs(parseFloat(w.document.querySelector('.lines').style.fontSize)-6000/1489)<1e-8);
  }finally{dom.window.close();}
});
