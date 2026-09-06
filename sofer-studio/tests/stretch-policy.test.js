import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProfile} from '../engine/profile.js';
import {autoSuggestLine,applyStretch,stretchCandidatesOf,computeLayout,normalizeGeometry} from '../engine/layout.js';
import {effectiveProfile} from '../engine/stretch-policy.js';
import {validateProfileInput} from '../server/validation.js';
import {processSource} from '../engine/source.js';
import {planBookStretch} from '../server/stretch-book.js';
import {fitMarginPlan} from '../server/fit-margin.js';

function fixture(overrides={}) {
  const p=normalizeProfile({reference_height_mm:3,letter_height_mm:3,stroke_mm:0,unit_mm:.5,
    letter_widths:{'ד':4,'ב':8},non_stretchable:[],
    stretch_policy:{version:1,caps_percent:{'ד':50,'ב':50},distribution:'equal_percent',word_space_percent:0,setuma_percent:50,setuma_first:true,...overrides}});
  const words=[{type:'word',text:'ד',letters:[{id:'a',base:'ד'}],width_mm:2},{type:'word',text:'ב',letters:[{id:'b',base:'ב'}],width_mm:4}];
  const l={line_id:'line',amud:1,line_index:1,words,items:words,tokens:['ד','ב'],text:'ד ב',width_mm:7,base_leftover_mm:1.5,leftover_mm:1.5,stretch_decisions:[],status:'pending',spacing_metadata_complete:true};
  return {p,l};
}
test('equal percentage allocation is based on original measured letter widths',()=>{
  const {p,l}=fixture();const r=autoSuggestLine(l,p);assert.deepEqual(r.suggestions.map(d=>d.stretch_mm),[.5,1]);
  applyStretch(l,r.suggestions,p);assert.equal(l.leftover_mm,0);assert.deepEqual(autoSuggestLine(l,p),r);
});
test('equal millimetres is an explicit alternative, independent of letter widths',()=>{
  const {p,l}=fixture({distribution:'equal_mm'});assert.deepEqual(autoSuggestLine(l,p).suggestions.map(d=>d.stretch_mm),[.75,.75]);
});
test('v2 uses human holy-letter marks and numeric preferences',()=>{
  const p=normalizeProfile({reference_height_mm:3,letter_height_mm:3,stroke_mm:0,unit_mm:.5,
    letter_widths:{'א':2,'ב':2},non_stretchable:[],stretch_policy:{version:2,
      caps_percent:{'א':50,'ב':50},distribution:'equal_mm',word_space_percent:0,
      petucha_percent:'unlimited',setuma_percent:'unlimited',priorities:{'א':2,'ב':3}}});
  const words=[
    {type:'word',text:'א',letters:[{id:'holy-a',base:'א',holy:true}],width_mm:1},
    {type:'word',text:'אב',letters:[{id:'plain-a',base:'א'},{id:'plain-b',base:'ב'}],width_mm:2},
  ];
  const line={line_id:'v2',amud:1,line_index:1,words,items:words,tokens:['א','אב'],text:'א אב',
    width_mm:4,base_leftover_mm:.5,leftover_mm:.5,stretch_decisions:[],status:'pending',spacing_metadata_complete:true};
  const candidates=stretchCandidatesOf(line,p);
  assert.equal(candidates.some(c=>c.letter_occurrence_id==='holy-a'),false);
  assert.deepEqual(candidates.filter(c=>c.kind==='letter').map(c=>[c.letter_occurrence_id,c.priority]),[['plain-a',2],['plain-b',3]]);
  assert.deepEqual(autoSuggestLine(line,p).suggestions,[{letter_occurrence_id:'plain-a',stretch_mm:.5,kind:'letter'}]);
});
test('capped letters stop growing and spare allocation is shared with remaining targets',()=>{
  const {p,l}=fixture({caps_percent:{'ד':10,'ב':50}});const r=autoSuggestLine(l,p);assert.deepEqual(r.suggestions.map(d=>d.stretch_mm),[.2,1.3]);
});
test('unlimited is JSON-safe, finite at runtime and cannot exceed the line budget',()=>{
  const {p,l}=fixture({caps_percent:{'ד':'unlimited','ב':'unlimited'}});l.base_leftover_mm=l.leftover_mm=100;
  const r=autoSuggestLine(l,p);applyStretch(l,r.suggestions,p);assert.equal(l.leftover_mm,0);
  assert(stretchCandidatesOf(l,p).every(c=>Number.isFinite(c.cap_mm)));assert(JSON.stringify(p).includes('unlimited'));
  const before=JSON.stringify(l);assert.throws(()=>applyStretch(l,[{letter_occurrence_id:'a',stretch_mm:101}],p));assert.equal(JSON.stringify(l),before);
});
test('setumah is gap-only: a finite cap never falls back to letters or spaces',()=>{
  const {p,l}=fixture();l.items=[l.words[0],{type:'setuma_gap',width_mm:4},l.words[1]];l.has_setuma=true;l.base_leftover_mm=l.leftover_mm=3;
  const r=autoSuggestLine(l,p);assert.equal(r.suggestions.find(d=>d.kind==='setuma_gap').stretch_mm,2);
  assert.equal(r.suggestions.filter(d=>d.kind!=='setuma_gap').length,0);
  applyStretch(l,r.suggestions,p);assert.equal(l.leftover_mm,1);assert.equal(l.items[1].width_mm,4);
  assert.throws(()=>applyStretch(l,[{letter_occurrence_id:'a',stretch_mm:.1}],p));
});
test('unlimited internal setumah consumes the gap first without stretching letters',()=>{
  const {p,l}=fixture({setuma_percent:'unlimited'});l.items=[l.words[0],{type:'setuma_gap',width_mm:4},l.words[1]];l.has_setuma=true;
  const r=autoSuggestLine(l,p);assert.equal(r.suggestions.length,1);assert.equal(r.suggestions[0].kind,'setuma_gap');assert.equal(r.suggestions[0].stretch_mm,1.5);
});
test('ordinary spaces grow at most 50%, also respecting a stricter saved spacing limit',()=>{
  const {p,l}=fixture({caps_percent:{},word_space_percent:50});p.word_space_limit_mm=1.3;
  const r=autoSuggestLine(l,p);assert.equal(r.suggestions.length,1);assert.equal(r.suggestions[0].stretch_mm,.3);
  assert.equal(r.shortfall_mm,1.2);assert.throws(()=>applyStretch(l,[{letter_occurrence_id:'word-space-before-1',stretch_mm:.501}],p));
});
test('new percentage profiles retain the approved 50% space cap when units change',()=>{
  const {p,l}=fixture({caps_percent:{},word_space_percent:50});
  const resolved=effectiveProfile({...p,units_per_row:80,unit_basis:'average_letter'},
    {line_width_mm:180,small_letter_reference:'י',max_inter_word_gap_factor:.95});
  assert.equal(resolved.word_space_limit_mm,null);
  assert.deepEqual(autoSuggestLine(l,resolved).suggestions,
    [{letter_occurrence_id:'word-space-before-1',stretch_mm:.5,kind:'word_space'}]);
});
test('fixed passages, terminal gaps, protected names and non-stretchable letters remain protected',()=>{
  const {p,l}=fixture();
  for(const flag of ['fixed_pattern','petucha_end','sefer_end','setuma_at_edge'])assert.equal(autoSuggestLine({...l,[flag]:true},p).suggestions.length,0);
  l.words[0].isShem=true;p.non_stretchable=['ב'];assert.equal(autoSuggestLine(l,p).suggestions.length,0);
  assert.throws(()=>applyStretch(l,[{letter_occurrence_id:'a',stretch_mm:.1}],p));
});
test('duplicate targets are aggregated before validation and failure is atomic',()=>{
  const {p,l}=fixture();const before=JSON.stringify(l);
  assert.throws(()=>applyStretch(l,[{letter_occurrence_id:'a',stretch_mm:.6},{letter_occurrence_id:'a',stretch_mm:.6}],p));assert.equal(JSON.stringify(l),before);
});
test('column unit calculation uses width divided by row units and does not mutate the profile',()=>{
  const p=normalizeProfile({units_per_row:360,unit_mm:99});const before=JSON.stringify(p);
  assert.equal(effectiveProfile(p,{line_width_mm:180}).unit_mm,.5);assert.equal(effectiveProfile(p,{line_width_mm:144}).unit_mm,.4);assert.equal(JSON.stringify(p),before);
  const source=processSource({text:'בר בר בר'}),g=normalizeGeometry({line_width_mm:180});
  assert.equal(computeLayout(source,p,g).lines[0].width_mm,computeLayout(source,{...p,units_per_row:null,unit_mm:.5},g).lines[0].width_mm);
});
test('input rejects malformed percentages, infinite numbers, excessive word spacing and invalid units',()=>{
  const {p}=fixture();assert.deepEqual(validateProfileInput(p),[]);
  for(const value of [-1,Infinity,NaN,'50%',null])assert(validateProfileInput({...p,stretch_policy:{...p.stretch_policy,caps_percent:{'ד':value}}}).length);
  for(const value of [51,'unlimited',-1])assert(validateProfileInput({...p,stretch_policy:{...p.stretch_policy,word_space_percent:value}}).length);
  assert(validateProfileInput({...p,units_per_row:0}).length);
});
test('whole-book plans include approved internal setumah expansion but preserve manual/written lines',()=>{
  const {p,l}=fixture({setuma_percent:'unlimited'});l.items=[l.words[0],{type:'setuma_gap',width_mm:4},l.words[1]];l.has_setuma=true;
  const row={id:'test',profile_snapshot:JSON.stringify(p),geometry_snapshot:JSON.stringify({lines_per_amud:42})};
  const plan=planBookStretch(row,[l,{...l,line_id:'written',status:'written'}],p);
  assert.equal(plan.summary.proposed_lines,1);assert.equal(plan.summary.setuma_gaps_stretched,1);assert.equal(plan.summary.letters_stretched,0);assert.equal(plan.summary.skipped_lines,1);
});

test('overfull lines cannot be made apparently aligned by applying an empty plan',()=>{
  const {p,l}=fixture();l.base_leftover_mm=l.leftover_mm=-.01;
  const before=JSON.stringify(l);assert.throws(()=>applyStretch(l,[],p),/overfull/);assert.equal(JSON.stringify(l),before);
});

test('equal millimetres includes spaces, stops at 50%, and reallocates to unlimited letters',()=>{
  const {p,l}=fixture({distribution:'equal_mm',caps_percent:{'ד':'unlimited','ב':50},word_space_percent:50});
  l.base_leftover_mm=l.leftover_mm=9;
  const r=autoSuggestLine(l,p),byId=Object.fromEntries(r.suggestions.map(d=>[d.letter_occurrence_id,d.stretch_mm]));
  assert.deepEqual(byId,{a:6.5,b:2,'word-space-before-1':.5});
  l.base_leftover_mm=l.leftover_mm=1.2;
  assert.deepEqual(autoSuggestLine(l,p).suggestions.map(d=>d.stretch_mm),[.4,.4,.4]);
});

test('multiple internal setumah gaps share equally and no ordinary target is available',()=>{
  const {p,l}=fixture({distribution:'equal_mm',setuma_percent:'unlimited',word_space_percent:50});
  l.words.push({...l.words[0],letters:[{id:'c',base:'ד'}]});
  l.items=[l.words[0],{type:'setuma_gap',width_mm:4},l.words[1],{type:'setuma_gap',width_mm:8},l.words[2]];l.has_setuma=true;
  const r=autoSuggestLine(l,p);assert.deepEqual(r.suggestions.map(d=>[d.kind,d.stretch_mm]),[['setuma_gap',.75],['setuma_gap',.75]]);
});

test('fit-to-margin never increases percentage caps or overrides gap-only paragraph rules',()=>{
  const {p,l}=fixture({caps_percent:{'ד':50,'ב':50}});l.base_leftover_mm=l.leftover_mm=50;
  const row={id:'test',profile_snapshot:JSON.stringify(p),geometry_snapshot:JSON.stringify({lines_per_amud:42})};
  const plan=fitMarginPlan(row,[l]);assert.equal(plan.changes.length,0);assert.equal(plan.summary.short_lines,1);
  assert.deepEqual(plan.profile.stretch_policy,p.stretch_policy);
});

test('rounding never crosses a cap or line margin across many budgets',()=>{
  for(let n=1;n<500;n++){
    const {p,l}=fixture({distribution:'equal_mm',caps_percent:{'ד':'unlimited','ב':50},word_space_percent:50});
    l.base_leftover_mm=l.leftover_mm=n/73;const caps=new Map(stretchCandidatesOf(l,p).map(c=>[c.letter_occurrence_id,c.cap_mm]));
    const r=autoSuggestLine(l,p);assert(r.suggestions.every(d=>d.stretch_mm<=caps.get(d.letter_occurrence_id)+1e-9));
    applyStretch(l,r.suggestions,p);assert(l.leftover_mm>=0);assert.deepEqual(autoSuggestLine(l,p),r);
  }
});
