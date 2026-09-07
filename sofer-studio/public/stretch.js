/*
 * Sofer Studio — stretch.js
 * Per-line justification (stretch) inspector. Shown when a tikkun line is
 * selected: leftover display, candidate letters with positions, manual
 * stretch steppers (hard-capped, human-marked holy letters never candidates), auto-suggest,
 * and apply via POST /api/layouts/:id/stretch.
 *
 * The SERVER enforces the hard per-letter cap and never stretches human-marked holy
 * letters; this UI only proposes values and displays the server's answer.
 */
(function () {
  'use strict';
  var SS = window.SS;
  var util = SS.util;
  var bus = SS.bus;
  var state = SS.state;
  var API;

  var el = null;         // #stretch-inspector
  var currentLine = null;
  var draftDecisions = {}; // occurrence_id -> stretch_mm (editing buffer)
  var batchRoot, batchOutput, batchApply, batchPreview, batchReport, batchDownload;
  var batchPlan = null, batchRows = [], batchPage = 0, batchVersion = 0, batchBusy = false;
  var fitPlan=null,fitOutput,fitPreview,fitCreate;

  function init(ctx) {
    API = ctx.api;
    el = util.byId('stretch-inspector');
    if (!el) return;
    buildBookControls();
    bus.on('line:selected', function (payload) { showLine(payload); });
    bus.on('layout:loaded', function () { hide(); resetBookControls(); });
    bus.on('layout:locked', resetBookControls);
  }

  function hide() {
    currentLine = null; draftDecisions = {};
    if (el) el.hidden = true;
  }

  function showLine(payload) {
    if (!el || !payload || !payload.raw) { hide(); return; }
    currentLine = payload.raw;
    draftDecisions = {};
    (currentLine.stretch_decisions || currentLine.stretch || []).forEach(function (d) {
      var id = d.letter_occurrence_id || d.occurrence_id || d.id;
      if (id) draftDecisions[id] = Number(d.stretch_mm || 0);
    });
    render();
    el.hidden = false;
  }

  function lineId() {
    if (!currentLine) return null;
    return currentLine.line_id || currentLine.id;
  }
  function leftover() {
    return Number(currentLine.leftover_mm != null ? currentLine.leftover_mm : currentLine.leftover);
  }
  function baseLeftover() {
    if(currentLine.base_leftover_mm != null) return Number(currentLine.base_leftover_mm);
    return leftover()+(currentLine.stretch_decisions||[]).reduce(function(sum,d){return sum+Number(d.stretch_mm||0);},0);
  }

  /* ------------------------------------------------------------------ *
   * Candidate letters
   * ------------------------------------------------------------------ */
  // F-10: candidates are ALWAYS server-authoritative (absolute cap_mm from the
  // engine's stretchCandidatesOf). The client never derives caps — the old
  // capFor() treated max_stretch as a multiplier whereas the backend stores
  // absolute mm; deriving here would show wrong units values.
  function candidates() {
    if (currentLine.stretch_candidates && Array.isArray(currentLine.stretch_candidates)) {
      return currentLine.stretch_candidates;
    }
    if (currentLine.candidates && Array.isArray(currentLine.candidates)) {
      return currentLine.candidates;
    }
    return [];
  }

  /* ------------------------------------------------------------------ *
   * Render
   * ------------------------------------------------------------------ */
  function render() {
    if (!el) return;
    util.clear(el);

    var head = util.el('div', { class: 'si-head' });
    head.appendChild(util.el('span', { class: 'eyebrow', text: 'Justify line' }));
    var refText = (currentLine.verse_ref || currentLine.ref) ? (currentLine.verse_ref || currentLine.ref) : lineId();
    head.appendChild(util.el('span', { class: 'mono t--1', text: '\u00a0\u00b7\u00a0' + refText }));
    el.appendChild(head);

    var lv = leftover();
    el.appendChild(util.el('div', { class: 'si-leftover' },
      [util.el('span', { text: 'Remaining gap: ' }),
      util.el('strong', { class: 'mono ' + (lv > 0 ? 'over' : 'under'), text: (lv > 0 ? '+' : '') + util.mm(lv) })]));

    var cands = candidates();
    if (state.layout && state.layout.status === 'locked') { el.appendChild(util.el('p',{text:'This layout is locked. Compute a new draft to edit stretching.'})); return; }
    // Server candidates are pre-filtered to stretchable, non-holy-marked letters.
    var stretchable = cands;

    if (!cands.length) {
      el.appendChild(util.el('div', { class: 't--2 faint', text: 'No candidate data for this line.' }));
      return;
    }

    // manual steppers
    var list = util.el('div', { class: 'si-cands' });
    stretchable.forEach(function (c) {
      var id = c.letter_occurrence_id || c.id;
      var cap = Number(c.cap_mm != null ? c.cap_mm : 0);
      var cur = Number(draftDecisions[id] || 0);
      var posLabel = c.line_end ? 'end' : (c.word_final ? 'word-final' : '');

      var rowEl = util.el('div', { class: 'si-cand' });
      rowEl.appendChild(util.el('span', { class: 'si-let heb', lang: 'he', text: c.letter || '\u05d0' }));
      rowEl.appendChild(util.el('span', { class: 'mono t--2 faint', text: (c.word||'') + (posLabel ? (' · ' + posLabel) : '') }));

      var minus = util.el('button', { type: 'button', class: 'btn-icon', text: '\u2212', 'aria-label': 'decrease stretch' });
      var input = util.el('input', { type: 'number', min: '0', max: String(cap), step: '0.05', value: util.fmt(cur, 2) });
      var plus = util.el('button', { type: 'button', class: 'btn-icon', text: '+', 'aria-label': 'increase stretch' });
      var capLbl = util.el('span', { class: 'mono t--2 faint', text: (c.cap_percent==='unlimited'?'Unlimited (line limit)':c.cap_percent!=null?'+'+c.cap_percent+'% maximum':'Cap')+' · '+util.mm(cap)+(c.kind==='setuma_gap'&&c.priority===0?' · first priority':'') });

      function commit() {
        var v = util.parseNum(input.value);
        if (Number.isNaN(v)) v = 0;
        if (cap > 0 && v > cap) v = cap; // hard cap, never exceed
        if (v < 0) v = 0;
        input.value = util.fmt(v, 2);
        draftDecisions[id] = v;
        updateLeftover();
      }
      minus.addEventListener('click', function () {
        var v = (util.parseNum(input.value) || 0) - 0.1; if (v < 0) v = 0;
        input.value = util.fmt(v, 2); commit();
      });
      plus.addEventListener('click', function () {
        var v = (util.parseNum(input.value) || 0) + 0.1; input.value = util.fmt(v, 2); commit();
      });
      input.addEventListener('change', commit);

      rowEl.appendChild(minus); rowEl.appendChild(input); rowEl.appendChild(plus); rowEl.appendChild(capLbl);
      list.appendChild(rowEl);
    });
    el.appendChild(list);

    // actions
    var actions = util.el('div', { class: 'si-actions' });
    var autoBtn = util.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Auto-suggest' });
    var applyBtn = util.el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Apply stretch' });
    var clearBtn = util.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Clear' });
    autoBtn.addEventListener('click', autoSuggest);
    applyBtn.addEventListener('click', applyStretch);
    clearBtn.addEventListener('click', function () {
      draftDecisions = {}; render(); updateLeftover();
    });
    actions.appendChild(autoBtn); actions.appendChild(applyBtn); actions.appendChild(clearBtn);
    el.appendChild(actions);
  }

  function updateLeftover() {
    var applied = 0;
    Object.keys(draftDecisions).forEach(function (id) { applied += Number(draftDecisions[id] || 0); });
    var remaining = baseLeftover() - applied;
    var lbl = util.qs('.si-leftover', el);
    if (lbl) {
      util.clear(lbl);
      lbl.appendChild(util.el('span', { text: 'Remaining: ' }));
      lbl.appendChild(util.el('strong', { class: 'mono ' + (remaining > 0 ? 'over' : 'under'), text: (remaining > 0 ? '+' : '') + util.mm(remaining) }));
    }
  }

  /* ------------------------------------------------------------------ *
   * Auto-suggest + apply
   * ------------------------------------------------------------------ */
  async function autoSuggest() {
    var layoutId = state.active.layoutId;
    var id = lineId();
    if (!layoutId || !id) { SS.toast('No active layout / line.', 'error'); return; }
    try {
      var res = await API.autoSuggest(layoutId, { line_id: id });
      if (layoutId !== state.active.layoutId || id !== lineId()) return;
      var suggs = res && res.suggestions ? res.suggestions : [];
      draftDecisions = {};
      suggs.forEach(function (s) {
        var oid = s.letter_occurrence_id || s.occurrence_id || s.id;
        draftDecisions[oid] = Number(s.stretch_mm || 0);
      });
      render();
      updateLeftover();
      SS.toast('Suggestions loaded — review before applying.');
    } catch (e) { SS.toast(e.message || String(e), 'error'); }
  }

  async function applyStretch() {
    var layoutId = state.active.layoutId;
    var id = lineId();
    if (!layoutId || !id) { SS.toast('No active layout / line.', 'error'); return; }
    var decisions = Object.keys(draftDecisions).map(function (oid) {
      return { letter_occurrence_id: oid, stretch_mm: Number(draftDecisions[oid] || 0) };
    }).filter(function (d) { return d.stretch_mm > 0; });
    try {
      var res = await API.stretch(layoutId, { line_id: id, decisions: decisions });
      if (layoutId !== state.active.layoutId) return;
      if (res.line) {
        var line = res.line;
        replaceLineInState(id, line);
        if (id !== lineId()) { bus.emit('line:status', line); resetBookControls(); return; }
        currentLine = line;
        bus.emit('line:status', line);
        bus.emit('layout:refreshed', state.layout);
        draftDecisions = {};
        (line.stretch_decisions||[]).forEach(function(d){draftDecisions[d.letter_occurrence_id]=d.stretch_mm;});
        render(); updateLeftover();
        resetBookControls();
      }
      SS.toast(res.line && res.line.leftover_mm>=.001 ? 'Stretch applied, but this line is still short by '+util.mm(res.line.leftover_mm)+'. Review Fit ordinary lines to margin.' : 'Stretch applied — line aligned.');
    } catch (e) { SS.toast(e.message || String(e), 'error'); }
  }

  function buildBookControls() {
    batchRoot=util.el('details',{class:'stretch-book'});
    batchRoot.appendChild(util.el('summary',{text:'Whole-book auto stretch & analysis'}));
    batchRoot.appendChild(util.el('p',{text:'Suggest across ALL pages of the loaded layout. On setumah lines, stretch only the internal paragraph gaps. Petuchah lines keep all remaining width as paragraph space. Other lines share stretch equally across eligible letters and word spaces, stopping each at its own cap. Word spaces grow by at most 50%. Saved manual stretches and fixed passages stay unchanged.'}));
    var editRules=util.el('button',{type:'button',class:'btn btn-ghost btn-sm',text:'Edit whole-book stretch rules'});
    editRules.addEventListener('click',function(){if(SS.workspace)SS.workspace.open('setup','calibration');});
    batchRoot.appendChild(editRules);
    batchRoot.appendChild(util.el('p',{text:'In Setup → Measurements, choose “Use requested stretch rules”, save the profile, and compute a new draft before suggesting. This does not change older saved layouts.'}));
    batchPreview=util.el('button',{type:'button',class:'btn btn-ghost btn-sm',text:'Auto-suggest whole book'});
    batchApply=util.el('button',{type:'button',class:'btn btn-primary btn-sm',text:'Apply reviewed suggestions',disabled:true});
    batchReport=util.el('button',{type:'button',class:'btn btn-ghost btn-sm',text:'Show applied stretch report'});
    batchDownload=util.el('button',{type:'button',class:'btn btn-ghost btn-sm',text:'Download stretch report CSV',disabled:true});
    batchOutput=util.el('div',{class:'stretch-book-report','aria-live':'polite'});
    batchRoot.appendChild(util.el('div',{class:'btn-row'},[batchPreview,batchApply,batchReport,batchDownload]));
    batchRoot.appendChild(batchOutput);
    var fit=util.el('section',{class:'fit-margin-controls','aria-label':'Fit ordinary lines to margin'});
    fit.appendChild(util.el('strong',{text:'Still short? Fit ordinary lines to margin'}));
    fit.appendChild(util.el('p',{text:'Create a NEW fitted review copy without changing the original. Percentage/unlimited profiles keep their approved caps and paragraph-gap-only rule. Legacy millimetre profiles can propose additional limits for explicit approval. Overfull words cannot be fixed by stretching: use Reflow and recompute with suitable units/column measurements.'}));
    fitPreview=util.el('button',{type:'button',class:'btn btn-primary btn-sm',text:'Review fit-to-margin proposal'});
    fitCreate=util.el('button',{type:'button',class:'btn btn-ghost btn-sm',text:'Approve limits & create fitted copy',disabled:true});
    fitOutput=util.el('div',{'aria-live':'polite',class:'fit-margin-report'});
    fit.appendChild(util.el('div',{class:'btn-row'},[fitPreview,fitCreate]));fit.appendChild(fitOutput);batchRoot.appendChild(fit);
    fitPreview.addEventListener('click',previewFit);fitCreate.addEventListener('click',createFit);
    var body=util.byId('tikkun-body');body.insertBefore(batchRoot,util.byId('tikkun-scroll'));
    batchPreview.addEventListener('click',previewBook);
    batchApply.addEventListener('click',applyBook);
    batchReport.addEventListener('click',loadBookReport);
    batchDownload.addEventListener('click',function(){
      var columns=['page','line','kind','word','word_index','letter','letter_occurrence_id','stretch_mm'];
      function cell(v){var s=String(v==null?'':v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
      var csv=[columns.join(',')].concat(batchRows.map(function(r){return columns.map(function(c){return cell(r[c]);}).join(',');})).join('\r\n');
      util.download('stretch-report-'+(batchPlan?'suggested':'applied')+'.csv',new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));
    });
    resetBookControls();
  }
  function resetBookControls() {
    ++batchVersion; batchPlan=null; batchRows=[]; batchPage=0;fitPlan=null;
    if(!batchRoot)return;
    batchApply.disabled=true;batchDownload.disabled=true;
    batchPreview.disabled=batchBusy||!state.active.layoutId||!!(state.layout&&state.layout.status==='locked');
    batchReport.disabled=batchBusy||!state.active.layoutId;
    if(fitCreate){fitCreate.disabled=true;fitPreview.disabled=batchBusy||!state.active.layoutId;fitOutput.textContent='No profile limits change without your approval.';}
    batchOutput.textContent=state.layout&&state.layout.status==='locked'?'Locked: the applied report is available, but changes require a new draft.':'Generate suggestions to see exactly which words and letters would be stretched.';
  }
  function busy(on){batchBusy=on;batchPreview.disabled=on||!state.active.layoutId||state.layout.status==='locked';batchReport.disabled=on||!state.active.layoutId;batchApply.disabled=on||!batchPlan||!batchPlan.lines.length;if(fitPreview){fitPreview.disabled=on||!state.active.layoutId;fitCreate.disabled=on||!fitPlan;}}
  async function previewFit(){
    if(batchBusy||!state.active.layoutId)return;
    var id=state.active.layoutId,version=++batchVersion;fitPlan=null;busy(true);fitOutput.textContent='Checking every ordinary line against the measured margin…';
    try{
      var result=await API.fitMargin(id,{action:'preview'});if(version!==batchVersion||id!==state.active.layoutId)return;
      fitPlan=result;util.clear(fitOutput);
      var s=result.summary;
      fitOutput.appendChild(util.el('p',{text:s.aligned_lines+' / '+s.ordinary_lines+' ordinary lines will align; '+s.short_lines+' remain short; '+s.overfull_lines+' overfull; '+s.preserved_lines+' intentionally preserved. This is a mathematical fit, not scribal approval.'}));
      var percent=result.changes.some(function(c){return c.unit==='percent';});
      var table=util.el('table');table.appendChild(util.el('tr',{},['Letter','Current cap ('+(percent?'%':'mm')+')','Proposed cap ('+(percent?'%':'mm')+')'].map(function(t){return util.el('th',{text:t});})));
      result.changes.forEach(function(c){table.appendChild(util.el('tr',{},[util.el('td',{text:c.letter}),util.el('td',{text:util.fmt(percent?c.from_percent:c.from_mm,3)}),util.el('td',{text:util.fmt(percent?c.to_percent:c.to_mm,3)})]));});fitOutput.appendChild(table);
      if(!result.changes.length)fitOutput.appendChild(util.el('p',{text:'No higher caps needed. The copy will finish all fillable lines within existing limits.'}));
      (result.issues||[]).slice(0,20).forEach(function(r){fitOutput.appendChild(util.el('p',{text:'Page '+r.page+', line '+r.line+': '+r.reason}));});
    }catch(e){if(version===batchVersion)fitOutput.textContent=e.message;}
    finally{busy(false);}
  }
  async function createFit(){
    if(batchBusy||!fitPlan)return;
    if(SS.calibration&&SS.calibration.isDirty&&SS.calibration.isDirty()){SS.toast('Save your edited profile before creating a fitted copy.','error');return;}
    if(!window.confirm('Approve the displayed per-letter limits and create a separate fitted review copy? The original layout is unchanged. Review the letter shapes with your sofer.'))return;
    var id=state.active.layoutId,plan=fitPlan;busy(true);
    try{
      var result=await API.fitMargin(id,{action:'create',confirm:true,revision:plan.revision});
      if(id!==state.active.layoutId)return;
      state.profiles=await API.listProfiles();state.layouts=await API.listLayouts();
      state.active.profileId=result.profile_id;state.active.geometryId=result.geometry_id;state.active.sourceId=result.source_id;state.active.layoutId=result.layout_id;
      if(SS.calibration&&SS.calibration.selectSaved)SS.calibration.selectSaved();
      bus.emit('profiles:list');bus.emit('profileId:changed');bus.emit('geometryId:changed');bus.emit('sourceId:changed');bus.emit('layouts:list',state.layouts);
      await SS.app.reloadLayout(result.layout_id);
      fitOutput.textContent='Fitted review copy created. '+result.summary.aligned_lines+' ordinary lines aligned; '+(result.summary.short_lines+result.summary.overfull_lines)+' still require measurement review. Original unchanged.';
      SS.toast('New fitted review copy opened. Original unchanged.');
    }catch(e){if(id===state.active.layoutId){fitPlan=null;fitOutput.textContent=e.message;}}
    finally{busy(false);}
  }
  async function previewBook(){
    if(batchBusy||!state.active.layoutId)return;
    var id=state.active.layoutId,version=++batchVersion;batchPlan=null;batchRows=[];batchDownload.disabled=true;busy(true);
    batchOutput.textContent='Analysing every page…';
    try{var result=await API.stretchBook(id,{action:'preview'});if(version!==batchVersion||id!==state.active.layoutId)return;batchPlan=result;batchRows=result.entries||[];batchPage=0;renderBookReport();}
    catch(e){if(version===batchVersion&&id===state.active.layoutId)batchOutput.textContent=e.status===404?'Whole-book stretch requires the updated backend.':e.message;}
    finally{busy(false);}
  }
  async function applyBook(){
    if(batchBusy||!batchPlan)return;
    if(!window.confirm('Apply the reviewed suggestions across '+batchPlan.summary.proposed_lines+' lines? Existing manual stretching will be preserved.'))return;
    var id=state.active.layoutId,plan=batchPlan;busy(true);
    try{
      var result=await API.stretchBook(id,{action:'apply',confirm:true,revision:plan.revision});
      if(id!==state.active.layoutId)return;
      await SS.app.reloadLayout(id);
      if(id!==state.active.layoutId)return;
      batchPlan=null;batchRows=result.entries||[];batchPage=0;renderBookReport('Applied '+result.summary.proposed_lines+' lines. This report lists this batch; Show applied stretch report includes all prior edits.');
      SS.toast(result.summary.remaining_gap_lines ? 'Stretch applied, but '+result.summary.remaining_gap_lines+' lines still have gaps. Review Fit ordinary lines to margin.' : 'Reviewed whole-book stretch applied.');
    }catch(e){if(id===state.active.layoutId){batchPlan=null;batchOutput.textContent=e.message;}}
    finally{busy(false);}
  }
  async function loadBookReport(){
    if(batchBusy||!state.active.layoutId)return;var id=state.active.layoutId,version=++batchVersion;busy(true);
    try{var result=await API.stretchReport(id);if(version!==batchVersion||id!==state.active.layoutId)return;batchPlan=null;batchRows=result.entries||[];batchPage=0;renderBookReport('Applied stretching in this saved layout.');}
    catch(e){if(version===batchVersion&&id===state.active.layoutId)batchOutput.textContent=e.message;}
    finally{busy(false);}
  }
  function renderBookReport(message){
    util.clear(batchOutput);batchDownload.disabled=!batchRows.length;
    var summary=batchPlan&&batchPlan.summary;
    batchOutput.appendChild(util.el('p',{class:'stretch-book-summary',text:message||(summary?summary.proposed_lines+' lines proposed; '+summary.words_stretched+' words / '+summary.letters_stretched+' letters; '+(summary.spaces_stretched||0)+' word spaces / '+(summary.setuma_gaps_stretched||0)+' setumah gaps; '+summary.skipped_lines+' lines preserved or skipped; '+summary.remaining_gap_lines+' proposed lines still have gaps.':'Applied stretch report.')}));
    var total=Math.max(1,Math.ceil(batchRows.length/100));batchPage=Math.min(batchPage,total-1);
    var prev=util.el('button',{type:'button',text:'Previous report page',disabled:batchPage===0}),next=util.el('button',{type:'button',text:'Next report page',disabled:batchPage+1>=total});
    prev.addEventListener('click',function(){--batchPage;renderBookReport(message);});next.addEventListener('click',function(){++batchPage;renderBookReport(message);});
    batchOutput.appendChild(util.el('div',{class:'btn-row'},[prev,util.el('span',{text:'Report '+(batchPage+1)+' / '+total+' · '+batchRows.length+' letter / gap changes'}),next]));
    var table=util.el('table');table.appendChild(util.el('tr',{},['Page','Line','Word','Letter','Added mm'].map(function(t){return util.el('th',{text:t});})));
    batchRows.slice(batchPage*100,(batchPage+1)*100).forEach(function(r){table.appendChild(util.el('tr',{},[util.el('td',{text:r.page}),util.el('td',{text:r.line}),util.el('td',{class:'hebrew',text:r.word}),util.el('td',{class:'hebrew',text:r.letter}),util.el('td',{text:util.fmt(r.stretch_mm,3)})]));});
    batchOutput.appendChild(table);
    if(batchPlan){var reasons={};batchPlan.skipped.forEach(function(s){reasons[s.reason]=(reasons[s.reason]||0)+1;});Object.keys(reasons).forEach(function(reason){batchOutput.appendChild(util.el('p',{text:reasons[reason]+' lines: '+reason}));});}
  }

  function replaceLineInState(lineId, updated) {
    if (!state.layout || !Array.isArray(state.layout.lines)) return;
    state.layout.lines.forEach(function (l, i) {
      var oid = l.line_id || l.id;
      if (String(oid) === String(lineId)) state.layout.lines[i] = updated;
    });
  }

  SS.stretch = { init: init, close: hide };
})();
