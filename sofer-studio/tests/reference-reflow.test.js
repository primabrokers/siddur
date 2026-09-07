import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadReferenceSource} from '../server/reference.js';
import {computeLayout,computeLayoutAsync,normalizeGeometry,autoSuggestLine} from '../engine/layout.js';
import {normalizeProfile,HEBREW_LETTERS} from '../engine/profile.js';
import {effectiveProfile} from '../engine/stretch-policy.js';
import {totalWidth} from '../engine/width.js';
const geometry=normalizeGeometry({line_width_mm:180,lines_per_amud:42,max_letters_per_line:0});
const p=units=>normalizeProfile({units_per_row:units,unit_basis:'average_letter',layout_mode:'reflow',stretch_policy:{version:1,caps_percent:{'ד':'unlimited','ה':'unlimited','ר':'unlimited','ת':'unlimited','א':50,'ט':50,'ל':50,'מ':50,'ם':50,'ק':50},distribution:'equal_mm',word_space_percent:50,setuma_percent:'unlimited',setuma_first:true}});
const source=book=>{const d=loadReferenceSource(book);d.reference=d.canonical.reference;return d;};
const letters=r=>r.lines.flatMap(l=>l.words.flatMap(w=>w.letters.map(x=>x.id)));
const markers=r=>r.lines.flatMap(l=>{let previous='';const out=[];for(const it of l.items){if(it.type==='word')previous=it.letters.at(-1).id;else if(it.type==='setuma_gap')out.push(['ס',previous]);}if(l.petucha_end)out.push(['פ',l.words.at(-1).letters.at(-1).id]);return out;});

test('older average-unit profiles use direct table units on recompute without mutating saved inputs',()=>{
  const input=p(62), before=JSON.stringify(input), profile=effectiveProfile(input,geometry);
  assert.equal(profile.unit_basis,'line_units');
  assert.equal(profile.average_unit_mm,undefined);
  assert(Math.abs(totalWidth('א',profile)-(2*180/62+profile.stroke_mm))<1e-10);
  assert.equal(JSON.stringify(input),before);
});

test('changing units repaginates the reference without clipping, losing, duplicating or reordering words',async()=>{
  const doc=source('Genesis'),before=JSON.stringify(doc.reference);
  const exact=computeLayout(doc,normalizeProfile({}),geometry);
  const a=computeLayout(doc,p(50),geometry),b=await computeLayoutAsync(doc,p(80),geometry);
  assert.equal(exact.lines.length,61*42);assert(a.lines.length>b.lines.length);assert(a.summary.total_amudim>b.summary.total_amudim);
  assert.deepEqual(letters(a),letters(exact));assert.deepEqual(letters(b),letters(exact));
  assert.deepEqual(markers(a),markers(exact));assert.deepEqual(markers(b),markers(exact));
  assert.equal(a.lines.filter(l=>!l.fixed_pattern&&l.leftover_mm<-.001).length,0);
  assert.equal(b.lines.filter(l=>!l.fixed_pattern&&l.leftover_mm<-.001).length,0);
  assert(a.lines.every(l=>!l.setuma_at_edge));assert(b.lines.every(l=>!l.setuma_at_edge));
  assert.equal(JSON.stringify(doc.reference),before);assert.equal(a.summary.layout_mode,'reflow');
  console.log(JSON.stringify({reflowProof:{units50:a.summary.total_amudim,units80:b.summary.total_amudim,exactReference:exact.summary.total_amudim,letters:a.summary.total_letters}}));
});

test('reflow retains fixed song and inverted-nun lines and all five book boundaries',()=>{
  const doc=source('all'),exact=computeLayout(doc,normalizeProfile({}),geometry),flow=computeLayout(doc,p(62),geometry);
  assert.deepEqual(letters(flow),letters(exact));assert.deepEqual(markers(flow),markers(exact));
  const fixed=r=>r.lines.filter(l=>l.fixed_pattern&&l.words.length).map(l=>[l.tokens,l.items.map(x=>x.type)]);
  assert.deepEqual(fixed(flow),fixed(exact));
  assert.equal(flow.lines.filter(l=>l.sefer_end).length,5);
  assert(flow.lines.every(l=>!l.setuma_at_edge));
  assert(flow.lines.filter(l=>l.fixed_pattern).every(l=>autoSuggestLine(l,p(62)).suggestions.length===0));
});
