import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { normalizeProfile, defaultProfile } from '../engine/profile.js';
import { computeLayout, computeLayoutAsync, normalizeGeometry, autoSuggestLine, applyStretch } from '../engine/layout.js';
import { effectiveProfile } from '../engine/stretch-policy.js';
import { processSource } from '../engine/source.js';
import { loadTefillinSource } from '../server/tefillin-source.js';
import { loadReferenceSource } from '../server/reference.js';
import { publicLine } from '../server/handlers.js';
import { moveWord } from '../engine/line-edit.js';
import { validateGeometryInput } from '../server/validation.js';
import { columnOptionsErrors } from '../engine/column-options.js';
const close = (actual, expected) => assert(Math.abs(actual - expected) < .005, `${actual} != ${expected}`);
function profile() { const p=defaultProfile(); return normalizeProfile({...p, units_per_row:null, letter_height_units:null, reference_height_mm:3, letter_height_mm:3, unit_mm:1, stroke_mm:0, stretch_policy:{...p.stretch_policy,caps_percent:{'א':'unlimited','ב':'unlimited','ג':'unlimited','ד':'unlimited'},word_space_percent:'unlimited'}}); }
const asset = name => readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
function ui(){
 const dom=new JSDOM(asset('index.html'),{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.eval(asset('core.js'));w.HTMLElement.prototype.scrollIntoView=function(){};
 const SS=w.SS;SS.toast=()=>{};SS.activeGeometry=()=>null;SS.activeSource=()=>null;SS.activeProfile=()=>null;
 w.eval(asset('tikkun.js'));SS.tikkun.init({});return {dom,w,SS,d:w.document};
}
const tick=()=>new Promise(r=>setTimeout(r,30));

test('song halves anchor both outer edges and retain document units; three parts stretch only the middle',async()=>{
 const p=profile(),g=normalizeGeometry({line_width_mm:125});
 const source=processSource({format:'stam',text:'אב גדmאב גדe אmאב גדmבe אב גד'});
 const layout=computeLayout(source,p,g),asyncLayout=await computeLayoutAsync(source,p,g);
 assert.deepEqual(layout.lines,asyncLayout.lines);
 const [two,three,normal]=layout.lines;
 assert.equal(two.column_width_mm,180);assert.equal(three.column_width_mm,180);
 close(two.song_layout.segments[0].width_mm,60);close(two.song_layout.segments[1].width_mm,60);
 close(two.song_layout.segments[0].start_mm,0);close(two.song_layout.segments[1].start_mm,120);
 close(three.song_layout.segments[0].start_mm,0);
 close(three.song_layout.segments[1].start_mm,58);close(three.song_layout.segments[1].width_mm,64);
 close(three.song_layout.segments[2].start_mm,178);assert.equal(three.song_layout.segments[0].stretch,false);
 const outer=new Set([three.words[0],three.words.at(-1)].flatMap(w=>w.letters.map(l=>l.id)));
 assert(three.stretch_decisions.every(d=>!outer.has(d.letter_occurrence_id)));
 close(two.words[0].width_mm,normal.words[0].width_mm);
 const haazinu=computeLayout(processSource({text:'אבmגדe'}),p,normalizeGeometry({line_width_mm:125,lines_per_amud:1,song_layouts:{manual:'haazinu',haazinu:{total_mm:170,right_mm:45,left_mm:55}}}));
 assert.equal(haazinu.lines[0].column_width_mm,170);close(haazinu.lines[0].song_layout.segments[1].start_mm,115);
});

test('overfull song sections extend into the middle in the requested directions without dropping text or stretching holy letters',()=>{
 const p=profile(),g=normalizeGeometry({lines_per_amud:1,song_layouts:{hayam:{total_mm:60,right_mm:10,left_mm:10}}});
 const two=computeLayout(processSource({text:'א'.repeat(8)+'m'+'ב'.repeat(8)+'e'}),p,g).lines[0];
 close(two.song_layout.segments[0].start_mm,0);close(two.song_layout.segments[1].start_mm,44);
 assert.equal(two.letter_occurrence_ids.length,16);assert.equal(two.leftover_mm,0);
 const three=computeLayout(processSource({text:'אm'+'ב'.repeat(24)+'mגe'}),p,g).lines[0];
 close(three.song_layout.segments[1].start_mm,6);close(three.song_layout.segments[1].width_mm,48);
 const holy=computeLayout(processSource({text:'Cאבmגדe'}),p,g).lines[0];
 const ids=holy.words.flatMap(w=>w.letters.filter(l=>l.holy).map(l=>l.id));
 assert(holy.stretch_decisions.every(d=>!ids.includes(d.letter_occurrence_id)));
 assert.throws(()=>applyStretch(holy,[],p),/song|Song/);
});

test('all pinned song rows get the right physical width without changing any source letters',()=>{
 const s=loadReferenceSource('all');s.reference=s.canonical.reference;
 const result=computeLayout(s,defaultProfile(),normalizeGeometry({line_width_mm:125}));
 const songs=result.lines.filter(l=>l.song_layout);assert(songs.length>70);
 for(const l of songs){assert.equal(l.column_width_mm,l.reference_page===78?180:170);assert.equal(l.song_layout.segments.length,l.items.filter(i=>i.type==='segment_gap').length+1);}
 assert.equal(result.lines.flatMap(l=>l.letter_occurrence_ids).length,s.letter_count);
});

test('Tefillin keeps all 1594 letters in four distinct passages, with exactly four or seven lines and independently chosen widths',async()=>{
 const s=loadTefillinSource();s.tefillin=s.canonical.tefillin;
 assert.equal(s.verse_count,31);assert.equal(s.letter_count,1594);assert(s.word_count>200);
 const p=normalizeProfile({...defaultProfile(),units_per_row:250});
 for(const kind of ['rosh','yad']){
  const g=normalizeGeometry({line_width_mm:125,tefillin:{kind,widths_mm:[95,100,70,110],paper:'A4'}});
  const result=await computeLayoutAsync(s,p,g),rows=kind==='rosh'?4:7;
  assert.equal(result.lines.length,rows*4);assert.equal(result.amudim.length,4);assert.equal(new Set(result.lines.flatMap(l=>l.letter_occurrence_ids)).size,1594);
  for(let i=0;i<4;i++){assert.equal(result.amudim[i].length,rows);assert(result.amudim[i].every(l=>l.column_width_mm===g.tefillin.widths_mm[i]&&l.tefillin_section===i+1));}
  const layout={status:'draft',lines:result.lines,summary:result.summary,snapshot:{profile:effectiveProfile(p,g),geometry:g}};
  const before=result.lines.flatMap(l=>l.letter_occurrence_ids);
  const a=result.lines[0],b=result.lines[1];
  const changed=moveWord(layout,{line_id:a.line_id,direction:'down',line_key:a.line_key,next_line_key:b.line_key});
  assert.equal(changed.lines.length,rows*4);assert.deepEqual(changed.lines.flatMap(l=>l.letter_occurrence_ids),before);assert.equal(changed.lines[0].column_width_mm,95);
  const end=result.lines[rows-1],next=result.lines[rows];
  assert.throws(()=>moveWord(layout,{line_id:end.line_id,direction:'down',line_key:end.line_key,next_line_key:next.line_key}),/ending|passage/);
 }
 assert.throws(()=>computeLayout(processSource({text:'אב'}),p,normalizeGeometry({tefillin:{kind:'rosh',widths_mm:[20,20,20,20]}})),/Load the four/);
 assert(columnOptionsErrors({song_layouts:{hayam:{total_mm:90,right_mm:60,left_mm:60}}}).length);
 assert(validateGeometryInput({tefillin:{kind:'rosh',widths_mm:[20,null,20,20]}}).length);
});

test('new small letters use two thirds while an old saved snapshot still renders its original half-width',()=>{
 const p=profile(),g=normalizeGeometry({line_width_mm:125}),line=computeLayout(processSource({text:'-א א'}),p,g).lines[0];
 close(line.words[0].width_mm,line.words[1].width_mm*2/3);
 close(publicLine(line,effectiveProfile(p,g)).words[0].letters[0].width_mm,4/3);
 close(publicLine(line,p).words[0].letters[0].width_mm,1);
 assert.equal(p.small_letter_scale,undefined);
});

test('preview shows paragraph deficit, positions song fragments, and suggests a drop without changing or submitting text',async()=>{
 const f=ui();try{
  const p=profile(),g=normalizeGeometry({line_width_mm:40,lines_per_amud:1}),source=processSource({text:'אבmגדe'});
  const song=publicLine(computeLayout(source,p,g).lines[0],effectiveProfile(p,g));
  const parsha={amud:1,line_index:2,text:'אב',words:[],petucha_end:true,base_leftover_mm:5,leftover_mm:5};
  const layout={id:'test',geometry:g,snapshot:{profile:effectiveProfile(p,g)},summary:{},lines:[song,parsha]};
  const copy=JSON.stringify(layout);f.SS.state.layout=layout;f.SS.tikkun.render(layout);await tick();
  const parts=f.d.querySelectorAll('.song-segment');assert.equal(parts.length,2);assert.equal(parts[0].style.right,'0mm');assert.equal(parts[1].style.right,'120mm');
  const note=f.d.querySelectorAll('.side')[1];assert.match(note.textContent,/י״/);assert.equal(Number(note.dataset.missingUnits),-15);assert(note.classList.contains('is-overfull'));
  assert.equal(JSON.stringify(layout),copy);
  const a={words:[{width_mm:10},{width_mm:5}],base_leftover_mm:1,inter_word_gap_mm:1},b={words:[{width_mm:5}],base_leftover_mm:20,inter_word_gap_mm:1};
  assert.equal(f.SS.tikkun.suggestsDrop(a,b),true);assert.equal(f.SS.tikkun.suggestsDrop(b,a),false);
  assert.equal(f.SS.tikkun.suggestsDrop(a,{...b,petucha_end:true}),false);
  assert.equal(f.SS.tikkun.suggestsDrop(a,{...b,base_leftover_mm:3}),false);
 }finally{f.dom.window.close();}
});

test('four-page print selects a physical A3/A4 grid and rejects clipping instead of shrinking',async()=>{
 const f=ui();try{
  const g={line_width_mm:80,lines_per_amud:4,baseline_pitch_mm:7.5,tefillin:{kind:'rosh',widths_mm:[80,85,70,90],paper:'A4'}};
  const layout={id:'print',geometry:g,snapshot:{profile:{units_per_row:62}},summary:{tefillin:g.tefillin},lines:Array.from({length:16},(_,i)=>({amud:Math.floor(i/4)+1,line_index:i+1,column_width_mm:g.tefillin.widths_mm[Math.floor(i/4)],words:[],leftover_mm:0}))};
  f.SS.tikkun.render(layout);await tick();await f.SS.tikkun.preparePrint();f.SS.tikkun.prepareTefillinPaper('A4');
  assert(f.d.querySelector('.tefillin-print'));assert.match(f.d.getElementById('tefillin-page-style').textContent,/A4 landscape/);
  assert.equal(f.d.querySelector('.sheet').style.getPropertyValue('--tefillin-columns'),'80mm 90mm');
  f.SS.tikkun.finishPrint();assert(!f.d.querySelector('.tefillin-print'));
  layout.summary.tefillin.widths_mm=[200,200,200,200];assert.throws(()=>f.SS.tikkun.prepareTefillinPaper('A4'),/do not fit/);
 }finally{f.dom.window.close();}
});
