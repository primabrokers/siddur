/*
 * Sofer Studio — validation.js
 * Validation results: severity summary strip, results table sorted
 * errors-first then by position, and jump-to-line on row click.
 */
(function () {
  'use strict';
  var SS = window.SS;
  var util = SS.util;
  var bus = SS.bus;
  var state = SS.state;

  var root = null;
  var summaryEl = null;
  var bodyEl = null;

  function init(ctx) {
    root = util.byId('validation-body');
    if (!root) return;
    buildStatic();
    bus.on('layout:loaded', function (layout) { render(layout); });
    renderEmpty();
  }

  function buildStatic() {
    summaryEl = util.el('div', { class: 'val-summary' });
    root.appendChild(summaryEl);
    bodyEl = util.el('div', { id: 'validation-results' });
    root.appendChild(bodyEl);
  }

  function renderEmpty() {
    if (!summaryEl || !bodyEl) return;
    util.clear(summaryEl);
    util.clear(bodyEl);
    bodyEl.appendChild(util.el('div', { class: 'empty', text: 'Compute a layout to see validation results.' }));
  }

  function severities(items) {
    var err = 0, warn = 0, clean = 0;
    items.forEach(function (i) {
      var s = (i.severity || i.level || '').toLowerCase();
      if (s === 'error') err++;
      else if (s === 'warning' || s === 'warn') warn++;
      else clean++;
    });
    return { err: err, warn: warn, clean: clean };
  }

  var ORDER = { error: 0, warning: 1, warn: 1, ok: 2, clean: 2, info: 3 };

  // Collect every validation item from the canonical shape
  // {valid, spacing_errors: string[], lines: [{line_id, valid, errors[], warnings[]}]},
  // plus the legacy array / errors+warnings fallbacks. Each error/warning becomes one
  // row with its severity, so a genuinely clean layout shows zero non-clean rows.
  function collectItems(layout) {
    var items = [];
    if (!layout || !layout.validation) return items;
    var v = layout.validation;
    if (typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.lines)) {
      var posById = {};
      (layout.lines || []).forEach(function (l) {
        if (l && l.line_id != null && String(l.line_id) !== '') posById[String(l.line_id)] = { amud: l.amud, line_index: l.line_index };
      });
      v.lines.forEach(function (ln) {
        var pos = posById[String(ln.line_id)] || {};
        (ln.errors || []).forEach(function (msg) {
          items.push({ severity: 'error', check: String(msg), amud: pos.amud, line_index: pos.line_index, line_id: ln.line_id });
        });
        (ln.warnings || []).forEach(function (msg) {
          items.push({ severity: 'warning', check: String(msg), amud: pos.amud, line_index: pos.line_index, line_id: ln.line_id });
        });
      });
      (v.spacing_errors || []).forEach(function (msg) {
        items.push({ severity: 'error', check: String(msg), ref: 'spacing' });
      });
      return items;
    }
    if (Array.isArray(v)) return v.slice();
    if (Array.isArray(layout.errors)) {
      return layout.errors.concat((layout.warnings || []).map(function (w) { return Object.assign({}, w, { severity: 'warning' }); }));
    }
    return items;
  }

  // Count of clean lines, derived from lines[].valid — never a hardcoded literal.
  function cleanLineCount(layout) {
    var v = layout && layout.validation;
    if (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.lines)) {
      return v.lines.filter(function (l) { return l.valid; }).length;
    }
    return null;
  }

  function hasLineValidation(layout) {
    var v = layout && layout.validation;
    return !!(v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.lines));
  }

  function render(layout) {
    if (!summaryEl || !bodyEl) return;
    var items = collectItems(layout);
    var cleanCount = cleanLineCount(layout);

    if (!items.length) {
      util.clear(summaryEl);
      util.clear(bodyEl);
      if (hasLineValidation(layout)) {
        var total = layout.validation.lines.length;
        bodyEl.appendChild(util.el('div', { class: 'empty', text: 'No validation issues \u2014 every line passed.' }));
        bodyEl.appendChild(util.el('div', { class: 't--2 faint', style: 'text-align:center', text: cleanCount + ' of ' + total + ' lines clean' }));
      } else if (layout && Array.isArray(layout.errors)) {
        bodyEl.appendChild(util.el('div', { class: 'empty', text: 'No validation issues \u2014 every line passed.' }));
      } else {
        bodyEl.appendChild(util.el('div', { class: 'empty', text: 'No validation data available.' }));
      }
      return;
    }

    var counts = severities(items);
    var clean = cleanCount != null ? cleanCount : counts.clean;
    util.clear(summaryEl);
    summaryEl.appendChild(stat(String(counts.err), 'errors', 'err'));
    summaryEl.appendChild(stat(String(counts.warn), 'warnings', 'warn'));
    summaryEl.appendChild(stat(String(clean), 'clean', 'ok'));

    // sort errors-first, then position
    var sorted = items.slice().sort(function (a, b) {
      var sa = ORDER[String(a.severity || '').toLowerCase()] != null ? ORDER[String(a.severity || '').toLowerCase()] : 9;
      var sb = ORDER[String(b.severity || '').toLowerCase()] != null ? ORDER[String(b.severity || '').toLowerCase()] : 9;
      if (sa !== sb) return sa - sb;
      var pa = positionNum(a), pb = positionNum(b);
      return pa - pb;
    });

    var tbl = util.el('table', { class: 'data' });
    var thr = util.el('tr', {}, [
      util.el('th', { text: 'Ref' }), util.el('th', { text: 'Check' }),
      util.el('th', { text: 'Result' }), util.el('th', { text: 'Sev' })
    ]);
    tbl.appendChild(util.el('thead', {}, thr));
    var tbody = util.el('tbody', {}, []);
    tbl.appendChild(tbody);

    sorted.forEach(function (item) {
      var sev = String(item.severity || 'warning').toLowerCase();
      var row = util.el('tr', { class: sev === 'error' ? 'sev-error' : (sev === 'warning' || sev === 'warn' ? 'sev-warn' : '') });
      row.style.cursor = 'pointer';

      row.appendChild(util.el('td', { class: 'mono t--1', text: lineRef(item) }));
      row.appendChild(util.el('td', { text: item.check || item.name || item.message || 'Issue' }));
      row.appendChild(util.el('td', { class: 'mono t--1', text: item.result || item.delta || item.detail || '' }));
      row.appendChild(util.el('td', { class: 'sev ' + sevClass(sev), text: glyph(sev) }));

      row.addEventListener('click', function () {
        bus.emit('jump:line', { amud: itemAmud(item), line: itemLine(item) });
      });
      tbody.appendChild(row);
    });

    util.clear(bodyEl);
    bodyEl.appendChild(tbl);
  }

  function stat(n, label, cls) {
    return util.el('div', { class: 'vs ' + cls },
      [util.el('div', { class: 'n', text: n }), util.el('div', { class: 'l', text: label })]);
  }
  function glyph(sev) {
    if (sev === 'error') return '\u25b2'; // ▲
    if (sev === 'clean' || sev === 'ok') return '\u2713'; // ✓
    return '\u25cf'; // ● warning
  }
  function sevClass(sev) {
    if (sev === 'error') return 'error';
    if (sev === 'clean' || sev === 'ok') return 'okg';
    return 'warn';
  }
  function itemAmud(item) {
    return item.amud != null ? item.amud : (item.line ? item.line.amud : null);
  }
  function itemLine(item) {
    return item.line_index != null ? item.line_index : (item.line_number != null ? item.line_number : (item.line ? item.line.line_index : null));
  }
  function lineRef(item) {
    var amud = itemAmud(item);
    var ln = itemLine(item);
    if (amud != null && ln != null) return 'Amud ' + amud + ' · L' + ln;
    if (item.ref) return item.ref;
    if (item.line_id) return item.line_id;
    return '—';
  }
  function positionNum(item) {
    var amud = itemAmud(item) || 0;
    var ln = itemLine(item) || 0;
    return amud * 100000 + ln;
  }

  SS.validation = { init: init };
})();
