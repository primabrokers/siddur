/*
 * Sofer Studio — app.js
 * Main application controller: startup, panel management, tab navigation,
 * keyboard shortcuts, the Sargel Rule, compute/lock flow, global status.
 *
 * Loaded LAST (all panel modules register themselves before this runs).
 */
(function () {
  'use strict';
  var SS = window.SS;
  var util = SS.util;
  var bus = SS.bus;
  var state = SS.state;
  var API = SS.api;

  var ctx = { api: API, state: state, bus: bus, util: util };

  /* ------------------------------------------------------------------ *
   * Toast
   * ------------------------------------------------------------------ */
  var toastTimer = null;
  SS.toast = function (msg, type) {
    var el = util.byId('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = type === 'error' ? 'error' : '';
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 4000);
  };

  /* ------------------------------------------------------------------ *
   * Status line (app bar)
   * ------------------------------------------------------------------ */
  function setStatus(txt) {
    var el = util.byId('app-status');
    if (el) el.textContent = txt || '';
  }

  /* ------------------------------------------------------------------ *
   * Helpers to look up active entities
   * ------------------------------------------------------------------ */
  function activeSource() {
    return state.sources.find(function (s) { return s.id === state.active.sourceId; }) || null;
  }
  // F-33: listProfiles returns only a summary (no letter_widths/gaps), so the
  // geometry/calibration width guards would fail to verify. Cache the FULL record
  // (GET /api/profiles/:id) keyed by id and prefer it in activeProfile().
  var fullProfiles = {};

  function activeProfile() {
    var id = state.active.profileId;
    if (id && fullProfiles[id]) return fullProfiles[id];
    return state.profiles.find(function (p) { return p.id === id; }) || null;
  }

  async function ensureFullProfile(id) {
    if (!id) return;
    try {
      var full = await API.getProfile(id);
      if (full) {
        fullProfiles[id] = full;
        bus.emit('selection:changed'); // re-render guards that read activeProfile()
      }
    } catch (e) { /* fall back to summary record */ }
  }
  function activeGeometry() {
    return state.geometries.find(function (g) { return g.id === state.active.geometryId; }) || null;
  }
  SS.activeSource = activeSource;
  SS.activeProfile = activeProfile;
  SS.activeGeometry = activeGeometry;

  /* ------------------------------------------------------------------ *
   * Selects (app bar)
   * ------------------------------------------------------------------ */
  function fillSelect(selId, items, labelField, activeKey) {
    var sel = util.byId(selId);
    if (!sel) return;
    util.clear(sel);
    if (!items || items.length === 0) {
      var o0 = util.el('option', { value: '', text: '— none —' });
      sel.appendChild(o0);
      return;
    }
    items.forEach(function (it) {
      var o = util.el('option', { value: it.id, text: it[labelField] || it.id });
      sel.appendChild(o);
    });
    var cur = state.active[activeKey];
    if (cur && items.some(function (it) { return it.id === cur; })) {
      sel.value = cur;
    } else {
      state.active[activeKey] = items[0].id;
      sel.value = items[0].id;
    }
  }

  function bindSelect(selId, activeKey) {
    var sel = util.byId(selId);
    if (!sel) return;
    sel.addEventListener('change', function () {
      state.active[activeKey] = sel.value || null;
      bus.emit(activeKey + ':changed');
      bus.emit('selection:changed');
    });
  }

  function refreshSelects() {
    fillSelect('source-select', state.sources, 'name', 'sourceId');
    fillSelect('profile-select', state.profiles, 'name', 'profileId');
    fillSelect('geometry-select', state.geometries, 'name', 'geometryId');
  }

  /* ------------------------------------------------------------------ *
   * Panel collapse (chevron) with persistence
   * ------------------------------------------------------------------ */
  function loadCollapsed() {
    try { return JSON.parse(localStorage.getItem('sofer:collapsed') || '{}'); }
    catch (e) { return {}; }
  }
  function saveCollapsed(map) {
    try { localStorage.setItem('sofer:collapsed', JSON.stringify(map)); }
    catch (e) { /* ignore */ }
  }

  function initCollapse() {
    var map = loadCollapsed();
    util.qsa('.panel').forEach(function (p) {
      var id = p.id;
      var head = util.qs('.panel-head', p);
      if (map[id]) { p.classList.add('is-collapsed'); if (head) head.setAttribute('aria-expanded', 'false'); }
      else if (head) head.setAttribute('aria-expanded', 'true');
      if (!head) return;
      head.addEventListener('click', function () {
        var collapsed = p.classList.toggle('is-collapsed');
        head.setAttribute('aria-expanded', String(!collapsed));
        map[id] = collapsed;
        saveCollapsed(map);
      });
      head.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); head.click(); }
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Lower bench drawer
   * ------------------------------------------------------------------ */
  function initDrawer() {
    var bench = util.byId('lower-bench');
    var tabs = util.byId('drawer-tabs');
    var chev = util.byId('drawer-chev');
    if (!bench || !tabs) return;

    util.qsa('.dt[data-drawer]', tabs).forEach(function (btn) {
      btn.addEventListener('click', function () {
        bench.classList.remove('is-collapsed');
        activateDrawer(btn.getAttribute('data-drawer'));
      });
    });
    if (chev) {
      chev.addEventListener('click', function (ev) { ev.stopPropagation(); toggleDrawer(); });
    }
  }

  function toggleDrawer() {
    var bench = util.byId('lower-bench');
    if (!bench) return;
    bench.classList.toggle('is-collapsed');
  }

  function activateDrawer(name) {
    util.qsa('.dt[data-drawer]').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.getAttribute('data-drawer') === name));
    });
    util.qsa('.drawer-pane').forEach(function (p) {
      p.classList.toggle('is-active', p.id === 'pane-' + name);
    });
    bus.emit('drawer:activated', name);
  }

  SS.activateDrawer = activateDrawer;
  SS.toggleDrawer = toggleDrawer;

  /* ------------------------------------------------------------------ *
   * Phone tab bar
   * ------------------------------------------------------------------ */
  function initPhoneTabs() {
    var bar = util.byId('phone-tabs');
    if (!bar) return;
    util.qsa('[data-phone-panel]', bar).forEach(function (b) {
      b.addEventListener('click', function () {
        activatePhonePanel(b.getAttribute('data-phone-panel'));
      });
    });
  }

  function activatePhonePanel(target) {
    util.qsa('[data-phone-panel]').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.getAttribute('data-phone-panel') === target));
    });
    var left = util.byId('rail-left');
    var right = util.byId('rail-right');
    var tikkun = util.byId('tikkun-region');
    var bench = util.byId('lower-bench');

    // F-13: below 1024px the stylesheet hides rail panels unless the rail carries
    // .show-panel — toggling `.style.display` alone was never enough.
    var showLeft = (target === 'measure');
    var showRight = (target === 'shemos' || target === 'checks');
    if (left) left.classList.toggle('show-panel', showLeft);
    if (right) right.classList.toggle('show-panel', showRight);
    if (left) left.style.display = '';
    if (right) right.style.display = '';
    if (tikkun) tikkun.hidden = !(target === 'tikkun' || target === 'measure' || target === 'shemos');
    if (bench) bench.hidden = target !== 'bench';

    // Per-panel visibility for the left rail (calibration vs geometry vs search).
    util.qsa('#rail-left .panel').forEach(function (p) {
      var name = p.getAttribute('data-panel');
      var show;
      if (target === 'measure') show = (name === 'calibration' || name === 'geometry' || name === 'search');
      else show = false;
      p.style.display = show ? '' : 'none';
    });
    util.qsa('#rail-right .panel').forEach(function (p) {
      var name = p.getAttribute('data-panel');
      var show;
      if (target === 'checks') show = (name === 'validation' || name === 'passages');
      else if (target === 'shemos') show = (name === 'shemos');
      else show = false;
      p.style.display = show ? '' : 'none';
    });
    if (target === 'bench' && bench) bench.classList.remove('is-collapsed');
  }

  /* ------------------------------------------------------------------ *
   * Sargel Rule — the signature live mm ruler
   * ------------------------------------------------------------------ */
  var SARGEL_MAX_MM = 300;
  var sargel = { el: null, ticks: null, win: null, flag: null, pxPerMm: 1 };

  function initSargel() {
    sargel.el = util.byId('sargel');
    sargel.ticks = util.byId('sargel-ticks');
    sargel.win = util.byId('sargel-window');
    sargel.flag = util.byId('sargel-flag');
    if (!sargel.el || !sargel.ticks) return;
    renderSargelTicks();

    document.addEventListener('focusin', function (ev) {
      var t = ev.target;
      if (t && t.matches && t.matches('.mm-input input, input[data-mm]')) wakeSargel(parseValue(t));
    });
    document.addEventListener('focusout', function () { sleepSargel(); });
    document.addEventListener('input', function (ev) {
      var t = ev.target;
      if (t && t.matches && t.matches('.mm-input input, input[data-mm]') && document.activeElement === t) {
        wakeSargel(parseValue(t));
      }
    });

    bus.on('sargel:tick', function (mm) {
      if (mm === null || mm === undefined) { sleepSargel(); return; }
      sargel.el.classList.add('is-woken');
      positionWindow(parseFloat(mm));
    });
    bus.on('sargel:wake', function (mm) { wakeSargel(mm); });
    bus.on('sargel:sleep', function () { sleepSargel(); });

    window.addEventListener('resize', util.debounce(renderSargelTicks, 150));
  }

  function parseValue(input) {
    return util.parseNum(input && input.value);
  }

  function renderSargelTicks() {
    if (!sargel.ticks) return;
    util.clear(sargel.ticks);
    var w = sargel.el.clientWidth || 1;
    sargel.pxPerMm = w / SARGEL_MAX_MM;
    var stepMinor = 10;
    var stepMajor = 50;
    for (var mm = 0; mm <= SARGEL_MAX_MM; mm += stepMinor) {
      var t = util.el('span', { class: 'tick' + ((mm % stepMajor === 0) ? ' major' : ' minor') });
      t.style.left = (mm * sargel.pxPerMm) + 'px';
      sargel.ticks.appendChild(t);
      if (mm % stepMajor === 0 && mm > 0) {
        var lbl = util.el('span', { class: 'tick-label', text: mm });
        lbl.style.left = (mm * sargel.pxPerMm) + 'px';
        sargel.ticks.appendChild(lbl);
      }
    }
  }

  function positionWindow(valueMm) {
    if (!sargel.win) return;
    if (!isFinite(valueMm) || valueMm <= 0) { sargel.win.hidden = true; return; }
    var capped = Math.min(valueMm, SARGEL_MAX_MM);
    sargel.win.hidden = false;
    sargel.win.style.left = '0px';
    sargel.win.style.width = (capped * sargel.pxPerMm) + 'px';
    if (sargel.flag) {
      sargel.flag.textContent = util.mm(valueMm);
      sargel.flag.hidden = false;
    }
  }

  function wakeSargel(valueMm) {
    if (!sargel.el) return;
    sargel.el.classList.add('is-woken');
    positionWindow(valueMm);
  }
  function sleepSargel() {
    if (!sargel.el) return;
    sargel.el.classList.remove('is-woken');
    if (sargel.win) sargel.win.hidden = true;
  }

  /* ------------------------------------------------------------------ *
   * Keyboard shortcuts
   * ------------------------------------------------------------------ */
  function initKeyboard() {
    document.addEventListener('keydown', function (ev) {
      var t = ev.target;
      var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (typing) {
        if (ev.key === 'Escape') { t.blur(); focusTikkun(); }
        return;
      }

      if (ev.key === '\u0060') { ev.preventDefault(); toggleDrawer(); return; }
      if (ev.key === '/') { ev.preventDefault(); focusSearch(); return; }
      if (ev.key === 'Escape') { focusTikkun(); return; }

      var map = { '1': 'calibration', '2': 'geometry', '3': 'tikkun', '4': 'shemos',
                  '5': 'passages', '6': 'validation', '7': 'layouts', '8': 'progress',
                  '9': 'diff', '0': 'search', '-': 'compare', '=': 'compare' };
      if (Object.prototype.hasOwnProperty.call(map, ev.key)) {
        ev.preventDefault();
        jumpToPanel(map[ev.key]);
      }
    });
  }

  function jumpToPanel(name) {
    if (name === 'layouts' || name === 'progress' || name === 'diff' || name === 'compare') {
      var bench = util.byId('lower-bench');
      if (bench) bench.classList.remove('is-collapsed');
      activateDrawer(name);
    }
    var panel = util.qs('[data-panel="' + name + '"]');
    if (panel) {
      panel.classList.remove('is-collapsed');
      panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      var head = util.qs('.panel-head', panel);
      if (head) head.focus();
    }
    if (name === 'search') focusSearch();
  }

  function focusSearch() {
    var el = util.byId('search-input');
    if (el) el.focus();
  }
  function focusTikkun() {
    var el = util.byId('tikkun-scroll');
    if (el) { el.setAttribute('tabindex', '-1'); el.focus(); }
  }

  /* ------------------------------------------------------------------ *
   * Compute / lock flow
   * ------------------------------------------------------------------ */
  // F-16: large corpora are computed via a polled background job (so the UI shows
  // real processed/total progress) and fetched back in bounded pages rather than
  // one giant JSON blob.
  var LARGE_CORPUS_LETTERS = 20000;

  async function pollComputeJob(jobId, btn) {
    for (;;) {
      var jr = await API.computeJob(jobId);
      if (jr.status === 'done') return jr.layout_id;
      if (jr.status === 'error') {
        SS.toast('Compute failed: ' + (jr.error || 'error'), 'error');
        setStatus('compute failed');
        return null;
      }
      var pct = (jr.total > 0) ? Math.round((jr.processed / jr.total) * 100) : 0;
      if (btn) btn.textContent = 'Computing… ' + pct + '%';
      setStatus('computing… ' + pct + '%');
      await new Promise(function (r) { setTimeout(r, 200); });
    }
  }

  async function fetchLayoutPaginated(id, pageSize) {
    pageSize = pageSize || 500;
    var first = await API.getLayout(id, { from: 0, limit: pageSize });
    var lines = (first.lines || []).slice();
    var total = (first.total_lines != null) ? first.total_lines : lines.length;
    var from = pageSize;
    while (from < total) {
      var pg = await API.getLayout(id, { from: from, limit: pageSize });
      var got = (pg.lines || []);
      if (!got.length) break;
      lines = lines.concat(got);
      from += pageSize;
    }
    first.lines = lines;
    return first;
  }

  async function computeLayout() {
    var src = activeSource();
    var prof = activeProfile();
    var geom = activeGeometry();
    if (!src) { SS.toast('Import a Torah source first.', 'error'); return; }
    if (!prof) { SS.toast('Select or create a calibration profile.', 'error'); return; }
    if (!geom) { SS.toast('Select or create a column geometry.', 'error'); return; }

    var btn = util.byId('btn-compute');
    if (btn) { btn.disabled = true; btn.textContent = 'Computing…'; }
    setStatus('computing layout…');
    var usePoll = !!(src.letter_count && src.letter_count > LARGE_CORPUS_LETTERS);
    try {
      var patternIds = (state.active.patternIds || []);
      var annotations = (state.active.annotations || {});
      var body = {
        source_id: src.id,
        profile_id: prof.id,
        geometry_id: geom.id,
        pattern_ids: patternIds,
        annotations: annotations
      };
      var layoutId;
      var result;
      if (usePoll) {
        var start = await API.computeLayout(Object.assign({ poll: true }, body));
        layoutId = await pollComputeJob(start.job_id, btn);
        if (!layoutId) return; // error toasted in pollComputeJob
        result = { summary: start.summary };
      } else {
        result = await API.computeLayout(body);
        layoutId = result.layout_id || result.id;
      }
      // F-27: fetch the CANONICAL persisted layout; tikkun renders the engine's
      // snapshot geometry (stretched_width_mm, items[]) rather than the POST echo.
      // F-16: large corpora are fetched in bounded pages, not one giant response.
      var canonical = usePoll
        ? await fetchLayoutPaginated(layoutId, 500)
        : await API.getLayout(layoutId);
      state.layout = canonical;
      state.active.layoutId = layoutId;
      refreshLayouts();
      updateLockChip();
      bus.emit('layout:loaded', state.layout);
      bus.emit('selection:changed');
      activateDrawer('progress');
      var ben = util.byId('lower-bench');
      if (ben) ben.classList.remove('is-collapsed');
      var amudim = (result.summary && result.summary.total_amudim != null) ? result.summary.total_amudim : null;
      setStatus('layout ' + state.active.layoutId + (amudim != null ? ' · ' + amudim + ' amudim' : ' · draft'));
      SS.toast('Layout computed.');
    } catch (e) {
      SS.toast(e.message || String(e), 'error');
      setStatus('compute failed');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Compute layout'; }
    }
  }

  async function lockLayout() {
    if (!state.active.layoutId) { SS.toast('Compute a layout first.', 'error'); return; }
    try {
      var res = await API.lockLayout(state.active.layoutId);
      if (state.layout) state.layout.status = res.status || 'locked';
      if (state.layout) state.layout.locked_at = res.locked_at;
      bus.emit('layout:locked', state.layout);
      refreshLayouts();
      updateLockChip();
      SS.toast('Layout locked — snapshot is now immutable.');
    } catch (e) {
      SS.toast(e.message || String(e), 'error');
    }
  }

  function updateLockChip() {
    var el = util.byId('app-lock');
    if (!el) return;
    util.clear(el);
    var lay = state.layout;
    if (lay && lay.status === 'locked') {
      el.appendChild(util.el('span', { class: 'chip locked', text: '\u1f512 locked' }));
    } else if (state.active.layoutId) {
      el.appendChild(util.el('span', { class: 'chip draft', text: 'draft' }));
    } else {
      el.appendChild(util.el('span', { class: 'chip draft', text: 'no layout' }));
    }
  }

  async function refreshLayouts() {
    try {
      state.layouts = await API.listLayouts();
      var c = util.byId('layouts-count');
      if (c) c.textContent = String(state.layouts.length);
      bus.emit('layouts:list', state.layouts);
    } catch (e) { /* list may 404 pre-backend; ignore */ }
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */
  async function boot() {
    initSargel();
    initCollapse();
    initDrawer();
    initPhoneTabs();
    initKeyboard();

    util.byId('btn-compute').addEventListener('click', computeLayout);
    util.byId('btn-lock').addEventListener('click', lockLayout);

    bindSelect('source-select', 'sourceId');
    bindSelect('profile-select', 'profileId');
    bindSelect('geometry-select', 'geometryId');

    // Keep the header lock chip in sync whenever a layout is loaded/opened/adopted.
    bus.on('layout:loaded', function () { updateLockChip(); });

    try {
      await Promise.all([
        loadList('sources', API.listSources),
        loadList('profiles', API.listProfiles),
        loadList('geometries', API.listGeometries),
        loadList('patterns', API.listPatterns),
        loadList('layouts', API.listLayouts)
      ]);
      state.ready = true;
      refreshSelects();
      ensureFullProfile(state.active.profileId);
      // F-33: (re)cache the full active profile whenever selection changes, whether
      // via the app-bar select or after a save in the calibration panel.
      bus.on('profileId:changed', function () { ensureFullProfile(state.active.profileId); });
      updateLockChip();
      var c = util.byId('layouts-count');
      if (c) c.textContent = String(state.layouts.length);
      setStatus('ready');
    } catch (e) {
      setStatus('offline — server unreachable');
      console.error('boot lists failed', e);
    }

    ['calibration', 'geometry', 'tikkun', 'shemos', 'passages', 'validation',
     'layouts', 'progress', 'diff', 'stretch', 'search', 'compare', 'export', 'firstRun']
      .forEach(function (name) {
        try {
          if (SS[name] && typeof SS[name].init === 'function') SS[name].init(ctx);
        } catch (e) { console.error('[init][' + name + ']', e); }
      });

    try { await API.session(); } catch (e) { /* no server yet */ }

    bus.emit('app:ready');
    bus.emit('selection:changed');
    bus.emit('layouts:list', state.layouts);
  }

  async function loadList(key, fn) {
    try { state[key] = await fn(); }
    catch (e) { state[key] = []; }
  }

  SS.app = { boot: boot, compute: computeLayout };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
