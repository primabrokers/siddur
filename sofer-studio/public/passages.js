/*
 * Sofer Studio — passages.js
 * Fixed passage patterns (Shiras HaYam, Ha'azinu, inverted nuns of Vayehi
 * Binso'a) with selectable schemes from GET /api/patterns, unusual-letter
 * occurrences with width overrides, and the taggin display toggle.
 *
 * Pattern definitions carry source + version + provenance from the server;
 * missing verified data shows an explicit blocker (never silent normal wrap).
 */
(function () {
  'use strict';
  var SS = window.SS;
  var util = SS.util;
  var bus = SS.bus;
  var state = SS.state;
  var API;

  var root = null;
  var tagginState = false;

  // The three product-defined special passages (named in the requirements —
  // these are fixed passages, not sample data).
  var PASSAGES = [
    { key: 'shiras_hayam', en: 'Shiras HaYam', he: '\u05e9\u05d9\u05e8\u05ea \u05d4\u05d9\u05dd', shape: 'brick', defaultSchemeName: 'Ariach al gabei leveinah' },
    { key: 'haazinu', en: 'Ha\u2019azinu', he: '\u05d4\u05d0\u05d6\u05d9\u05e0\u05d5', shape: 'columns', defaultSchemeName: 'Two-column 70-line' },
    { key: 'vayehi_binsoa', en: 'Vayehi Binso\u2019a', he: '\u05d5\u05d9\u05d4\u05d9 \u05d1\u05e0\u05e1\u05e2', shape: 'nuns', defaultSchemeName: 'Inverted nun bracket' }
  ];

  function init(ctx) {
    API = ctx.api;
    root = util.byId('passages-body');
    if (!root) return;
    buildStatic();
    bus.on('patterns:list', renderPassages);
    bus.on('app:ready', renderPassages);
    bus.on('layout:loaded', loadOccurrences);
    bus.on('sourceId:changed', loadOccurrences);
    renderPassages();
    loadOccurrences();
  }

  /* ------------------------------------------------------------------ *
   * Passage cards
   * ------------------------------------------------------------------ */
  function buildStatic() {
    root.appendChild(util.el('div', { class: 'passages-list', id: 'passages-list' }));
    root.appendChild(util.el('div', { class: 'sirtut' }));

    var occHead = util.el('div', { class: 'eyebrow', text: 'Unusual letter occurrences' });
    root.appendChild(occHead);
    root.appendChild(util.el('div', { id: 'occurrences-list' }));

    root.appendChild(util.el('div', { class: 'sirtut' }));

    // Taggin toggle
    var tog = util.el('label', { class: 'toggle' },
      [util.el('input', { type: 'checkbox', id: 'taggin-toggle' }),
       util.el('span', { text: 'Show taggin (display only)' })]);
    root.appendChild(tog);
    root.appendChild(util.el('div', { class: 't--2 faint', text: 'Display only \u2014 does not change measurements.' }));
    util.byId('taggin-toggle').addEventListener('change', function () {
      tagginState = util.byId('taggin-toggle').checked;
      bus.emit('taggin:toggle', tagginState);
    });

    // occurrence override stepper feedback lives in renderOccurrences
    root.appendChild(util.el('div', { id: 'occ-overrides' }));
  }

  function renderPassages() {
    var list = util.byId('passages-list');
    if (!list) return;
    util.clear(list);

    state.active.enabledPatterns = state.active.enabledPatterns || {};

    PASSAGES.forEach(function (p) {
      var card = util.el('div', { class: 'pass-card' });
      card.appendChild(util.el('div', { class: 'pname', lang: 'he', text: p.he + ' \u00b7 ' + p.en }));

      // scheme select (populated from real patterns)
      var matching = (state.patterns || []).filter(function (pat) {
        return String(pat.passage_name || '').indexOf(p.key) >= 0 || String(pat.passage_name || '').indexOf(p.en) >= 0;
      });
      var sel = util.el('select', { class: 'pass-scheme', 'data-passage': p.key });
      if (matching.length) {
        matching.forEach(function (pat) {
          var label = (pat.scheme_name || 'scheme') + (pat.version ? ' \u00b7 ' + pat.version : '');
          sel.appendChild(util.el('option', { value: pat.id, text: label }));
        });
      } else {
        sel.appendChild(util.el('option', { value: '', text: p.defaultSchemeName + ' \u2014 none configured' }));
      }
      card.appendChild(sel);

      // mini SVG of pattern shape
      card.appendChild(patternShape(p.shape));

      // provenance line
      var prov = matching.length ? matching[0].provenance : null;
      if (prov) card.appendChild(util.el('div', { class: 'pmeta', text: 'Provenance: ' + prov }));

      // enable toggle
      var enabled = !!state.active.enabledPatterns[p.key];
      var tgl = util.el('label', { class: 'toggle' },
        [util.el('input', { type: 'checkbox', 'data-enable': p.key, checked: enabled }),
         util.el('span', { text: 'Apply pattern' })]);
      card.appendChild(tgl);

      // Status label reflects REAL backend behaviour — never decorative.
      var enabledId = state.active.enabledPatterns[p.key];
      var concreteId = (enabledId && enabledId !== true) ? enabledId : null;
      var selectedPattern = concreteId ? matching.find(function (pat) { return pat.id === concreteId; }) : null;
      var statusChip = function (text, cls) {
        return util.el('div', { class: 'blocker' }, util.el('span', { class: 'chip' + (cls ? ' ' + cls : ''), text: text }));
      };
      if (!concreteId) {
        // F-02: with no verified pattern selected the server fails closed on any
        // known special passage — normal wrapping is not permitted, so surface
        // this as an error state rather than a neutral "no pattern" notice.
        card.appendChild(statusChip('no pattern selected — normal wrapping is blocked for known special passages (fail-closed); select a verified pattern', 'error'));
      } else if (!selectedPattern) {
        card.appendChild(statusChip('pattern data missing \u2014 no matching scheme (blocker)', 'error'));
      } else if (selectedPattern.status !== 'verified') {
        card.appendChild(statusChip('unverified pattern data (' + (selectedPattern.status || 'unavailable') + ') \u2014 blocker', 'error'));
      } else {
        card.appendChild(statusChip('fixed pattern applied', ''));
      }

      sel.addEventListener('change', function () {
        state.active.enabledPatterns[p.key] = sel.value || null;
        syncEnabledPatterns();
      });
      util.qs('input[data-enable]', card).addEventListener('change', function (ev) {
        state.active.enabledPatterns[p.key] = ev.target.checked ? (sel.value || true) : null;
        syncEnabledPatterns();
      });

      list.appendChild(card);
    });
  }

  function syncEnabledPatterns() {
    var ids = [];
    Object.keys(state.active.enabledPatterns || {}).forEach(function (k) {
      var v = state.active.enabledPatterns[k];
      if (v && v !== true) ids.push(v);
    });
    state.active.patternIds = ids;
    bus.emit('patterns:changed', ids);
  }

  function patternShape(shape) {
    var wrap = util.el('div', { class: 'mini-svg' });
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 120 34');
    svg.setAttribute('preserveAspectRatio', 'none');
    var ink = '#3E8E81';
    function rect(x, y, w, h, fill) {
      var r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', h);
      r.setAttribute('fill', fill || '#2C6B60');
      svg.appendChild(r);
      return r;
    }
    if (shape === 'brick') {
      // brick-over-brick rows
      for (var row = 0; row < 3; row++) {
        var y = 2 + row * 11;
        var offset = (row % 2 === 0) ? 0 : 12;
        for (var i = 0; i < 4; i++) rect(offset + i * 26, y, 22, 8, ink);
      }
    } else if (shape === 'columns') {
      rect(4, 4, 50, 26, ink);
      rect(66, 4, 50, 26, ink);
    } else if (shape === 'nuns') {
      rect(20, 8, 22, 18, ink);
      rect(78, 8, 22, 18, ink);
      rect(56, 2, 8, 30, '#C79A3F');
    }
    wrap.appendChild(svg);
    return wrap;
  }

  /* ------------------------------------------------------------------ *
   * Unusual letter occurrences
   * ------------------------------------------------------------------ */
  var occurrences = [];   // source unusual_letters (id/ref/type from GET /api/sources/:id)
  var overrides = {};     // occurrence_id -> { occurrence_id, type, letter, ref, width_override_mm }

  function loadOccurrences() {
    var srcId = state.active.sourceId;
    if (!srcId) { renderOccurrences([]); return; }
    API.getSource(srcId).then(function (src) {
      occurrences = (src && src.unusual_letters) || [];
      renderOccurrences(occurrences);
    }).catch(function () { renderOccurrences([]); });
  }

  function renderOccurrences(list) {
    var el = util.byId('occurrences-list');
    if (!el) return;
    util.clear(el);

    if (!list || !list.length) {
      el.appendChild(util.el('div', { class: 'empty', text: 'No unusual letters in this source.' }));
      return;
    }

    var tbl = util.el('table', { class: 'data' });
    tbl.appendChild(util.el('thead', {}, util.el('tr', {}, [
      util.el('th', { text: 'Type' }), util.el('th', { text: 'Letter' }),
      util.el('th', { text: 'Ref' }), util.el('th', { text: 'ID' }),
      util.el('th', { text: 'Override mm' })
    ])));
    var tbody = util.el('tbody', {});
    tbl.appendChild(tbody);

    list.forEach(function (o) {
      var oid = o.occurrence_id || o.id || null;
      var tr = util.el('tr', {});
      tr.appendChild(util.el('td', {}, util.el('span', { class: 'chip candidate', text: o.type || 'unusual' })));
      tr.appendChild(util.el('td', { class: 'heb', lang: 'he', text: o.letter || '' }));
      tr.appendChild(util.el('td', { class: 'mono t--1', text: o.ref || '' }));
      tr.appendChild(util.el('td', { class: 'mono t--1', text: oid || '' }));

      var cur = overrides[oid] && overrides[oid].width_override_mm != null ? overrides[oid].width_override_mm : o.width_override_mm;
      var ov = util.el('input', { class: 'cell', type: 'number', step: '0.05', placeholder: 'auto', value: (cur != null ? cur : '') });
      ov.addEventListener('change', function () {
        var v = ov.value === '' ? null : util.parseNum(ov.value);
        overrides[oid] = { occurrence_id: oid, type: o.type, letter: o.letter, ref: o.ref, width_override_mm: v };
      });
      tr.appendChild(util.el('td', { class: 'num' }, ov));
      tbody.appendChild(tr);
    });
    el.appendChild(tbl);

    var save = util.el('button', { class: 'btn btn-primary btn-sm', text: 'Save overrides & recompute' });
    save.addEventListener('click', saveOverrides);
    el.appendChild(save);
  }

  function saveOverrides() {
    var items = Object.keys(overrides).map(function (k) { return overrides[k]; })
      .filter(function (o) { return o && o.width_override_mm != null; });
    state.active.annotations = state.active.annotations || {};
    state.active.annotations.unusual_letters = items;
    SS.toast('Occurrence overrides saved to annotations. Recomputing…');
    if (SS.app && SS.app.compute) SS.app.compute();
  }

  SS.passages = { init: init };
})();
