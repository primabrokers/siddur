import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=process.argv[2] || resolve(fileURLToPath(new URL('../../sofer-studio/',import.meta.url)));
const {openDatabase}=await import(pathToFileURL(join(root,'db/db.js')));
const {createApp}=await import(pathToFileURL(join(root,'server/app.js')));
const dir=mkdtempSync(join(tmpdir(),'sofer-advanced-'));
const db=openDatabase(join(dir,'audit.db'));
const port=4273,base=`http://127.0.0.1:${port}`;
const server=createApp({db,publicDir:join(root,'public'),port});
let token;
const checks=[];
async function req(path,method='GET',body){
 const r=await fetch(base+path,{method,headers:{...(token?{'X-Sofer-Token':token}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 return {status:r.status,data:await r.json()};
}
const profile={name:'advanced fixture',reference_height_mm:3,letter_height_mm:3,stroke_mm:.2,unit_mm:1,min_nib_mm:1,letter_widths:Object.fromEntries(Array.from('אבגדהוזחטיכךלמםנןסעפףצץקרשת').map(c=>[c,1])),non_stretchable:['י','ו','ז','ן','נ','ג','צ','ץ'],gaps:{inter_letter:.1,inter_word:.5},max_stretch:{ה:1.5},stretch_position:'anywhere'};
try{
 await new Promise((ok,bad)=>{server.once('error',bad);server.listen(port,'127.0.0.1',ok)});
 token=(await req('/api/session')).data.token;
 const p=(await req('/api/profiles','POST',profile)).data;
 const s=(await req('/api/sources/import','POST',{text:'הה הה הה',format:'txt',name:'synthetic geometry fixture'})).data;
 const g=(await req('/api/geometries','POST',{name:'narrow fixture',line_width_mm:10,baseline_pitch_mm:5,lines_per_amud:2})).data;
 const wide=(await req('/api/geometries','POST',{name:'wide fixture',line_width_mm:100,baseline_pitch_mm:5,lines_per_amud:2})).data;
 async function compute(geometry){const r=await req('/api/layout/compute','POST',{source_id:s.id,profile_id:p.id,geometry_id:geometry.id});if(r.status!==200)throw Error('compute '+JSON.stringify(r));return (await req('/api/layouts/'+(r.data.layout_id||r.data.id))).data;}
 const narrow=await compute(g);
 const line=narrow.lines[0];
 const over=await req(`/api/layouts/${narrow.id}/stretch`,'POST',{line_id:line.line_id,decisions:line.letter_occurrence_ids.slice(0,2).map(id=>({letter_occurrence_id:id,stretch_mm:1}))});
 checks.push({name:'Aggregate expansion cannot overfill line',pass:over.status>=400,status:over.status,leftover:over.data.line?.leftover_mm});
 const stable=await compute(wide);
 const baseline=stable.lines[0];
 await req(`/api/profiles/${p.id}`,'PUT',{...profile,letter_height_mm:4});
 const edit=await req(`/api/layouts/${stable.id}/stretch`,'POST',{line_id:baseline.line_id,decisions:[]});
 checks.push({name:'Draft edits use frozen layout measurements after profile change',pass:edit.status===200&&edit.data.line.width_mm===baseline.width_mm,before:baseline.width_mm,after:edit.data.line?.width_mm,status:edit.status});
 await req(`/api/layouts/${stable.id}/progress`,'POST',{line_id:baseline.line_id,status:'written'});
 const candidate=await req(`/api/layouts/${stable.id}/candidate`,'POST',{profile_id:p.id,geometry_id:wide.id});
 checks.push({name:'Diff reports changed measurements despite identical words',pass:candidate.status===200&&candidate.data.diff.length>0,diffCount:candidate.data.diff?.length,status:candidate.status});
 const adopt=await req(`/api/layouts/${stable.id}/adopt-candidate`,'POST',{candidate_id:candidate.data.candidate_id,verified_unchanged_lines:[baseline.line_id]});
 const adopted=adopt.status===200?(await req('/api/layouts/'+adopt.data.new_layout_id)).data:null;
 checks.push({name:'Changed measured line cannot inherit written status',pass:adopt.status>=400||adopted?.lines[0].status==='pending',status:adopt.status,adoptedStatus:adopted?.lines[0].status});
 checks.push({name:'Adopted candidate preserves summary totals',pass:adopt.status>=400||adopted?.summary?.total_lines===stable.summary.total_lines,summary:adopted?.summary});
}catch(e){checks.push({name:'Execution',pass:false,error:e.message});}
finally{await new Promise(ok=>server.close(ok));db.close();rmSync(dir,{recursive:true,force:true});}
console.log(JSON.stringify({checks},null,2));
