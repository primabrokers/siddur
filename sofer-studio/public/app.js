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
    if (activeKey === 'profileId' && state.calibrationDraftDirty && !state.active.profileId) {
      sel.appendChild(util.el('option', { value: '', text: 'New kulmus — save first' }));
      (items || []).forEach(function (it) { sel.appendChild(util.el('option', { value: it.id, text: it[labelField] || it.id })); });
      sel.value = '';
      return;
    }
    if (!items || items.length === 0) {
      state.active[activeKey] = null;
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
      // A deliberately saved Classic/Tikkun profile is the measured baseline
      // for a new reference layout.  Prefer it only when the user has not
      // already selected a profile; an explicit selection always wins.
      var fallback = items[0];
      if (activeKey === 'profileId') {
        var classic = items.find(function (it) {
          var name = String(it && it[labelField] || '').trim().toLowerCase();
          return /^(classic|classic sefer torah|classic tikkun|tikkun classic)$/.test(name);
        }) || items.find(function (it) {
          var name = String(it && it[labelField] || '').toLowerCase();
          return name.indexOf('classic') !== -1 && name.indexOf('editable copy') === -1;
        });
        if (classic) fallback = classic;
      }
      state.active[activeKey] = fallback.id;
      sel.value = fallback.id;
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

  function showCalibration() {
    if (window.matchMedia && window.matchMedia('(max-width: 1023px)').matches) activatePhonePanel('measure');
    jumpToPanel('calibration');
    var input = util.byId('cal-name');
    if (input) input.focus();
  }

  function initProfileStart() {
    var bench = util.byId('workbench');
    if (!bench || util.byId('profile-start')) return;
    var start = util.el('button', { id: 'btn-new-profile', type: 'button', class: 'btn btn-primary', text: 'Create a new kulmus' });
    start.addEventListener('click', function () {
      if (SS.calibration && SS.calibration.startNew()) showCalibration();
    });
    var starter = util.el('button', {id:'btn-starter-layout',type:'button',class:'btn btn-ghost',text:'New 42-line measurement draft'});
    starter.addEventListener('click', async function () {
      if (state.calibrationDraftDirty && !window.confirm('Leave your unsaved kulmus draft and select a new editable starter?')) return;
      starter.disabled = true;
      try {
        // Create new entities; never overwrite an existing measured profile/layout.
        var profile = await API.createProfile({name:'STaM Ashkenaz — starter measurements (draft)',letter_height_units:2,letter_height_mm:4.5,stroke_mm:0,min_nib_mm:0,unit_mm:.5,units_per_row:62,unit_basis:'line_units',layout_mode:'reflow'});
        var geometry = await API.createGeometry(SS.geometry.starter());
        state.profiles = await API.listProfiles(); state.geometries = await API.listGeometries();
        state.calibrationDraftDirty = false;
        state.active.profileId = profile.id; state.active.geometryId = geometry.id;
        if (SS.calibration.selectSaved) SS.calibration.selectSaved();
        refreshSelects(); bus.emit('profileId:changed'); bus.emit('geometryId:changed');
        SS.toast('Measurement draft selected — not the Simanim reference. Review measurements before computing a custom layout.');
      } catch(e) { SS.toast(e.message || String(e),'error'); }
      finally { starter.disabled = false; }
    });
    var guide = util.el('div', { id: 'profile-start', class: 'profile-start' }, [start,starter,
      util.el('span', { text: '1. Create and save your measured kulmus  →  2. Load a book  →  3. Choose klaf and compute  →  4. Review, then Print / Save PDF' })]);
    bench.parentNode.insertBefore(guide, bench);
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
        if (SS.workspace) return;
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
    if (SS.workspace) { SS.workspace.open('review', 'progress'); return; }
    var bench = util.byId('lower-bench');
    if (!bench) return;
    bench.classList.toggle('is-collapsed');
  }

  function activateDrawer(name) {
    if (SS.workspace) {
      SS.workspace.open(name === 'layouts' ? 'setup' : 'review', name);
      bus.emit('drawer:activated', name);
      return;
    }
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
    if (SS.workspace) { SS.workspace.panel(name); return; }
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
      if (head) { head.setAttribute('aria-expanded', 'true'); head.focus(); }
    }
    if (name === 'search') focusSearch();
  }

  function focusSearch() {
    if (SS.workspace) SS.workspace.open('setup', 'book');
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
    if (SS.calibration && SS.calibration.isDirty && SS.calibration.isDirty()) {
      SS.toast('Save your new or edited kulmus before computing.', 'error');
      showCalibration();
      return;
    }
    var src = activeSource();
    var prof = activeProfile();
    var geom = activeGeometry();
    if (!prof) { SS.toast('Create and save a kulmus first.', 'error'); showCalibration(); return; }
    if (!src) { SS.toast('Import a Torah text first.', 'error'); return; }
    if (!geom) { SS.toast('Select or create a klaf.', 'error'); return; }

    var btn = util.byId('btn-compute');
    if (btn) { btn.disabled = true; btn.textContent = 'Computing…'; }
    setStatus('computing layout…');
    var usePoll = !!(src.letter_count && src.letter_count > LARGE_CORPUS_LETTERS);
    try {
      if (SS.geometry?.forCompute) geom = await SS.geometry.forCompute();
      var patternIds = (state.active.patternIds || []);
      var annotations = (state.active.annotations || {});
      var body = {
        source_id: src.id,
        profile_id: prof.id,
        geometry_id: geom.id,
        pattern_ids: patternIds,
        annotations: annotations,
        rendering: SS.documentFont?.get()
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
      if (SS.workspace) SS.workspace.open('layout');
      else activateDrawer('progress');
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
      el.appendChild(util.el('span', { class: 'chip locked', text: 'Locked' }));
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
    bus.on('sources:updated', refreshSelects);
    bus.on('profiles:list', refreshSelects);
    bus.on('profileId:changed', refreshSelects);
    bus.on('geometryId:changed', refreshSelects);
    bus.on('calibration:draft-changed', refreshSelects);

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

    initProfileStart();
    initWorkspace();
    try { await API.session(); } catch (e) { /* no server yet */ }

    bus.emit('app:ready');
    bus.emit('selection:changed');
    bus.emit('layouts:list', state.layouts);
  }

  async function loadList(key, fn) {
    try { state[key] = await fn(); }
    catch (e) { state[key] = []; }
  }

  // Reuse the existing modules and their DOM nodes: switching workspace never
  // reconstructs a form, discards an edit, or changes the persisted layout.
  // Kept in app.js so existing, session-serving HTML can adopt the new UI without
  // restarting a demo process or replacing any user's in-memory database.
  function initWorkspace() {
    var app = util.byId('app');
    if (!app || SS.workspace) return;
    document.body.classList.add('sofer-workspace');
    var current = 'setup', views = {}, tabs = {}, sections = {}, sectionTabs = {};
    var selected = { setup: 'book', review: 'stretch' };
    var nav = util.el('nav', { id: 'workspace-tabs', role: 'tablist', 'aria-label': 'Sofer workspace' });
    var main = util.el('main', { id: 'workspace-main' });
    var labels = { setup: 'Setup', layout: 'Layout', review: 'Review', download: 'Download' };
    Object.keys(labels).forEach(function (name, index) {
      var tab = util.el('button', { id: 'tab-' + name, type: 'button', role: 'tab', 'aria-controls': 'view-' + name }, [
        util.el('span', { class: 'step-number', text: String(index + 1) }), util.el('span', { text: labels[name] })]);
      tab.addEventListener('click', function () { open(name); });
      nav.appendChild(tab); tabs[name] = tab;
      views[name] = util.el('section', { id: 'view-' + name, class: 'workspace-view', role: 'tabpanel', 'aria-labelledby': tab.id, tabindex: '0' });
      main.appendChild(views[name]);
    });
    util.byId('appbar').after(nav);
    app.appendChild(main);

    function move(node, to) { if (typeof node === 'string') node = util.byId(node); if (node) to.appendChild(node); }
    function heading(view, title, detail) {
      var head = util.el('div', { class: 'workspace-heading' }, [util.el('div', {}, [
        util.el('h1', { text: title }), util.el('p', { text: detail })])]);
      view.appendChild(head); return head;
    }
    function group(viewName, entries) {
      var bar = util.el('nav', { class: 'workspace-subnav', role: 'tablist', 'aria-label': labels[viewName] + ' tools' });
      sections[viewName] = {}; sectionTabs[viewName] = {};
      if (viewName !== 'setup') views[viewName].appendChild(bar);
      entries.forEach(function (entry) {
        var key = entry[0], id = viewName + '-' + key;
        var button = util.el('button', { id: 'tool-' + id, type: 'button', role: 'tab', 'aria-controls': 'section-' + id, text: entry[1] });
        button.addEventListener('click', function () { open(viewName, key); });
        var section = util.el('section', { id: 'section-' + id, class: 'workspace-section', role: 'tabpanel', 'aria-labelledby': button.id });
        if (viewName === 'setup') {
          section.removeAttribute('role'); section.removeAttribute('aria-labelledby');
          section.setAttribute('aria-label', entry[1]);
          if (key === 'layouts' || key === 'font') { button.removeAttribute('role'); button.className = 'btn btn-ghost btn-sm'; selectors.appendChild(button); }
        } else bar.appendChild(button);
        views[viewName].appendChild(section);
        sections[viewName][key] = section; sectionTabs[viewName][key] = button;
      });
      keyboardTabs(bar);
    }
    function keyboardTabs(bar) {
      bar.addEventListener('keydown', function (ev) {
        var items = Array.from(bar.querySelectorAll('[role="tab"]'));
        var index = items.indexOf(ev.target), next = index;
        if (index < 0) return;
        if (ev.key === 'ArrowRight') next = (index + 1) % items.length;
        else if (ev.key === 'ArrowLeft') next = (index + items.length - 1) % items.length;
        else if (ev.key === 'Home') next = 0;
        else if (ev.key === 'End') next = items.length - 1;
        else return;
        ev.preventDefault(); ev.stopPropagation(); items[next].click(); items[next].focus();
      });
    }
    heading(views.setup, 'Setup', 'Choose a text, kulmus, klaf or font to open its settings.');
    var selectors = util.el('div', { class: 'workspace-selectors' });
    ['source-select', 'profile-select', 'geometry-select'].forEach(function (id) {
      var select = util.byId(id); if (select) {
        move(select.closest('label'), selectors);
        var key = { 'source-select': 'book', 'profile-select': 'calibration', 'geometry-select': 'geometry' }[id];
        select.addEventListener('pointerdown', function () { open('setup', key); });
        select.addEventListener('focus', function () { open('setup', key); });
        select.addEventListener('change', function () { open('setup', key); });
      }
    });
    move('btn-compute', selectors); views.setup.appendChild(selectors);
    group('setup', [['book', 'Book & text'], ['calibration', 'Measurements'], ['geometry', 'Column settings'], ['font', 'Font & overlap'], ['layouts', 'Saved layouts']]);
    move(util.qs('.reference-start'), sections.setup.book);
    var searchField = util.byId('search-input');
    if (searchField) move(searchField.closest('.app-field'), sections.setup.book);
    move('panel-search', sections.setup.book);
    move('profile-start', sections.setup.calibration);
    move('panel-calibration', sections.setup.calibration);
    move('panel-geometry', sections.setup.geometry);
    move('layouts-body', sections.setup.layouts);
    var mainMeasurements = util.el('div', { class: 'setup-main-measurements' });
    ['cal-font', 'cal-letter-overlap'].forEach(function (id) { var control = util.byId(id); if (control) move(control.closest('label'), mainMeasurements); });
    var rowUnits = util.byId('cal-units-per-row');
    if (rowUnits) move(rowUnits.closest('label'), util.byId('geom-line-measurements') || mainMeasurements);
    sections.setup.font.appendChild(util.el('h2', { text: 'Font & overlap' }));
    sections.setup.font.appendChild(mainMeasurements);
    sections.setup.font.appendChild(util.el('p', { class: 'profile-help', text: 'These settings are saved with each computed layout. You can change them independently of the Kulmus.' }));
    var summary = util.el('dialog', { id: 'setup-summary', class: 'document-summary', 'aria-label': 'Document summary' });
    var summaryTitle = util.el('h2', { text: 'Summary' }), summaryClose = util.el('button', { type: 'button', class: 'btn btn-ghost', text: 'Close' });
    var setupValues = util.el('div'), layoutValues = util.el('div');
    move(util.qs('.big-klaf'), setupValues); move('geom-derived', setupValues);
    [summaryTitle, layoutValues, setupValues, summaryClose].forEach(function (node) { summary.appendChild(node); });
    app.appendChild(summary);
    summaryClose.addEventListener('click', function () { summary.close(); });
    function summaryButton(fromLayout) {
      var button = util.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Summary', id: fromLayout ? 'layout-summary-button' : 'setup-summary-button' });
      button.addEventListener('click', function () {
        var lay = fromLayout && state.layout, g = lay?.snapshot?.geometry || SS.geometry?.getDraft() || {};
        var p = lay?.snapshot?.profile || SS.calibration?.getDraft() || {}, r = lay ? (p.document_rendering || p.stretch_policy?.rendering) : SS.documentFont?.get();
        summaryTitle.textContent = lay ? (lay.name || 'Layout summary') : 'Setup summary';
        setupValues.hidden = !!lay; util.clear(layoutValues);
        var values = [['Kulmus', p.name], ['Klaf', g.name], ['Font', r?.font === 'asirit' ? 'Asirit' : 'STaM Ashkenaz'],
          ['Letter overlap', r?.overlap_percent?.[r.font] != null ? util.fmt(r.overlap_percent[r.font], 2) + '%' : 'Legacy letter height']];
        if (lay) values = values.concat([['Columns', lay.summary?.total_amudim], ['Lines', lay.summary?.total_lines || lay.lines?.length],
          ['Yerios', lay.summary?.total_yerios], ['Klaf length', util.fmt(lay.summary?.klaf_length_m, 2) + ' m'],
          ['Lines per amud', g.lines_per_amud], ['Line height', util.mm(g.baseline_pitch_mm)], ['Base column width', util.mm(g.line_width_mm)],
          ['Column height', util.mm(g.lines_per_amud * g.baseline_pitch_mm)], ['Top margin', util.mm(g.top_margin_mm)], ['Bottom margin', util.mm(g.bottom_margin_mm)]]);
        values.forEach(function (pair) { layoutValues.appendChild(util.el('p', {}, [util.el('strong', { text: pair[0] + ': ' }), util.el('span', { text: pair[1] ?? '—' })])); });
        summary.showModal();
      }); return button;
    }
    selectors.appendChild(summaryButton(false));

    // The document and a single optional inspector are the only Layout content.
    var layoutBar = util.el('div', { class: 'workspace-document-label' }, [
      util.el('strong', { text: 'Your Tikkun' }), util.el('span', { id: 'workspace-layout-summary', text: 'Load a book in Setup to begin.' }),
      util.el('span', { class: 'workspace-line-hint', text: 'Click a line to edit its stretching' })]);
    views.layout.appendChild(layoutBar);
    layoutBar.appendChild(summaryButton(true));
    var savedLayouts = util.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Saved layouts' });
    savedLayouts.addEventListener('click', function () { open('setup', 'layouts'); }); layoutBar.appendChild(savedLayouts);
    var documentGrid = util.el('div', { id: 'document-workspace' }); views.layout.appendChild(documentGrid);
    move('tikkun-region', documentGrid);
    var inspector = util.el('aside', { id: 'line-editor', 'aria-label': 'Line editor', hidden: true });
    var close = util.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Close', 'aria-label': 'Close line editor' });
    inspector.appendChild(util.el('div', { class: 'line-editor-head' }, [util.el('strong', { text: 'Line editor' }), close]));
    move('stretch-inspector', inspector); documentGrid.appendChild(inspector);
    close.addEventListener('click', function () { if (SS.stretch && SS.stretch.close) SS.stretch.close(); inspector.hidden = true; focusTikkun(); });
    bus.on('line:selected', function (payload) { if (payload && payload.raw) { open('layout'); inspector.hidden = false; } });
    bus.on('layout:loaded', function () { inspector.hidden = true; updateSummary(); });
    bus.on('layout:locked', updateSummary);
    ['jump:line', 'jump:amud', 'flash:shem'].forEach(function (event) { bus.on(event, function () { open('layout'); }); });

    var reviewHead = heading(views.review, 'Review before writing', 'Check the whole book, then individual lines. Suggestions still need your sofer’s approval.');
    move('btn-lock', reviewHead);
    group('review', [['stretch', 'Whole-book stretching'], ['validation', 'Checks'], ['shemos', 'Protected names'], ['passages', 'Special passages'], ['progress', 'Progress'], ['compare', 'Compare'], ['diff', 'Changes']]);
    move(util.qs('.stretch-book'), sections.review.stretch);
    var stretchDetails = util.qs('.stretch-book'); if (stretchDetails) stretchDetails.open = true;
    ['validation', 'shemos', 'passages'].forEach(function (name) { move('panel-' + name, sections.review[name]); });
    ['progress', 'compare', 'diff'].forEach(function (name) { move(name + '-body', sections.review[name]); });
    move('panel-compare-mini', sections.review.compare);

    heading(views.download, 'Take your Tikkun with you', 'Print or save all pages as a PDF. Screen zoom never changes the measurements in your export.');
    var downloadCard = util.el('div', { class: 'workspace-download-card' });
    downloadCard.appendChild(util.el('h2', { text: 'Full document PDF' }));
    downloadCard.appendChild(util.el('p', { id: 'download-summary', role: 'status', text: 'Open or compute a layout first.' }));
    move('export-controls', downloadCard); views.download.appendChild(downloadCard);
    views.download.appendChild(util.el('p', { class: 'workspace-note', text: 'Review protected names, special passages and letter shapes before writing. Layout planning does not replace hagahah.' }));
    var reportLink = util.el('button', { class: 'btn btn-ghost', text: 'View / download stretch report' });
    reportLink.addEventListener('click', function () { open('review', 'stretch'); }); views.download.appendChild(reportLink);

    app.appendChild(util.el('footer', { class: 'workspace-copyright', text: 'Copyright Yehuda Weisz — no one has rights to use this or copy without paying.' }));
    // Old panels are retained, but no longer expandable competing columns.
    util.qsa('.panel', main).forEach(function (panel) {
      panel.classList.remove('is-collapsed');
      var head = util.qs('.panel-head', panel);
      if (head) { head.removeAttribute('tabindex'); head.removeAttribute('role'); head.removeAttribute('aria-expanded'); }
    });
    ['workbench', 'lower-bench', 'phone-tabs', 'sargel'].forEach(function (id) { var el = util.byId(id); if (el) el.hidden = true; });
    keyboardTabs(nav);
    function updateSummary() {
      var lay = state.layout, lines = lay && lay.lines || [];
      var count = lay && lay.summary && lay.summary.total_amudim;
      if (!count && lines.length) count = new Set(lines.map(function (line) { return line.amud || line.amud_index || 1; })).size;
      var text = lay ? (count || 0) + ' columns · ' + lines.length + ' lines · ' + (lay.status === 'locked' ? 'Locked' : 'Draft') : 'Load a book in Setup to begin.';
      util.byId('workspace-layout-summary').textContent = text;
      util.byId('download-summary').textContent = lay ? text + (lay.summary && lay.summary.study_preview ? ' · Export blocked: unverified study preview.' : ' · PDF includes every column.') : 'Open or compute a layout first.';
    }
    function open(name, section) {
      if (!views[name]) return;
      if (name !== 'layout' && SS.tikkun && SS.tikkun.setExpanded) SS.tikkun.setExpanded(false);
      current = name;
      Object.keys(views).forEach(function (key) {
        views[key].hidden = key !== name; tabs[key].setAttribute('aria-selected', String(key === name)); tabs[key].tabIndex = key === name ? 0 : -1;
      });
      if (section && sections[name] && sections[name][section]) selected[name] = section;
      Object.keys(sections).forEach(function (view) {
        Object.keys(sections[view]).forEach(function (key) {
          var active = key === selected[view]; sections[view][key].hidden = !active;
          if (view === 'setup') { sectionTabs[view][key].setAttribute('aria-expanded', String(active)); sectionTabs[view][key].tabIndex = 0; }
          else { sectionTabs[view][key].setAttribute('aria-selected', String(active)); sectionTabs[view][key].tabIndex = active ? 0 : -1; }
        });
      });
      // The existing preview observes its box; notify also covers older browsers.
      window.dispatchEvent(new Event('resize'));
    }
    SS.workspace = {
      open: open, current: function () { return current; },
      panel: function (name) {
        if (name === 'tikkun') open('layout');
        else if (name === 'search') { open('setup', 'book'); focusSearch(); }
        else if (sections.setup[name]) open('setup', name);
        else open('review', name === 'compare-mini' ? 'compare' : name);
      }
    };
    updateSummary(); open('setup');
  }

  SS.app = { boot: boot, compute: computeLayout, reloadLayout: async function(id) {
    var layout = await fetchLayoutPaginated(id,500);
    if(state.active.layoutId !== id) return;
    state.layout=layout; bus.emit('layout:loaded',layout); updateLockChip();
  } };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
