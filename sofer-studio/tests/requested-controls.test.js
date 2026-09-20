import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { normalizeProfile } from '../engine/profile.js';
import { effectiveProfile } from '../engine/stretch-policy.js';
import { autoSuggestLine, computeLayout, normalizeGeometry } from '../engine/layout.js';
import { processSource } from '../engine/source.js';
const source = name => readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
function fixture() {
  const dom = new JSDOM(source('index.html'),{runScripts:'outside-only',pretendToBeVisual:true});
  const w = dom.window; w.eval(source('core.js')); w.confirm=()=>true;
  w.HTMLElement.prototype.scrollIntoView=function(){};
  const SS=w.SS;SS.toast=()=>{};SS.activeProfile=()=>null;SS.activeGeometry=()=>null;SS.activeSource=()=>null;
  return {dom,w,SS,d:w.document};
}
test('requested defaults save, custom lines remain editable even at a preset, and omitted controls stay absent',async()=>{
  const f=fixture();let saved;
  try {
    f.w.eval(source('calibration.js'));f.SS.calibration.init({api:{}});
    f.w.eval(source('geometry.js'));f.SS.geometry.init({api:{createGeometry:async body=>(saved=structuredClone(body),{...body,id:'g'}),listGeometries:async()=>[]}});
    const defaults={name:'45 cm Torah',line_width_mm:125,baseline_pitch_mm:7.5,top_margin_mm:60,bottom_margin_mm:75,outer_margin_mm:30,amudim_per_yeria:4};
    for(const [key,value] of Object.entries(defaults)) assert.equal(f.SS.geometry.getDraft()[key],value);
    assert.equal(f.SS.calibration.getDraft().letter_height_units,2.5);
    for(const id of ['cal-policy-mode','cal-unit-mode','cal-stretch-distribution','cal-stretch-position','geom-small_letter_reference','geom-setuma_reference_letter']) assert.equal(f.d.getElementById(id),null);
    for(const key of ['unit_mm','min_inter_word_gap_mm','max_inter_word_gap_mm','max_inter_word_gap_factor']) assert.equal(f.d.querySelector('[data-field="'+key+'"]'),null);
    assert.deepEqual([...f.d.querySelectorAll('.letter-table th')].map(el=>el.textContent),['Letter','Skeleton units','Total mm','Maximum increase','Stretch preference']);
    const input=f.d.getElementById('geom-lines-custom-input'),custom=f.d.querySelector('[data-lines="custom"]');
    custom.click();assert.equal(f.d.getElementById('geom-lines-custom').hidden,false);assert.equal(custom.getAttribute('aria-pressed'),'true');
    for(const value of [45,42,53]) {input.value=value;input.dispatchEvent(new f.w.Event('input'));assert.equal(f.SS.geometry.getDraft().lines_per_amud,value);assert.equal(f.d.getElementById('geom-lines-custom').hidden,false);}
    f.d.querySelector('#geometry-body .btn-primary').click();await new Promise(r=>setTimeout(r,10));
    assert.equal(saved.lines_per_amud,53);for(const [key,value] of Object.entries(defaults))assert.equal(saved[key],value);
    assert.doesNotMatch(f.d.querySelector('#geom-derived').textContent,/Ink extent|Allocated ruling height/);
    f.d.querySelector('[data-lines="48"]').click();assert.equal(f.d.getElementById('geom-lines-custom').hidden,true);
    custom.click();assert.equal(input.value,'48');
  } finally {f.dom.window.close();}
});
test('shortfall is the immutable original gap in row units, with line numbers further right and no ruling grid',()=>{
  const f=fixture();try {
    f.w.eval(source('tikkun.js'));f.SS.tikkun.init({});
    const lines=[0,2,4,6,5,-2].map((missing,i)=>({amud:1,line_index:i+1,text:'אב',width_mm:125-missing,base_leftover_mm:missing,leftover_mm:0,words:[],stretch_decisions:[{stretch_mm:Math.max(0,missing)}]}));
    f.SS.tikkun.render({id:'shortfall',geometry:{line_width_mm:125,lines_per_amud:42,baseline_pitch_mm:7.5},snapshot:{profile:{units_per_row:62.5}},lines});
    assert.deepEqual([...f.d.querySelectorAll('.side')].map(el=>el.textContent),['ש״ת','ח״א','ח״ב','ח״ג','ח״ב+0.5','י״א']);
    assert.deepEqual([...f.d.querySelectorAll('.lnum')].map(el=>el.textContent),['I','II','III','IV','V','VI']);
    assert.deepEqual([...f.d.querySelector('.line').children].map(el=>el.className),['lnum','side','ltext']);
    assert.equal(f.d.querySelector('.sirtut-grid'),null);
    assert.equal(lines[1].base_leftover_mm,2);assert.equal(lines[1].leftover_mm,0);
  }finally{f.dom.window.close();}
});
test('fixed draft uses table widths and equal percentage suggestions anywhere while protecting holy letters',()=>{
  const f=fixture();try {
    f.w.eval(source('calibration.js'));f.SS.calibration.init({api:{}});
    const draft=f.SS.calibration.getDraft();
    draft.stretch_policy.caps_percent={'ב':'unlimited','ש':'unlimited'};
    draft.stretch_policy.word_space_percent=0;
    const geometry=normalizeGeometry({line_width_mm:20,max_letters_per_line:0});
    const profile=effectiveProfile(normalizeProfile(draft),geometry);
    const line=computeLayout(processSource({text:'בש בש',format:'stam'}),profile,geometry).lines[0];
    const suggestions=autoSuggestLine(line,profile).suggestions;
    assert.equal(suggestions.length,4);
    const widths=new Map(line.words.flatMap(w=>w.letters.map(l=>[l.id,profile.letter_widths[l.base]*20/62])));
    const percentages=suggestions.map(s=>s.stretch_mm/widths.get(s.letter_occurrence_id));
    assert(Math.max(...percentages)-Math.min(...percentages)<.003);
    assert.equal(profile.stretch_position,'anywhere');assert.equal(profile.unit_basis,'line_units');
    const holy=computeLayout(processSource({text:'בש C',format:'stam'}),profile,geometry).lines[0];
    const ids=new Set(holy.words.flatMap(w=>w.letters.filter(l=>l.holy).map(l=>l.id)));
    assert(ids.size>0);for(const suggestion of autoSuggestLine(holy,profile).suggestions)assert(!ids.has(suggestion.letter_occurrence_id));
  }finally{f.dom.window.close();}
});
