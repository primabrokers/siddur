import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadReferenceSource} from '../server/reference.js';
import {computeLayout,normalizeGeometry,autoSuggestLine} from '../engine/layout.js';
import {normalizeProfile} from '../engine/profile.js';
import {sectionBreakSummary} from '../engine/source.js';
import {startTestServer,bootstrap,request,jsonHeaders} from './helpers.js';

test('full pinned Tikkun retains every verse, word, section, inverted nun and 245 × 42 ruling lines',()=>{
  const doc=loadReferenceSource('all'),ref=doc.canonical.reference;
  assert.equal(doc.verse_count,5846);assert.equal(doc.letter_count,304801);assert.equal(doc.word_count,79977);
  // The pinned final record has an empty trailing array cell. It is reference
  // padding rather than a 380th setumah because there is no following word.
  assert.deepEqual(sectionBreakSummary(doc.verses),{petucha:290,setuma:379,present:true,verified:false});
  assert.equal(ref.lines.length,245*42);
  assert.equal(ref.lines.flatMap(l=>l.items).filter(i=>i.type==='nun_hafucha').length,2);
  for(let page=1;page<=245;page++)assert.equal(ref.lines.filter(l=>l.page===page).length,42);
  assert.deepEqual(ref.lines.filter(l=>l.page===78&&l.blank).map(l=>l.line),[6,37]);
  assert.equal(ref.lines.filter(l=>l.page===61&&l.blank).length,4);
  assert.equal(doc.verses.at(-1).ref,'Deuteronomy 34:12');
  assert(doc.verses.at(-1).consonant.endsWith('לעיני כל ישראל'));
  assert.notEqual(ref.lines.at(-1).items.at(-1)?.type,'setuma_gap');
});

test('single books preserve boundary columns and immutable membership through recalibration',()=>{
  for(const [name,verses]of [['Genesis',1533],['Exodus',1210],['Leviticus',859],['Numbers',1288],['Deuteronomy',956]]){
    const doc=loadReferenceSource(name);assert.equal(doc.verse_count,verses);assert.equal(doc.book_count,1);
    assert(doc.canonical.reference.lines.every(l=>l.items.filter(i=>i.type==='word').every(i=>Number.isInteger(i.word_index))));
  }
  const doc=loadReferenceSource('Genesis');doc.reference=doc.canonical.reference;
  const profile=normalizeProfile({}),geometry=normalizeGeometry({lines_per_amud:42,line_width_mm:180,max_letters_per_line:0});
  const a=computeLayout(doc,profile,geometry),b=computeLayout(doc,profile,{...geometry,line_width_mm:170});
  assert.deepEqual(a.lines.map(l=>l.tokens),b.lines.map(l=>l.tokens));assert.equal(a.lines.length,61*42);
  assert.equal(a.lines[16*42+7].first_word,'וירא');
  assert.deepEqual(autoSuggestLine(a.lines.find(l=>l.petucha_end),profile).suggestions,[]);
  assert.throws(()=>computeLayout(doc,profile,{...geometry,lines_per_amud:48}),/requires 42/);
});

test('reference imports, computes, locks and exports through the real HTTP API with durable provenance',async()=>{
  const server=await startTestServer(':memory:');
  try{
    const seed=await bootstrap(server),headers=jsonHeaders(seed.token);
    const source=await request(server,'POST','/api/sources/import',{headers,body:{builtin:'tikkun:Genesis'}});
    assert.equal(source.status,200,source.text);
    const geometry=await request(server,'POST','/api/geometries',{headers,body:{name:'Reference test',lines_per_amud:42,line_width_mm:180,max_letters_per_line:0}});
    const result=await request(server,'POST','/api/layout/compute',{headers,body:{source_id:source.json.id,profile_id:seed.profile_id,geometry_id:geometry.json.id,poll:true}});
    assert.equal(result.status,200,result.text);
    let job;
    for(let i=0;i<200;i++){job=await request(server,'GET','/api/layout/compute-job/'+result.json.job_id);if(job.json.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(job.json.status,'done',JSON.stringify(job.json));
    const id=job.json.layout_id,path='/api/layouts/'+id;
    const page=await request(server,'GET',path+'?from=672&limit=42');
    assert.equal(page.json.lines.length,42);assert.equal(page.json.total_lines,2562);
    assert(page.json.lines.every(l=>l.reference_page===17));assert.equal(page.json.lines[7].first_word,'וירא');
    assert.equal(page.json.summary.reference.id,'tikkun-245-57ba104e');
    assert.equal((await request(server,'POST',path+'/lock',{headers,body:{}})).status,200);
    const csv=await request(server,'GET',path+'/export?format=csv');assert.equal(csv.status,200);assert.match(csv.text,/בראשית/);
    const json=await request(server,'GET',path+'/export?format=json');assert.equal(json.status,200);assert.equal(json.json.lines.length,2562);
    assert.equal(json.json.summary.reference.raw_sha256,page.json.summary.reference.raw_sha256);
  }finally{await server.close();}
});
