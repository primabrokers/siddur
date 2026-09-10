import {createHash} from 'node:crypto';
import {autoSuggestLine,applyStretch} from '../engine/layout.js';

function reportLine(line, decisions, geometry) {
  const occurrences = new Map();
  for(const [wordIndex,word] of (line.words||[]).entries()) for(const letter of word.letters||[]) occurrences.set(letter.id,{word:word.text,word_index:wordIndex+1,letter:letter.base});
  return decisions.filter(d=>d.stretch_mm>0).map(d=>({
    page:line.amud,line:((line.line_index-1)%geometry.lines_per_amud)+1,line_index:line.line_index,line_id:line.line_id,
    ...(occurrences.get(d.kind === 'hyphen' ? d.letter_occurrence_id.slice(7) : d.letter_occurrence_id) || {
      word: d.kind === 'setuma_gap' ? 'Setumah gap' : d.kind === 'petucha_gap' ? 'Petuchah gap' : 'Word space',
      letter: '', word_index: null,
    }),
    kind:d.kind || 'letter',letter_occurrence_id:d.letter_occurrence_id,stretch_mm:d.stretch_mm,
    verse_refs:line.verse_refs||[],
  }));
}
export function stretchReport(lines,geometry) {return lines.flatMap(l=>reportLine(l,l.stretch_decisions||[],geometry));}

export function planBookStretch(row,lines,profile) {
  const geometry=JSON.parse(row.geometry_snapshot);
  const hash=createHash('sha256').update(JSON.stringify({version:2,row}));
  // Stream lines into the revision rather than allocating a full-book JSON copy.
  for(const line of lines) hash.update('\n').update(JSON.stringify(line));
  const revision=hash.digest('hex');
  const proposed=[],entries=[],skipped=[];
  for(const line of lines) {
    let reason;
    if(!line.spacing_metadata_complete) reason='Legacy spacing metadata: recompute a new draft first';
    else if(line.petucha_end&&profile.stretch_policy?.version!==2) reason='Petuchah: remaining column width is paragraph space; letters and word spaces unchanged';
    else if(line.fixed_pattern||line.sefer_end||line.setuma_at_edge||(line.has_setuma&&!profile.stretch_policy)) reason='Intentional break or fixed-passage spacing preserved';
    else if((line.stretch_decisions||[]).some(d=>d.stretch_mm>0)) reason='Existing stretch decisions preserved';
    else if(line.status!=='pending') reason='Written/reviewed line preserved';
    if(reason){skipped.push({page:line.amud,line_index:line.line_index,reason,
      remaining_mm:!line.fixed_pattern&&!(line.petucha_end&&profile.stretch_policy?.version!==2)&&!line.sefer_end&&(!line.has_setuma||profile.stretch_policy)?line.leftover_mm:0});continue;}
    const result=autoSuggestLine(line,profile);
    if(!result.suggestions.length){skipped.push({page:line.amud,line_index:line.line_index,reason:result.unjustifiable?'No permitted stretch candidates':'No remaining stretch needed',remaining_mm:result.shortfall_mm});continue;}
    const copy=structuredClone(line);
    applyStretch(copy,result.suggestions,profile); // validate entire replacement before presenting it
    proposed.push({line_id:line.line_id,decisions:result.suggestions,remaining_mm:copy.leftover_mm});
    entries.push(...reportLine(line,result.suggestions,geometry));
  }
  return {layout_id:row.id,revision,lines:proposed,entries,skipped,summary:{
    total_lines:lines.length,proposed_lines:proposed.length,skipped_lines:skipped.length,
    words_stretched:new Set(entries.filter(e=>e.kind==='letter').map(e=>e.line_id+':'+e.word_index)).size,
    letters_stretched:entries.filter(e=>e.kind==='letter').length,
    spaces_stretched:entries.filter(e=>e.kind==='word_space').length,
    hyphens_stretched:entries.filter(e=>e.kind==='hyphen').length,
    petucha_gaps_stretched:entries.filter(e=>e.kind==='petucha_gap').length,
    setuma_gaps_stretched:entries.filter(e=>e.kind==='setuma_gap').length,
    remaining_gap_lines:proposed.filter(l=>l.remaining_mm>=.001).length+skipped.filter(l=>l.remaining_mm>=.001).length,
  }};
}
