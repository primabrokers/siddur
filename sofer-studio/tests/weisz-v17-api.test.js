import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, getToken, jsonHeaders, request } from './helpers.js';
import { defaultProfile } from '../engine/profile.js';
import * as store from '../server/store.js';
import { applyMigrations, SCHEMA_VERSION } from '../db/schema.js';

test('geometry options migration and new computations preserve existing records and saved line snapshots',async()=>{
 const s=await startTestServer(':memory:');try{
  const headers=jsonHeaders(await getToken(s));
  const call=async(method,path,body)=>{const r=await request(s,method,path,{headers,body});assert.equal(r.status,200,r.text);return r.json;};
  const p=await call('POST','/api/profiles',{...defaultProfile(),name:'Existing profile'});
  const g=await call('POST','/api/geometries',{name:'Existing geometry'});
  const src=await call('POST','/api/sources/import',{text:'אב גד הו זח טי כל מנ',format:'stam'});
  const old=await call('POST','/api/layout/compute',{profile_id:p.id,geometry_id:g.id,source_id:src.id});
  const tables=['profiles','sources','geometries','layouts','layout_lines'];
  const rows=()=>Object.fromEntries(tables.map(name=>[name,s.db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]));
  const before=rows(),snapshot=await call('GET','/api/layouts/'+old.layout_id);
  s.db.exec('DROP TABLE geometry_options; DELETE FROM schema_migrations WHERE version=9');
  assert.equal(applyMigrations(s.db),SCHEMA_VERSION);assert.deepEqual(rows(),before);
  const geometry=await call('POST','/api/geometries',{name:'Songs',song_layouts:{hayam:{total_mm:180,right_mm:60,left_mm:60},haazinu:{total_mm:170,right_mm:50,left_mm:55},manual:'hayam'}});
  const loaded=(await call('GET','/api/geometries')).find(x=>x.id===geometry.id);assert.deepEqual(loaded.song_layouts,geometry.song_layouts);
  const source=await call('POST','/api/sources/import',{text:'אב גדmהו זחe אmאב גדmבe',format:'stam'});
  const song=await call('POST','/api/layout/compute',{profile_id:p.id,geometry_id:geometry.id,source_id:source.id});
  const saved=await call('GET','/api/layouts/'+song.layout_id);
  assert.equal(saved.lines[0].column_width_mm,180);assert.equal(saved.lines[1].song_layout.segments.length,3);
  assert.deepEqual(saved.lines.map(l=>l.song_layout),song.lines.map(l=>l.song_layout));
  assert(saved.lines.some(l=>l.stretch_decisions.length));
  const lineId=saved.lines[0].line_id;
  await call('POST','/api/layouts/'+saved.id+'/progress',{line_id:lineId,status:'written',lock:true});
  await call('POST','/api/layouts/'+saved.id+'/lock',{});
  const movedGeometry=await call('POST','/api/geometries',{name:'Changed song columns',song_layouts:{hayam:{total_mm:180,right_mm:70,left_mm:50}}});
  const candidate=await call('POST','/api/layouts/'+saved.id+'/candidate',{profile_id:p.id,geometry_id:movedGeometry.id});
  assert(candidate.diff.some(d=>d.type==='measurement_changed'&&d.deltas.some(x=>x.field.startsWith('song_part_'))));
  const adopted=await call('POST','/api/layouts/'+saved.id+'/adopt-candidate',{candidate_id:candidate.candidate_id,verified_unchanged_lines:[lineId]});
  assert(adopted.refused_line_ids.includes(lineId),'changed song positioning must not inherit written status');
  const adoptedLayout=await call('GET','/api/layouts/'+adopted.new_layout_id);
  assert.equal(adoptedLayout.lines[0].status,'pending');assert.equal(adoptedLayout.lines[0].song_layout.segments[1].target_mm,50);
  assert.deepEqual(await call('GET','/api/layouts/'+old.layout_id),snapshot);
  assert.deepEqual(store.getProfile(s.db,p.id).letter_widths,p.letter_widths);
  assert.equal(s.db.pragma('integrity_check',{simple:true}),'ok');
 }finally{await s.close();}
});

test('Tefillin import, compute, reload, print metadata and passage-safe word moves survive the API',async()=>{
 const s=await startTestServer(':memory:');try{
  const headers=jsonHeaders(await getToken(s));
  const call=async(method,path,body)=>{const r=await request(s,method,path,{headers,body});assert.equal(r.status,200,r.text);return r.json;};
  const p=await call('POST','/api/profiles',{...defaultProfile(),units_per_row:250,name:'Small letters for test'});
  const src=await call('POST','/api/sources/import',{builtin:'tefillin'});assert.equal(src.letter_count,1594);
  for(const kind of ['rosh','yad']){
   const t={kind,widths_mm:[95,100,70,110],paper:'A4'};
   const g=await call('POST','/api/geometries',{line_width_mm:125,tefillin:t});
   const out=await call('POST','/api/layout/compute',{profile_id:p.id,geometry_id:g.id,source_id:src.id});
   const path='/api/layouts/'+out.layout_id;let layout=await call('GET',path);
   const rows=kind==='rosh'?4:7;assert.equal(layout.lines.length,rows*4);assert.equal(layout.summary.total_amudim,4);
   assert.deepEqual(layout.snapshot.geometry.tefillin,t);assert.equal(layout.summary.tefillin.paper,'A4');
   const letters=layout.lines.flatMap(l=>l.letter_occurrence_ids);assert.equal(letters.length,1594);
   assert.equal(layout.lines[rows].column_width_mm,100);assert.equal(layout.lines[rows].tefillin_section,2);
   await call('POST',path+'/move-word',{line_id:layout.lines[0].line_id,direction:'down',line_key:layout.lines[0].line_key,next_line_key:layout.lines[1].line_key});
   layout=await call('GET',path);assert.deepEqual(layout.lines.flatMap(l=>l.letter_occurrence_ids),letters);
   const end=layout.lines[rows-1],next=layout.lines[rows];
   const blocked=await request(s,'POST',path+'/move-word',{headers,body:{line_id:end.line_id,direction:'down',line_key:end.line_key,next_line_key:next.line_key}});assert.equal(blocked.status,409);
   assert.deepEqual(await call('GET',path),layout);
  }
  const count=s.db.prepare('SELECT count(*) n FROM geometries').get().n;
  assert.equal((await request(s,'POST','/api/geometries',{headers,body:{tefillin:{kind:'rosh',widths_mm:[null,1,2,3]}}})).status,400);
  assert.equal(s.db.prepare('SELECT count(*) n FROM geometries').get().n,count);
 }finally{await s.close();}
});
