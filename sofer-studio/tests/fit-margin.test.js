import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fitMarginPlan,applyFitCopy} from '../server/fit-margin.js';
import {normalizeProfile} from '../engine/profile.js';
import {autoSuggestLine,applyStretch,computeLayout,normalizeGeometry} from '../engine/layout.js';
import {processSource} from '../engine/source.js';
import {validateLine} from '../engine/validate.js';
import {startTestServer,bootstrap,request,jsonHeaders} from './helpers.js';
function fixture(){
  const p=normalizeProfile({}),g=normalizeGeometry({line_width_mm:180});
  const l=computeLayout(processSource({text:'בר בר בר'}),p,g).lines[0];l.spacing_metadata_complete=true;l.status='pending';
  return{p,g,l,row:{id:'synthetic',profile_snapshot:JSON.stringify(p),geometry_snapshot:JSON.stringify(g),summary:'{}'}};
}
test('rounding remainders are assigned without exceeding any existing cap',()=>{
  const {p,l}=fixture();l.base_leftover_mm=1.123;l.leftover_mm=1.123;
  const plan=autoSuggestLine(l,p);applyStretch(l,plan.suggestions,p);
  assert.equal(l.leftover_mm,0);assert(plan.suggestions.every(d=>d.stretch_mm>=.05));
  assert.equal(autoSuggestLine(l,p).shortfall_mm,0);
});

test('partial stretching still warns about a short line, unlike intentional spaces',()=>{
  const {p,g,l}=fixture();applyStretch(l,autoSuggestLine(l,p).suggestions,p);
  assert(l.leftover_mm>0);assert(validateLine(l,p,g).warnings.some(w=>w.includes('after stretching')));
  for(const flag of ['petucha_end','has_setuma','sefer_end','fixed_pattern']){
    assert(!validateLine({...l,[flag]:true},p,g).warnings.some(w=>w.startsWith('underfull:')));
  }
});
test('fit proposal raises only permitted caps; creating a copy fills the margin',()=>{
  const {p,l,row}=fixture(),before=JSON.stringify(l);
  const plan=fitMarginPlan(row,[l]);assert(plan.changes.length>0);assert.equal(plan.summary.aligned_lines,1);
  assert.equal(JSON.stringify(l),before);assert.equal(row.profile_snapshot,JSON.stringify(p));
  assert(plan.changes.every(c=>p.max_stretch[c.letter]>0&&!p.non_stretchable.includes(c.letter)));
  const copy=structuredClone(l);applyFitCopy([copy],plan);assert.equal(copy.leftover_mm,0);
  assert.equal(JSON.stringify(l),before);
});
test('intentional spacing, written lines, restricted names and overfull text cannot be forced to fill',()=>{
  const {l,row}=fixture();
  const lines=['petucha_end','has_setuma','sefer_end','fixed_pattern'].map((flag,i)=>({...structuredClone(l),line_id:'p'+i,[flag]:true}));
  lines.push({...structuredClone(l),line_id:'written',status:'written'});
  const protectedLine=structuredClone(l);protectedLine.line_id='protected';protectedLine.words.forEach(w=>w.isShem=true);lines.push(protectedLine);
  lines.push({...structuredClone(l),line_id:'over',base_leftover_mm:-10,leftover_mm:-10});
  const plan=fitMarginPlan(row,lines);assert.equal(plan.changes.length,0);assert.equal(plan.summary.preserved_lines,5);
  assert.equal(plan.summary.short_lines,1);assert.equal(plan.summary.overfull_lines,1);assert.equal(plan.issues.length,2);
});
test('HTTP fit is explicit, revision-bound and creates a persisted independent profile/layout',async()=>{
  const s=await startTestServer(':memory:');
  try{
    const seed=await bootstrap(s),headers=jsonHeaders(seed.token);
    const base=await request(s,'POST','/api/layout/compute',{headers,body:{source_id:seed.source_id,profile_id:seed.profile_id,geometry_id:seed.geometry_id}});
    assert.equal(base.status,200,base.text);const id=base.json.layout_id;
    const before=await request(s,'GET','/api/layouts/'+id),profilesBefore=s.db.prepare('SELECT count(*) n FROM profiles').get().n;
    const path='/api/layouts/'+id+'/fit-margin';
    const preview=await request(s,'POST',path,{headers,body:{action:'preview'}});assert.equal(preview.status,200,preview.text);
    assert.equal(s.db.prepare('SELECT count(*) n FROM profiles').get().n,profilesBefore);
    assert.equal((await request(s,'POST',path,{headers,body:{action:'create',revision:preview.json.revision}})).status,409);
    assert.equal((await request(s,'POST',path,{headers,body:{action:'create',revision:'stale',confirm:true}})).status,409);
    const created=await request(s,'POST',path,{headers,body:{action:'create',revision:preview.json.revision,confirm:true}});
    assert.equal(created.status,200,created.text);assert.notEqual(created.json.layout_id,id);
    assert.equal((await request(s,'GET','/api/layouts/'+id)).text,before.text);
    const copy=await request(s,'GET','/api/layouts/'+created.json.layout_id);
    assert.equal(copy.json.summary.margin_fit.parent_layout_id,id);assert.equal(copy.json.status,'draft');
    assert.equal(s.db.prepare('SELECT count(*) n FROM profiles').get().n,profilesBefore+1);
    assert(copy.json.lines.every(l=>l.leftover_mm===0||l.petucha_end||l.sefer_end||l.fixed_pattern||l.has_setuma));
  }finally{await s.close();}
});
