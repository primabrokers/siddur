import {pathToFileURL} from 'node:url';
const root='/var/lib/deepseek-harness/workspaces/siddur-small-sefer-torah-20260830/sofer-studio/engine/';
const {normalizeProfile,HEBREW_LETTERS}=await import(pathToFileURL(root+'profile.js'));
const {renderPattern,buildWordUnits}=await import(pathToFileURL(root+'layout.js'));
const {processSource}=await import(pathToFileURL(root+'source.js'));
const p=normalizeProfile({reference_height_mm:3,letter_height_mm:3,unit_mm:1,stroke_mm:.2,letter_widths:Object.fromEntries(HEBREW_LETTERS.map(c=>[c,1])),gaps:{inter_letter:.1,inter_word:.5}});
const g={line_width_mm:100};
const words=buildWordUnits(processSource({text:'אב גד',format:'txt'})).units.filter(u=>u.type==='word');
const cases=[
 ['two slots preserve source', {slots:[{index:0,segments:[{tokens:['אב']}]},{index:1,segments:[{tokens:['גד']}]}]},false],
 ['reordered source rejected',{slots:[{index:0,segments:[{tokens:['גד','אב']}]}]},true],
 ['explicit segment spacing measured',{slots:[{index:0,segments:[{tokens:['אב'],gap_before_mm:2},{tokens:['גד'],gap_before_mm:3}]}]},false],
];
for(const [name,pattern,shouldReject] of cases){try{
 const lines=renderPattern(pattern,p,g,words);
 const pass=!shouldReject&&(name!=='two slots preserve source'||lines.length===2)&&(name!=='explicit segment spacing measured'||Math.abs(lines[0].width_mm-10)<1e-6);
 console.log(JSON.stringify({name,pass,lines:lines.map(l=>({tokens:l.tokens,width:l.width_mm,items:l.items.map(i=>i.type)}))}));
}catch(e){console.log(JSON.stringify({name,pass:shouldReject,error:e.message}));}}
