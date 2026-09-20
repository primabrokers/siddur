import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';


const source=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
function fixture(){
  const dom=new JSDOM(source('index.html'),{runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;w.eval(source('core.js'));w.confirm=()=>true;w.HTMLElement.prototype.scrollIntoView=function(){};
  const SS=w.SS;SS.toast=()=>{};SS.activeProfile=()=>null;SS.activeGeometry=()=>null;SS.activeSource=()=>null;
  return{dom,w,SS,d:w.document};
}
test('new profile matches requested groups and caps, with column-derived units',()=>{
  const f=fixture();try{
    f.w.eval(source('calibration.js'));f.SS.calibration.init({api:{}});
    f.w.eval(source('geometry.js'));f.SS.geometry.init({api:{}});
    const p=f.SS.calibration.getDraft();
    for(const ch of 'דהרת')assert.equal(p.stretch_policy.caps_percent[ch],'unlimited');
    for(const ch of 'אטלמםק')assert.equal(p.stretch_policy.caps_percent[ch],50);
    for(const ch of 'דהרתאטלמםק')assert(!p.non_stretchable.includes(ch));
    assert.equal(p.stretch_policy.caps_percent['ב'],50);assert.equal(p.stretch_policy.distribution,'equal_percent');
    assert.equal(p.stretch_policy.word_space_percent,50);assert.equal(p.stretch_policy.setuma_percent,'unlimited');
    assert.equal(p.units_per_row,62);assert.equal(p.layout_mode,'reflow');assert.equal(p.unit_basis,'line_units');
    assert.equal(f.d.querySelector('#geom-lw-unit-toggle'),null);
    const width=f.d.querySelector('#geometry-body [data-field="line_width_mm"]');assert.equal(width.value,'125');
    width.value='200';width.dispatchEvent(new f.w.Event('input'));
    const units=f.d.getElementById('cal-units-per-row');units.value='80';units.dispatchEvent(new f.w.Event('input'));
    assert(Math.abs(2*p.unit_mm*(p.letter_height_mm/p.reference_height_mm)-2*200/80)<1e-9);
    assert.match(f.d.getElementById('cal-unit-formula').textContent,/200 mm column ÷ 80 units/);
  }finally{f.dom.window.close();}
});
test('legacy profile adopts fixed choices in its draft, retaining caps until preset action',async()=>{
  const f=fixture();try{
    f.SS.state.active.profileId='legacy';f.SS.activeProfile=()=>({id:'legacy'});
    f.w.eval(source('calibration.js'));f.SS.calibration.init({api:{getProfile:async()=>({id:'legacy',name:'Existing',unit_mm:.7})}});await tick();
    assert.equal(f.SS.calibration.getDraft().stretch_policy.version,1);assert.equal(f.SS.calibration.getDraft().stretch_policy.distribution,'equal_percent');assert.equal(f.SS.calibration.getDraft().unit_mm,.7);
    [...f.d.querySelectorAll('button')].find(b=>b.textContent==='Use requested stretch rules').click();
    const p=f.SS.calibration.getDraft();assert.equal(p.stretch_policy.caps_percent['ד'],'unlimited');assert.equal(p.unit_mm,.7);assert(p.units_per_row>0);assert.equal(p.unit_basis,'line_units');assert(f.SS.calibration.isDirty());
  }finally{f.dom.window.close();}
});
test('setumah and word-space increases render once, retaining words and measured margins',async()=>{
  const f=fixture();try{
    f.w.eval(source('tikkun.js'));f.SS.tikkun.init({});
    const words=[{text:'ד',width_mm:2,letters:[{id:'a',base:'ד',width_mm:2}]},{text:'ת',width_mm:4,letters:[{id:'b',base:'ת',width_mm:4}]}];
    const lines=[{line_index:1,amud:1,has_setuma:true,setuma_stretch_enabled:true,words,items:[{type:'word'},{type:'setuma_gap',width_mm:4},{type:'word'}],width_mm:10,stretched_width_mm:12,leftover_mm:0,
      stretch_decisions:[{letter_occurrence_id:'setuma-gap-1',kind:'setuma_gap',stretch_mm:2}]},
      {line_index:2,amud:1,words,items:[{type:'word'},{type:'word'}],inter_word_gap_mm:1,leftover_mm:0,stretch_decisions:[{letter_occurrence_id:'word-space-before-1',kind:'word_space',stretch_mm:.5}]}];
    f.SS.state.layout={id:'test',geometry:{line_width_mm:12,lines_per_amud:42,baseline_pitch_mm:8},lines};f.SS.bus.emit('layout:loaded',f.SS.state.layout);await tick();
    assert.equal(f.d.querySelector('.setuma-gap').style.width,'6mm');assert.equal(f.d.querySelector('.word-gap').style.width,'1.5mm');
    assert.equal(f.d.querySelector('.word-box').style.width,'2mm');assert.equal(f.d.querySelector('.line').dataset.alignment,'aligned');
    assert.equal(lines[0].items[1].width_mm,4);assert.equal(f.d.querySelectorAll('.lk.stretched').length,0);
  }finally{f.dom.window.close();}
});
