// Disposable public-corpus scale proof; no production data or credentials.
import assert from 'node:assert/strict';
import {startTestServer,request,getToken,jsonHeaders} from './helpers.js';
const s=await startTestServer(':memory:');
try {
  s.db.pragma('max_page_count = 16384');
  const h=jsonHeaders(await getToken(s));
  const post=async(path,body)=>{const r=await request(s,'POST',path,{headers:h,body});assert.equal(r.status,200,r.text.slice(0,500));return r.json;};
  const src=await post('/api/sources/import',{builtin:'Genesis'});
  const p=await post('/api/profiles',{name:'Synthetic scale test',letter_height_mm:4.5});
  const g=await post('/api/geometries',{name:'Scale test, not reference',line_width_mm:180,lines_per_amud:42,max_letters_per_line:0});
  const computed=await post('/api/layout/compute',{source_id:src.id,profile_id:p.id,geometry_id:g.id,poll:true,study_preview:true});
  let id=computed.layout_id;
  if(!id) for(let n=0;n<600;n++){
    const r=await request(s,'GET','/api/layout/compute-job/'+computed.job_id);
    assert.equal(r.status,200,r.text);assert.notEqual(r.json.status,'error',r.text);
    if(r.json.status==='done'){id=r.json.layout_id;break;}
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert(id,'compute did not complete');
  let preview=await post('/api/layouts/'+id+'/stretch-book',{action:'preview'});
  const summary=preview.summary,revision=preview.revision,expected=preview.entries.length;
  preview=null;
  const applied=await post('/api/layouts/'+id+'/stretch-book',{action:'apply',confirm:true,revision});
  assert.equal(applied.entries.length,expected);assert(summary.total_lines>1000);
  const report=await request(s,'GET','/api/layouts/'+id+'/stretch-report');assert.equal(report.status,200);assert.equal(report.json.entries.length,expected);
  console.log(JSON.stringify({book:'Genesis',verses:src.verse_count,...summary,applied_entries:expected,heap_used_mb:Math.round(process.memoryUsage().heapUsed/1048576),rss_mb:Math.round(process.memoryUsage().rss/1048576)}));
} finally {await s.close();}
