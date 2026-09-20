import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../db/db.js';
import { applyMigrations } from '../db/schema.js';
import * as store from '../server/store.js';
import { defaultProfile } from '../engine/profile.js';
import { startTestServer, getToken, jsonHeaders, request } from './helpers.js';

test('height-unit migration adds a nullable column without changing existing profile values',()=>{
  const db=openDatabase(':memory:');
  try {
    const profile=store.insertProfile(db,{name:'Existing measured profile',letter_height_mm:4.25,reference_height_mm:3,min_letter_height_mm:2.8});
    db.exec('ALTER TABLE profiles DROP COLUMN letter_height_units; DELETE FROM schema_migrations WHERE version=8');
    const before=db.prepare('SELECT * FROM profiles').all();
    assert.equal(applyMigrations(db),8);assert.equal(applyMigrations(db),8);
    const after=db.prepare('SELECT * FROM profiles').all();assert.equal(after[0].letter_height_units,null);
    assert.deepEqual(after.map(({letter_height_units,...old})=>old),before);
    assert.equal(store.getProfile(db,profile.id).letter_height_mm,4.25);
    assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
  } finally { db.close(); }
});
test('HTTP saves, reloads and duplicates special caps and height units; computed snapshots retain their own height and decisions',async()=>{
  const server=await startTestServer(':memory:');
  try {
    const headers=jsonHeaders(await getToken(server));
    const call=async(method,path,body)=>{const r=await request(server,method,path,{headers,body});assert.equal(r.status,200,r.text);return r.json;};
    const defaults=defaultProfile();
    const p=await call('POST','/api/profiles',{...defaults,name:'Requested measurements',stroke_mm:0,
      stretch_policy:{...defaults.stretch_policy,caps_percent:{},word_space_percent:'unlimited',hyphen_percent:50,petucha_percent:125,setuma_percent:'unlimited'}});
    const reloaded=await call('GET','/api/profiles/'+p.id);
    assert.equal(reloaded.letter_height_units,2.5);assert.equal(reloaded.stretch_policy.hyphen_percent,50);assert.equal(reloaded.stretch_policy.word_space_percent,'unlimited');
    const copy=await call('POST','/api/profiles/'+p.id+'/duplicate',{name:'Copy'});
    assert.equal(copy.letter_height_units,2.5);assert.deepEqual(copy.stretch_policy,reloaded.stretch_policy);
    const g=await call('POST','/api/geometries',{name:'Column',line_width_mm:124});
    const s=await call('POST','/api/sources/import',{name:'Synthetic measurement test',format:'stam',text:'א--ב'});
    const computed=await call('POST','/api/layout/compute',{profile_id:p.id,geometry_id:g.id,source_id:s.id});
    const path='/api/layouts/'+computed.layout_id, saved=await call('GET',path);
    assert.equal(saved.snapshot.profile.letter_height_mm,5);assert.equal(saved.snapshot.profile.letter_height_units,2.5);
    assert.equal(saved.lines[0].stretch_decisions[0].kind,'hyphen');assert.equal(saved.lines[0].stretch_decisions[0].stretch_mm,2);
    const report=await call('GET',path+'/stretch-report');assert.equal(report.entries[0].kind,'hyphen');assert.equal(report.entries[0].word,'אב');
    await call('PUT','/api/profiles/'+p.id,{...reloaded,letter_height_units:3,stretch_policy:{...reloaded.stretch_policy,hyphen_percent:'unlimited'}});
    assert.deepEqual(await call('GET',path),saved);
    const newer=await call('POST','/api/layout/compute',{profile_id:p.id,geometry_id:g.id,source_id:s.id});
    const changed=await call('GET','/api/layouts/'+newer.layout_id);
    assert.equal(changed.snapshot.profile.letter_height_mm,6);assert.equal(changed.lines[0].leftover_mm,0);
  } finally { await server.close(); }
});
