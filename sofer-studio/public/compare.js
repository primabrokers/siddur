/*
 * Sofer Studio — compare.js
 * Side-by-side comparison of 2–3 profiles on the SAME source + geometry.
 * POST /api/compare returns independently computed totals per profile; the
 * header must state that each column is an independent full layout, not a
 * rescale. Renders into the drawer (full) and the left-rail mini.
 */
(function () {
  'use strict';
  var SS = window.SS;
  var util = SS.util;
  var bus = SS.bus;
  var state = SS.state;
  var API;

  var full = null;   // #compare-body
  var mini = null;   // #compare-mini-body
  var lastResult = null;

  function init(ctx) {
    API = ctx.api;
    full = util.byId('compare-body');
    mini = util.byId('compare-mini-body');
    buildFull();
    buildMini();
    bus.on('profiles:list', function () { buildFull(); buildMini(); });
    bus.on('selection:changed', function () { /* active source/geometry used */ });
  }

  /* ------------------------------------------------------------------ *
   * Full (drawer)
   * ------------------------------------------------------------------ */
  function buildFull() {
    if (!full) return;
    util.clear(full);

    full.appendChild(util.el('div', { class: 'compare-note',
      text: 'Each column is an independent full layout, not a rescale.' }));

    var picker = util.el('div', { class: 'cmp-picker', id: 'cmp-picker' });
    full.appendChild(picker);

    renderProfileChecks('cmp-picker');

    var btnRow = util.el('div', { class: 'btn-row' });
    var go = util.el('button', { class: 'btn btn-primary', text: 'Compare profiles' });
    go.addEventListener('click', runCompare);
    btnRow.appendChild(go);
    full.appendChild(btnRow);

    full.appendChild(util.el('div', { id: 'cmp-results' }));
    if (lastResult) renderResults(lastResult, 'cmp-results');
  }

  function buildMini() {
    if (!mini) return;
    util.clear(mini);
    var go = util.el('button', { class: 'btn btn-ghost btn-sm', text: 'Open full comparison' });
    go.addEventListener('click', function () { SS.activateDrawer('compare'); var b = util.byId('lower-bench'); if (b) b.classList.remove('is-collapsed'); });
    mini.appendChild(go);
    mini.appendChild(util.el('div', { id: 'cmp-mini-results', class: 'cmp-mini' }));
    if (lastResult) renderMini(lastResult);
  }

  function renderProfileChecks(containerId) {
    var box = util.byId(containerId);
    util.clear(box);
    if (!state.profiles || !state.profiles.length) {
      box.appendChild(util.el('div', { class: 'empty', text: 'No profiles to compare.' }));
      return;
    }
    var sel = { count: 0 };
    state.profiles.forEach(function (p, i) {
      var cb = util.el('input', { type: 'checkbox', 'data-profile': p.id, checked: i < 2 });
      if (i < 2) sel.count += 1;
      cb.addEventListener('change', function () { sel.count += cb.checked ? 1 : -1; });
      box.appendChild(util.el('label', { class: 'toggle cmp-choice' },
        [cb, util.el('span', { text: p.name + ' \u00b7 ' + util.fmt(p.letter_height_mm) + '\u00a0mm' })]));
    });
    sel._get = function () {
      return util.qsa('#cmp-picker input[data-profile]:checked').map(function (i) { return i.getAttribute('data-profile'); });
    };
    box._sel = sel;
  }

  async function runCompare() {
    var ids = util.qsa('#cmp-picker input[data-profile]:checked').map(function (i) { return i.getAttribute('data-profile'); });
    if (ids.length < 2 || ids.length > 3) { SS.toast('Select 2 or 3 profiles.', 'error'); return; }
    var src = SS.activeSource ? SS.activeSource() : null;
    var geom = SS.activeGeometry ? SS.activeGeometry() : null;
    if (!src || !geom) { SS.toast('Select a source and geometry first.', 'error'); return; }
    try {
      var res = await API.compare({ source_id: src.id, geometry_id: geom.id, profile_ids: ids });
      lastResult = res;
      renderResults(res, 'cmp-results');
      renderMini(res);
    } catch (e) { SS.toast(e.message || String(e), 'error'); }
  }

  function renderResults(res, containerId) {
    var box = util.byId(containerId);
    if (!box) return;
    util.clear(box);
    var comps = (res && res.comparisons) ? res.comparisons : [];
    if (!comps.length) {
      box.appendChild(util.el('div', { class: 'empty', text: 'Run a comparison to see totals.' }));
      return;
    }
    if (res.source_label) {
      box.appendChild(util.el('div', { class: 'compare-note', text: res.source_label }));
    }
    var cols = util.el('div', { class: 'compare-cols c' + comps.length });
    var base = comps[0];
    comps.forEach(function (c) {
      cols.appendChild(column(c, base));
    });
    box.appendChild(cols);
  }

  function column(c, base) {
    var col = util.el('div', { class: 'compare-col' });
    col.appendChild(util.el('div', { class: 'cname', text: c.profile_name || c.profile_id }));
    var prof = state.profiles.find(function (p) { return p.id === c.profile_id; });
    if (prof) col.appendChild(util.el('div', { class: 'cheight', text: 'letter height ' + util.mm(prof.letter_height_mm) }));

    var totals = util.el('div', { class: 'ctotal' });
    totals.appendChild(row('Total amudim', c.total_amudim));
    totals.appendChild(row('Total yerios', c.total_yerios));
    totals.appendChild(row('Klaf length', util.m(c.klaf_length_m)));
    col.appendChild(totals);

    // delta vs leftmost (for non-base columns)
    if (c !== base && base && base.klaf_length_m != null && c.klaf_length_m != null) {
      var d = c.klaf_length_m - base.klaf_length_m;
      var delta = util.el('div', { class: 'delta ' + (d < 0 ? 'neg' : 'pos'), text: (d >= 0 ? '+' : '') + util.m(d) + ' vs ' + (base.profile_name || 'leftmost') });
      col.appendChild(delta);
    }
    return col;
  }

  function row(label, value) {
    return util.el('div', { class: 'crow' },
      [util.el('span', { text: label }), util.el('span', { class: 'v', text: (value != null && isFinite(value)) ? String(value) : '\u2014' })]);
  }

  function renderMini(res) {
    var box = util.byId('cmp-mini-results');
    if (!box) return;
    util.clear(box);
    var comps = (res && res.comparisons) ? res.comparisons : [];
    if (!comps.length) return;
    var base = comps[0];
    comps.forEach(function (c) {
      var l = util.el('div', { class: 'cmp-mini-row' });
      l.appendChild(util.el('span', { class: 'mono t--1', text: ' ' }));
      var d = (c.klaf_length_m != null && base.klaf_length_m != null) ? (c.klaf_length_m - base.klaf_length_m) : null;
      l.appendChild(util.el('span', { text: (c.profile_name || c.profile_id) + ' \u00b7 ' + util.m(c.klaf_length_m) + (d != null ? (' (' + (d >= 0 ? '+' : '') + util.m(d) + ')') : '') }));
      box.appendChild(l);
    });
  }

  SS.compare = { init: init };
})();
