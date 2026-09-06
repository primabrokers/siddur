/*
 * Sofer Studio — diff.js
 * Candidate diff: line/verse changes between a locked layout and a candidate,
 * and candidate adoption with EXPLICIT verification.
 *
 * CRITICAL SAFETY (per frozen contract): progress is NEVER silently carried to
 * changed lines. Only lines the sofer explicitly ticks as unchanged keep their
 * written/checked/proofread status — every changed line resets to "pending".
 */
(function () {
  'use strict';
  var SS = window.SS;
  var util = SS.util;
  var bus = SS.bus;
  var state = SS.state;
  var API;

  var root = null;
  var keepTicked = {};   // line_id -> true (sofer chose to keep progress)

  function init(ctx) {
    API = ctx.api;
    root = util.byId('diff-body');
    if (!root) return;

    bus.on('candidate:request', function (payload) { createCandidate(payload); });
    bus.on('layout:locked', function () { /* diff flows start from a locked layout */ });
    bus.on('layout:loaded', function () { renderEmpty(); });

    renderEmpty();
  }

  function renderEmpty() {
    if (!root) return;
    util.clear(root);
    root.appendChild(util.el('div', { class: 'empty', text: 'Lock a layout, change calibration, then “Duplicate as candidate” to see a diff.' }));
  }

  /* ------------------------------------------------------------------ *
   * Candidate creation
   * ------------------------------------------------------------------ */
  async function createCandidate(payload) {
    var layoutId = payload && payload.layoutId ? payload.layoutId : state.active.layoutId;
    if (!layoutId) { SS.toast('Open a locked layout first.', 'error'); return; }
    var prof = SS.activeProfile ? SS.activeProfile() : null;
    var geom = SS.activeGeometry ? SS.activeGeometry() : null;
    if (!prof || !geom) { SS.toast('Select a target profile and geometry first.', 'error'); return; }

    try {
      var cand = await API.createCandidate(layoutId, { profile_id: prof.id, geometry_id: geom.id });
      state.candidate = cand;
      var diff = await API.getDiff(layoutId);
      state.diff = diff;
      keepTicked = {};
      render(diff, cand);
    } catch (e) { SS.toast(e.message || String(e), 'error'); }
  }

  /* ------------------------------------------------------------------ *
   * Render
   * ------------------------------------------------------------------ */
  function render(diff, cand) {
    if (!root) return;
    util.clear(root);

    // header chips
    var head = util.el('div', { class: 'diff-head' });
    var lockedName = (diff.locked && diff.locked.name) || 'Locked layout';
    var candName = (diff.candidate && diff.candidate.name) || 'Candidate';
    head.appendChild(util.el('div', { class: 'col' },
      [util.el('div', { class: 'cn', text: 'LOCKED' }), util.el('div', { text: lockedName })]));
    head.appendChild(util.el('div', { class: 'col' },
      [util.el('div', { class: 'cn', text: 'CANDIDATE' }), util.el('div', { text: candName }),
       (cand && cand.candidate_id ? util.el('div', { class: 't--2 faint mono', text: 'id ' + cand.candidate_id }) : null)]));
    root.appendChild(head);

    // delta chip (profile/geometry change)
    if (cand) {
      var delta = buildDeltaChip(cand);
      if (delta) root.appendChild(delta);
    }

    var changes = (diff && Array.isArray(diff.changes)) ? diff.changes : [];
    root.appendChild(util.el('div', { class: 'eyebrow', text: changes.length + ' line changes' }));

    var list = util.el('div', { class: 'diff-list' });
    changes.forEach(function (ch) {
      list.appendChild(diffItem(ch));
    });
    if (!changes.length) {
      list.appendChild(util.el('div', { class: 'empty', text: 'No line changes — the candidate is identical to the locked layout.' }));
    }
    root.appendChild(list);

    // adoption verification block
    root.appendChild(buildAdoption(diff));
  }

  function buildDeltaChip(cand) {
    var parts = [];
    if (cand.profile_name || cand.profile_id) parts.push('profile \u2192 ' + (cand.profile_name || cand.profile_id));
    if (cand.geometry_name || cand.geometry_id) parts.push('geometry \u2192 ' + (cand.geometry_name || cand.geometry_id));
    if (!parts.length) return null;
    return util.el('div', { class: 'banner info', text: 'Candidate uses ' + parts.join(' · ') });
  }

  function lineRefForChange(ch) {
    if (ch.line_index != null) return 'Line ' + ch.line_index;
    if (ch.ref) return ch.ref;
    if (ch.line_id) return ch.line_id;
    return '';
  }
  function fmtDVal(v) {
    if (v === null || v === undefined) return '\u2014';
    if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
    return String(v);
  }
  function fmtTokens(t) {
    if (t == null) return '\u2014';
    if (Array.isArray(t)) return t.join(' ');
    return String(t);
  }

  function diffItem(ch) {
    var el = util.el('div', { class: 'diff-item' });
    var type = ch.type || 'unchanged';
    var labelMap = { line_changed: 'Line changed', measurement_changed: 'Measurement changed', line_added: 'Line added', line_removed: 'Line removed', unchanged: 'Unchanged', moved: 'Moved', rebroken: 'Re-broken', new: 'New', removed: 'Removed' };
    el.appendChild(util.el('span', { class: 'dtype ' + type, text: labelMap[type] || type }));
    el.appendChild(util.el('span', { class: 'dref', text: lineRefForChange(ch) }));

    if (type === 'measurement_changed' && Array.isArray(ch.deltas) && ch.deltas.length) {
      var dl = util.el('div', { class: 'deltas' });
      ch.deltas.forEach(function (d) {
        dl.appendChild(util.el('div', { class: 'delta mono t--1', text: (d.field || '') + ': ' + fmtDVal(d.from) + ' \u2192 ' + fmtDVal(d.to) }));
      });
      el.appendChild(dl);
    } else if (ch.from || ch.to) {
      var tok = util.el('div', { class: 'moved-to heb', lang: 'he' });
      tok.textContent = fmtTokens(ch.from) + ' \u2192 ' + fmtTokens(ch.to);
      el.appendChild(tok);
    }
    return el;
  }

  /* ------------------------------------------------------------------ *
   * Adoption — explicit verification
   * ------------------------------------------------------------------ */
  function buildAdoption(diff) {
    var wrap = util.el('div', { class: 'diff-adopt' });
    wrap.appendChild(util.el('div', { class: 'sirtut' }));

    // Split lines by whether progress exists and whether it changed.
    var changed = changedLines(diff);      // changed lines (progress will reset)
    var unchanged = unchangedWithProgress(diff); // unchanged lines with progress

    wrap.appendChild(util.el('div', { class: 't--1' },
      util.el('strong', { text: 'Adopt candidate \u2014 review required' })));

    // Unchanged lines with progress: keep checkboxes
    var keepBox = util.el('div', { id: 'diff-keep' });
    if (unchanged.length) {
      keepBox.appendChild(util.el('div', { class: 't--1 faint', text: 'Keep progress on these unchanged lines (tick to keep, untick to reset):' }));
      unchanged.forEach(function (line) {
        var id = line.line_id || line.id;
        var lbl = util.el('label', { class: 'toggle' },
          [util.el('input', { type: 'checkbox', 'data-keep': id }),
           util.el('span', { class: 'mono t--1', text: lineRef(line) + ' \u00b7 ' + (line.status || 'written') })]);
        lbl.querySelector('input').addEventListener('change', function (ev) { keepTicked[id] = !!ev.target.checked; refreshAdoptState(); });
        keepBox.appendChild(lbl);
        keepBox.appendChild(document.createElement('br'));
      });
    } else {
      keepBox.appendChild(util.el('div', { class: 't--1 faint', text: 'No progressed lines to carry over.' }));
    }
    wrap.appendChild(keepBox);

    // Changed lines with progress: warning (never carried)
    if (changed.progressed.length) {
      wrap.appendChild(util.el('div', { class: 'banner warn', text: changed.progressed.length + ' written/checked/proofread line(s) changed \u2014 their progress resets to pending, always.' }));
    }

    // Global acknowledgement
    var ack = util.el('label', { class: 'toggle', id: 'diff-ack-toggle' },
      [util.el('input', { type: 'checkbox', id: 'diff-ack' }),
       util.el('span', { text: 'I have reviewed the diff. Changed lines start from pending; only the lines I ticked above keep their status.' })]);
    wrap.appendChild(ack);

    var footer = util.el('div', { class: 'diff-footer' });
    var adoptBtn = util.el('button', { class: 'btn btn-primary', id: 'diff-adopt', text: 'Adopt candidate', disabled: true });
    var discardBtn = util.el('button', { class: 'btn btn-ghost', text: 'Discard candidate' });
    var exportBtn = util.el('button', { class: 'btn btn-ghost', text: 'Export diff (JSON)' });
    footer.appendChild(adoptBtn);
    footer.appendChild(discardBtn);
    footer.appendChild(exportBtn);
    wrap.appendChild(footer);

    util.byId('diff-ack').addEventListener('change', refreshAdoptState);
    adoptBtn.addEventListener('click', function () { adopt(diff); });
    discardBtn.addEventListener('click', function () { discard(); });
    exportBtn.addEventListener('click', function () { exportDiff(diff); });

    refreshAdoptState();
    return wrap;
  }

  function refreshAdoptState() {
    var ack = util.byId('diff-ack');
    var btn = util.byId('diff-adopt');
    if (!btn) return;
    var ok = ack && ack.checked;
    btn.disabled = !ok;
    btn.title = ok ? 'Adopt the candidate as the new working layout' : 'Tick the review acknowledgement to adopt';
  }

  function changedLines(diff) {
    var progressed = [];
    var lines = (diff && diff.locked && Array.isArray(diff.locked.lines)) ? diff.locked.lines : [];
    var changes = (diff && Array.isArray(diff.changes)) ? diff.changes : [];
    changes.forEach(function (ch) {
      if (!ch.type || ch.type === 'unchanged') return;
      var line = null;
      if (ch.line_index != null) line = lines[Number(ch.line_index) - 1];
      if (!line && ch.line_id) line = lines.find(function (l) { return l.line_id === ch.line_id; });
      if (line && line.status && line.status !== 'pending') progressed.push(ch);
    });
    return { progressed: progressed };
  }
  function unchangedWithProgress(diff) {
    var out = [];
    var lines = (diff && diff.locked && Array.isArray(diff.locked.lines)) ? diff.locked.lines : [];
    var changedIds = changedLineIds(diff);
    lines.forEach(function (line) {
      var st = line.status || 'pending';
      if (st === 'pending') return;
      var id = line.line_id || line.id;
      if (changedIds[id]) return; // changed lines are never carried
      out.push(line);
    });
    return out;
  }
  function changedLineIds(diff) {
    var ids = {};
    var lines = (diff && diff.locked && Array.isArray(diff.locked.lines)) ? diff.locked.lines : [];
    var changes = (diff && Array.isArray(diff.changes)) ? diff.changes : [];
    changes.forEach(function (ch) {
      if (!ch.type || ch.type === 'unchanged') return;
      // The server emits line_index (not line_id); resolve it against the locked
      // lines so changed lines are actually recognised as changed.
      var line = null;
      if (ch.line_index != null) line = lines[Number(ch.line_index) - 1];
      if (!line && ch.line_id) line = lines.find(function (l) { return l.line_id === ch.line_id; });
      if (line) ids[line.line_id || line.id] = 1;
      var id = ch.line_id || ch.id;
      if (id) ids[id] = 1;
    });
    return ids;
  }
  function lineRef(line) {
    var amud = line.amud != null ? line.amud : line.amud_index;
    var ln = line.line_index != null ? line.line_index : line.line_number;
    return (amud != null ? 'Amud ' + amud : '') + (ln != null ? ' · L' + ln : '') || line.line_id || '';
  }

  /* ------------------------------------------------------------------ *
   * Adopt / discard / export
   * ------------------------------------------------------------------ */
  async function adopt(diff) {
    var layoutId = state.active.layoutId;
    if (!layoutId || !state.candidate) { SS.toast('No candidate to adopt.', 'error'); return; }
    var candidateId = state.candidate.candidate_id || state.candidate.id;
    var verified = Object.keys(keepTicked).filter(function (id) { return keepTicked[id]; });
    try {
      var res = await API.adoptCandidate(layoutId, { candidate_id: candidateId, verified_unchanged_lines: verified });
      state.layouts = await API.listLayouts();
      bus.emit('layouts:list', state.layouts);
      state.diff = null; state.candidate = null;
      if (res.new_layout_id) {
        var lay = await API.getLayout(res.new_layout_id);
        state.layout = lay; state.active.layoutId = lay.id;
        bus.emit('layout:loaded', lay);
      }
      renderEmpty();
      var adoptMsg = res.message || 'Candidate adopted as the new working layout.';
      if (res.refused_line_ids && res.refused_line_ids.length) {
        adoptMsg += ' Server refused these claimed-unchanged lines: ' + res.refused_line_ids.join(', ');
      }
      SS.toast(adoptMsg);
    } catch (e) { SS.toast(e.message || String(e), 'error'); }
  }

  function discard() {
    state.diff = null; state.candidate = null; keepTicked = {};
    renderEmpty();
    SS.toast('Candidate discarded.');
  }

  function exportDiff(diff) {
    var blob = new Blob([JSON.stringify(diff, null, 2)], { type: 'application/json' });
    util.download('layout-diff.json', blob);
  }

  SS.diff = { init: init };
})();
