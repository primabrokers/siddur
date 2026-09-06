/*
 * Sofer Studio — progress.js
 * Progress tracking: amud grid (tri-state), aggregation bar, per-line status
 * dots with cycling, and the stable-identity lock notice. Progress is sent to
 * POST /api/layouts/:id/progress (server enforces the lock).
 */
(function () {
  'use strict';
  var SS = window.SS;
  var util = SS.util;
  var bus = SS.bus;
  var state = SS.state;
  var API;

  var root = null;
  var gridEl = null;
  var aggEl = null;
  var detailEl = null;
  var noticeEl = null;
  var current = null;   // { amud, lines }

  var RANK = { pending: 0, written: 1, checked: 2, proofread: 3 };
  var CYCLE = ['pending', 'written', 'checked', 'proofread'];

  function init(ctx) {
    API = ctx.api;
    root = util.byId('progress-body');
    if (!root) return;
    buildStatic();
    bus.on('layout:loaded', function (layout) { render(layout); });
    bus.on('layout:locked', function (layout) { renderNotice(layout); if (layout) render(layout); });
    renderEmpty();
  }

  function buildStatic() {
    noticeEl = util.el('div', { class: 'banner info', id: 'progress-notice', hidden: true });
    root.appendChild(noticeEl);

    aggEl = util.el('div', { id: 'progress-agg' });
    root.appendChild(aggEl);

    gridEl = util.el('div', { class: 'amud-grid', id: 'progress-grid' });
    root.appendChild(gridEl);

    detailEl = util.el('div', { id: 'progress-detail' });
    root.appendChild(detailEl);
  }

  function renderEmpty() {
    util.clear(aggEl); util.clear(gridEl); util.clear(detailEl);
    detailEl.appendChild(util.el('div', { class: 'empty', text: 'Compute or open a layout to track progress.' }));
  }

  /* ------------------------------------------------------------------ *
   * Line helpers
   * ------------------------------------------------------------------ */
  function amudOf(line) {
    return (line.amud != null) ? line.amud : (line.amud_index != null ? line.amud_index : (line.page != null ? line.page : 1));
  }
  function lineIdOf(line) {
    return line.line_id || line.id || (amudOf(line) + ':' + (line.line_index != null ? line.line_index : 0));
  }
  function statusOf(line) {
    var s = line.status || 'pending';
    return (RANK[s] != null) ? s : 'pending';
  }

  function indexAmudim(layout) {
    var map = {}; // amud -> { amud, lines: [], written, checked, proofread }
    layout.lines.forEach(function (line) {
      var a = amudOf(line);
      if (!map[a]) map[a] = { amud: a, lines: [], written: 0, checked: 0, proofread: 0 };
      map[a].lines.push(line);
      var s = statusOf(line);
      if (s === 'written' || s === 'checked' || s === 'proofread') map[a].written++;
      if (s === 'checked' || s === 'proofread') map[a].checked++;
      if (s === 'proofread') map[a].proofread++;
    });
    return map;
  }

  function amudStatus(g) {
    var n = g.lines.length;
    if (n > 0 && g.proofread === n) return 'proofread';
    if (n > 0 && g.written === n) return 'checked';
    if (g.written > 0) return 'written';
    return 'pending';
  }

  function render(layout) {
    if (!root || !layout || !Array.isArray(layout.lines)) { renderEmpty(); return; }
    renderNotice(layout);

    var map = indexAmudim(layout);
    var amudim = Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return Number(a.amud) - Number(b.amud); });

    renderAgg(layout);
    renderGrid(amudim);
    renderDetail(null);
  }

  function renderAgg(layout) {
    util.clear(aggEl);
    var lines = layout.lines;
    var n = lines.length || 1;
    var written = 0, checked = 0, proofread = 0;
    lines.forEach(function (l) {
      var s = statusOf(l);
      if (s === 'written' || s === 'checked' || s === 'proofread') written++;
      if (s === 'checked' || s === 'proofread') checked++;
      if (s === 'proofread') proofread++;
    });
    var pct = function (x) { return Math.round((x / n) * 100); };

    var barWrap = util.el('div', { class: 'agg-wrap' });
    var bar = util.el('div', { class: 'agg-bar' });
    bar.appendChild(seg(pct(written), 'segw', 'written'));
    bar.appendChild(seg(pct(checked), 'segc', 'checked'));
    bar.appendChild(seg(pct(proofread), 'segp', 'proofread'));
    var rest = 100 - pct(written);
    if (rest > 0) bar.appendChild(seg(rest, 'segrest', ''));
    barWrap.appendChild(bar);

    var line = util.el('div', { class: 'agg-line' },
      [swatch('segw'), util.el('span', { text: 'written ' + pct(written) + '%' }),
       swatch('segc'), util.el('span', { text: 'checked ' + pct(checked) + '%' }),
       swatch('segp'), util.el('span', { text: 'proofread ' + pct(proofread) + '%' })]);
    barWrap.appendChild(line);
    aggEl.appendChild(barWrap);
  }
  function seg(pctVal, cls, label) {
    var s = util.el('span', { class: cls });
    s.style.width = pctVal + '%';
    s.setAttribute('aria-label', label || cls);
    return s;
  }
  function swatch(cls) {
    var color = { segw: 'teal', segc: 'teal-bright', segp: 'ok' }[cls] || 'teal';
    return util.el('span', { class: 'swatch', style: 'background:var(--' + color + ')' });
  }

  function renderGrid(amudim) {
    util.clear(gridEl);
    if (!amudim.length) {
      gridEl.appendChild(util.el('div', { class: 'empty', text: 'No amudim.' }));
      return;
    }
    amudim.forEach(function (g) {
      var st = amudStatus(g);
      var cell = util.el('button', { class: 'amud-cell ' + st, text: String(g.amud), type: 'button' });
      var gim = util.gimatria(g.amud);
      cell.title = 'Amud ' + g.amud + ' \u00b7 ' + g.lines.length + ' lines \u00b7 checked ' + g.checked + '/' + g.lines.length;
      cell.setAttribute('aria-valuetext', 'Amud ' + g.amud + ' ' + st);
      cell.addEventListener('click', function () { renderDetail(g); });
      gridEl.appendChild(cell);
    });
  }

  function renderDetail(g) {
    util.clear(detailEl);
    current = g;
    if (!g) return;

    var head = util.el('div', { class: 't--1' },
      util.el('strong', { text: 'Amud ' + g.amud + ' \u00b7 ' + g.lines.length + ' lines' }));
    detailEl.appendChild(head);

    var strip = util.el('div', { class: 'line-strip' });
    g.lines.slice().sort(function (a, b) {
      return (Number(a.line_index) || 0) - (Number(b.line_index) || 0);
    }).forEach(function (line) {
      var idx = line.line_index != null ? line.line_index : line.line_number;
      var st = statusOf(line);
      var dot = util.el('button', {
        class: 'dot ' + st, text: String(idx != null ? idx : ''),
        type: 'button', 'data-line-id': lineIdOf(line), 'aria-label': 'Line ' + idx + ' ' + st
      });
      dot.addEventListener('click', function () { cycleLine(line, dot); });
      strip.appendChild(dot);
    });
    detailEl.appendChild(strip);
  }

  function cycleLine(line, dot) {
    var cur = statusOf(line);
    var next;
    if (cur === 'proofread') {
      if (!window.confirm('Regress this proofread line? Progress regressions are recorded.')) return;
      next = 'checked';
    } else {
      next = CYCLE[(RANK[cur] + 1) % CYCLE.length];
    }
    submitProgress(line, next, dot);
  }

  async function submitProgress(line, status, dot) {
    var layoutId = state.active.layoutId;
    if (!layoutId) { SS.toast('No active layout to update.', 'error'); return; }
    // F-31: the first "written" locks the whole layout; require explicit
    // confirmation and pass lock:true so the server never auto-locks silently.
    var isLocked = !!(state.layout && state.layout.status === 'locked');
    var lock = false;
    if (status === 'written' && !isLocked) {
      if (!window.confirm('Marking this line written locks the entire layout (no further edits to this snapshot). Continue?')) return;
      lock = true;
    }
    try {
      var payload = { line_id: lineIdOf(line), amud: amudOf(line), status: status };
      if (lock) payload.lock = true;
      var res = await API.updateProgress(layoutId, payload);
      if (res && res.locked && state.layout) state.layout.status = 'locked';
      line.status = status;
      dot.className = 'dot ' + status;
      bus.emit('line:status', line);
      renderAgg(state.layout);
      var m = indexAmudim(state.layout);
      renderGrid(Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return Number(a.amud) - Number(b.amud); }));
      if (current) renderDetail(current);
      SS.toast('Line marked ' + status + '.');
    } catch (e) { SS.toast(e.message || String(e), 'error'); }
  }

  function currentLayoutLines() {
    return state.layout;
  }

  function renderNotice(layout) {
    if (!noticeEl) return;
    var locked = layout && layout.status === 'locked';
    noticeEl.hidden = false;
    noticeEl.textContent = (locked
      ? 'Layout locked. Progress identity is stable — calibration changes create candidates, they never touch written lines.'
      : 'This layout is a draft. Marking any line “written” locks the entire layout on the server.');
  }

  SS.progress = { init: init };
})();
