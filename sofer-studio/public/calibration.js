/*
 * Sofer Studio — calibration.js
 * Calibration profile editor: master scale, stroke, min letter-height warning,
 * full 27-letter table (incl. five sofiyot), per-letter stretch caps, profile
 * CRUD / duplicate / import / export.
 *
 * The letter-height warning is keyed to a configurable minimum practical
 * LETTER HEIGHT (letter_height_mm < min_letter_height_mm), per the revised
 * requirement — NOT against the nib/stroke measurement. A separate, clearly
 * labelled minimum STROKE width warning is also offered.
 */
(function () {
  'use strict';
  var SS = window.SS;
  var util = SS.util;
  var bus = SS.bus;
  var state = SS.state;
  var API;

  var root = null;         // #calibration-body
  var warnEl = null;       // panel banner
  var appWarnEl = null;    // app-bar warning chip
  var previewEl = null;    // hover letter preview

  var draft = null;        // working profile object
  var dirty = false;

  var REF_HEIGHT_DEFAULT = 3.0;   // skeleton widths are stored at this reference height (mm)

  // Skeleton widths in SOFER UNITS (canonical schema — matches the backend).
  // referenceSkeletonWidth(mm) = units * unit_mm.
  var DEFAULT_WIDTHS = {
    '\u05d0': 2, '\u05d1': 2, '\u05d2': 1, '\u05d3': 2, '\u05d4': 2,
    '\u05d5': 1, '\u05d6': 1, '\u05d7': 2, '\u05d8': 2, '\u05d9': 1,
    '\u05db': 2, '\u05da': 2, '\u05dc': 2, '\u05de': 2, '\u05dd': 2,
    '\u05e0': 1, '\u05df': 1, '\u05e1': 2, '\u05e2': 2, '\u05e4': 2,
    '\u05e3': 2, '\u05e6': 2, '\u05e5': 2, '\u05e7': 2, '\u05e8': 2,
    '\u05e9': 3, '\u05ea': 2
  };
  var SPECIAL_DEFAULTS = { word_space: 2, hyphen: 1, petucha: 20, setuma: 20 };
  var SPECIAL_LABELS = { word_space: 'Word space', hyphen: 'Hyphen', petucha: 'Pesucha gap', setuma: 'Setuma gap' };
  function defaultPriorities() {
    var out = { word_space: 3, hyphen: 3, petucha: 1, setuma: 1 };
    SS.LETTERS.forEach(function (ch) { out[ch] = '\u05d0\u05d3\u05d4\u05d8\u05dc\u05de\u05dd\u05e7\u05e8\u05ea'.indexOf(ch) >= 0 ? 2 : 3; });
    return out;
  }
  function defaultPolicy() {
    var caps = {}; SS.LETTERS.forEach(function (ch) { caps[ch] = '\u05d3\u05d4\u05e8\u05ea'.indexOf(ch) >= 0 ? 'unlimited' : 50; });
    return { version: 2, caps_percent: caps, distribution: 'equal_mm', word_space_percent: 50,
      petucha_percent: 'unlimited', setuma_percent: 'unlimited', stam_hyphen_units: 1,
      special_widths_units: Object.assign({}, SPECIAL_DEFAULTS), priorities: defaultPriorities(),
      song_widths_mm: { page: 0, middle: 0, side: 0 } };
  }

  // Per-letter stretch caps in ABSOLUTE mm (matches backend DEFAULT_MAX_STRETCH_MM).
  var DEFAULT_MAX_STRETCH = {
    '\u05d3': 1.5, '\u05d4': 1.5, '\u05d7': 1.5, '\u05dc': 1.5, '\u05e8': 1.8,
    '\u05ea': 1.8, '\u05d1': 1.5, '\u05db': 1.5, '\u05dd': 1.5, '\u05e1': 1.5
  };

  function init(ctx) {
    API = ctx.api;
    root = util.byId('calibration-body');
    if (!root) return;

    buildStatic();
    bindInputEvents();
    loadDraftFromActive();

    bus.on('profileId:changed', function () { if (!dirty || confirmDiscard()) loadDraftFromActive(); });
    bus.on('selection:changed', function () { if (!draft || draft._isDefault) loadDraftFromActive(); });
    bus.on('app:ready', function () { if (!draft) loadDraftFromActive(); });
    bus.on('profiles:list', function () { if (!draft) loadDraftFromActive(); });
  }

  function confirmDiscard() {
    return window.confirm('Discard unsaved calibration changes and load the selected profile?');
  }

  /* ------------------------------------------------------------------ *
   * Static chrome
   * ------------------------------------------------------------------ */
  function buildStatic() {
    // warning banner (top)
    warnEl = util.el('div', { class: 'banner warn', hidden: true });
    root.appendChild(warnEl);

    // app-bar warning chip (created once)
    appWarnEl = util.byId('app-warn');
    if (!appWarnEl) {
      appWarnEl = util.el('div', { id: 'app-warn', hidden: true });
      var appbar = util.byId('appbar');
      if (appbar) {
        var lock = util.byId('app-lock');
        if (lock) appbar.insertBefore(appWarnEl, lock);
        else appbar.appendChild(appWarnEl);
      }
    }

    // profile CRUD row
    var crud = util.el('div', { class: 'grid-crud' });
    var nameField = util.el('label', { class: 'field', style: 'flex:1' },
      [util.el('span', { text: 'Profile name' }),
       util.el('input', { type: 'text', id: 'cal-name', placeholder: 'Profile name' })]);
    crud.appendChild(nameField);

    var btnSave = util.el('button', { class: 'btn btn-primary btn-sm', title: 'Save profile', text: 'Save' });
    var btnNew = util.el('button', { class: 'btn btn-ghost btn-sm', title: 'New profile', text: 'New' });
    var btnDup = util.el('button', { class: 'btn btn-ghost btn-sm', title: 'Duplicate active profile', text: 'Duplicate' });
    var btnImport = util.el('button', { class: 'btn btn-ghost btn-sm', title: 'Import profile JSON', text: 'Import' });
    var btnExport = util.el('button', { class: 'btn btn-ghost btn-sm', title: 'Export profile JSON', text: 'Export' });
    var btnDelete = util.el('button', { class: 'btn btn-danger btn-sm', title: 'Delete profile', text: 'Delete' });
    var fileInput = util.el('input', { type: 'file', accept: 'application/json,.json', hidden: true });

    btnSave.addEventListener('click', saveProfile);
    btnNew.addEventListener('click', newProfile);
    btnDup.addEventListener('click', duplicateProfile);
    btnImport.addEventListener('click', function () { fileInput.click(); });
    btnExport.addEventListener('click', exportProfile);
    btnDelete.addEventListener('click', deleteProfile);
    fileInput.addEventListener('change', function () { importProfile(fileInput); });

    var row = util.el('div', { class: 'btn-row' });
    [btnSave, btnNew, btnDup, btnImport, btnExport, btnDelete].forEach(function (b) { row.appendChild(b); });

    crud.appendChild(row);
    crud.appendChild(fileInput);
    root.appendChild(crud);

    // Master scale controls
    root.appendChild(util.el('div', { class: 'sirtut' }));
    var master = util.el('div', { class: 'master-grid' });
    master.appendChild(util.el('label', { class: 'field' }, [
      util.el('span', { text: 'Units per line' }),
      util.el('input', { type: 'number', min: '1', step: '1', 'data-field': 'units_per_row' }),
      util.el('span', { class: 'hint', text: 'Classic reference: 62. Unit size is derived from the selected column width.' })
    ]));
    master.appendChild(mmField('Letter height', 'letter_height_mm', 0.1, 'Master ktav height — scales all widths proportionally'));
    master.appendChild(mmField('Stroke (kav)', 'stroke_mm', 0.01, 'Stroke thickness, added once per letter'));
    master.appendChild(mmField('Min letter height', 'min_letter_height_mm', 0.1, 'Warn when letter height falls below this'));
    master.appendChild(mmField('Min stroke width', 'min_nib_mm', 0.01, 'Warn when stroke falls below this (separate from letter height)'));
    master.appendChild(mmField('Reference height', 'reference_height_mm', 0.5, 'Height the skeleton widths are stored at'));
    root.appendChild(master);

    // spacing + stretch position
    var gaps = util.el('div', { class: 'master-grid' });
    gaps.appendChild(mmField('Inter-letter gap', 'gaps.inter_letter', 0.1, 'Gap between adjacent letters within a word'));
    // Word-space width is edited beside the 27 letters in the table below.
    var pos = util.el('label', { class: 'field full' },
      [util.el('span', { text: 'Stretch position' }),
       util.el('select', { id: 'cal-stretch-position', 'data-field': 'stretch_position' },
         [util.el('option', { value: 'anywhere', text: 'Anywhere on line' }),
          util.el('option', { value: 'word_final', text: 'Word-final only' }),
          util.el('option', { value: 'line_end', text: 'Line-end only' })])]);
    gaps.appendChild(pos);
    root.appendChild(gaps);

    // hover letter preview chip
    previewEl = util.el('div', { class: 'letter-preview', hidden: true });
    previewEl.innerHTML = '<span class="pbig" id="cal-preview-letter"></span><span class="pmeta" id="cal-preview-meta"></span>';
    root.appendChild(previewEl);

    // scale note
    root.appendChild(util.el('p', { class: 'scale-note t--1 faint', id: 'cal-scale-note' }));

    // letter table
    root.appendChild(tableScaffold());

    var songButton = util.el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Song widths…' });
    songButton.addEventListener('click', openSongDialog);
    root.appendChild(songButton);

    // footer contract note
    root.appendChild(util.el('div', { class: 'panel-foot' },
      util.el('span', { text: 'Skeleton widths ', class: '' })));
    var foot = util.qs('.panel-foot', root);
    foot.innerHTML = '<strong>Widths exclude stroke;</strong> lower stretch-preference numbers are used first. ' +
      'Holy-letter protection comes only from human input and can never be inferred or bypassed.';
  }

  function tableScaffold() {
    var wrap = util.el('div', { class: 'table-scroll' });
    var tbl = util.el('table', { class: 'letter-table' });
    var thr = util.el('tr', {}, [
      util.el('th', { text: 'Letter' }),
      util.el('th', { text: 'Skeleton units' }),
      util.el('th', { text: '+Stroke mm' }),
      util.el('th', { text: 'Skeleton mm' }),
      util.el('th', { text: 'Total mm' }),
      util.el('th', { text: 'Cap %' }),
      util.el('th', { text: 'Stretch preference' })
    ]);
    var thead = util.el('thead', {}, thr);
    tbl.appendChild(thead);
    var tbody = util.el('tbody', { id: 'cal-letter-rows' });
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    return wrap;
  }

  /* ------------------------------------------------------------------ *
   * mm field builder (with steppers + sargel wake)
   * ------------------------------------------------------------------ */
  function mmField(label, path, step, hint) {
    var input = util.el('input', { type: 'number', step: String(step), 'data-mm': path, 'data-field': path });
    var unitSpan = util.el('span', { class: 'unit', text: 'mm' });
    var down = util.el('button', { type: 'button', 'aria-label': 'decrease', text: '\u2212' });
    var up = util.el('button', { type: 'button', 'aria-label': 'increase', text: '+' });

    var field = util.el('label', { class: 'field' },
      [util.el('span', { text: label }),
       util.el('div', { class: 'mm-input' }, [input, unitSpan,
         util.el('span', { class: 'stepper' }, [down, up])])]);

    function apply(dir) {
      var cur = util.parseNum(input.value);
      if (Number.isNaN(cur)) cur = 0;
      var shift = (dir === 'shift');
      var delta = (dir === 'up' ? step : -step) * (shift ? 10 : 1);
      var next = Math.round((cur + delta) * 1000) / 1000;
      input.value = next;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    down.addEventListener('click', function (ev) { apply(ev.shiftKey ? 'downshift' : 'down'); });
    up.addEventListener('click', function (ev) { apply(ev.shiftKey ? 'upshift' : 'up'); });

    if (hint) field.appendChild(util.el('span', { class: 'hint', text: hint }));
    field._input = input;
    return field;
  }

  /* ------------------------------------------------------------------ *
   * Draft management
   * ------------------------------------------------------------------ */
  function defaultDraft() {
    return {
      _isDefault: true,
      id: null,
      name: 'Classic Sefer Torah',
      letter_height_mm: 4.5,
      stroke_mm: 0.2,
      unit_mm: 0.5,
      min_letter_height_mm: 3.0,
      min_nib_mm: 1.0,
      reference_height_mm: REF_HEIGHT_DEFAULT,
      letter_widths: Object.assign({}, DEFAULT_WIDTHS),
      gaps: { inter_letter: 0, inter_word: 1.0 },
      non_stretchable: [],
      max_stretch: Object.assign({}, DEFAULT_MAX_STRETCH),
      stretch_position: 'anywhere', units_per_row: 62, unit_basis: 'average_letter', layout_mode: 'reflow',
      stretch_policy: defaultPolicy()
    };
  }

  // F-33: fetch the FULL profile record (not the list summary) so every field
  // (letter_widths, gaps, max_stretch, non_stretchable, min_letter_height_mm, …)
  // lands in the draft exactly as persisted.
  async function loadDraftFromActive() {
    var prof = SS.activeProfile ? SS.activeProfile() : null;
    if (prof && prof.id && API && typeof API.getProfile === 'function') {
      try { prof = await API.getProfile(prof.id); }
      catch (e) { /* fall back to the summary entry */ }
    }
    if (prof) {
      draft = normalizeProfile(prof);
    } else if (!draft) {
      draft = defaultDraft();
    }
    dirty = false;
    renderFromDraft();
  }

  function normalizeProfile(p) {
    return {
      _isDefault: false,
      id: p.id,
      name: p.name || 'Profile',
      letter_height_mm: toNum(p.letter_height_mm, 4.5),
      stroke_mm: toNum(p.stroke_mm, 0.2),
      unit_mm: toNum(p.unit_mm, 0.5),
      min_letter_height_mm: toNum(p.min_letter_height_mm, 3.0),
      min_nib_mm: toNum(p.min_nib_mm, 1.0),
      reference_height_mm: toNum(p.reference_height_mm, REF_HEIGHT_DEFAULT),
      letter_widths: Object.assign({}, DEFAULT_WIDTHS, (p.letter_widths || {})),
      gaps: Object.assign({ inter_letter: 0, inter_word: 1.0 }, (p.gaps || {})),
      non_stretchable: Array.isArray(p.non_stretchable) ? p.non_stretchable.slice() : SS.DEFAULT_NON_STRETCH.slice(),
      max_stretch: Object.assign({}, DEFAULT_MAX_STRETCH, (p.max_stretch || {})),
      stretch_position: p.stretch_position || 'anywhere',
      units_per_row: toNum(p.units_per_row, 62), unit_basis: p.unit_basis || 'average_letter', layout_mode: p.layout_mode || 'reflow',
      stretch_policy: (function () {
        var d = defaultPolicy(), q = p.stretch_policy || {};
        return Object.assign(d, q, {
          version: 2,
          caps_percent: Object.assign({}, d.caps_percent, q.caps_percent || {}),
          special_widths_units: Object.assign({}, d.special_widths_units, q.special_widths_units || {}),
          priorities: Object.assign({}, d.priorities, q.priorities || {}),
          song_widths_mm: Object.assign({}, d.song_widths_mm, q.song_widths_mm || {})
        });
      })()
    };
  }
  function toNum(v, d) { return (v === null || v === undefined || v === '') ? d : Number(v); }

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */
  function setFieldValue(path, value) {
    var el = util.qs('[data-field="' + path + '"]', root);
    if (el) el.value = value;
  }
  function getFieldValue(path) {
    var el = util.qs('[data-field="' + path + '"]', root);
    return el ? el.value : '';
  }
  function nestedGet(path) {
    var parts = path.split('.');
    var cur = draft;
    for (var i = 0; i < parts.length; i++) cur = cur[parts[i]];
    return cur;
  }
  function nestedSet(path, value) {
    var parts = path.split('.');
    var cur = draft;
    for (var i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
    cur[parts[parts.length - 1]] = value;
  }

  function renderFromDraft() {
    if (!root) return;

    util.byId('cal-name').value = draft.name || '';
    setFieldValue('letter_height_mm', draft.letter_height_mm);
    setFieldValue('stroke_mm', draft.stroke_mm);
    setFieldValue('unit_mm', draft.unit_mm);
    setFieldValue('units_per_row', draft.units_per_row);
    setFieldValue('min_letter_height_mm', draft.min_letter_height_mm);
    setFieldValue('min_nib_mm', draft.min_nib_mm);
    setFieldValue('reference_height_mm', draft.reference_height_mm);
    setFieldValue('gaps.inter_letter', draft.gaps.inter_letter);
    setFieldValue('gaps.inter_word', draft.gaps.inter_word);
    util.byId('cal-stretch-position').value = draft.stretch_position || 'anywhere';

    renderScaleNote();
    renderRows();
    updateWarnings();
    markSaved(!dirty && !draft._isDefault);
  }

  function scale() {
    var ref = draft.reference_height_mm || REF_HEIGHT_DEFAULT;
    return (draft.letter_height_mm / ref) || 0;
  }

  function renderScaleNote() {
    var el = util.byId('cal-scale-note');
    if (!el) return;
    el.textContent = 'All widths scale proportionally from ' + util.mm(draft.reference_height_mm) +
      ' reference \u2192 current ' + util.mm(draft.letter_height_mm) + ' (\u00d7' + util.fmt(scale(), 3) + ').';
  }

  function computeTotal(letter) {
    var units = toNum(draft.letter_widths[letter], 0);
    var unitMm = toNum(draft.unit_mm, 0.5);
    return units * unitMm * scale() + toNum(draft.stroke_mm, 0);
  }

  // F-34: skeleton mm = units × unit_mm × scale (stroke excluded).
  function skeletonMm(letter) {
    var units = toNum(draft.letter_widths[letter], 0);
    var unitMm = toNum(draft.unit_mm, 0.5);
    return units * unitMm * scale();
  }

  function renderRows() {
    var tbody = util.byId('cal-letter-rows');
    if (!tbody) return;
    util.clear(tbody);

    SS.LETTERS.forEach(function (letter) {
      var restricted = false;
      var skel = draft.letter_widths[letter];
      var cap = draft.stretch_policy.caps_percent[letter];
      var total = computeTotal(letter);

      var tr = util.el('tr', { class: restricted ? 'restricted' : '' });
      tr.dataset.letter = letter;

      // Letter
      var tdLet = util.el('td', { class: 'let' }, letter);
      tdLet.setAttribute('lang', 'he');
      tr.appendChild(tdLet);

      // Skeleton (editable)
      var skelInput = util.el('input', { class: 'cell', type: 'number', step: '0.5', value: skel, 'aria-label': 'skeleton units for ' + letter });
      var skelMmCell = util.el('td', { class: 'num', text: util.fmt(skeletonMm(letter)) });
      skelInput.addEventListener('input', function () {
        draft.letter_widths[letter] = util.parseNum(skelInput.value);
        markDirty();
        totalCell.textContent = util.fmt(computeTotal(letter));
        skelMmCell.textContent = util.fmt(skeletonMm(letter));
      });
      tr.appendChild(util.el('td', { class: 'num' }, skelInput));

      // +Stroke (same for all)
      tr.appendChild(util.el('td', { class: 'num', text: util.fmt(draft.stroke_mm) }));

      // Skeleton mm (units × unit_mm × scale, no stroke)
      tr.appendChild(skelMmCell);

      // Total
      var totalCell = util.el('td', { class: 'num', text: util.fmt(total) });
      tr.appendChild(totalCell);

      // Cap (editable, hard capped)
      var capInput = util.el('input', { class: 'cell', type: 'text', value: cap, 'aria-label': 'stretch cap percent or unlimited for ' + letter });
      capInput.addEventListener('input', function () {
        var raw = capInput.value.trim().toLowerCase();
        draft.stretch_policy.caps_percent[letter] = raw === 'unlimited' ? 'unlimited' : Math.max(0, util.parseNum(raw) || 0);
        markDirty();
      });
      var tdCap = util.el('td', { class: 'num cap' }, capInput);
      tr.appendChild(tdCap);

      // Numeric preference: lower numbers are used first.
      var btn = util.el('input', { class: 'cell stretch-priority', type: 'number', min: '1', step: '1',
        value: draft.stretch_policy.priorities[letter], 'aria-label': 'stretch preference for ' + letter });
      btn.addEventListener('input', function () {
        draft.stretch_policy.priorities[letter] = Math.max(1, Math.round(util.parseNum(btn.value) || 1));
        markDirty();
      });
      var tdStretch = util.el('td', { class: 'cap' }, btn);
      tr.appendChild(tdStretch);

      // hover preview
      tr.addEventListener('mouseenter', function () { showPreview(letter); });
      tr.addEventListener('mouseleave', function () { hidePreview(); });

      tbody.appendChild(tr);
    });

    ['word_space', 'hyphen', 'petucha', 'setuma'].forEach(function (key) {
      var minimum = key === 'petucha' || key === 'setuma' ? 20 : 0;
      var tr = util.el('tr', { class: 'special-measurement' });
      tr.appendChild(util.el('td', { class: 'let', text: SPECIAL_LABELS[key] }));
      var width = util.el('input', { class: 'cell', type: 'number', min: String(minimum), step: '0.5', value: draft.stretch_policy.special_widths_units[key] });
      width.addEventListener('input', function () {
        draft.stretch_policy.special_widths_units[key] = Math.max(minimum, util.parseNum(width.value) || minimum);
        if (key === 'hyphen') draft.stretch_policy.stam_hyphen_units = draft.stretch_policy.special_widths_units[key];
        markDirty();
      });
      tr.appendChild(util.el('td', { class: 'num' }, width));
      tr.appendChild(util.el('td', { class: 'num', text: '—' }));
      tr.appendChild(util.el('td', { class: 'num', text: util.fmt(draft.stretch_policy.special_widths_units[key] * draft.unit_mm * scale()) }));
      tr.appendChild(util.el('td', { class: 'num', text: util.fmt(draft.stretch_policy.special_widths_units[key] * draft.unit_mm * scale()) }));
      var specialCap = key === 'word_space' ? draft.stretch_policy.word_space_percent :
        key === 'petucha' ? draft.stretch_policy.petucha_percent : key === 'setuma' ? draft.stretch_policy.setuma_percent : 0;
      tr.appendChild(util.el('td', { class: 'num', text: String(specialCap) }));
      var priority = util.el('input', { class: 'cell stretch-priority', type: 'number', min: '1', step: '1', value: draft.stretch_policy.priorities[key] });
      priority.addEventListener('input', function () { draft.stretch_policy.priorities[key] = Math.max(1, Math.round(util.parseNum(priority.value) || 1)); markDirty(); });
      tr.appendChild(util.el('td', { class: 'cap' }, priority));
      tbody.appendChild(tr);
    });
  }

  function openSongDialog() {
    var widths = draft.stretch_policy.song_widths_mm;
    var modal = util.el('div', { class: 'modal-backdrop' });
    var box = util.el('div', { class: 'modal song-width-dialog' });
    box.appendChild(util.el('h2', { text: 'Song layout widths' }));
    box.appendChild(util.el('p', { text: 'Applied to the whole page containing the song, including lines before and after it.' }));
    [['Page width', 'page'], ['Middle break width', 'middle'], ['Side break width', 'side']].forEach(function (entry) {
      var input = util.el('input', { type: 'number', min: '0', step: '0.1', value: widths[entry[1]], 'data-song-width': entry[1] });
      box.appendChild(util.el('label', { class: 'field' }, [util.el('span', { text: entry[0] + ' (mm)' }), input]));
    });
    var save = util.el('button', { class: 'btn btn-primary', type: 'button', text: 'Apply song widths' });
    save.addEventListener('click', function () {
      util.qsa('[data-song-width]', box).forEach(function (input) { widths[input.dataset.songWidth] = Math.max(0, util.parseNum(input.value) || 0); });
      markDirty(); modal.remove();
    });
    var cancel = util.el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel' });
    cancel.addEventListener('click', function () { modal.remove(); });
    box.appendChild(util.el('div', { class: 'btn-row' }, [save, cancel]));
    modal.appendChild(box); document.body.appendChild(modal);
  }

  function showPreview(letter) {
    if (!previewEl) return;
    previewEl.hidden = false;
    util.byId('cal-preview-letter').textContent = letter;
    var total = computeTotal(letter);
    var cap = draft.stretch_policy.caps_percent[letter];
    var priority = draft.stretch_policy.priorities[letter];
    util.byId('cal-preview-meta').textContent =
      util.fmt(draft.letter_widths[letter], 1) + ' units skel \u00b7 total ' + util.mm(total) +
      ' \u00b7 preference ' + priority + ' \u00b7 cap ' + cap;
  }
  function hidePreview() { if (previewEl) previewEl.hidden = true; }

  /* ------------------------------------------------------------------ *
   * Warnings (letter height vs min letter height; stroke vs min stroke)
   * ------------------------------------------------------------------ */
  function updateWarnings() {
    var issues = [];
    var lh = toNum(draft.letter_height_mm, 0);
    var minLh = toNum(draft.min_letter_height_mm, 0);
    var stroke = toNum(draft.stroke_mm, 0);
    var minNib = toNum(draft.min_nib_mm, 0);

    if (minLh > 0 && lh < minLh) {
      issues.push('Letter height ' + util.mm(lh) + ' is below your ' + util.mm(minLh) + ' minimum practical letter height — letters may be impractical to write.');
    }
    if (minNib > 0 && stroke < minNib) {
      issues.push('Kav (stroke) ' + util.mm(stroke) + ' is below your ' + util.mm(minNib) + ' minimum stroke width.');
    }

    if (issues.length) {
      if (warnEl) { warnEl.hidden = false; warnEl.textContent = issues.join(' '); }
      if (appWarnEl) {
        appWarnEl.hidden = false;
        appWarnEl.innerHTML = '<span class="chip error">below min</span>';
        appWarnEl.title = issues.join(' ');
      }
    } else {
      if (warnEl) warnEl.hidden = true;
      if (appWarnEl) appWarnEl.hidden = true;
    }
  }

  /* ------------------------------------------------------------------ *
   * Dirty tracking & CRUD
   * ------------------------------------------------------------------ */
  function markDirty() {
    dirty = true;
    updateWarnings();
    renderScaleNote();
    markSaved(false);
    bus.emit('calibration:dirty', draft);
  }
  function markSaved(saved) {
    var btn = util.qs('#calibration-body .btn-primary');
    if (btn) btn.textContent = saved ? 'Saved' : (dirty ? 'Save \u2022' : 'Save');
  }

  function bindInputEvents() {
    util.qsa('input[data-field], select#cal-stretch-position', root).forEach(function (el) {
      el.addEventListener('input', onFieldInput);
      el.addEventListener('change', onFieldInput);
    });
    util.byId('cal-name').addEventListener('input', function () {
      draft.name = util.byId('cal-name').value;
      markDirty();
    });
  }

  function onFieldInput(ev) {
    var path = ev.target.getAttribute('data-field');
    if (!path) return;
    var v = ev.target.tagName === 'SELECT' ? ev.target.value : util.parseNum(ev.target.value);
    nestedSet(path, v);
    markDirty();
    if (path === 'unit_mm' || path === 'letter_height_mm' || path === 'reference_height_mm' || path === 'stroke_mm') {
      renderRows(); // totals depend on these
    }
  }

  function currentBody() {
    return {
      name: draft.name || 'Profile',
      letter_height_mm: draft.letter_height_mm,
      stroke_mm: draft.stroke_mm,
      unit_mm: draft.unit_mm,
      min_letter_height_mm: draft.min_letter_height_mm,
      min_nib_mm: draft.min_nib_mm,
      reference_height_mm: draft.reference_height_mm,
      letter_widths: draft.letter_widths,
      gaps: draft.gaps,
      non_stretchable: draft.non_stretchable,
      max_stretch: draft.max_stretch,
      stretch_position: draft.stretch_position,
      units_per_row: draft.units_per_row, unit_basis: draft.unit_basis, layout_mode: draft.layout_mode,
      stretch_policy: draft.stretch_policy
    };
  }

  async function saveProfile() {
    var name = util.byId('cal-name').value.trim();
    if (!name) { SS.toast('Give the profile a name.', 'error'); return; }
    draft.name = name;
    var body = currentBody();
    try {
      var saved;
      if (draft.id) saved = await API.updateProfile(draft.id, body);
      else saved = await API.createProfile(body);
      draft = normalizeProfile(saved);
      draft._isDefault = false;
      dirty = false;
      await refreshProfiles();
      state.active.profileId = saved.id;
      renderFromDraft();
      bus.emit('profileId:changed');
      SS.toast('Profile saved.');
    } catch (e) {
      SS.toast(e.message || String(e), 'error');
    }
  }

  function newProfile() {
    draft = defaultDraft();
    dirty = true;
    renderFromDraft();
    util.byId('cal-name').focus();
  }

  async function duplicateProfile() {
    var prof = SS.activeProfile ? SS.activeProfile() : null;
    var srcId = draft.id || (prof && prof.id);
    if (!srcId) { SS.toast('Save a profile before duplicating.', 'error'); return; }
    try {
      var name = draft.name + ' copy';
      var saved = await API.duplicateProfile(srcId, { name: name });
      await refreshProfiles();
      state.active.profileId = saved.id;
      draft = normalizeProfile(saved);
      draft._isDefault = false;
      dirty = false;
      renderFromDraft();
      bus.emit('profileId:changed');
      SS.toast('Profile duplicated.');
    } catch (e) { SS.toast(e.message || String(e), 'error'); }
  }

  async function deleteProfile() {
    if (!draft.id) { SS.toast('Nothing to delete.', 'error'); return; }
    if (!window.confirm('Delete profile “' + draft.name + '”? This cannot be undone.')) return;
    try {
      await API.deleteProfile(draft.id);
      await refreshProfiles();
      draft = defaultDraft();
      dirty = true;
      renderFromDraft();
      SS.toast('Profile deleted.');
    } catch (e) { SS.toast(e.message || String(e), 'error'); }
  }

  async function exportProfile() {
    if (!draft.id) { SS.toast('Save the profile before exporting.', 'error'); return; }
    try {
      var prof = await API.exportProfile(draft.id);
      var blob = new Blob([JSON.stringify(prof, null, 2)], { type: 'application/json' });
      util.download(util.slug(prof.name) + '.profile.json', blob);
    } catch (e) { SS.toast(e.message || String(e), 'error'); }
  }

  async function importProfile(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    try {
      var text = await file.text();
      var obj = JSON.parse(text);
      var saved = await API.importProfile(obj);
      await refreshProfiles();
      state.active.profileId = saved.id;
      draft = normalizeProfile(saved);
      draft._isDefault = false;
      dirty = false;
      renderFromDraft();
      bus.emit('profileId:changed');
      SS.toast('Profile imported.');
    } catch (e) {
      SS.toast('Import failed: ' + (e.message || String(e)), 'error');
    } finally {
      input.value = '';
    }
  }

  async function refreshProfiles() {
    try {
      state.profiles = await API.listProfiles();
      bus.emit('profiles:list', state.profiles);
      bus.emit('selection:changed');
    } catch (e) { /* ignore */ }
  }

  SS.calibration = { init: init };
})();
