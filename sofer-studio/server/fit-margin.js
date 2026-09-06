import {createHash} from 'node:crypto';
import {autoSuggestLine,stretchCandidatesOf,applyStretch} from '../engine/layout.js';

export function fitMarginPlan(row,lines) {
  const profile=JSON.parse(row.profile_snapshot),proposed=structuredClone(profile);
  const hash=createHash('sha256').update('fit-margin-v2').update(JSON.stringify(row));
  for(const line of lines)hash.update('\n').update(JSON.stringify(line));
  const preserve=new Map(),issues=[];
  const reference=JSON.parse(row.summary||'{}').reference;
  // Older reference snapshots omitted the book-end flag. Keep those terminal
  // lines unchanged too; this is inferred only for the trusted fixed reference.
  const bookEnds=new Set();
  if(reference){
    const nonempty=lines.filter(l=>l.words?.length);
    const book=l=>String(l.verse_refs?.at(-1)||'').replace(/\s+\d+:\d+$/,'');
    nonempty.forEach((l,i)=>{if(!nonempty[i+1]||book(l)!==book(nonempty[i+1]))bookEnds.add(l.line_id);});
  }
  for(const line of lines){
    let reason;
    if(!line.spacing_metadata_complete)reason='Legacy measurements: compute a new reference draft first';
    else if(line.fixed_pattern||line.petucha_end||line.sefer_end||line.setuma_at_edge||(line.has_setuma&&!profile.stretch_policy)||bookEnds.has(line.line_id))reason='Intentional section, book-end or fixed-passage spacing';
    else if(line.status!=='pending')reason='Written or reviewed line';
    if(reason){preserve.set(line.line_id,reason);continue;}
    const gap=Number(line.base_leftover_mm);
    if(!Number.isFinite(gap)||gap<0){issues.push({page:line.amud,line:line.line_index,reason:'Overfull: adjust calibration/column width; stretching cannot shrink text',gap_mm:gap});continue;}
    if(gap<.001)continue;
    const candidates=stretchCandidatesOf(line,profile).filter(c=>!profile.stretch_policy||c.kind==='letter');
    if(profile.stretch_policy) {
      const result=autoSuggestLine(line,profile);
      if(result.shortfall_mm>=.001)issues.push({page:line.amud,line:line.line_index,reason:'Approved percentage/paragraph-gap limits leave space; limits are not raised automatically',gap_mm:result.shortfall_mm});
      continue;
    }
    if(!candidates.length){issues.push({page:line.amud,line:line.line_index,reason:'No permitted stretch letters at the selected positions',gap_mm:gap});continue;}
    // Propose, never silently impose, a higher cap. Spread the required space
    // across the already-permitted letters, without changing their eligibility.
    const each=Math.ceil(gap/candidates.length*1000)/1000;
    for(const c of candidates) {
      if(profile.stretch_policy) {
        const current=proposed.stretch_policy.caps_percent[c.letter];
        if(current!=='unlimited')proposed.stretch_policy.caps_percent[c.letter]=Math.max(Number(current)||0,Math.ceil(each/c.base_width_mm*100000)/1000);
      } else proposed.max_stretch[c.letter]=Math.max(proposed.max_stretch[c.letter],each);
    }
  }
  const changes=profile.stretch_policy
    ? Object.keys(proposed.stretch_policy.caps_percent).filter(ch=>proposed.stretch_policy.caps_percent[ch]!==profile.stretch_policy.caps_percent[ch]).map(letter=>({letter,unit:'percent',from_percent:profile.stretch_policy.caps_percent[letter],to_percent:proposed.stretch_policy.caps_percent[letter]}))
    : Object.keys(proposed.max_stretch).filter(ch=>proposed.max_stretch[ch]>profile.max_stretch[ch]).map(letter=>({letter,from_mm:profile.max_stretch[letter],to_mm:proposed.max_stretch[letter]}));
  const adjustments=[],alignment=[];
  for(const line of lines){
    if(preserve.has(line.line_id))continue;
    const plan=autoSuggestLine(line,proposed),existing=(line.stretch_decisions||[]).reduce((n,d)=>n+d.stretch_mm,0);
    const remaining=Number(line.base_leftover_mm)-plan.suggestions.reduce((n,d)=>n+d.stretch_mm,0);
    if(line.base_leftover_mm>=0 && (plan.suggestions.length||existing))adjustments.push({line_id:line.line_id,decisions:plan.suggestions});
    alignment.push({page:line.amud,line:line.line_index,remaining_mm:remaining});
  }
  return {revision:hash.digest('hex'),changes,profile:proposed,adjustments,issues,book_ends:[...bookEnds],
    preserved:[...preserve].map(([line_id,reason])=>({line_id,reason})),
    summary:{ordinary_lines:alignment.length,aligned_lines:alignment.filter(l=>Math.abs(l.remaining_mm)<.001).length,
      short_lines:alignment.filter(l=>l.remaining_mm>=.001).length,overfull_lines:alignment.filter(l=>l.remaining_mm<-.001).length,
      preserved_lines:preserve.size,changed_caps:changes.length},alignment};
}

export function applyFitCopy(lines,plan) {
  const decisions=new Map(plan.adjustments.map(p=>[p.line_id,p.decisions]));
  // Caller loaded its own independent line objects. No source or parent DB row
  // changes: save these as a NEW layout after explicit exact-revision approval.
  for(const line of lines)if(decisions.has(line.line_id))applyStretch(line,decisions.get(line.line_id),plan.profile);
  for(const line of lines)if(plan.book_ends.includes(line.line_id))line.sefer_end=true;
  return lines;
}
