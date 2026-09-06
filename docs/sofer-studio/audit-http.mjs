import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root='/var/lib/deepseek-harness/workspaces/siddur-small-sefer-torah-20260830/sofer-studio/';
const {openDatabase}=await import(pathToFileURL(root+'db/db.js'));
const {createApp}=await import(pathToFileURL(root+'server/app.js'));
const dir=mkdtempSync(join(tmpdir(),'sofer-controller-audit-'));
const db=openDatabase(join(dir,'audit.db'));
const port=4269, base=`http://127.0.0.1:${port}`;
const server=createApp({db,publicDir:root+'public',port});
const checks=[];
let token;
async function req(path,method='GET',body,extra={}){
 const headers={...(token?{'X-Sofer-Token':token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...extra};
 const r=await fetch(base+path,{method,headers,body:body!==undefined?JSON.stringify(body):undefined});
 const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={raw:text.slice(0,200)}}
 return {status:r.status,data};
}
function check(name,pass,evidence){checks.push({name,pass,evidence});}
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
 token=(await req('/api/session')).data.token;
 const letters=Array.from('אבגדהוזחטיכךלמםנןסעפףצץקרשת');
 const profile={name:'Controller QA',reference_height_mm:3,letter_height_mm:3,stroke_mm:.2,unit_mm:1,min_nib_mm:1,letter_widths:Object.fromEntries(letters.map(c=>[c,1])),non_stretchable:['י','ו','ז','ן','נ','ג','צ','ץ'],gaps:{inter_letter:.1,inter_word:.5},max_stretch:{ה:1.5},stretch_position:'anywhere'};
 const bad=await req('/api/profiles','POST',{...profile,letter_height_mm:-3});
 check('Negative profile height rejected',bad.status>=400,{status:bad.status});
 const cross=await req('/api/profiles','POST',profile,{Origin:'http://localhost:9999'});
 check('Other loopback origin rejected',cross.status===403,{status:cross.status});
 const nullOrigin=await req('/api/profiles','POST',profile,{Origin:'null'});
 check('Null origin rejected',nullOrigin.status===403,{status:nullOrigin.status});
 const p=await req('/api/profiles','POST',profile);if(!p.data.id)throw Error('Profile create failed '+JSON.stringify(p));
 const exp=await req(`/api/profiles/${p.data.id}/export`);
 check('Profile exclusions round trip as array',Array.isArray(exp.data.non_stretchable)&&exp.data.non_stretchable.includes('י'),{value:exp.data.non_stretchable});
 const g=await req('/api/geometries','POST',{name:'QA geometry',line_width_mm:100,lines_per_amud:2,baseline_pitch_mm:4,top_margin_mm:2,bottom_margin_mm:2,outer_margin_mm:3,inter_column_gap_mm:5,amudim_per_yeria:3,max_letters_per_line:80,partial_final_yeria:'exact'});
 const s=await req('/api/sources/import','POST',{name:'QA test text',format:'txt',text:'הה הה'});
 const c=await req('/api/layout/compute','POST',{source_id:s.data.id,profile_id:p.data.id,geometry_id:g.data.id});
 const id=c.data.layout_id||c.data.id;
 check('Layout compute succeeds',c.status===200&&!!id,{status:c.status});
 if(id){
  const saved=await req('/api/layouts/'+id);
  const l=saved.data.lines?.[0];if(!l)throw Error('No saved line');
  check('Saved lines retain words and measured items',Array.isArray(l.words)&&Array.isArray(l.items),{keys:Object.keys(l)});
  const decision={letter_occurrence_id:l.letter_occurrence_ids[0],stretch_mm:1};
  const dup=await req(`/api/layouts/${id}/stretch`,'POST',{line_id:l.line_id,decisions:[decision,decision]});
  check('Duplicate stretch cannot exceed cap',dup.status>=400,{status:dup.status});
  const one=await req(`/api/layouts/${id}/stretch`,'POST',{line_id:l.line_id,decisions:[decision]});
  const two=await req(`/api/layouts/${id}/stretch`,'POST',{line_id:l.line_id,decisions:[decision]});
  check('Stretch replacement idempotent',one.status===200&&two.status===200&&one.data.line?.leftover_mm===two.data.line?.leftover_mm,{one:one.data.line?.leftover_mm,two:two.data.line?.leftover_mm});
  const written=await req(`/api/layouts/${id}/progress`,'POST',{line_id:l.line_id,status:'written'});
  const lock=await req('/api/layouts/'+id);
  check('Written progress locks layout',written.status===200&&lock.data.status==='locked',{status:lock.data.status});
  const lockedEdit=await req(`/api/layouts/${id}/stretch`,'POST',{line_id:l.line_id,decisions:[]});
  check('Locked stretch rejected at HTTP boundary',lockedEdit.status===409,{status:lockedEdit.status});
 }
}catch(e){checks.push({name:'Audit execution',pass:false,evidence:e.message});}
finally{await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});}
console.log(JSON.stringify({checks},null,2));
