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

  function init(ctx) {
    API = ctx.api;
    el = util.byId('stretch-inspector');
    if (!el) return;
    bus.on('line:selected', function (payload) { showLine(payload); });
    bus.on('layout:loaded', function () { hide(); });
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
    return currentLine.line_id || currentLine.id;
  }
  function leftover() {
    return Number(currentLine.leftover_mm != null ? currentLine.leftover_mm : currentLine.leftover);
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
      util.el('span', { text: 'Leftover: ' }),
      util.el('strong', { class: 'mono ' + (lv > 0 ? 'over' : 'under'), text: (lv > 0 ? '+' : '') + util.mm(lv) })));

    var cands = candidates();
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
      rowEl.appendChild(util.el('span', { class: 'mono t--2 faint', text: posLabel ? ('· ' + posLabel) : '' }));

      var minus = util.el('button', { type: 'button', class: 'btn-icon', text: '\u2212', 'aria-label': 'decrease stretch' });
      var input = util.el('input', { type: 'number', min: '0', max: String(cap), step: '0.05', value: util.fmt(cur, 2) });
      var plus = util.el('button', { type: 'button', class: 'btn-icon', text: '+', 'aria-label': 'increase stretch' });
      var capLbl = util.el('span', { class: 'mono t--2 faint', text: '\u00f7 cap ' + util.mm(cap) });

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
    var remaining = leftover() - applied;
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
      if (res.line) {
        var line = res.line;
        replaceLineInState(id, line);
        currentLine = line;
        bus.emit('line:status', line);
        bus.emit('layout:refreshed', state.layout);
      }
      SS.toast('Stretch applied.');
    } catch (e) { SS.toast(e.message || String(e), 'error'); }
  }

  function replaceLineInState(lineId, updated) {
    if (!state.layout || !Array.isArray(state.layout.lines)) return;
    state.layout.lines.forEach(function (l, i) {
      var oid = l.line_id || l.id;
      if (String(oid) === String(lineId)) state.layout.lines[i] = updated;
    });
  }

  SS.stretch = { init: init };
})();
