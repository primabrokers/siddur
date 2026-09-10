/*
 * Sofer Studio — geometry.js
 * Column geometry editor: lines per amud (42/48/60/custom), margins, gaps,
 * amudim-per-yeria (configurable), derived results, min-column-width guard,
 * and klaf length in metres (displayed per the frozen correction:
 * klaf_length_m = sum of sheet WIDTHS / 1000 — NOT height × count).
 */
(function () {
  'use strict';
  var SS = window.SS;
  var util = SS.util;
  var bus = SS.bus;
  var state = SS.state;
  var API;

  var root = null;      // #geometry-body
  var derivedEl = null; // derived results block
  var guardEl = null;   // min-width guard line
  var bigKlafEl = null; // big klaf number
  var layoutSummary = null;
  var lwInUnits = true; // Real physical line budget, displayed in calibrated sofer units.

  function currentUnitMm() {
    var p = SS.calibration && SS.calibration.getDraft ? SS.calibration.getDraft() : SS.activeProfile ? SS.activeProfile() : null;
    if (p && p.units_per_row != null && Number(p.units_per_row) > 0 && draft && Number(draft.line_width_mm) > 0) {
      return Number(draft.line_width_mm) / Number(p.units_per_row);
    }
    return (p && p.unit_mm != null && Number(p.unit_mm) > 0) ? Number(p.unit_mm) : 0.5;
  }

  var FIELDS = [
    ['baseline_pitch_mm', 'Sirtut pitch (rovach)', 0.1],
    ['top_margin_mm', 'Top margin', 0.1],
    ['bottom_margin_mm', 'Bottom margin', 0.1],
    ['inter_column_gap_mm', 'Column gap', 0.1],
    ['outer_margin_mm', 'Outer margin', 0.1],
    ['line_width_mm', 'Line (column) width', 0.1]
  ];

  function init(ctx) {
    API = ctx.api;
    root = util.byId('geometry-body');
    if (!root) return;

    buildStatic();
    bindEvents();
    loadDraftFromActive();

    bus.on('geometryId:changed', loadDraftFromActive);
    bus.on('selection:changed', function () { renderDerived(); });
    bus.on('app:ready', function () { if (!draft) loadDraftFromActive(); });
    bus.on('layout:loaded', function (layout) {
      layoutSummary = (layout && layout.summary) || null;
      renderDerived();
      renderTotals();
    });
    bus.on('profileId:changed', function () { syncLineWidthDisplay(); renderDerived(); });
    bus.on('calibration:dirty', function () { syncLineWidthDisplay(); renderDerived(); });
  }

  var draft = null;

  function defaultDraft() {
    return {
      _isDefault: true, id: null, name: 'Ashkenaz 42-line measurement draft (not Simanim)',
      lines_per_amud: 42, baseline_pitch_mm: 8.0, top_margin_mm: 30, bottom_margin_mm: 30,
      inter_column_gap_mm: 20, outer_margin_mm: 35, line_width_mm: 180,
      max_letters_per_line: 0, amudim_per_yeria: 2, partial_final_yeria: 'round_up',
      setuma_gap_mm: null, setuma_reference_letter: 'א',
      min_inter_letter_gap_mm: 0, min_inter_word_gap_mm: 1.0, max_inter_word_gap_mm: null,
      max_inter_word_gap_factor: null, small_letter_reference: 'י', vavei_haamudim: true
    };
  }

  function normalizeGeometry(g) {
    return {
      _isDefault: false, id: g.id, name: g.name || 'Geometry',
      lines_per_amud: toInt(g.lines_per_amud, 42),
      baseline_pitch_mm: toNum(g.baseline_pitch_mm, 8.0),
      top_margin_mm: toNum(g.top_margin_mm, 30),
      bottom_margin_mm: toNum(g.bottom_margin_mm, 30),
      inter_column_gap_mm: toNum(g.inter_column_gap_mm, 20),
      outer_margin_mm: toNum(g.outer_margin_mm, 35),
      line_width_mm: toNum(g.line_width_mm, 130),
      max_letters_per_line: toInt(g.max_letters_per_line, 32),
      amudim_per_yeria: Math.max(1, toInt(g.amudim_per_yeria, 2)),
      partial_final_yeria: g.partial_final_yeria === 'exact' ? 'exact' : 'round_up',
      setuma_gap_mm: (g.setuma_gap_mm != null) ? toNum(g.setuma_gap_mm, null) : null,
      setuma_reference_letter: g.setuma_reference_letter || 'א',
      min_inter_letter_gap_mm: toNum(g.min_inter_letter_gap_mm, 0),
      min_inter_word_gap_mm: toNum(g.min_inter_word_gap_mm, 1.0),
      max_inter_word_gap_mm: (g.max_inter_word_gap_mm != null) ? toNum(g.max_inter_word_gap_mm, null) : null,
      max_inter_word_gap_factor: (g.max_inter_word_gap_factor != null) ? toNum(g.max_inter_word_gap_factor, null) : null,
      small_letter_reference: g.small_letter_reference || 'י',
      vavei_haamudim: g.vavei_haamudim !== false
    };
  }
  function toNum(v, d) { return (v === null || v === undefined || v === '') ? d : Number(v); }
  function toInt(v, d) { var n = Math.round(toNum(v, d)); return isFinite(n) ? n : d; }

  function activeGeometry() { return SS.activeGeometry ? SS.activeGeometry() : null; }

  function loadDraftFromActive() {
    var g = activeGeometry();
    draft = g ? normalizeGeometry(g) : defaultDraft();
    renderFromDraft();
  }

  /* ------------------------------------------------------------------ *
   * Static UI
   * ------------------------------------------------------------------ */
  function buildStatic() {
    // name + save
    var crud = util.el('div', { class: 'grid-crud' });
    crud.appendChild(util.el('label', { class: 'field', style: 'flex:1' },
      [util.el('span', { text: 'Geometry name' }),
       util.el('input', { type: 'text', id: 'geom-name', placeholder: 'Geometry name' })]));
    var bSave = util.el('button', { class: 'btn btn-primary btn-sm', text: 'Save as new' });
    var bNew = util.el('button', { class: 'btn btn-ghost btn-sm', text: 'New' });
    bSave.addEventListener('click', saveGeometry);
    bNew.addEventListener('click', function () { draft = defaultDraft(); renderFromDraft(); });
    var row = util.el('div', { class: 'btn-row' }, [bSave, bNew]);
    crud.appendChild(row);
    root.appendChild(crud);
    root.appendChild(util.el('p', {class:'profile-help',text:'This is a custom measurement draft, not the verified Simanim Layout 1. Computing it reflows text. Save a copy and adjust measurements with your sofer; do not use it as an exact printed tikkun reference.'}));
    root.appendChild(util.el('div', { class: 'sirtut' }));

    // lines per amud selector
    var linesWrap = util.el('div', { class: 'lines-selector' });
    linesWrap.appendChild(util.el('span', { class: 'field-label', text: 'Lines per amud' }));
    var seg = util.el('div', { class: 'seg', id: 'geom-lines-seg' });
    [['42', '42'], ['48', '48'], ['60', '60'], ['custom', 'custom']].forEach(function (pair) {
      var b = util.el('button', { type: 'button', 'data-lines': pair[0], text: pair[1] });
      b.addEventListener('click', function () { setLinesPerAmud(pair[0]); });
      seg.appendChild(b);
    });
    linesWrap.appendChild(seg);
    var customInput = util.el('div', { class: 'mm-input', id: 'geom-lines-custom', hidden: true },
      [util.el('input', { type: 'number', min: '1', step: '1', id: 'geom-lines-custom-input', placeholder: 'lines' }),
       util.el('span', { class: 'unit', text: 'lines' })]);
    linesWrap.appendChild(customInput);
    root.appendChild(linesWrap);

    // mm input grid
    var grid = util.el('div', { class: 'geom-grid', id: 'geom-inputs' });
    FIELDS.forEach(function (f) {
      grid.appendChild(mmField(f[1], f[0], f[2]));
    });
    grid.appendChild(util.el('p', {class:'profile-help full',text:'Maximum units per line is the measured line-width budget, not a count of letters. 1 unit uses your profile’s Unit size; letter widths, stroke, spaces and stretch all count towards the line width.'}));
    grid.appendChild(intField('Amudim per yeria', 'amudim_per_yeria'));
    var pfy = util.el('label', { class: 'field full' },
      [util.el('span', { text: 'Partial final yeria' }),
       util.el('select', { id: 'geom-pfy' },
         [util.el('option', { value: 'round_up', text: 'Round up (full sheet)' }),
          util.el('option', { value: 'exact', text: 'Exact (narrow final sheet)' })])]);
    grid.appendChild(pfy);
    root.appendChild(grid);

    // F-34: units/mm toggle on the line-width field, synced via profile unit_mm.
    // The [data-field] selector resolves to the <input>, so step to its parent
    // (.mm-input wrapper) to place the units/mm toggle and find the suffix span.
    var lwInput = util.qs('[data-field="line_width_mm"]', root);
    var lwField = lwInput ? lwInput.parentNode : null;
    if (lwField) {
      lwField.parentNode.firstChild.textContent = 'Maximum units per line';
      var lwUnitSpan = util.qs('.unit', lwField);
      lwUnitSpan.textContent = 'units';
      var lwToggle = util.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'geom-lw-unit-toggle', text: lwInUnits ? 'units' : 'mm', title: 'Toggle line width between mm and sofer units' });
      lwToggle.addEventListener('click', function () {
        lwInUnits = !lwInUnits;
        lwToggle.textContent = lwInUnits ? 'units' : 'mm';
        lwUnitSpan.textContent = lwInUnits ? 'units' : 'mm';
        lwField.parentNode.firstChild.textContent = lwInUnits ? 'Maximum units per line' : 'Maximum line width (mm)';
        syncLineWidthDisplay();
      });
      lwField.appendChild(lwToggle);
    }

    // F-19: setuma gap + inter-letter/inter-word spacing limits, previously unreachable.
    root.appendChild(util.el('div', { class: 'sirtut' }));
    root.appendChild(util.el('div', { class: 'field-label', text: 'Setuma + spacing limits' }));
    var spGrid = util.el('div', { class: 'geom-grid' });
    // Pesucha/setuma widths now live with the 27 letters in Measurements.
    spGrid.appendChild(mmField('Min inter-word gap', 'min_inter_word_gap_mm', 0.1));
    spGrid.appendChild(mmField('Max inter-word gap (blank = auto)', 'max_inter_word_gap_mm', 0.1));
    // N-04: the max inter-word gap factor scales the calibrated small-letter width
    // (0 < factor < 1) and is now persistable + editable.
    spGrid.appendChild(util.el('label', { class: 'field' },
      [util.el('span', { text: 'Max inter-word gap factor (× small letter)' }),
       util.el('div', { class: 'mm-input' },
         [util.el('input', { type: 'number', min: '0.01', max: '0.99', step: '0.01', 'data-field': 'max_inter_word_gap_factor' }),
          util.el('span', { class: 'unit', text: '×' })])]));
    // F-19 residual: expose small_letter_reference + vavei_haamudim (both halachic).
    spGrid.appendChild(textField('Small letter reference (max gap base)', 'small_letter_reference'));
    spGrid.appendChild(util.el('label', { class: 'toggle' },
      [util.el('input', { type: 'checkbox', id: 'geom-vavei_haamudim' }),
       util.el('span', { text: "Vavei ha'amudim (column-initial vavs)" })]));
    spGrid.appendChild(textField('Setuma reference letter', 'setuma_reference_letter'));
    root.appendChild(spGrid);

    // min-width guard (live)
    guardEl = util.el('div', { class: 'guard', id: 'geom-guard' });
    root.appendChild(guardEl);

    root.appendChild(util.el('div', { class: 'sirtut' }));

    // derived results
    bigKlafEl = util.el('div', { class: 'big-klaf', hidden: true },
      [util.el('div', { class: 'label', text: 'Total klaf length' }),
       util.el('div', { class: 'value', id: 'geom-klaf-value' })]);
    root.appendChild(bigKlafEl);

    derivedEl = util.el('div', { class: 'derived-stack', id: 'geom-derived' });
    root.appendChild(derivedEl);
  }

  function setLinesPerAmud(which) {
    if (which === 'custom') {
      util.byId('geom-lines-custom').hidden = false;
      var v = util.parseNum(util.byId('geom-lines-custom-input').value);
      if (!Number.isNaN(v) && v > 0) draft.lines_per_amud = Math.round(v);
      util.byId('geom-lines-custom-input').value = String(draft.lines_per_amud);
    } else {
      draft.lines_per_amud = parseInt(which, 10);
      util.byId('geom-lines-custom').hidden = true;
    }
    updateLinesSegUI();
    renderDerived();
    renderTotals();
  }

  function updateLinesSegUI() {
    var L = draft.lines_per_amud;
    var isPreset = (L === 42 || L === 48 || L === 60);
    util.qsa('#geom-lines-seg button').forEach(function (b) {
      var d = b.getAttribute('data-lines');
      var active = (d === 'custom') ? !isPreset : (parseInt(d, 10) === L);
      b.setAttribute('aria-pressed', String(active));
      if (d === 'custom' && active) util.byId('geom-lines-custom').hidden = false;
    });
    if (isPreset) util.byId('geom-lines-custom').hidden = true;
  }

  function mmField(label, path, step) {
    var input = util.el('input', { type: 'number', step: String(step), 'data-field': path });
    var f = util.el('label', { class: 'field' },
      [util.el('span', { text: label }),
       util.el('div', { class: 'mm-input' }, [input, util.el('span', { class: 'unit', text: 'mm' })])]);
    f._input = input;
    return f;
  }

  function syncLineWidthDisplay() {
    var el = util.qs('[data-field="line_width_mm"]', root);
    if (!el || !draft) return;
    var profile = SS.calibration && SS.calibration.getDraft ? SS.calibration.getDraft() : SS.activeProfile ? SS.activeProfile() : null;
    var columnMode = !!(profile && profile.units_per_row != null);
    if (columnMode) lwInUnits = false;
    var toggle = util.byId('geom-lw-unit-toggle');
    if (toggle) { toggle.disabled = columnMode; toggle.textContent = lwInUnits ? 'units' : 'mm'; }
    util.qs('.unit', el.parentNode).textContent = lwInUnits ? 'units' : 'mm';
    el.closest('label').firstChild.textContent = columnMode ? 'Column width (mm)' : lwInUnits ? 'Maximum units per line' : 'Maximum line width (mm)';
    if (lwInUnits) el.value = util.fmt(draft.line_width_mm / currentUnitMm(), 3);
    else el.value = draft.line_width_mm;
  }
  function intField(label, path) {
    var input = util.el('input', { type: 'number', step: '1', min: '1', 'data-field': path });
    var f = util.el('label', { class: 'field' },
      [util.el('span', { text: label }), input]);
    f._input = input;
    return f;
  }
  function textField(label, path) {
    var input = util.el('input', { type: 'text', id: 'geom-' + path });
    var f = util.el('label', { class: 'field' },
      [util.el('span', { text: label }), input]);
    f._input = input;
    return f;
  }

  function bindEvents() {
    util.qsa('input[data-field]', root).forEach(function (el) {
      el.addEventListener('input', function () {
        var path = el.getAttribute('data-field');
        var v = util.parseNum(el.value);
        if (path === 'line_width_mm' && lwInUnits) v = v * currentUnitMm();
        if (path === 'max_inter_word_gap_factor') {
          draft[path] = (el.value === '' || Number.isNaN(v)) ? null : Math.min(0.99, Math.max(0.01, v));
        } else if (el.value === '') {
          draft[path] = (path === 'setuma_gap_mm' || path === 'max_inter_word_gap_mm') ? null : v;
        } else {
          draft[path] = (path === 'amudim_per_yeria') ? Math.max(1, Math.round(v)) : v;
        }
        renderDerived();
        renderTotals();
        bus.emit('geometry:draft-changed');
      });
    });
    util.byId('geom-setuma_reference_letter').addEventListener('input', function () {
      draft.setuma_reference_letter = util.byId('geom-setuma_reference_letter').value.trim() || '\u05d0';
      renderDerived();
    });
    util.byId('geom-small_letter_reference').addEventListener('input', function () {
      draft.small_letter_reference = util.byId('geom-small_letter_reference').value.trim() || '\u05d9';
      renderDerived();
    });
    util.byId('geom-vavei_haamudim').addEventListener('change', function () {
      draft.vavei_haamudim = util.byId('geom-vavei_haamudim').checked;
      renderDerived();
    });
    util.byId('geom-name').addEventListener('input', function () { draft.name = util.byId('geom-name').value; });
    util.byId('geom-pfy').addEventListener('change', function () { draft.partial_final_yeria = util.byId('geom-pfy').value; renderTotals(); });
    util.byId('geom-lines-custom-input').addEventListener('input', function () {
      var v = util.parseNum(util.byId('geom-lines-custom-input').value);
      if (!Number.isNaN(v) && v > 0) { draft.lines_per_amud = Math.round(v); renderDerived(); renderTotals(); }
    });
  }

  function renderFromDraft() {
    util.byId('geom-name').value = draft.name || '';
    FIELDS.forEach(function (f) {
      var el = util.qs('[data-field="' + f[0] + '"]', root);
      if (el) el.value = draft[f[0]];
    });
    util.byId('geom-pfy').value = draft.partial_final_yeria;
    var custom = util.qs('[data-field="max_letters_per_line"]', root);
    if (custom) custom.value = draft.max_letters_per_line;
    var k = util.qs('[data-field="amudim_per_yeria"]', root);
    if (k) k.value = draft.amudim_per_yeria;
    syncLineWidthDisplay();
    ['setuma_gap_mm', 'min_inter_letter_gap_mm', 'min_inter_word_gap_mm', 'max_inter_word_gap_mm', 'max_inter_word_gap_factor'].forEach(function (p) {
      var el = util.qs('[data-field="' + p + '"]', root);
      if (el) el.value = (draft[p] != null && !Number.isNaN(draft[p])) ? draft[p] : '';
    });
    util.byId('geom-setuma_reference_letter').value = draft.setuma_reference_letter || '\u05d0';
    util.byId('geom-small_letter_reference').value = draft.small_letter_reference || '\u05d9';
    util.byId('geom-vavei_haamudim').checked = !!draft.vavei_haamudim;
    updateLinesSegUI();
    util.byId('geom-lines-custom-input').value = String(draft.lines_per_amud);
    renderDerived();
    renderTotals();
    bus.emit('geometry:draft-changed');
  }

  /* ------------------------------------------------------------------ *
   * Width computation (matches engine: skeleton*scale + stroke once)
   * ------------------------------------------------------------------ */
  function profileLetterWidth(letter) {
    var prof = SS.calibration && SS.calibration.getDraft ? SS.calibration.getDraft() : SS.activeProfile ? SS.activeProfile() : null;
    if (!prof) return null;
    var units = (prof.letter_widths && prof.letter_widths[letter]);
    if (typeof units !== 'number' || !isFinite(units) || units <= 0) return null;
    var unitMm = (prof.unit_mm != null && isFinite(Number(prof.unit_mm))) ? Number(prof.unit_mm) : 0.5;
    var ref = prof.reference_height_mm || 3.0;
    var stroke = (prof.stroke_mm || 0) * Number(prof.stroke_factors && prof.stroke_factors[letter] != null ? prof.stroke_factors[letter] : 1);
    var lh = prof.letter_height_mm || 0;
    // engine: skeletonWidth = units * unit_mm * (height / reference); total = skeleton + stroke
    return units * unitMm * (lh / ref) + stroke;
  }
  function interLetterGap() {
    var prof = SS.calibration && SS.calibration.getDraft ? SS.calibration.getDraft() : SS.activeProfile ? SS.activeProfile() : null;
    return (prof && prof.gaps && prof.gaps.inter_letter) || 0;
  }
  function interWordGap() {
    var prof = SS.calibration && SS.calibration.getDraft ? SS.calibration.getDraft() : SS.activeProfile ? SS.activeProfile() : null;
    if (prof && prof.stretch_policy && prof.stretch_policy.version === 2) {
      return Number(prof.stretch_policy.special_widths_units.word_space) * (prof.unit_basis==='line_units' && prof.units_per_row>0 ? draft.line_width_mm/prof.units_per_row : Number(prof.unit_mm));
    }
    return (prof && prof.gaps && prof.gaps.inter_word) || 0;
  }
  function wordWidth(word) {
    // sum of letter widths + (len-1) inter-letter gaps; null if any letter width is missing
    var letters = util.graphemes(word).filter(function (g) { return util.isHebrew(g); });
    var sum = 0;
    var missing = false;
    letters.forEach(function (g) {
      var w = profileLetterWidth(g);
      if (w === null) { missing = true; return; }
      sum += w;
    });
    if (missing) return null;
    if (letters.length > 1) sum += (letters.length - 1) * interLetterGap();
    return sum;
  }
  var THREE_WORD = '\u05dc\u05de\u05e9\u05e4\u05d7\u05d5\u05ea\u05d9\u05db\u05dd'; // למשפחותיכם (engine THRESHOLD_WORD)

  function minColumnWidth() {
    var w = wordWidth(THREE_WORD);
    if (w === null) return null;
    return 3 * w + 2 * interWordGap();
  }

  /* ------------------------------------------------------------------ *
   * Derived results
   * ------------------------------------------------------------------ */
  function renderDerived() {
    if (!guardEl || !derivedEl) return;

    var prof = SS.activeProfile ? SS.activeProfile() : null;
    var L = draft.lines_per_amud;
    var P = draft.baseline_pitch_mm;
    var H = prof ? (prof.letter_height_mm || 0) : 0;
    var top = draft.top_margin_mm, bot = draft.bottom_margin_mm;

    var inkExtent = (L - 1) * P + H;
    var allocated = L * P;
    var trailing = allocated - inkExtent;
    var columnHeight = allocated;
    var amudHeight = columnHeight + top + bot;

    var overlap = (P < H);

    // guard
    var mw = minColumnWidth();
    var lw = draft.line_width_mm;
    if (mw === null) {
      // Never claim a pass from missing calibration data.
      guardEl.className = 'guard warn';
      util.clear(guardEl);
      guardEl.appendChild(util.el('span', {
        text: prof ? 'Incomplete calibration — cannot verify the three-word column minimum (missing letter widths).' : 'No calibration profile loaded — the three-word column minimum cannot be verified.'
      }));
    } else {
      var pass = lw >= mw;
      guardEl.className = 'guard ' + (pass ? 'pass' : 'fail');
      util.clear(guardEl);
      guardEl.appendChild(util.el('span', { text: '3 × ' }));
      var phrase = util.el('span', { class: 'gphrase', lang: 'he', text: THREE_WORD });
      guardEl.appendChild(phrase);
      guardEl.appendChild(util.el('span', { text: ' = ' + util.mm(mw) + ' \u2264 ' + util.mm(lw) + ' ' + (pass ? '\u2713' : '\u2717 (' + util.mm(mw - lw) + ' short)') }));
      guardEl.appendChild(util.el('br'));
      guardEl.appendChild(util.el('span', { class: 't--1 faint', text: pass ? 'Column width meets the three-word minimum.' : 'Below the three-word column minimum — widen the column or reduce letter height.' }));
    }

    // derived list
    util.clear(derivedEl);
    derivedItem(derivedEl, 'Lines per amud', String(L), L + ' lines');
    derivedItem(derivedEl, 'Ink extent', util.mm(inkExtent), '(' + L + '\u22121)\u00d7' + util.fmt(P) + ' + ' + util.fmt(H) + ' = ' + util.mm(inkExtent));
    derivedItem(derivedEl, 'Allocated ruling height', util.mm(allocated), L + '\u00d7' + util.fmt(P) + ' = ' + util.mm(allocated));
    derivedItem(derivedEl, 'Trailing margin', util.mm(trailing), util.fmt(P) + ' \u2212 ' + util.fmt(H) + ' = ' + util.mm(trailing));
    derivedItem(derivedEl, 'Column height', util.mm(columnHeight), L + '\u00d7' + util.fmt(P));
    derivedItem(derivedEl, 'Amud height', util.mm(amudHeight), util.fmt(columnHeight) + ' + ' + util.fmt(top) + ' + ' + util.fmt(bot));

    var k = draft.amudim_per_yeria;
    var fullYeria = fullYeriaWidth();
    derivedItem(derivedEl, 'Amudim per yeria', String(k), 'configurable');
    derivedItem(derivedEl, 'Full yeria width', util.mm(fullYeria),
      '2\u00d7' + util.fmt(draft.outer_margin_mm) + ' + ' + k + '\u00d7' + util.fmt(draft.line_width_mm) + ' + ' + (k - 1) + '\u00d7' + util.fmt(draft.inter_column_gap_mm));

    if (overlap) {
      var warn = util.el('div', { class: 'banner warn', text: 'Sirtut pitch (' + util.mm(P) + ') is less than letter height (' + util.mm(H) + ') — lines would overlap.' });
      derivedEl.prepend ? derivedEl.prepend(warn) : derivedEl.insertBefore(warn, derivedEl.firstChild);
    }
  }

  function fullYeriaWidth() {
    var k = draft.amudim_per_yeria;
    return 2 * draft.outer_margin_mm + k * draft.line_width_mm + (k - 1) * draft.inter_column_gap_mm;
  }

  function renderTotals() {
    if (!bigKlafEl) return;
    bigKlafEl.hidden = true;
    if (!layoutSummary) return;

    var totalAmudim = layoutSummary.total_amudim;
    var totalYerios = layoutSummary.total_yerios;
    var klafM = layoutSummary.klaf_length_m;

    bigKlafEl.hidden = false;
    var valEl = util.byId('geom-klaf-value');
    if (valEl) {
      valEl.textContent = (klafM != null && isFinite(klafM)) ? util.fmt(klafM, 2) : '\u2014';
      var unit = util.el('span', { class: 'unit', text: 'm' });
      valEl.appendChild(unit);
    }
  }

  function derivedItem(parent, label, value, formula) {
    var el = util.el('div', { class: 'derived' },
      [util.el('div', { class: 'dlabel', text: label }),
       util.el('div', { class: 'dval' },
         [util.el('span', { class: 'fmark', text: '\u0192 ' }), util.el('span', { text: value })]),
       util.el('div', { class: 'dformula', text: formula })]);
    parent.appendChild(el);
  }

  /* ------------------------------------------------------------------ *
   * Save (create) — the contract exposes POST /geometries (no PUT).
   * ------------------------------------------------------------------ */
  async function saveGeometry() {
    var name = util.byId('geom-name').value.trim();
    if (!name) { SS.toast('Give the geometry a name.', 'error'); return; }
    var body = {
      name: name,
      lines_per_amud: draft.lines_per_amud,
      baseline_pitch_mm: draft.baseline_pitch_mm,
      top_margin_mm: draft.top_margin_mm,
      bottom_margin_mm: draft.bottom_margin_mm,
      inter_column_gap_mm: draft.inter_column_gap_mm,
      outer_margin_mm: draft.outer_margin_mm,
      line_width_mm: draft.line_width_mm,
      max_letters_per_line: 0,
      amudim_per_yeria: draft.amudim_per_yeria,
      partial_final_yeria: draft.partial_final_yeria,
      setuma_gap_mm: (draft.setuma_gap_mm != null && !Number.isNaN(draft.setuma_gap_mm)) ? draft.setuma_gap_mm : null,
      setuma_reference_letter: draft.setuma_reference_letter || '\u05d0',
      min_inter_letter_gap_mm: draft.min_inter_letter_gap_mm,
      min_inter_word_gap_mm: draft.min_inter_word_gap_mm,
      max_inter_word_gap_mm: (draft.max_inter_word_gap_mm != null && !Number.isNaN(draft.max_inter_word_gap_mm)) ? draft.max_inter_word_gap_mm : null,
      max_inter_word_gap_factor: (draft.max_inter_word_gap_factor != null && !Number.isNaN(draft.max_inter_word_gap_factor)) ? draft.max_inter_word_gap_factor : null,
      small_letter_reference: draft.small_letter_reference || '\u05d9',
      vavei_haamudim: !!draft.vavei_haamudim
    };
    try {
      var saved = await API.createGeometry(body);
      await refreshGeometries();
      state.active.geometryId = saved.id;
      draft = normalizeGeometry(saved);
      renderFromDraft();
      bus.emit('geometryId:changed');
      SS.toast('Geometry saved.');
    } catch (e) { SS.toast(e.message || String(e), 'error'); }
  }

  async function refreshGeometries() {
    try {
      state.geometries = await API.listGeometries();
      bus.emit('selection:changed');
    } catch (e) { /* ignore */ }
  }

  SS.geometry = { init: init, starter: defaultDraft, getDraft:function(){return draft;} };
})();
