import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';


const source=name=>readFileSync(new URL(`../public/${name}`,import.meta.url),'utf8');

function fixture(){
  const dom=new JSDOM('<section id="tikkun-region"><div id="tikkun-body"><div id="print-note"></div><div id="tikkun-scroll"></div></div></section><span id="tikkun-ref"></span><div id="export-controls"></div><div id="toast"></div>',{runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;w.eval(source('core.js'));w.eval(source('tikkun.js'));w.eval(source('export.js'));
  w.HTMLElement.prototype.scrollIntoView=function(){};
  const SS=w.SS;SS.toast=()=>{};SS.activeGeometry=()=>({line_width_mm:999});SS.activeSource=()=>({excerpt:true});
  let prints=0,requests=0;w.print=()=>{prints++;};
  SS.tikkun.init({});SS.export.init({api:{exportLayout:async()=>{requests++;return{kind:'text',text:'{}',filename:'test.json'};}}});
  return {dom,w,SS,prints:()=>prints,requests:()=>requests};
}
const layout={id:'synthetic-preview-test',geometry:{line_width_mm:130,lines_per_amud:42,baseline_pitch_mm:8},summary:{is_excerpt:true,total_lines:84},lines:Array.from({length:84},(_,i)=>({amud:Math.floor(i/42)+1,line_index:i%42+1,text:'בראשית ברא',words:[]}))};
async function load(f,extra={}){f.SS.state.active.layoutId=layout.id;f.SS.state.layout={...layout,...extra};f.SS.bus.emit('layout:loaded',f.SS.state.layout);await new Promise(r=>setTimeout(r,30));}

test('fit whole page uses both dimensions, including very small viewports',()=>{const f=fixture();try{const fit=f.SS.tikkun.fitScale;assert.equal(fit('page',1000,2000,500,400),.2);assert.equal(fit('width',1000,2000,500,400),.5);assert.equal(fit('actual',1000,2000,500,400),1);assert.equal(fit('page',1000,2000,50,40),.02);assert.equal(fit('page',0,0,0,0),1);}finally{f.dom.window.close();}});
test('pagination renders one page; print preparation includes every original line',async()=>{const f=fixture();try{await load(f);assert.equal(f.w.document.querySelectorAll('.line').length,42);assert.equal(f.w.document.querySelectorAll('.amud').length,2);assert.equal(f.w.document.querySelectorAll('.amud:not(.screen-page-hidden)').length,1);assert.match(f.w.document.querySelector('.watermark').textContent,/SAMPLE TEXT/);const next=f.w.document.querySelector('[aria-label="Next page"]');next.click();assert.equal(f.w.document.querySelector('.amud:not(.screen-page-hidden)').dataset.amud,'2');assert.equal(next.disabled,true);f.SS.tikkun.jumpToLine({amud:1,line:1});assert.equal(f.w.document.querySelector('.amud:not(.screen-page-hidden)').dataset.amud,'1');await f.SS.tikkun.preparePrint();assert.equal(f.w.document.querySelectorAll('.line').length,84);assert.equal(f.w.document.querySelectorAll('.print-study-label').length,2);assert.equal(f.SS.tikkun.isPrintReady(),true);f.SS.tikkun.finishPrint();assert.equal(f.w.document.querySelectorAll('.line').length,42);assert.equal(f.SS.tikkun.isPrintReady(),false);assert.equal(f.SS.state.layout.lines.length,84);}finally{f.dom.window.close();}});
test('expanded view can be closed with Escape',()=>{const f=fixture();try{const b=f.w.document.querySelector('[aria-pressed]');b.click();assert.equal(b.getAttribute('aria-pressed'),'true');f.w.document.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(b.getAttribute('aria-pressed'),'false');}finally{f.dom.window.close();}});
test('print needs a loaded ready layout and uses persisted geometry, not current selector',async()=>{const f=fixture();try{await f.SS.export.printLayout();assert.equal(f.prints(),0);await load(f);await f.SS.export.printLayout();assert.equal(f.prints(),1);const note=f.w.document.getElementById('print-note').textContent;assert.match(note,/130/);assert.doesNotMatch(note,/999/);assert.equal(f.w.document.querySelectorAll('.amud').length,2);}finally{f.dom.window.close();}});
test('study preview export restrictions also apply to the PDF print action',async()=>{const f=fixture();try{await load(f,{summary:{study_preview:true,total_lines:84}});for(const b of f.w.document.querySelectorAll('[data-format]'))assert.equal(b.disabled,true);assert.match(f.w.document.querySelector('.watermark').textContent,/NOT WRITING-READY/);f.SS.export.printLayout();assert.equal(f.prints(),0);assert.equal(f.requests(),0);}finally{f.dom.window.close();}});
test('print CSS includes all pages and removes screen scaling',()=>{const css=source('styles.css');assert.match(css,/\.amud, \.amud\.screen-page-hidden \{ display: block !important/);assert.match(css,/transform: none !important/);assert.match(css,/page-break-after: always/);assert.match(css,/\.print-study-label \{ display: block/);});

test('Lock and other body-less mutations send JSON while reads remain body-less',async()=>{
  const dom=new JSDOM('',{runScripts:'outside-only',url:'https://sofer.primainsurance.tech/'});
  try{const w=dom.window;w.eval(source('core.js'));w.SS.state.sessionToken='synthetic-test-token';const calls=[];
    w.fetch=async(url,options)=>{calls.push({url,...options});return{ok:true,headers:{get:n=>n==='content-type'?'application/json':null},json:async()=>({status:'locked'})};};
    w.eval(source('api.js'));
    await w.SS.api.lockLayout('test-layout');await w.SS.api.deleteProfile('test-profile');await w.SS.api.listLayouts();await w.SS.api.importSource({builtin:'Genesis'});
    for(const c of calls.slice(0,2)){assert.equal(c.headers['Content-Type'],'application/json');assert.equal(c.body,'{}');assert.equal(c.headers['X-Sofer-Token'],'synthetic-test-token');}
    assert.equal(calls[2].body,undefined);assert.equal(calls[2].headers['Content-Type'],undefined);
    assert.equal(calls[3].body,'{"builtin":"Genesis"}');
  }finally{dom.window.close();}
});

async function profileFixture({existing=true,delayed=false}={}) {
  const dom=new JSDOM(source('index.html'),{runScripts:'outside-only',pretendToBeVisual:true,url:'https://sofer.primainsurance.tech/'});
  const w=dom.window;w.HTMLElement.prototype.scrollIntoView=function(){};w.confirm=()=>true;
  w.eval(source('core.js'));const SS=w.SS,calls=[],pending=[];
  let profiles=existing?[{id:'existing-profile',name:'Existing measured profile',letter_height_mm:5,stroke_mm:.4}]:[];
  SS.api={
    listSources:async()=>[],listGeometries:async()=>[],listPatterns:async()=>[],listLayouts:async()=>[],session:async()=>({}),
    listProfiles:async()=>profiles.slice(),
    getProfile:id=>delayed?new Promise(resolve=>pending.push(()=>resolve(profiles.find(p=>p.id===id)))):Promise.resolve(profiles.find(p=>p.id===id)),
    createProfile:async body=>{calls.push({kind:'create',body});const p={...body,id:'created-profile'};profiles.push(p);return p;},
    updateProfile:async(id,body)=>{calls.push({kind:'update',id,body});return {...body,id};},
    deleteProfile:async id=>{calls.push({kind:'delete',id});profiles=profiles.filter(p=>p.id!==id);},
    computeLayout:async body=>{calls.push({kind:'compute',body});throw Error('not part of profile test');}
  };
  w.eval(source('calibration.js'));
  const ready=new Promise(resolve=>SS.bus.on('app:ready',resolve));w.eval(source('app.js'));await ready;
  await new Promise(r=>setTimeout(r,5));
  return{dom,w,SS,calls,pending,profiles:()=>profiles};
}
const tick=()=>new Promise(r=>setTimeout(r,15));
test('new profile is available before loading text and saves independently without refresh',async()=>{
  const f=await profileFixture();try{
    f.w.document.getElementById('btn-new-profile').click();
    assert.equal(f.SS.state.active.profileId,null);
    assert.match(f.w.document.getElementById('profile-select').textContent,/New profile — save first/);
    assert.equal(f.w.document.activeElement.id,'cal-name');
    const input=f.w.document.getElementById('cal-name');input.value='Sofer’s own profile';input.dispatchEvent(new f.w.Event('input'));
    f.SS.bus.emit('selection:changed');await tick();assert.equal(input.value,'Sofer’s own profile');
    await f.SS.app.compute();assert.equal(f.calls.length,0);assert.match(f.w.document.getElementById('toast').textContent,/Save your new or edited/);
    f.w.document.querySelector('#calibration-body .btn-primary').click();await tick();
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].kind,'create');
    assert.equal(f.profiles().length,2);assert.equal(f.profiles()[0].name,'Existing measured profile');
    assert.equal(f.SS.state.active.profileId,'created-profile');
    assert.equal(f.w.document.getElementById('profile-select').value,'created-profile');
    assert.equal(f.SS.calibration.isDirty(),false);
  }finally{f.dom.window.close();}
});
test('empty workspace can create its first profile without a source or geometry',async()=>{
  const f=await profileFixture({existing:false});try{
    f.w.document.getElementById('btn-new-profile').click();
    const input=f.w.document.getElementById('cal-name');input.value='First profile';input.dispatchEvent(new f.w.Event('input'));
    f.w.document.querySelector('#calibration-body .btn-primary').click();await tick();
    assert.equal(f.calls[0].kind,'create');assert.equal(f.SS.state.active.profileId,'created-profile');
    assert.equal(f.SS.state.sources.length,0);assert.equal(f.SS.state.geometries.length,0);
    assert.match(f.w.document.getElementById('calibration-body').textContent,/initial numbers are examples/);
    assert.equal(f.w.document.querySelector('[data-field="stroke_mm"]'),null);
    assert.equal(f.SS.calibration.getDraft().stroke_mm,0);
  }finally{f.dom.window.close();}
});
test('late profile fetch does not overwrite a new unsaved profile',async()=>{
  const f=await profileFixture({delayed:true});try{
    f.w.document.getElementById('btn-new-profile').click();
    const input=f.w.document.getElementById('cal-name');input.value='Keep this draft';input.dispatchEvent(new f.w.Event('input'));
    f.pending.splice(0).forEach(resolve=>resolve());await tick();
    assert.equal(input.value,'Keep this draft');assert.equal(f.SS.state.active.profileId,null);assert.equal(f.SS.calibration.isDirty(),true);
  }finally{f.dom.window.close();}
});
test('New profile respects cancelling discard of unsaved measurements',async()=>{
  const f=await profileFixture();try{
    f.w.document.getElementById('btn-new-profile').click();const input=f.w.document.getElementById('cal-name');input.value='Keep me';input.dispatchEvent(new f.w.Event('input'));
    f.w.confirm=()=>false;f.w.document.getElementById('btn-new-profile').click();assert.equal(input.value,'Keep me');assert.equal(f.calls.length,0);
  }finally{f.dom.window.close();}
});
