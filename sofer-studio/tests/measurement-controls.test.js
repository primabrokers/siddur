import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { defaultProfile, normalizeProfile } from '../engine/profile.js';
import { effectiveProfile } from '../engine/stretch-policy.js';
import { computeLayout, normalizeGeometry, stretchCandidatesOf, applyStretch, autoSuggestLine } from '../engine/layout.js';
import { processSource } from '../engine/source.js';
import { validateProfileInput } from '../server/validation.js';
import { totalWidth } from '../engine/width.js';
const source = n => readFileSync(new URL('../public/'+n,import.meta.url),'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve,20));
function ui(saved) {
  const dom = new JSDOM(source('index.html'), {runScripts:'outside-only',pretendToBeVisual:true});
  const w = dom.window; w.eval(source('core.js')); w.confirm=()=>true;
  w.HTMLElement.prototype.scrollIntoView=function(){};
  const SS=w.SS; SS.toast=()=>{}; SS.activeProfile=()=>saved; SS.activeGeometry=()=>null; SS.activeSource=()=>null;
  const f={dom,w,SS,d:w.document,body:null};
  w.eval(source('calibration.js'));
  SS.calibration.init({api:{getProfile:async()=>saved, createProfile:async p=>(f.body=structuredClone(p),{...p,id:'saved'}),
    updateProfile:async(_,p)=>(f.body=structuredClone(p),{...p,id:'saved'}),listProfiles:async()=>[]}});
  w.eval(source('geometry.js')); SS.geometry.init({api:{}});
  f.input=(selector,value,event='input')=>{const el=f.d.querySelector(selector); assert(el,selector);el.value=String(value);el.dispatchEvent(new w.Event(event,{bubbles:true}));};
  return f;
}
test('all special rows share numeric percentage and Unlimited controls, including hyphen, and save exact values', async()=>{
  const f=ui(null);
  try {
    for(const key of ['word_space','hyphen','petucha','setuma']) {
      const mode='[aria-label="stretch limit type for '+key+'"]', cap='[aria-label="stretch cap for '+key+'"]';
      assert.deepEqual([...f.d.querySelector(mode).options].map(x=>x.value),['percent','unlimited']);
      f.input(mode,'percent','change'); f.input(cap,125);
      assert.equal(f.SS.calibration.getDraft().stretch_policy[key==='word_space'?'word_space_percent':key+'_percent'],125);
      f.input(mode,'unlimited','change'); assert(f.d.querySelector(cap).disabled);
      f.input(mode,'percent','change'); assert.equal(f.d.querySelector(cap).value,'125');
      f.input(mode,'unlimited','change');
    }
    f.input('#cal-name','Measurement controls');
    f.d.querySelector('#calibration-body .grid-crud .btn-primary').click(); await tick();
    assert.deepEqual(validateProfileInput(f.body),[]);
    for(const key of ['word_space','hyphen','petucha','setuma']) assert.equal(f.body.stretch_policy[key+'_percent'],'unlimited');
    const reloaded=ui({...f.body,id:'saved'}); await tick();
    try { for(const key of ['word_space','hyphen','petucha','setuma']) assert.equal(reloaded.d.querySelector('[aria-label="stretch limit type for '+key+'"]').value,'unlimited'); }
    finally { reloaded.dom.window.close(); }
  } finally { f.dom.window.close(); }
});
test('only Letter height is editable, in units defaulting to 2.5, and changes preserve the horizontal row budget',()=>{
  const f=ui(null);
  try {
    const field=f.d.querySelector('[data-field="letter_height_units"]');
    assert.equal(field.value,'2.5'); assert.equal(field.closest('label').querySelector('.unit').textContent,'units');
    for(const name of ['letter_height_mm','reference_height_mm','min_letter_height_mm','stroke_mm','min_nib_mm','gaps.inter_letter']) assert.equal(f.d.querySelector('[data-field="'+name+'"]'),null);
    assert.equal(f.SS.calibration.getDraft().stroke_mm,0);
    assert.equal(f.SS.calibration.getDraft().min_nib_mm,0);
    assert.equal(f.SS.calibration.getDraft().gaps.inter_letter,0);
    assert.equal(f.SS.calibration.getDraft().stretch_policy.special_widths_units.word_space,1);
    assert.equal(defaultProfile().special_widths_units.word_space,1);
    assert.equal(defaultProfile().stroke_mm,0);
    f.input('#geometry-body [data-field="line_width_mm"]',124); // one row unit = 2mm.
    const p=f.SS.calibration.getDraft(); assert.equal(p.letter_height_mm,5);
    const before=totalWidth('א',effectiveProfile(normalizeProfile(p),{line_width_mm:124}));
    f.input('[data-field="letter_height_units"]',3); assert.equal(p.letter_height_mm,6);
    assert.equal(totalWidth('א',effectiveProfile(normalizeProfile(p),{line_width_mm:124})),before);
    f.input('#geometry-body [data-field="line_width_mm"]',186); assert.equal(p.letter_height_mm,9); assert.equal(field.value,'3');
  } finally { f.dom.window.close(); }
});
test('legacy millimetre heights display as units without changing stored measurements on save',async()=>{
  const saved=normalizeProfile({id:'old',name:'Old',units_per_row:62,unit_basis:'line_units',letter_height_mm:4.25});
  const f=ui(saved);
  try { await tick(); assert.equal(f.SS.calibration.getDraft().letter_height_units,null);
    f.d.querySelector('#calibration-body .grid-crud .btn-primary').click();await tick();
    assert.equal(f.body.letter_height_units,null);assert.equal(f.body.letter_height_mm,4.25);
    assert.equal(f.body.reference_height_mm,saved.reference_height_mm);assert.equal(f.body.min_letter_height_mm,saved.min_letter_height_mm);
    assert.equal(f.body.stroke_mm,saved.stroke_mm);assert.equal(f.body.min_nib_mm,saved.min_nib_mm);
    assert.deepEqual(f.body.gaps,saved.gaps);
  } finally { f.dom.window.close(); }
});
const p = overrides => normalizeProfile({...defaultProfile(),units_per_row:null,letter_height_units:null,
  letter_height_mm:3,reference_height_mm:3,unit_mm:.5,stroke_mm:0,
  stretch_policy:{...defaultProfile().stretch_policy,caps_percent:{},word_space_percent:0,hyphen_percent:0,special_widths_units:{...defaultProfile().special_widths_units,word_space:2},...overrides}});
const g=normalizeGeometry({line_width_mm:20,max_letters_per_line:0});
const line=(text,profile)=>computeLayout(processSource({text,format:'stam'}),profile,g).lines[0];
test('v2 word spaces support percentages above 50 and Unlimited but retain explicit physical caps',()=>{
  for(const value of [125,'unlimited']) {
    const prof=effectiveProfile(p({word_space_percent:value}),g), l=line('א ב',prof);
    const c=stretchCandidatesOf(l,prof).find(c=>c.kind==='word_space');
    assert.equal(c.cap_mm,value==='unlimited'?l.base_leftover_mm:1.25);
    applyStretch(l,[{letter_occurrence_id:c.letter_occurrence_id,stretch_mm:c.cap_mm}],prof);
    assert(l.leftover_mm>=0);
    const capped=effectiveProfile(p({word_space_percent:value}),{...g,max_inter_word_gap_mm:1.1});
    assert.equal(stretchCandidatesOf(line('א ב',capped),capped).find(c=>c.kind==='word_space').cap_mm,.1);
    assert.deepEqual(validateProfileInput(prof),[]);
  }
});
test('hyphen caps and priorities control marked width; two hyphens count twice and holy letters remain protected',()=>{
  for(const cap of [50,'unlimited']) {
    const prof=effectiveProfile(p({hyphen_percent:cap,priorities:{hyphen:2}}),g), l=line('א--ב',prof);
    const c=stretchCandidatesOf(l,prof).find(c=>c.kind==='hyphen');
    assert(c);assert.equal(c.base_width_mm,1);assert.equal(c.priority,2);
    assert.equal(c.cap_mm,cap==='unlimited'?l.base_leftover_mm:.5);
    const suggested=autoSuggestLine(l,prof);assert.equal(suggested.suggestions.length,1);
    applyStretch(l,suggested.suggestions,prof);assert(l.leftover_mm>=0);
    assert.equal(stretchCandidatesOf(line('א--C',prof),prof).filter(c=>c.kind==='hyphen').length,0);
    const noHyphen=effectiveProfile(p({hyphen_percent:0}),g);assert.equal(stretchCandidatesOf(line('א--ב',noHyphen),noHyphen).length,0);
  }
});
test('letter height units resolve per column without mutating input or changing old mm profiles',()=>{
  const prof=defaultProfile(), before=JSON.stringify(prof);
  for(const width of [124,186]) { const r=effectiveProfile(prof,{line_width_mm:width});assert.equal(r.letter_height_mm,2.5*width/62);assert.deepEqual(effectiveProfile(r,{line_width_mm:width}),r); }
  assert.equal(JSON.stringify(prof),before);
  const old=normalizeProfile({units_per_row:62,unit_basis:'line_units',letter_height_mm:4.25});
  assert.equal(effectiveProfile(old,{line_width_mm:186}).letter_height_mm,4.25);
  for(const value of [0,-1,Infinity,NaN]) assert(validateProfileInput({...prof,letter_height_units:value}).length);
});
