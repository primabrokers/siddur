import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';


const source=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
function fixture() {
  const dom=new JSDOM(source('index.html'),{runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;w.eval(source('core.js'));w.confirm=()=>true;w.HTMLElement.prototype.scrollIntoView=function(){};
  const SS=w.SS;SS.toast=()=>{};return{dom,w,SS};
}
test('column width changes actual mm budget and hides old letter-count limit',async()=>{
  const f=fixture();try{
    let saved;f.SS.activeProfile=()=>({unit_mm:.5});f.SS.activeGeometry=()=>null;
    f.w.eval(source('geometry.js'));f.SS.geometry.init({api:{createGeometry:async body=>(saved=body,{...body,id:'g'}),listGeometries:async()=>[saved]}});
    const root=f.w.document.getElementById('geometry-body'),input=root.querySelector('[data-field="line_width_mm"]');
    assert.match(input.closest('label').textContent,/Column width \(mm\)/);assert.equal(Number(input.value),125);
    assert.equal(root.querySelector('[data-field="max_letters_per_line"]'),null);
    input.value='200';input.dispatchEvent(new f.w.Event('input'));
    [...root.querySelectorAll('button')].find(b=>b.textContent==='Save as new').click();await tick();
    assert.equal(saved.line_width_mm,200);assert.equal(saved.max_letters_per_line,0);
    assert.equal(saved.name,'45 cm Torah');
  }finally{f.dom.window.close();}
});

test('Layout 1 starts an empty workspace with a profile and fixed 42-line reference',async()=>{
  const f=fixture();try{
    const calls=[];f.SS.calibration={isDirty:()=>false,selectSaved:()=>{}};
    f.SS.app={compute:async()=>calls.push('compute')};
    const api={listBuiltinSources:async()=>[],createProfile:async p=>(calls.push(p),{id:'p'}),listProfiles:async()=>[{id:'p'}],
      createGeometry:async g=>(calls.push(g),{id:'g'}),listGeometries:async()=>[{id:'g'}],
      importSource:async body=>(calls.push(body),{id:'s'}),listSources:async()=>[{id:'s'}]};
    f.w.eval(source('search.js'));f.SS.search.init({api});
    f.w.document.querySelector('[aria-label="Layout 1 book"]').value='Exodus';
    [...f.w.document.querySelectorAll('button')].find(b=>b.textContent==='Load Layout 1').click();await tick();
    assert.equal(calls[0].unit_mm,.5);assert.equal(calls[1].lines_per_amud,42);
    assert.equal(calls[2].builtin,'tikkun:Exodus');assert.equal(calls[3],'compute');
    assert.equal(f.SS.state.active.sourceId,'s');assert.equal(f.SS.state.active.profileId,'p');
  }finally{f.dom.window.close();}
});

test('fixed reference shows its own passage review status, not the unrelated reflow blocker',async()=>{
  const f=fixture();try{
    f.SS.state.active.sourceId='s';f.w.eval(source('passages.js'));
    f.SS.passages.init({api:{getSource:async()=>({reference:{id:'pinned'},section_breaks:{present:true,petucha:1,setuma:2}})}});
    await tick();
    assert.match(f.w.document.getElementById('passages-list').textContent,/fixed song lines/);
    assert.doesNotMatch(f.w.document.getElementById('passages-list').textContent,/normal wrapping is blocked/);
  }finally{f.dom.window.close();}
});
test('preview widths include stretching exactly once and keep word/letter gaps',async()=>{
  const f=fixture();try{
    f.SS.activeSource=()=>null;f.w.eval(source('tikkun.js'));f.SS.tikkun.init({});
    const line={line_id:'l',amud:1,line_index:1,text:'בר בר',width_mm:14,leftover_mm:1,inter_word_gap_mm:2,inter_letter_gap_mm:1,
      stretch_decisions:[{letter_occurrence_id:'a',stretch_mm:1}],items:[{type:'word'},{type:'word'}],
      words:[{text:'בר',width_mm:6,letters:[{id:'a',base:'ב',width_mm:2},{id:'b',base:'ר',width_mm:3}]},{text:'בר',width_mm:6,letters:[{id:'c',base:'ב',width_mm:2},{id:'d',base:'ר',width_mm:3}]}]};
    const l={id:'layout',geometry:{line_width_mm:16,lines_per_amud:42,baseline_pitch_mm:8},lines:[line]};
    f.SS.state.layout=l;f.SS.bus.emit('layout:loaded',l);await tick();
    const d=f.w.document,words=d.querySelectorAll('.word-box');assert.equal(words[0].style.width,'7mm');assert.equal(words[1].style.width,'6mm');
    assert.equal(d.querySelector('.lk.stretched').style.width,'3mm');assert(d.querySelector('.lk.stretched > .ink-glyph'));
    assert.equal(d.querySelector('.word-gap').style.width,'2mm');assert.equal(words[0].style.gap,'1mm');
    assert.equal(d.querySelector('.line').style.height,'8mm');assert.match(source('styles.css'),/--font-he: "Stam Ashkenaz CLM"/);
    assert.equal(line.words[0].width_mm,6);
  }finally{f.dom.window.close();}
});

test('line notes show missing units before stretch, independently of current alignment',async()=>{
  const f=fixture();try{
    f.SS.activeSource=()=>null;f.w.eval(source('tikkun.js'));f.SS.tikkun.init({});
    const lines=[{line_index:1,amud:1,text:'בר',words:[],width_mm:10,stretched_width_mm:20,leftover_mm:0},
      {line_index:2,amud:1,text:'בר',words:[],width_mm:10,stretched_width_mm:15,leftover_mm:5},
      {line_index:3,amud:1,text:'בר',words:[],width_mm:10,leftover_mm:10,petucha_end:true}];
    f.SS.state.layout={id:'align',snapshot:{profile:{units_per_row:20}},geometry:{lines_per_amud:42,line_width_mm:20,baseline_pitch_mm:8},lines};f.SS.bus.emit('layout:loaded',f.SS.state.layout);await tick();
    const d=f.w.document;assert.equal(d.querySelector('.alignment-aligned .side').textContent,'ח״י');
    assert.equal(d.querySelector('.alignment-short .side').textContent,'ח״י');
    assert.equal(d.querySelector('.alignment-intentional .side').textContent,'');
  }finally{f.dom.window.close();}
});

test('approved profile caps above 2 mm are editable rather than silently clamped',async()=>{
  const f=fixture();try{
    f.SS.activeProfile=()=>null;f.w.eval(source('calibration.js'));f.SS.calibration.init({api:{}});
    const input=f.w.document.querySelector('[aria-label="stretch cap for ב"]');input.value='6';input.dispatchEvent(new f.w.Event('input'));
    assert.equal(input.value,'6');
  }finally{f.dom.window.close();}
});

test('margin glyphs fit visible ink including side bearings and overhangs without transition feedback',()=>{
  const f=fixture();try{
    f.w.eval(source('tikkun.js'));
    for(const [natural,target,left,right] of [[12.8,40,3,15],[14,22,-1,12],[5,6,0,5]]){
      const fit=f.SS.tikkun.glyphFit(natural,target,left,right);
      const rendered=x=>target+(x-natural)*fit.scale+fit.translate;
      assert(Math.abs(rendered(-left))<1e-8);assert(Math.abs(rendered(right)-target)<1e-8);
    }
    assert.equal(f.SS.tikkun.glyphFit(10,20).scale,2);
    assert.match(source('styles.css'),/\.sheet, \.ink-glyph \{ transition: none !important/);
  }finally{f.dom.window.close();}
});
test('whole-book control previews before approval, then reloads and reports applied words',async()=>{
  const f=fixture();try{
    const calls=[],rows=[{page:2,line:3,word:'בר',letter:'ר',stretch_mm:1,letter_occurrence_id:'r'}];
    f.SS.state.active.layoutId='l';f.SS.state.layout={id:'l',status:'draft',lines:[]};
    f.SS.app={reloadLayout:async()=>{calls.push('reload');f.SS.bus.emit('layout:loaded',f.SS.state.layout);}};
    const api={stretchBook:async(id,body)=>{calls.push(body);return{revision:'exact',entries:rows,lines:[{}],skipped:[],summary:{proposed_lines:1,words_stretched:1,letters_stretched:1,skipped_lines:0,remaining_gap_lines:0}};}};
    f.w.eval(source('stretch.js'));f.SS.stretch.init({api});
    const button=text=>[...f.w.document.querySelectorAll('.stretch-book button')].find(b=>b.textContent===text);
    assert.equal(button('Apply reviewed suggestions').disabled,true);
    button('Auto-suggest whole book').click();await tick();assert.equal(calls.length,1);assert.equal(calls[0].action,'preview');
    assert.match(f.w.document.querySelector('.stretch-book-report').textContent,/בר/);
    f.w.confirm=()=>false;button('Apply reviewed suggestions').click();await tick();assert.equal(calls.length,1);
    f.w.confirm=()=>true;button('Apply reviewed suggestions').click();await tick();
    assert.equal(calls[1].revision,'exact');assert.equal(calls[1].confirm,true);assert.equal(calls[2],'reload');
    assert.equal(button('Download stretch report CSV').disabled,false);
  }finally{f.dom.window.close();}
});

test('fit-to-margin requires reviewed approval and opens a new copy, never the parent',async()=>{
  const f=fixture();try{
    const calls=[],summary={aligned_lines:2,ordinary_lines:3,short_lines:0,overfull_lines:1,preserved_lines:1};
    f.SS.state.active.layoutId='parent';f.SS.state.layout={id:'parent',status:'locked',lines:[]};
    f.SS.calibration={isDirty:()=>false,selectSaved:()=>calls.push('selected')};
    f.SS.app={reloadLayout:async id=>{calls.push(id);f.SS.state.layout={id,status:'draft',lines:[]};f.SS.bus.emit('layout:loaded',f.SS.state.layout);}};
    const api={fitMargin:async(id,body)=>{calls.push({id,...body});return body.action==='preview'?{revision:'fit-revision',changes:[{letter:'ב',from_mm:1.5,to_mm:6}],summary,issues:[]}:{layout_id:'copy',profile_id:'new-profile',source_id:'s',geometry_id:'g',summary};},listProfiles:async()=>[],listLayouts:async()=>[]};
    f.w.eval(source('stretch.js'));f.SS.stretch.init({api});
    const button=text=>[...f.w.document.querySelectorAll('.fit-margin-controls button')].find(b=>b.textContent===text);
    const preview=button('Review fit-to-margin proposal'),create=button('Approve limits & create fitted copy');
    assert.equal(preview.disabled,false);assert.equal(create.disabled,true);preview.click();await tick();
    assert.match(f.w.document.querySelector('.fit-margin-report').textContent,/2 \/ 3 ordinary lines will align/);
    f.w.confirm=()=>false;create.click();await tick();assert.equal(calls.length,1);
    f.w.confirm=()=>true;create.click();await tick();
    assert.deepEqual(calls[1],{id:'parent',action:'create',confirm:true,revision:'fit-revision'});
    assert.equal(f.SS.state.active.layoutId,'copy');assert.equal(f.SS.state.active.profileId,'new-profile');
    assert.match(f.w.document.querySelector('.fit-margin-report').textContent,/Original unchanged/);
    assert.equal(create.disabled,true);
  }finally{f.dom.window.close();}
});
test('manual remaining gap uses immutable base, including Clear after a saved stretch',()=>{
  const f=fixture();try{
    f.SS.state.active.layoutId='l';f.SS.state.layout={status:'draft'};f.w.eval(source('stretch.js'));f.SS.stretch.init({api:{}});
    f.SS.bus.emit('line:selected',{raw:{line_id:'line',base_leftover_mm:4,leftover_mm:3,stretch_decisions:[{letter_occurrence_id:'a',stretch_mm:1}],stretch_candidates:[{letter_occurrence_id:'a',letter:'ב',cap_mm:2}]}});
    [...f.w.document.querySelectorAll('#stretch-inspector button')].find(b=>b.textContent==='Clear').click();
    assert.match(f.w.document.querySelector('.si-leftover').textContent,/4\.00/);
  }finally{f.dom.window.close();}
});

test('section guides follow words, never change their ink or the measured gap, and are hidden in print',async()=>{
  const f=fixture();try{
    f.SS.activeSource=()=>null;f.w.eval(source('tikkun.js'));f.SS.tikkun.init({});
    const word=(text,id)=>({text,width_mm:4,letters:[{id,base:text,width_mm:4}]});
    const layout={id:'sections',geometry:{line_width_mm:150,lines_per_amud:42,baseline_pitch_mm:8},lines:[
      {amud:1,line_id:'p',line_index:1,text:'א',petucha_end:true,words:[word('א','a')],items:[{type:'word'}]},
      {amud:1,line_id:'s',line_index:2,text:'ב ג',has_setuma:true,words:[word('ב','b'),word('ג','c')],items:[{type:'word'},{type:'setuma_gap',width_mm:25},{type:'word'}]},
      {amud:1,line_id:'song',line_index:3,text:'ד ה',words:[word('ד','d'),word('ה','e')],items:[{type:'word'},{type:'segment_gap',width_mm:30},{type:'word'}]}
    ]};
    f.SS.state.layout=layout;f.SS.bus.emit('layout:loaded',layout);await tick();
    const d=f.w.document,p=d.querySelector('.parasha-anchor'),gap=d.querySelector('.setuma-gap');
    assert(p.previousElementSibling.classList.contains('word-box'));
    assert.equal(p.textContent,'פ');assert.equal(gap.querySelector('.parasha-mark').textContent,'ס');
    assert.equal(gap.style.width,'25mm');
    assert.deepEqual([...d.querySelectorAll('.word-box')].map(w=>w.textContent),['א','ב','ג','ד','ה']);
    assert.equal(d.querySelectorAll('.segment-gap .parasha-mark').length,0,'song spaces are not setumah');
    assert.equal(d.querySelectorAll('.parasha-mark').length,2);
    d.getElementById('section-guides-toggle').click();
    assert(d.getElementById('tikkun-scroll').classList.contains('hide-section-guides'));
    assert.equal(gap.style.width,'25mm');
    assert.match(source('styles.css'),/@media print\s*\{\s*\.parasha-mark, \.parasha-anchor \{ display: none !important; \}/);
    assert.equal(layout.lines[0].text,'א');assert.equal(layout.lines[1].items[1].width_mm,25);
  }finally{f.dom.window.close();}
});

test('section panel identifies markers after the correct word and jumps to their exact line',async()=>{
  const f=fixture();try{
    f.SS.state.active.sourceId='s';f.SS.state.layout={source_id:'s',lines:[
      {amud:2,line_index:43,line_in_amud:1,petucha_end:true,last_word:'אב'},
      {amud:2,line_index:44,line_in_amud:2,has_setuma:true,words:[{text:'גד'},{text:'הו'}],items:[{type:'word'},{type:'setuma_gap',width_mm:25},{type:'word'}]}
    ]};
    let jump;f.SS.bus.on('jump:line',x=>{jump=x;});
    f.w.eval(source('passages.js'));f.SS.passages.init({api:{getSource:async()=>({section_breaks:{petucha:1,setuma:1,present:true,verified:false}})}});await tick();
    const d=f.w.document,buttons=d.querySelectorAll('#section-break-list button');
    assert.equal(buttons.length,2);assert.match(buttons[0].textContent,/after אב/);assert.match(buttons[1].textContent,/after גד/);
    buttons[1].click();assert.equal(jump.amud,2);assert.equal(jump.line,44);
    assert.match(d.getElementById('section-break-summary').textContent,/sofer review/);
    const filter=d.getElementById('section-break-filter');filter.value='petucha';filter.dispatchEvent(new f.w.Event('change'));
    assert.equal(d.querySelectorAll('#section-break-list button').length,1);
  }finally{f.dom.window.close();}
});

test('source changes ignore stale section counts and missing markers are explicit',async()=>{
  const f=fixture();try{
    let finishOld;f.SS.state.active.sourceId='old';
    f.w.eval(source('passages.js'));f.SS.passages.init({api:{getSource:id=>id==='old'?new Promise(r=>{finishOld=r;}):Promise.resolve({section_breaks:{petucha:0,setuma:0,present:false,verified:false}})}});
    f.SS.state.active.sourceId='new';f.SS.bus.emit('sourceId:changed','new');await tick();
    finishOld({section_breaks:{petucha:100,setuma:50,present:true,verified:false}});await tick();
    const text=f.w.document.getElementById('section-break-summary').textContent;
    assert.match(text,/no petuchah\/setumah markers/);assert.doesNotMatch(text,/100/);
  }finally{f.dom.window.close();}
});
