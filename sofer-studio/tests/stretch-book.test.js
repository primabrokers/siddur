import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProfile} from '../engine/profile.js';
import {autoSuggestLine,applyStretch,normalizeGeometry} from '../engine/layout.js';
import {planBookStretch,stretchReport} from '../server/stretch-book.js';
import {startTestServer,bootstrap,compute,request,jsonHeaders} from './helpers.js';

const profile=normalizeProfile({});
function line(i=1,extra={}) {return {line_id:'line-'+i,line_index:i,amud:Math.ceil(i/42),status:'pending',spacing_metadata_complete:true,
  width_mm:10,base_leftover_mm:2,leftover_mm:2,stretch_decisions:[],words:[{text:'בר',letters:[{id:'b-'+i,base:'ב'},{id:'r-'+i,base:'ר'}]}],...extra};}
const row={id:'test',geometry_snapshot:JSON.stringify({lines_per_amud:42})};

test('suggest/apply/re-suggest is idempotent and respects the physical budget',()=>{
  for(let n=1;n<200;n++) {
    const l=line(1,{base_leftover_mm:n/73,leftover_mm:n/73});
    const a=autoSuggestLine(l,profile);applyStretch(l,a.suggestions,profile);
    const b=autoSuggestLine(l,profile);assert.deepEqual(b.suggestions,a.suggestions);
    applyStretch(l,b.suggestions,profile);assert(l.leftover_mm>=0);
    assert(a.suggestions.reduce((s,d)=>s+d.stretch_mm,0)<=l.base_leftover_mm+1e-6);
  }
});
test('whole-book preview is read-only, covers pages, and reports exact occurrences',()=>{
  const lines=[line(1),line(43),line(85)],before=JSON.stringify(lines);
  const plan=planBookStretch(row,lines,profile);assert.equal(JSON.stringify(lines),before);
  assert.equal(plan.summary.proposed_lines,3);assert.deepEqual([...new Set(plan.entries.map(e=>e.page))],[1,2,3]);
  assert(plan.entries.every(e=>e.line===1&&e.word==='בר'&&e.word_index===1&&e.letter_occurrence_id));
  assert.equal(plan.revision,planBookStretch(row,lines,profile).revision);
  lines[0].status='written';assert.notEqual(plan.revision,planBookStretch(row,lines,profile).revision);
});
test('auto stretch preserves protected names, intentional whitespace, legacy and manual decisions',()=>{
  const lines=[line(1,{fixed_pattern:true}),line(2,{petucha_end:true}),line(3,{sefer_end:true}),line(4,{has_setuma:true}),
    line(5,{spacing_metadata_complete:false}),line(6,{stretch_decisions:[{letter_occurrence_id:'b-6',stretch_mm:.5}]}),line(7,{status:'written'}),
    line(8,{words:[{text:'אלהים',isShem:true,letters:[{id:'protected',base:'ה'}]}]})];
  const p=planBookStretch(row,lines,profile);assert.equal(p.lines.length,0);assert.equal(p.skipped.length,8);
  assert.equal(p.summary.remaining_gap_lines,4,'short manual, written, legacy and candidate-free lines remain visible; intentional spaces do not count');
  assert.equal(stretchReport(lines,{lines_per_amud:42})[0].letter_occurrence_id,'b-6');
  assert.throws(()=>applyStretch(lines[0],[],profile),/frozen/);
});
test('zero legacy letter count disables the advisory; physical width remains canonical',()=>{
  assert.equal(normalizeGeometry({line_width_mm:150,max_letters_per_line:0}).max_letters_per_line,0);
  assert.equal(normalizeGeometry({line_width_mm:150,max_letters_per_line:0}).line_width_mm,150);
});
test('HTTP preview/apply is revision-bound, durable, locked-safe and stores spacing metadata',async()=>{
  const server=await startTestServer(':memory:');
  try{
    const seed=await bootstrap(server),h=jsonHeaders(seed.token),computed=await compute(server,seed.token,seed),id=computed.layout_id;
    assert(id,JSON.stringify(computed));const path='/api/layouts/'+id;
    const before=await request(server,'GET',path);assert.equal(before.status,200);
    assert(before.json.lines.every(l=>l.spacing_metadata_complete));
    assert(before.json.lines.flatMap(l=>l.words).flatMap(w=>w.letters).every(l=>Number.isFinite(l.width_mm)));
    const preview=await request(server,'POST',path+'/stretch-book',{headers:h,body:{action:'preview'}});
    assert.equal(preview.status,200,preview.text);assert(preview.json.lines.length>0);
    const unchanged=await request(server,'GET',path);assert.deepEqual(unchanged.json.lines,before.json.lines);
    const stale=await request(server,'POST',path+'/stretch-book',{headers:h,body:{action:'apply',confirm:true,revision:'stale'}});assert.equal(stale.status,409);
    const apply=await request(server,'POST',path+'/stretch-book',{headers:h,body:{action:'apply',confirm:true,revision:preview.json.revision}});assert.equal(apply.status,200,apply.text);
    const report=await request(server,'GET',path+'/stretch-report');assert.equal(report.status,200);assert.deepEqual(report.json.entries,preview.json.entries);
    const repeat=await request(server,'POST',path+'/stretch-book',{headers:h,body:{action:'apply',confirm:true,revision:preview.json.revision}});assert.equal(repeat.status,409);
    server.db.prepare("UPDATE layouts SET status='locked' WHERE id=?").run(id);
    const locked=await request(server,'POST',path+'/stretch-book',{headers:h,body:{action:'preview'}});assert.equal(locked.status,409);
    assert.equal((await request(server,'GET',path+'/stretch-report')).status,200);
  }finally{await server.close();}
});
