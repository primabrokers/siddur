import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startTestServer,bootstrap,compute,request,jsonHeaders} from './helpers.js';
import {openDatabase} from '../db/db.js';
import {applyMigrations,SCHEMA_VERSION} from '../db/schema.js';
import * as store from '../server/store.js';
const policy={version:1,caps_percent:{'ד':'unlimited','ה':'unlimited','ר':'unlimited','ת':'unlimited','א':50,'ט':50,'ל':50,'מ':50,'ם':50,'ק':50},distribution:'equal_mm',word_space_percent:50,setuma_percent:'unlimited',setuma_first:true};

test('migration 6→7 preserves legacy rows; new policy survives close/reopen and duplicate/export',()=>{
  const dir=mkdtempSync(join(tmpdir(),'sofer-policy-')),path=join(dir,'test.sqlite');let db=openDatabase(path);
  try{
    const legacy=store.insertProfile(db,{name:'Legacy evidence',unit_mm:.7});
    db.exec('ALTER TABLE profiles DROP COLUMN letter_height_units; DROP TABLE geometry_options; DELETE FROM schema_migrations WHERE version>=8; ALTER TABLE profiles DROP COLUMN stretch_policy; ALTER TABLE profiles DROP COLUMN units_per_row; ALTER TABLE profiles DROP COLUMN unit_basis; ALTER TABLE profiles DROP COLUMN layout_mode; DELETE FROM schema_migrations WHERE version=7');
    const before=db.prepare('SELECT * FROM profiles').all();assert.equal(applyMigrations(db),SCHEMA_VERSION);
    const after=db.prepare('SELECT * FROM profiles').all().map(({stretch_policy,units_per_row,unit_basis,layout_mode,letter_height_units,...rest})=>rest);
    assert.deepEqual(after,before);assert.equal(store.getProfile(db,legacy.id).stretch_policy,null);
    const saved=store.insertProfile(db,{name:'New requested rules',stretch_policy:policy,units_per_row:360,non_stretchable:[]});
    db.close();db=openDatabase(path);const reloaded=store.getProfile(db,saved.id);
    assert.equal(reloaded.stretch_policy.caps_percent['ד'],'unlimited');assert.equal(reloaded.units_per_row,360);
    const copied=store.insertProfile(db,{...reloaded,name:'Copy'});
    assert.deepEqual(copied.stretch_policy,reloaded.stretch_policy);
    assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('HTTP paragraph-only preview/apply/report is persistent, revision-bound, and snapshot isolated',async()=>{
  const server=await startTestServer(':memory:');try{
    const seed=await bootstrap(server),headers=jsonHeaders(seed.token);
    const post=async(path,body)=>{const r=await request(server,'POST',path,{headers,body});assert.equal(r.status,200,r.text);return r.json;};
    const profile=await post('/api/profiles',{name:'Requested',units_per_row:300,stretch_policy:policy,non_stretchable:[]});
    const geometry=await post('/api/geometries',{name:'150mm test',line_width_mm:150,lines_per_amud:42,max_letters_per_line:0});
    const source=await post('/api/sources/import',{name:'Synthetic paragraph checks',text:'דרה{פ}תהר(ס)מלק'});
    const computed=await compute(server,seed.token,{source_id:source.id,profile_id:profile.id,geometry_id:geometry.id});
    assert(computed.layout_id,JSON.stringify(computed));const path='/api/layouts/'+computed.layout_id;
    const before=(await request(server,'GET',path)).json;
    assert.equal(before.snapshot.profile.unit_mm,.5);assert.equal(before.snapshot.profile.unit_column_width_mm,150);
    const petucha=before.lines.find(l=>l.petucha_end),setuma=before.lines.find(l=>l.has_setuma);assert(petucha);assert(setuma);
    const preview=await post(path+'/stretch-book',{action:'preview'});
    assert.equal(preview.summary.letters_stretched,0);assert.equal(preview.summary.spaces_stretched,0);assert.equal(preview.summary.setuma_gaps_stretched,1);
    assert.equal(preview.lines[0].line_id,setuma.line_id);assert.match(preview.skipped.find(l=>l.line_index===petucha.line_index).reason,/Petuchah/);
    assert.deepEqual((await request(server,'GET',path)).json.lines,before.lines);
    assert.equal((await request(server,'POST',path+'/stretch-book',{headers,body:{action:'apply',confirm:true,revision:'wrong'}})).status,409);
    await post(path+'/stretch-book',{action:'apply',confirm:true,revision:preview.revision});
    const saved=(await request(server,'GET',path)).json;
    assert.deepEqual(saved.lines.find(l=>l.petucha_end),petucha);
    const expanded=saved.lines.find(l=>l.has_setuma);assert.equal(expanded.leftover_mm,0);assert.deepEqual(expanded.items,setuma.items);assert.deepEqual(expanded.words,setuma.words);
    assert.deepEqual((await request(server,'GET',path+'/stretch-report')).json.entries,preview.entries);
    // A later live-profile edit must not alter this layout or its approved rules.
    store.updateProfile(server.db,profile.id,{...store.getProfile(server.db,profile.id),stretch_policy:{...policy,caps_percent:{'ד':1}},units_per_row:600});
    assert.deepEqual((await request(server,'GET',path)).json.lines,saved.lines);
    assert.equal((await request(server,'GET',path)).json.snapshot.profile.units_per_row,300);
    const direct=await request(server,'POST',path+'/stretch',{headers,body:{line_id:setuma.line_id,decisions:[{letter_occurrence_id:setuma.words[0].letters[0].id,stretch_mm:.1}]}});
    assert.equal(direct.status,409,direct.text);
    server.db.prepare("UPDATE layouts SET status='locked' WHERE id=?").run(computed.layout_id);
    assert.equal((await request(server,'POST',path+'/stretch-book',{headers,body:{action:'apply',confirm:true,revision:preview.revision}})).status,409);
  }finally{await server.close();}
});

test('v2 compute immediately applies permitted stretch decisions',async()=>{
  const server=await startTestServer(':memory:');try{
    const seed=await bootstrap(server),headers=jsonHeaders(seed.token);
    const post=async(path,body)=>{const r=await request(server,'POST',path,{headers,body});assert.equal(r.status,200,r.text);return r.json;};
    const profile=await post('/api/profiles',{name:'Immediate v2 stretch',non_stretchable:[],
      stretch_policy:{version:2,caps_percent:{'א':50,'ב':50,'ר':50,'ש':50,'י':50,'ת':50},
        distribution:'equal_mm',word_space_percent:50,petucha_percent:'unlimited',setuma_percent:'unlimited',
        priorities:{'א':2,'ב':3,'ר':2,'ש':3,'י':3,'ת':2,word_space:3,petucha:1,setuma:1,hyphen:3},
        special_widths_units:{word_space:2,hyphen:1,petucha:20,setuma:20},
        song_widths_mm:{page:0,middle:0,side:0}}});
    const geometry=await post('/api/geometries',{name:'Wide test',line_width_mm:80,lines_per_amud:42,max_letters_per_line:0});
    const source=await post('/api/sources/import',{name:'Short synthetic text',text:'בראשית ברא'});
    const computed=await compute(server,seed.token,{source_id:source.id,profile_id:profile.id,geometry_id:geometry.id});
    assert.equal(computed.summary.auto_stretched_on_compute,true);
    assert(computed.summary.auto_stretched_lines>0);
    assert(computed.lines.some(line=>(line.stretch_decisions||[]).length>0));
  }finally{await server.close();}
});
