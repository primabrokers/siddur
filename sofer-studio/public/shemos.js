/*
 * Sofer Studio — shemos.js
 * Holy names (Shemos kodesh) display. The program never classifies holiness:
 * this panel renders only exact human-authored marks received from the backend.
 */
(function () {
  'use strict';
  var SS = window.SS;
  var util = SS.util;
  var bus = SS.bus;
  var state = SS.state;

  var root = null;
  var pendingDecision = {}; // tokenText -> 'approved' | 'dismissed'


  // Letter width from active profile (same convention as engine).
  function letterWidth(letter) {
    var prof = SS.activeProfile ? SS.activeProfile() : null;
    if (!prof) return 0;
    var units = (prof.letter_widths && prof.letter_widths[letter]) || 0;
    var unitMm = (prof.unit_mm != null) ? Number(prof.unit_mm) : 0.5;
    var ref = prof.reference_height_mm || 3.0;
    var stroke = prof.stroke_mm || 0;
    var lh = prof.letter_height_mm || 0;
    return units * unitMm * (lh / ref) + stroke;
  }
  function wordWidth(word) {
    var letters = util.graphemes(word).filter(function (g) { return util.isHebrew(g); });
    var sum = 0;
    letters.forEach(function (g) { sum += letterWidth(g); });
    var gap = (SS.activeProfile && SS.activeProfile() && SS.activeProfile().gaps) ? SS.activeProfile().gaps.inter_letter || 0 : 0;
    if (letters.length > 1) sum += (letters.length - 1) * gap;
    return sum;
  }
  function columnWidth() {
    var g = SS.activeGeometry ? SS.activeGeometry() : null;
    return (g && g.line_width_mm) || 130;
  }

  SS.shem = { wordWidth: wordWidth };

  /* ------------------------------------------------------------------ *
   * Panel
   * ------------------------------------------------------------------ */
  function init(ctx) {
    root = util.byId('shemos-body');
    if (!root) return;
    buildStatic();
    bus.on('layout:loaded', function (layout) { render(layout); });
    bus.on('profileId:changed', function () { if (state.layout) render(state.layout); });
    renderEmpty();
  }

  function buildStatic() {
    var certain = util.el('div', { class: 'shemos-group certain' });
    certain.appendChild(util.el('div', { class: 'ghead' }, util.el('span', { text: 'Human-marked holy letters' })));
    certain.appendChild(util.el('div', { class: 'gbody', id: 'shem-certain' }));

    var uncertain = util.el('div', { class: 'shemos-group uncertain' });
    uncertain.appendChild(util.el('div', { class: 'ghead' }, util.el('span', { text: 'Human decision required' })));
    uncertain.appendChild(util.el('div', { class: 'gbody', id: 'shem-uncertain' }));

    var unsat = util.el('div', { class: 'shemos-group unsat', hidden: true });
    unsat.appendChild(util.el('div', { class: 'ghead' }, util.el('span', { text: 'Unsatisfiable' })));
    unsat.appendChild(util.el('div', { class: 'gbody', id: 'shem-unsat' }));

    root.appendChild(certain);
    root.appendChild(uncertain);
    root.appendChild(unsat);
  }

  function renderEmpty() {
    setList('shem-certain', util.el('div', { class: 'empty', text: 'Compute a layout to list human-marked holy letters.' }));
    setList('shem-uncertain', null);
    setList('shem-unsat', null);
  }

  function setList(id, content) {
    var el = util.byId(id);
    if (!el) return;
    util.clear(el);
    if (content) el.appendChild(content);
  }

  function render(layout) {
    if (!root) return;
    var tokens = collectTokens(layout);
    if (!tokens.length) {
      setList('shem-certain', util.el('div', { class: 'empty', text: 'No holy letters were marked by human input in this layout. The program does not infer them.' }));
      setList('shem-uncertain', null);
      setList('shem-unsat', null);
      util.qs('.shemos-group.unsat', root).hidden = true;
      return;
    }

    var certainEl = util.byId('shem-certain');
    var uncertainEl = util.byId('shem-uncertain');
    var unsatEl = util.byId('shem-unsat');
    util.clear(certainEl); util.clear(uncertainEl); util.clear(unsatEl);

    var cw = columnWidth();
    var seenCertain = {}, seenUncertain = {}, sat = 0, unsatCount = 0;

    tokens.forEach(function (t) {
      var key = t.token;
      var width = wordWidth(key);
      var tooWide = width > cw;

      if (tooWide) {
        unsatCount++;
        unsatEl.appendChild(unsatRow(t, width, cw));
        return;
      }
      if (t.uncertain) {
        if (pendingDecision[t.token] === 'dismissed') return;
        if (seenUncertain[key]) { seenUncertain[key].count++; return; }
        seenUncertain[key] = { count: 1, el: null };
        uncertainEl.appendChild(shemRow(t, true, seenUncertain[key]));
      } else {
        if (seenCertain[key]) { seenCertain[key].count++; return; }
        seenCertain[key] = { count: 1 };
        certainEl.appendChild(shemRow(t, false, seenCertain[key]));
      }
    });

    if (!certainEl.children.length) certainEl.appendChild(util.el('div', { class: 'empty', text: 'None.' }));
    if (!uncertainEl.children.length) uncertainEl.appendChild(util.el('div', { class: 'empty', text: 'None.' }));
    util.qs('.shemos-group.unsat', root).hidden = unsatCount === 0;
  }

  function collectTokens(layout) {
    // 1. Top-level server-provided listing (if present).
    if (layout.shemos && Array.isArray(layout.shemos)) {
      return layout.shemos.map(function (s) { return { token: s.token || s.text || s.name, uncertain: !!s.uncertain, amud: s.amud, line: s.line_index, ref: s.ref }; });
    }
    if (layout.shem_tokens && Array.isArray(layout.shem_tokens)) {
      return layout.shem_tokens.map(function (s) { return { token: s.token || s.text || s.name, uncertain: !!s.uncertain, amud: s.amud, line: s.line_index, ref: s.ref }; });
    }
    // 2. Per-line backend metadata (canonical per-token certainty — never recomputed).
    var perLine = [];
    (layout.lines || []).forEach(function (line) {
      (line.shem_tokens || []).forEach(function (s) {
        perLine.push({ token: s.token, uncertain: !!s.uncertain, amud: s.amud, line: s.line_index, ref: s.ref });
      });
    });
    if (perLine.length) return perLine;
    // No heuristic fallback: absence of explicit backend metadata means no mark.
    return [];
  }

  function shemRow(t, uncertain, seen) {
    var row = util.el('div', { class: 'shem-row' });
    row.appendChild(util.el('span', { class: 'spine' }));
    var tok = util.el('span', { class: 'stok', lang: 'he', text: t.token, title: (uncertain ? 'Uncertain \u00b7 ' : 'Certain \u00b7 ') + t.token });
    row.appendChild(tok);

    var meta = util.el('div', { class: 'smeta' });
    meta.appendChild(util.el('div', { class: 'pos', text: position(t) }));
    if (uncertain) meta.appendChild(util.el('div', { class: 't--1 faint', text: 'Legacy unmarked occurrence \u2014 only the sofer can decide.' }));
    row.appendChild(meta);

    var showBtn = util.el('button', { class: 'btn btn-ghost btn-sm', text: 'Show', title: 'Show on sheet' });
    showBtn.addEventListener('click', function () { bus.emit('flash:shem', t.token); });
    row.appendChild(showBtn);

    if (uncertain) {
      var appr = util.el('button', { class: 'btn btn-ghost btn-sm', text: 'Approve' });
      var dism = util.el('button', { class: 'btn btn-ghost btn-sm', text: 'Dismiss' });
      appr.addEventListener('click', function () { decide(t.token, 'approved', row); });
      dism.addEventListener('click', function () { decide(t.token, 'dismissed', row); });
      row.appendChild(appr);
      row.appendChild(dism);
    }
    return row;
  }

  function unsatRow(t, width, cw) {
    var row = util.el('div', { class: 'shem-row' });
    row.appendChild(util.el('span', { class: 'spine' }));
    row.appendChild(util.el('span', { class: 'stok', lang: 'he', text: t.token }));
    var meta = util.el('div', { class: 'smeta' });
    meta.appendChild(util.el('div', { class: 'pos', text: position(t) }));
    meta.appendChild(util.el('div', { class: 'unsat-num', text: util.mm(width) + ' > line ' + util.mm(cw) + ' — cannot be split or truncated.' }));
    row.appendChild(meta);
    return row;
  }

  function position(t) {
    var amud = t.amud != null ? ('Amud ' + t.amud) : '';
    var ln = t.line != null ? ('line ' + t.line) : '';
    return (amud || ln) ? (amud + (ln ? ' · ' + ln : '')) : 'position unknown';
  }

  function decide(token, decision, row) {
    pendingDecision[token] = decision;
    if (decision === 'approved') {
      row.classList.add('is-approved');
      util.qsa('.btn', row).forEach(function (b) { b.disabled = true; });
      var meta = util.qs('.smeta', row);
      if (meta) { util.clear(meta); meta.appendChild(util.el('div', { class: 'pos', text: 'Approved for review.' })); }
    } else if (decision === 'dismissed') {
      row.remove();
    }
    if (state.layout) render(state.layout);
  }

  SS.shemos = { init: init };
})();
