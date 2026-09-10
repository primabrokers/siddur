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
  var loadRevision = 0;
  var saving = false;

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
    return { version: 2, caps_percent: caps, distribution: 'equal_mm', word_space_percent: 50, hyphen_percent: 0,
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

    bus.on('profileId:changed', function () {
      if (!dirty || confirmDiscard()) loadDraftFromActive();
      else { state.active.profileId = draft.id || null; bus.emit('calibration:draft-changed'); }
    });
    bus.on('selection:changed', function () { if (!draft) loadDraftFromActive(); });
    bus.on('app:ready', function () { if (!draft) loadDraftFromActive(); });
    bus.on('profiles:list', function () { if (!draft) loadDraftFromActive(); });
    bus.on('geometryId:changed', refreshColumnUnit);
    bus.on('geometry:draft-changed', refreshColumnUnit);
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
    root.appendChild(util.el('p', { class: 'profile-help', text: 'Start with your own named profile. Measure the sofer’s actual writing before saving; the initial numbers are examples, not recommended or verified measurements.' }));
    root.appendChild(util.el('p', { id: 'cal-draft-status', class: 'profile-help', role: 'status' }));

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
    var btnNew = util.el('button', { class: 'btn btn-ghost btn-sm', title: 'New profile', text: 'New profile' });
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
    master.appendChild(mmField('Skeleton unit size', 'unit_mm', 0.01, 'Calculated from the column in automatic modes; editable in manual mode.'));
    master.appendChild(mmField('Letter height', 'letter_height_units', 0.1, 'Height in the same units as the measurement table.', 'units'));
    master.appendChild(mmField('Stroke (kav)', 'stroke_mm', 0.01, 'Thickness of the ink stroke in mm, measured from the sofer’s writing — not letter height. The width calculation adds this once per letter.'));
    master.appendChild(mmField('Min stroke width', 'min_nib_mm', 0.01, 'Warn when stroke falls below this (separate from letter height)'));
    root.appendChild(master);
    buildPolicyControls();

    // spacing + stretch position
    var gaps = util.el('div', { class: 'master-grid' });
    gaps.appendChild(mmField('Inter-letter gap', 'gaps.inter_letter', 0.1, 'Gap between adjacent letters within a word'));
    var legacySpace = mmField('Inter-word gap', 'gaps.inter_word', 0.1, 'Saved spacing for earlier profiles');
    legacySpace.id = 'cal-legacy-word-gap';
    gaps.appendChild(legacySpace);
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

    var songButton = util.el('button', { id: 'cal-song-widths', class: 'btn btn-ghost btn-sm', type: 'button', text: 'Song widths…' });
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
      util.el('th', { id: 'cal-cap-heading', text: 'Cap %' }),
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
  function mmField(label, path, step, hint, unit) {
    var input = util.el('input', { type: 'number', step: String(step), 'data-field': path });
    if (!unit) input.setAttribute('data-mm', path);
    else input.min = '0.001';
    var unitSpan = util.el('span', { class: 'unit', text: unit || 'mm' });
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
      letter_height_units: 2,
      stroke_mm: 0.2,
      unit_mm: 0.5,
      min_letter_height_mm: 3.0,
      min_nib_mm: 1.0,
      reference_height_mm: REF_HEIGHT_DEFAULT,
      letter_widths: Object.assign({}, DEFAULT_WIDTHS),
      stroke_factors: {},
      gaps: { inter_letter: 0, inter_word: 1.0 },
      non_stretchable: [],
      max_stretch: Object.assign({}, DEFAULT_MAX_STRETCH),
      stretch_position: 'anywhere', units_per_row: 62, unit_basis: 'line_units', layout_mode: 'reflow',
      stretch_policy: defaultPolicy()
    };
  }

  // F-33: fetch the FULL profile record (not the list summary) so every field
  // (letter_widths, gaps, max_stretch, non_stretchable, min_letter_height_mm, …)
  // lands in the draft exactly as persisted.
  async function loadDraftFromActive() {
    var revision = ++loadRevision;
    var prof = SS.activeProfile ? SS.activeProfile() : null;
    if (prof && prof.id && API && typeof API.getProfile === 'function') {
      try { prof = await API.getProfile(prof.id); }
      catch (e) { /* fall back to the summary entry */ }
    }
    if (revision !== loadRevision) return;
    if (prof) {
      draft = normalizeProfile(prof);
    } else if (!draft) {
      draft = defaultDraft();
    }
    dirty = false;
    state.calibrationDraftDirty = false;
    renderFromDraft();
    bus.emit('calibration:draft-changed');
  }

  function normalizeProfile(p) {
    return {
      _isDefault: false,
      id: p.id,
      name: p.name || 'Profile',
      letter_height_mm: toNum(p.letter_height_mm, 4.5),
      letter_height_units: p.letter_height_units == null ? null : Number(p.letter_height_units),
      stroke_mm: toNum(p.stroke_mm, 0.2),
      unit_mm: toNum(p.unit_mm, 0.5),
      min_letter_height_mm: toNum(p.min_letter_height_mm, 3.0),
      min_nib_mm: toNum(p.min_nib_mm, 1.0),
      reference_height_mm: toNum(p.reference_height_mm, REF_HEIGHT_DEFAULT),
      letter_widths: Object.assign({}, DEFAULT_WIDTHS, (p.letter_widths || {})),
      stroke_factors: Object.assign({},p.stroke_factors||{}),
      gaps: Object.assign({ inter_letter: 0, inter_word: 1.0 }, (p.gaps || {})),
      non_stretchable: Array.isArray(p.non_stretchable) ? p.non_stretchable.slice() : SS.DEFAULT_NON_STRETCH.slice(),
      max_stretch: Object.assign({}, DEFAULT_MAX_STRETCH, (p.max_stretch || {})),
      stretch_policy: savedPolicy(p.stretch_policy),
      units_per_row: p.units_per_row == null ? null : Number(p.units_per_row),
      unit_basis:['line_units','average_letter'].includes(p.unit_basis)?'line_units':'skeleton', layout_mode:p.layout_mode==='reflow'?'reflow':'reference',
      stretch_position: p.stretch_position || 'anywhere'
    };
  }
  function toNum(v, d) { return (v === null || v === undefined || v === '') ? d : Number(v); }

  // Loading or saving an earlier profile must not silently opt it into v2.
  function savedPolicy(policy) {
    if (!policy) return null;
    var copy = JSON.parse(JSON.stringify(policy));
    if (copy.version === 2) {
      copy.priorities = Object.assign(defaultPriorities(), copy.priorities || {});
      copy.special_widths_units = Object.assign({}, SPECIAL_DEFAULTS, copy.special_widths_units || {});
      copy.song_widths_mm = Object.assign({ page: 0, middle: 0, side: 0 }, copy.song_widths_mm || {});
    }
    return copy;
  }
  function hasPreferences() { return !!(draft.stretch_policy && draft.stretch_policy.version === 2); }
  function isRestricted(letter) { return draft.non_stretchable.indexOf(letter) >= 0; }

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
    renderPolicy();

    renderScaleNote();
    renderRows();
    updateWarnings();
    markSaved(!dirty && !draft._isDefault);
    var status = util.byId('cal-draft-status');
    if (status) status.textContent = draft.id
      ? (dirty ? 'Unsaved changes — save before computing a layout.' : 'Saved profile — ready to choose a source and column geometry.')
      : 'New, unsaved profile — name it, enter your measurements, then Save. Existing profiles are unchanged.';
  }

  function scale() {
    var ref = draft.reference_height_mm || REF_HEIGHT_DEFAULT;
    return (draft.letter_height_mm / ref) || 0;
  }

  function renderScaleNote() {
    var el = util.byId('cal-scale-note');
    if (!el) return;
    el.textContent = 'Letter height: ' + util.fmt(draft.letter_height_units == null ? draft.letter_height_mm / heightUnitMm() : draft.letter_height_units, 3) + ' units. Row units and the table determine horizontal widths.';
  }

  function computeTotal(letter) {
    var units = toNum(draft.letter_widths[letter], 0);
    var unitMm = toNum(draft.unit_mm, 0.5);
    return units * unitMm * scale() + toNum(draft.stroke_mm, 0) * Number(draft.stroke_factors[letter]==null?1:draft.stroke_factors[letter]);
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
      var restricted = isRestricted(letter);
      var skel = draft.letter_widths[letter];
      var cap = draft.stretch_policy ? (draft.stretch_policy.caps_percent[letter] || 0) : ((draft.max_stretch[letter] != null) ? draft.max_stretch[letter] : 0);
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
      skelInput.addEventListener('change',refreshColumnUnit);
      tr.appendChild(util.el('td', { class: 'num' }, skelInput));

      // +Stroke (same for all)
      tr.appendChild(util.el('td', { class: 'num', text: util.fmt(draft.stroke_mm*Number(draft.stroke_factors[letter]==null?1:draft.stroke_factors[letter])) }));

      // Skeleton mm (units × unit_mm × scale, no stroke)
      tr.appendChild(skelMmCell);

      // Total
      var totalCell = util.el('td', { class: 'num', text: util.fmt(total) });
      tr.appendChild(totalCell);

      tr.appendChild(capCell(letter, cap, !!draft.stretch_policy, function(value) {
        if (draft.stretch_policy) draft.stretch_policy.caps_percent[letter] = value;
        else draft.max_stretch[letter] = value;
      }));

      // Numeric preference: lower numbers are used first.
      var btn = util.el('input', { class: 'cell stretch-priority', type: 'number', min: '1', step: '1',
        value: hasPreferences() ? draft.stretch_policy.priorities[letter] : '', 'aria-label': 'stretch preference for ' + letter });
      btn.disabled = !hasPreferences();
      if (!hasPreferences()) btn.title = 'Saved rules retained. Use requested stretch rules to enable numeric preferences.';
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

    if (!hasPreferences()) return;
    ['word_space', 'hyphen', 'petucha', 'setuma'].forEach(function (key) {
      var minimum = key === 'petucha' || key === 'setuma' ? 20 : 0;
      var tr = util.el('tr', { class: 'special-measurement', 'data-measurement': key });
      tr.appendChild(util.el('td', { class: 'let', text: SPECIAL_LABELS[key] }));
      var width = util.el('input', { class: 'cell', type: 'number', min: String(minimum), step: '0.5', value: draft.stretch_policy.special_widths_units[key] });
      width.addEventListener('input', function () {
        draft.stretch_policy.special_widths_units[key] = Math.max(minimum, util.parseNum(width.value) || minimum);
        if (key === 'hyphen') draft.stretch_policy.stam_hyphen_units = draft.stretch_policy.special_widths_units[key];
        markDirty();
        refreshColumnUnit();
      });
      tr.appendChild(util.el('td', { class: 'num' }, width));
      tr.appendChild(util.el('td', { class: 'num', text: '—' }));
      tr.appendChild(util.el('td', { class: 'num', text: util.fmt(specialWidthMm(key)) }));
      tr.appendChild(util.el('td', { class: 'num', text: util.fmt(specialWidthMm(key)) }));
      var capKey = key === 'word_space' ? 'word_space_percent' : key + '_percent';
      tr.appendChild(capCell(key, draft.stretch_policy[capKey] == null ? 0 : draft.stretch_policy[capKey], true, function(value) {
        draft.stretch_policy[capKey] = value;
      }));
      var priority = util.el('input', { class: 'cell stretch-priority', type: 'number', min: '1', step: '1', value: draft.stretch_policy.priorities[key] });
      priority.addEventListener('input', function () { draft.stretch_policy.priorities[key] = Math.max(1, Math.round(util.parseNum(priority.value) || 1)); markDirty(); });
      tr.appendChild(util.el('td', { class: 'cap' }, priority));
      tbody.appendChild(tr);
    });
  }

  function capCell(key, cap, percentage, save) {
    var lastPercent = cap === 'unlimited' ? 50 : cap;
    var input = util.el('input', { class:'cell', type:'number', min:'0', step:percentage?'1':'0.05',
      value:cap==='unlimited'?'':cap, 'aria-label':'stretch cap for '+key });
    input.disabled = cap === 'unlimited';
    input.addEventListener('input', function() { lastPercent = util.parseNum(input.value); save(lastPercent); markDirty(); });
    var cell = util.el('td', {class:'num cap'}, input);
    if (percentage) {
      var mode = util.el('select', {'aria-label':'stretch limit type for '+key}, [
        util.el('option', {value:'percent',text:'% increase'}), util.el('option', {value:'unlimited',text:'Unlimited'})]);
      mode.value = cap === 'unlimited' ? 'unlimited' : 'percent';
      mode.addEventListener('change', function() {
        var unlimited = mode.value === 'unlimited';
        input.disabled = unlimited; input.value = unlimited ? '' : lastPercent;
        save(unlimited ? 'unlimited' : lastPercent); markDirty();
      });
      cell.appendChild(mode);
    }
    return cell;
  }

  function specialWidthMm(key) {
    var units = Number(draft.stretch_policy.special_widths_units[key]);
    var width = units * (draft.unit_basis==='line_units' && draft.units_per_row!=null ? columnWidth()/draft.units_per_row : Number(draft.unit_mm));
    if (key === 'hyphen' && draft.units_per_row != null) return units * columnWidth() / draft.units_per_row;
    if (key === 'setuma') {
      var geometry = SS.geometry && SS.geometry.getDraft ? SS.geometry.getDraft() : SS.activeGeometry && SS.activeGeometry();
      var minimum = geometry && geometry.setuma_gap_mm != null ? Number(geometry.setuma_gap_mm) :
        9 * computeTotal(geometry && geometry.setuma_reference_letter || '\u05d0') + 8 * Number(draft.gaps.inter_letter);
      return Math.max(width, minimum);
    }
    return width;
  }

  function openSongDialog() {
    if (!hasPreferences()) return;
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
    var cap = draft.stretch_policy ? draft.stretch_policy.caps_percent[letter] : draft.max_stretch[letter];
    var priority = hasPreferences() ? draft.stretch_policy.priorities[letter] : 'saved rules';
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
    ++loadRevision;
    dirty = true;
    state.calibrationDraftDirty = true;
    updateWarnings();
    renderScaleNote();
    markSaved(false);
    bus.emit('calibration:dirty', draft);
    bus.emit('calibration:draft-changed');
    var status = util.byId('cal-draft-status');
    if (status) status.textContent = 'Unsaved profile — save your measurements before computing a layout.';
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
    if(path==='unit_mm' && draft.units_per_row!=null){refreshColumnUnit();return;}
    var v = ev.target.tagName === 'SELECT' ? ev.target.value : util.parseNum(ev.target.value);
    nestedSet(path, v);
    if (path === 'letter_height_units') { refreshColumnUnit(); markDirty(); return; }
    markDirty();
    if (path === 'unit_mm' || path === 'letter_height_mm' || path === 'reference_height_mm' || path === 'stroke_mm') {
      refreshColumnUnit();
    }
  }

  function currentBody() {
    refreshColumnUnit();
    return {
      name: draft.name || 'Profile',
      letter_height_mm: draft.letter_height_mm,
      letter_height_units: draft.letter_height_units,
      stroke_mm: draft.stroke_mm,
      unit_mm: draft.unit_mm,
      min_letter_height_mm: draft.min_letter_height_mm,
      min_nib_mm: draft.min_nib_mm,
      reference_height_mm: draft.reference_height_mm,
      letter_widths: draft.letter_widths,
      stroke_factors:draft.stroke_factors,
      gaps: draft.gaps,
      non_stretchable: draft.non_stretchable,
      max_stretch: draft.max_stretch,
      stretch_policy: draft.stretch_policy,
      units_per_row: draft.units_per_row,
      unit_basis:draft.unit_basis, layout_mode:draft.layout_mode,
      stretch_position: draft.stretch_position
    };
  }

  async function saveProfile() {
    if (saving) return;
    var name = util.byId('cal-name').value.trim();
    if (!name) { SS.toast('Give the profile a name.', 'error'); return; }
    draft.name = name;
    var body = currentBody();
    saving = true;
    try {
      var saved;
      if (draft.id) saved = await API.updateProfile(draft.id, body);
      else saved = await API.createProfile(body);
      draft = normalizeProfile(saved);
      draft._isDefault = false;
      dirty = false;
      state.calibrationDraftDirty = false;
      state.active.profileId = saved.id;
      await refreshProfiles();
      renderFromDraft();
      bus.emit('profileId:changed');
      SS.toast('Profile saved.');
    } catch (e) {
      SS.toast(e.message || String(e), 'error');
    } finally { saving = false; }
  }

  function newProfile() {
    if (saving || (dirty && !confirmDiscard())) return false;
    ++loadRevision;
    draft = defaultDraft();
    draft.name = '';
    dirty = true;
    state.calibrationDraftDirty = true;
    state.active.profileId = null;
    renderFromDraft();
    bus.emit('calibration:draft-changed');
    util.byId('cal-name').focus();
    return true;
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
      state.calibrationDraftDirty = false;
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
      ++loadRevision;
      draft = defaultDraft();
      draft.name = '';
      dirty = true;
      state.calibrationDraftDirty = true;
      state.active.profileId = null;
      await refreshProfiles();
      renderFromDraft();
      bus.emit('calibration:draft-changed');
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
      state.calibrationDraftDirty = false;
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

  function newPolicy() {
    return defaultPolicy();
  }
  function buildPolicyControls() {
    var box = util.el('section', {class:'stretch-policy-controls', 'aria-label':'Whole-book stretch rules'});
    box.appendChild(util.el('h3',{text:'Units and whole-book stretch rules'}));
    var requested=util.el('button',{type:'button',class:'btn btn-primary btn-sm',text:'Use requested stretch rules'});
    requested.addEventListener('click',function(){
      draft.stretch_policy=newPolicy();
      draft.non_stretchable=SS.LETTERS.filter(function(letter){return !draft.stretch_policy.caps_percent[letter];});
      draft.stretch_position='anywhere';markDirty();renderFromDraft();
      SS.toast('Requested rules loaded into this profile draft. Save, then compute a new layout. Existing layouts are unchanged.');
    });
    box.appendChild(requested);
    box.appendChild(util.el('p',{class:'profile-help',text:'Requested preset: ד ה ר ת unlimited; other letters and word spaces +50% maximum. Gaps have preference 1, אדהטלמםקרת preference 2, and the rest preference 3. Equal added millimetres within each preference, stopping at each cap.'}));
    function field(label, element) { box.appendChild(util.el('label',{class:'field'},[util.el('span',{text:label}),element])); return element; }
    var layoutMode=field('Line breaks and amudim',util.el('select',{id:'cal-layout-mode'},[
      util.el('option',{value:'reflow',text:'Reflow words to units per line — recalculate amudim'}),
      util.el('option',{value:'reference',text:'Exact reference columns — keep original word positions'})]));
    layoutMode.addEventListener('change',function(){draft.layout_mode=layoutMode.value;markDirty();});
    var unitsMode = field('Unit size calculation',util.el('select',{id:'cal-unit-mode'},[
      util.el('option',{value:'line',text:'Row units — use the letter widths in the table'}),
      util.el('option',{value:'column',text:'Reference-height skeleton units (legacy)'}),util.el('option',{value:'manual',text:'Manual millimetres per unit (legacy)'})]));
    var units = field('Units per row',util.el('input',{id:'cal-units-per-row',type:'number',min:'0.001',step:'1','aria-label':'Units per row'}));
    var hyphenUnits = field('Width per STAM hyphen (line units)',util.el('input',{id:'cal-hyphen-units',type:'number',min:'0',step:'0.25','aria-label':'Width assigned to each STAM hyphen marker'}));
    box.appendChild(util.el('p',{id:'cal-unit-formula',class:'profile-help',role:'status'}));
    var mode = field('Stretch caps',util.el('select',{id:'cal-policy-mode'},[
      util.el('option',{value:'percent',text:'Percentage / unlimited per letter'}),util.el('option',{value:'legacy',text:'Saved millimetre caps (legacy)'})]));
    var distribution = field('Share remaining stretch equally',util.el('select',{id:'cal-stretch-distribution'},[
      util.el('option',{value:'equal_percent',text:'Same percentage increase'}),util.el('option',{value:'equal_mm',text:'Same added millimetres'})]));
    var spaces = field('Word-space maximum increase (%) — up to 50%',util.el('input',{id:'cal-space-percent',type:'number',min:'0',max:'50',step:'1'}));
    var setumaMode = field('Setumah-gap limit',util.el('select',{id:'cal-setuma-mode'},[
      util.el('option',{value:'percent',text:'Percentage increase'}),util.el('option',{value:'unlimited',text:'Unlimited within the column'})]));
    var setumaPercent = field('Setumah-gap maximum increase (%)',util.el('input',{id:'cal-setuma-percent',type:'number',min:'0',step:'1'}));
    box.appendChild(util.el('p',{class:'profile-help',text:'Paragraph lines: gap only. Internal setumah gaps expand before anything else, with no letter or word-space stretching on that line. A petuchah keeps all remaining width as its end-of-line paragraph space. Fixed passages and invalid edge gaps stay unchanged.'}));
    box.appendChild(util.el('p',{class:'profile-help',text:'Save measurements before computing a new layout. Existing saved and written layouts keep their original measurements and stretch decisions.'}));
    root.appendChild(box);
    unitsMode.addEventListener('change',function(){draft.unit_basis=unitsMode.value==='line'?'line_units':'skeleton';draft.units_per_row=unitsMode.value==='manual'?null:(draft.units_per_row||62);markDirty();renderPolicy();renderRows();});
    units.addEventListener('input',function(){draft.units_per_row=Number(units.value);markDirty();refreshColumnUnit();});
    hyphenUnits.addEventListener('input',function(){if(draft.stretch_policy){draft.stretch_policy.stam_hyphen_units=Math.max(0,Number(hyphenUnits.value));markDirty();refreshColumnUnit();}});
    mode.addEventListener('change',function(){
      if(mode.value==='percent') {
        draft.stretch_policy=newPolicy();
        SS.LETTERS.forEach(function(letter){var width=computeTotal(letter);draft.stretch_policy.caps_percent[letter]=width>0?Math.floor((Number(draft.max_stretch[letter])||0)/width*100000)/1000:0;});
      } else {
        if(draft.stretch_policy && Object.values(draft.stretch_policy.caps_percent).includes('unlimited')) {SS.toast('Choose finite percentage caps before switching back to legacy millimetres.','error');mode.value='percent';return;}
        if(draft.stretch_policy) SS.LETTERS.forEach(function(letter){draft.max_stretch[letter]=computeTotal(letter)*Number(draft.stretch_policy.caps_percent[letter]||0)/100;});
        draft.stretch_policy=null;
      }
      markDirty();renderPolicy();renderRows();
    });
    distribution.addEventListener('change',function(){if(draft.stretch_policy){draft.stretch_policy.distribution=distribution.value;markDirty();}});
    spaces.addEventListener('input',function(){if(draft.stretch_policy){draft.stretch_policy.word_space_percent=Number(spaces.value);markDirty();}});
    setumaMode.addEventListener('change',function(){if(draft.stretch_policy){draft.stretch_policy.setuma_percent=setumaMode.value==='unlimited'?'unlimited':50;markDirty();renderPolicy();}});
    setumaPercent.addEventListener('input',function(){if(draft.stretch_policy){draft.stretch_policy.setuma_percent=Number(setumaPercent.value);markDirty();}});
  }
  function columnWidth() {
    var current = SS.geometry && SS.geometry.getDraft && SS.geometry.getDraft();
    if (!current) current = (state.geometries||[]).find(function(g){return g.id===state.active.geometryId;});
    return Number(current && current.line_width_mm) || 180;
  }
  function heightUnitMm() {
    return draft.units_per_row > 0 ? columnWidth() / draft.units_per_row : Number(draft.unit_mm);
  }
  function refreshColumnUnit() {
    if (!draft || !root) return;
    if (draft.letter_height_units != null) draft.letter_height_mm = Number(draft.letter_height_units) * heightUnitMm();
    setFieldValue('letter_height_units', draft.letter_height_units == null ? Number((draft.letter_height_mm / heightUnitMm()).toFixed(6)) : draft.letter_height_units);
    if (draft.units_per_row != null && Number(draft.units_per_row)>0) {
      draft.unit_mm=columnWidth()/Number(draft.units_per_row);
      if(draft.unit_basis==='line_units'){
        draft.unit_mm/=draft.letter_height_mm/draft.reference_height_mm;
      }
      setFieldValue('unit_mm',draft.unit_mm);
    }
    renderRows();
    renderScaleNote();
    var formula=util.byId('cal-unit-formula');
    if(formula){
      if(draft.units_per_row!=null){
        var physicalUnit=columnWidth()/draft.units_per_row;
        var hyphenUnits=draft.stretch_policy && draft.stretch_policy.stam_hyphen_units!=null?Number(draft.stretch_policy.stam_hyphen_units):1;
        formula.textContent=columnWidth()+' mm column ÷ '+draft.units_per_row+' units per row = '+util.fmt(physicalUnit,6)+' mm per '+(draft.unit_basis==='line_units'?'row unit. A 2-unit letter uses 2 row units and a 3-unit letter uses 3. At 62 units, at most 31 two-unit letters fit; stroke and spaces use additional width.':'reference-height skeleton unit (legacy).')+' Each STAM hyphen = '+util.fmt(hyphenUnits,3)+' line units = '+util.fmt(hyphenUnits*physicalUnit,6)+' mm. Spaces also count towards the line. Save and compute a new draft to reflow whole words, change line breaks and recalculate the number of amudim.';
      } else {
        formula.textContent='Legacy manual unit size. Choose row units to calculate from the letter widths in the table and a fixed row budget.';
      }
    }
  }
  function renderPolicy() {
    var policy=draft.stretch_policy;
    var preferences = hasPreferences();
    var legacySpace = util.byId('cal-legacy-word-gap');
    if (legacySpace) legacySpace.hidden = preferences;
    var songButton = util.byId('cal-song-widths');
    if (songButton) songButton.disabled = !preferences;
    util.byId('cal-layout-mode').value=draft.layout_mode;
    util.byId('cal-unit-mode').value=draft.units_per_row==null?'manual':draft.unit_basis==='line_units'?'line':'column';
    util.byId('cal-units-per-row').disabled=draft.units_per_row==null;
    util.byId('cal-units-per-row').value=draft.units_per_row==null?'':draft.units_per_row;
    var unit=util.qs('[data-field="unit_mm"]',root);unit.readOnly=draft.units_per_row!=null;unit.disabled=draft.units_per_row!=null;
    util.byId('cal-policy-mode').value=policy?'percent':'legacy';
    ['cal-stretch-distribution','cal-space-percent','cal-setuma-mode','cal-setuma-percent','cal-hyphen-units'].forEach(function(id){util.byId(id).disabled=!policy;});
    ['cal-space-percent','cal-setuma-mode','cal-setuma-percent','cal-hyphen-units'].forEach(function(id){util.byId(id).parentNode.hidden=preferences;});
    util.byId('cal-cap-heading').textContent=policy?'Maximum increase':'Cap mm';
    if(policy){
      util.byId('cal-stretch-distribution').value=policy.distribution;
      util.byId('cal-space-percent').value=policy.word_space_percent;
      util.byId('cal-setuma-mode').value=policy.setuma_percent==='unlimited'?'unlimited':'percent';
      util.byId('cal-setuma-percent').disabled=policy.setuma_percent==='unlimited';
      util.byId('cal-setuma-percent').value=policy.setuma_percent==='unlimited'?'':policy.setuma_percent;
      util.byId('cal-hyphen-units').value=policy.stam_hyphen_units == null ? 1 : policy.stam_hyphen_units;
    }
    refreshColumnUnit();
  }
  SS.calibration = { init: init, startNew: newProfile, requestedRules:newPolicy, getDraft:function(){return draft;}, isDirty: function () { return dirty; }, selectSaved: function () { dirty=false; ++loadRevision; } };
})();
