import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=process.argv[2]||fileURLToPath(new URL('../../sofer-studio/',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'sofer-restart-audit-'));
const port=4271,base=`http://127.0.0.1:${port}`;
let child,token;
async function start(){
 child=spawn(process.execPath,[join(root,'server.js')],{env:{...process.env,SOFER_PORT:String(port),SOFER_DB:join(dir,'state.db')},stdio:['ignore','ignore','pipe']});
 let errors='';child.stderr.on('data',b=>{errors=(errors+b.toString()).slice(-1000)});
 for(let i=0;i<50;i++){
  if(child.exitCode!==null)throw Error('Server exited: '+errors);
  try{const r=await fetch(base+'/api/health');if(r.ok){token=(await (await fetch(base+'/api/session')).json()).token;return child.pid}}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 throw Error('Server startup timed out');
}
async function stop(){if(!child||child.exitCode!==null)return;const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done;}
async function request(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'X-Sofer-Token':token,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();return {status:r.status,data};}
try{
 const first=await start();
 const letters=Array.from('אבגדהוזחטיכךלמםנןסעפףצץקרשת');
 const profile={name:'Restart QA',reference_height_mm:3,letter_height_mm:3,stroke_mm:.2,unit_mm:1,min_nib_mm:1,letter_widths:Object.fromEntries(letters.map(c=>[c,1])),non_stretchable:['י','ו','ז','ן','נ','ג','צ','ץ'],gaps:{inter_letter:.1,inter_word:.5},max_stretch:{ה:1.5},stretch_position:'anywhere'};
 const p=await request('/api/profiles','POST',profile);assert.equal(p.status,200);
 const g=await request('/api/geometries','POST',{name:'Restart geometry',line_width_mm:100,lines_per_amud:2,baseline_pitch_mm:4,top_margin_mm:2,bottom_margin_mm:2,outer_margin_mm:3,inter_column_gap_mm:5,amudim_per_yeria:3,max_letters_per_line:100,partial_final_yeria:'exact'});assert.equal(g.status,200);
 const s=await request('/api/sources/import','POST',{name:'Restart synthetic excerpt',format:'txt',text:'הה '.repeat(80).trim()});assert.equal(s.status,200);
 const result=await request('/api/layout/compute','POST',{source_id:s.data.id,profile_id:p.data.id,geometry_id:g.data.id});assert.equal(result.status,200);
 const id=result.data.layout_id||result.data.id;
 const before=(await request('/api/layouts/'+id)).data;
 const written=await request(`/api/layouts/${id}/progress`,'POST',{line_id:before.lines[0].line_id,status:'written'});assert.equal(written.status,200);
 const locked=(await request('/api/layouts/'+id)).data;assert.equal(locked.status,'locked');
 const edited=await request('/api/profiles/'+p.data.id,'PUT',{...profile,letter_height_mm:4});assert.ok([200,409].includes(edited.status));
 await stop();const second=await start();assert.notEqual(first,second);
 const restored=(await request('/api/layouts/'+id)).data;
 assert.equal(restored.status,'locked');assert.deepEqual(restored.snapshot,locked.snapshot);assert.deepEqual(restored.lines,locked.lines);assert.deepEqual(restored.summary,locked.summary);
 const rejected=await request(`/api/layouts/${id}/stretch`,'POST',{line_id:before.lines[0].line_id,decisions:[]});assert.equal(rejected.status,409);
 console.log(JSON.stringify({pass:true,checks:['genuine process restart','immutable snapshot despite calibration edit','identical persisted lines and metadata','written progress and lock preserved','locked edits rejected after restart']}));
}finally{await stop();rmSync(dir,{recursive:true,force:true});}
