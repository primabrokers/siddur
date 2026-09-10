import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultProfile,normalizeProfile} from '../engine/profile.js';
import {computeLayout,computeLayoutAsync,normalizeGeometry,petuchaGapMm} from '../engine/layout.js';
import {effectiveProfile} from '../engine/stretch-policy.js';
import {validateLine} from '../engine/validate.js';
import {processSource} from '../engine/source.js';
import {loadReferenceSource} from '../server/reference.js';
const g=normalizeGeometry({line_width_mm:124,max_letters_per_line:0});
const profile=(gap=20)=>normalizeProfile({...defaultProfile(),stretch_policy:{...defaultProfile().stretch_policy,
  special_widths_units:{...defaultProfile().special_widths_units,petucha:gap}}});
const doc=text=>processSource({text,format:'stam'});
const ids=result=>result.lines.flatMap(l=>l.words.flatMap(w=>w.letters.map(x=>x.id)));

test('petucha reserves at least 20 row units and moves with the preceding whole word',async()=>{
  for(const gap of [10,20,25,40]) {
    const p=profile(gap),src=doc(Array(20).fill('א').join(' ')+' p אבג');
    const result=computeLayout(src,p,g),asyncResult=await computeLayoutAsync(src,p,g);
    assert.deepEqual(ids(result),ids(asyncResult));
    assert.deepEqual(result.lines.map(l=>[l.tokens,l.petucha_end,l.width_mm]),asyncResult.lines.map(l=>[l.tokens,l.petucha_end,l.width_mm]));
    const end=result.lines.find(l=>l.petucha_end);
    assert.equal(end.words.length,1);assert.equal(end.words[0].text,'א');
    assert(g.line_width_mm-end.width_mm>=Math.max(20,gap)*2);
    assert.equal(result.lines[0].words.length,19);
    assert.equal(result.lines.at(-1).words[0].text,'אבג');
    assert.equal(ids(result).length,23);
  }
});

test('an exact 20-unit ending gap fits; one additional unit moves the last word',()=>{
  // 20 + 1 + 21 = 42 units of text and word space, leaving exactly 20.
  for(const last of ['א'.repeat(9)+'ש','א'.repeat(11)]) {
    const result=computeLayout(doc('א'.repeat(10)+' '+last+' p אב'),profile(),g);
    const end=result.lines.find(l=>l.petucha_end);
    assert.equal(end.words.length,last.length===10?2:1);
    assert(g.line_width_mm-end.width_mm>=40);
  }
});

test('setuma keeps the preceding word, 20-unit gap and following word on the same line',async()=>{
  const src=doc(Array(13).fill('אב').join(' ')+' s גד p הו'),p=profile();
  for(const r of [computeLayout(src,p,g),await computeLayoutAsync(src,p,g)]) {
    const l=r.lines.find(l=>l.has_setuma);
    assert.deepEqual(l.items.map(i=>i.type),['word','setuma_gap','word']);
    assert.deepEqual(l.words.map(w=>w.text),['אב','גד']);
    assert.equal(l.items[1].width_mm,40);assert.equal(l.setuma_at_edge,false);
    assert(l.petucha_end);assert(g.line_width_mm-l.width_mm>=40);
    assert.equal(ids(r).length,30);
  }
});

test('an indivisible word with no room for the required paragraph gap is retained and flagged',()=>{
  const p=profile(),r=computeLayout(doc('א'.repeat(22)+' p אב'),p,g),l=r.lines[0];
  assert.equal(l.words[0].letters.length,22);assert(l.petucha_end);
  assert(validateLine(l,effectiveProfile(p,g),g).errors.some(e=>e.includes('paragraph gap needs')));
});

test('measured reference reflow preserves every word and paragraph anchor while reserving the ending gap',()=>{
  const src=loadReferenceSource('all');src.reference=src.canonical.reference;
  const p=profile(),exact=computeLayout(src,normalizeProfile({}),g),r=computeLayout(src,p,g);
  assert.deepEqual(ids(r),ids(exact));
  const anchors=x=>x.lines.filter(l=>l.petucha_end).map(l=>l.words.at(-1)?.letters.at(-1)?.id);
  assert.deepEqual(anchors(r),anchors(exact));
  const fixed=x=>x.lines.filter(l=>l.fixed_pattern&&l.words.length).map(l=>l.tokens);
  assert.deepEqual(fixed(r),fixed(exact));
  assert.equal(r.lines.filter(l=>l.sefer_end).length,5);
  const required=petuchaGapMm(effectiveProfile(p,g));
  const short=r.lines.filter(l=>l.petucha_end&&!l.fixed_pattern&&g.line_width_mm-l.width_mm+.001<required);
  assert.deepEqual(short.map(l=>({id:l.id,tokens:l.tokens,width:l.width_mm})),[]);
  assert(r.lines.every(l=>!l.setuma_at_edge));
});
