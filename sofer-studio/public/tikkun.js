/*
 * Sofer Studio — tikkun.js
 * The parchment preview: RTL Hebrew columns, sirtut, human-marked holy letters,
 * unusual letters, line hover -> Sargel Rule, selection, taggin toggle,
 * and chunked rendering for large sources.
 *
 * Every value drawn comes from the real layout object in SS.state.layout
 * (produced by POST /api/layout/compute). No sample text is hardcoded.
 */
(function () {
  'use strict';
  var SS = window.SS;
  var util = SS.util;
  var bus = SS.bus;
  var state = SS.state;

  var container = null;   // #tikkun-scroll
  var refEl = null;       // #tikkun-ref
  var renderToken = 0;    // cancels stale renders
  var tagginOn = false;
  var selectedKey = null; // "amud:line"

  // The seven letters that traditionally receive taggin (visual only).
  var TAGGIN = { '\u05e9': 1, '\u05e2': 1, '\u05d8': 1, '\u05e0': 1, '\u05d6': 1, '\u05d2': 1, '\u05e5': 1 };

  function init(ctx) {
    container = util.byId('tikkun-scroll');
    refEl = util.byId('tikkun-ref');

    bus.on('layout:loaded', function (layout) { render(layout); });
    bus.on('taggin:toggle', function (on) { tagginOn = !!on; rerender(); });
    bus.on('jump:line', function (payload) { jumpToLine(payload); });
    bus.on('jump:amud', function (amud) { jumpToAmud(amud); });
    bus.on('flash:shem', function (token) { flashToken(token); });
    bus.on('line:status', function () { rerender(); });

    renderEmpty();
  }

  /* ---------- pick first defined field ---------- */
  function pick(o, keys, dflt) {
    if (!o) return dflt;
    for (var i = 0; i < keys.length; i++) {
      if (o[keys[i]] !== undefined && o[keys[i]] !== null) return o[keys[i]];
    }
    return dflt;
  }

  function lineText(line) {
    return String(pick(line, ['content', 'text', 'hebrew', 'token_text'], ''));
  }
  function lineAmud(line) {
    return pick(line, ['amud', 'amud_index', 'amud_number', 'page'], null);
  }

  // F-27: a loaded layout's geometry must come from the persisted snapshot (the
  // GET /api/layouts/:id response and the layout.snapshot.geometry), NEVER from
  // the live geometry selector — otherwise changing the selector would reflow a
  // locked layout's preview. The live selector is only a last-resort fallback
  // before any layout is loaded.
  function layoutGeometry(layout) {
    if (layout && layout.geometry) return layout.geometry;
    if (layout && layout.snapshot && layout.snapshot.geometry) return layout.snapshot.geometry;
    return SS.activeGeometry ? SS.activeGeometry() : null;
  }

  /* ---------- rendering ---------- */
  function renderEmpty() {
    if (!container) return;
    util.clear(container);
    var msg = util.el('div', { class: 'empty' },
      [util.el('span', { class: 'emark', text: '\u05e1\u05e4\u05e8' }),
       util.el('p', { text: 'No layout computed yet.' }),
       util.el('p', { class: 't--1', text: 'Choose a source, profile and geometry, then click “Compute layout”.' })]);
    container.appendChild(msg);
    if (refEl) refEl.textContent = '';
  }

  function render(layout) {
    var token = ++renderToken;
    if (!container) return;
    if (!layout || !Array.isArray(layout.lines) || layout.lines.length === 0) {
      renderEmpty();
      return;
    }
    util.clear(container);

    // Group lines into amudim (columns), preserving order.
    var amudim = [];   // [{ index, lines: [] }]
    var indexOfAmud = {};
    layout.lines.forEach(function (line, i) {
      var a = lineAmud(line);
      var key = (a === null || a === undefined) ? -1 : a;
      if (!Object.prototype.hasOwnProperty.call(indexOfAmud, key)) {
        indexOfAmud[key] = amudim.length;
        amudim.push({ num: key, lines: [] });
      }
      amudim[indexOfAmud[key]].lines.push(line);
    });

    // restructure: if no explicit amud numbers, treat amudim as discovered
    amudim.forEach(function (g, gi) {
      if (g.num === -1) g.num = gi + 1;
    });

    var sheet = util.el('div', { class: 'sheet' });
    sheet.setAttribute('lang', 'he');
    sheet.setAttribute('dir', 'rtl');
    applyFitScale(sheet, layout);

    // Watermark excerpts, partial corpora, and study-preview layouts (known
    // special passages rendered without a verified pattern) — none is writing-ready.
    var isExcerpt = !!(layout.summary && layout.summary.is_excerpt);
    var isStudyPreview = !!(layout.summary && layout.summary.study_preview);
    var src = (SS.activeSource ? SS.activeSource() : null);
    var isPartial = !!(src && src.partial_corpus && !src.excerpt);
    if (isExcerpt || isStudyPreview || isPartial) {
      var wm = util.el('div', { class: 'watermark', text: isStudyPreview ? 'STUDY PREVIEW — NOT WRITING-READY' : (isExcerpt ? 'SAMPLE TEXT' : 'PARTIAL CORPUS — NOT THE FULL FIVE BOOKS') });
      sheet.appendChild(wm);
    }

    var row = util.el('div', { class: 'amudim-row' });
    sheet.appendChild(row);

    // Build amud DOM elements (deferred append for chunking).
    var amudEls = [];
    amudim.forEach(function (g, gi) {
      var lastYeria = layout.summary && layout.summary.amudim_per_yeria &&
        (g.num % layout.summary.amudim_per_yeria === 0);
      var el = buildAmud(g, gi, layout, lastYeria);
      amudEls.push(el);
    });

    // Chunked append: wire horizontal seams per yeria handled in buildAmud.
    var chunk = 4;
    (function appendNext(start) {
      if (token !== renderToken) return;
      var end = Math.min(start + chunk, amudEls.length);
      for (var i = start; i < end; i++) row.appendChild(amudEls[i]);
      if (end < amudEls.length) {
        setTimeout(function () { appendNext(end); }, 0);
      }
    })(0);

    container.appendChild(sheet);
    fillPrintNote(layout);
  }

  function buildAmud(g, gi, layout, isYeriaEdge) {
    var amud = util.el('div', { class: 'amud' + (isYeriaEdge ? ' onde' : '') });
    amud.dataset.amud = String(g.num);

    var head = util.el('div', { class: 'sheet-head' });
    head.appendChild(util.el('span', { class: 'amud-num', text: 'Amud ' + g.num + ' ' }));
    head.appendChild(util.el('span', { class: 'amud-num gim', text: '\u05e2\u05de\u05d5\u05d3 ' + util.gimatria(g.num) }));
    amud.appendChild(head);

    var linesWrap = util.el('div', { class: 'lines' });

    // sirtut grid (uniform baseline pitch)
    var grid = util.el('div', { class: 'sirtut-grid' });
    linesWrap.appendChild(grid);

    var geom = layoutGeometry(layout);
    var pitch = (geom && geom.baseline_pitch_mm) || 10;

    g.lines.forEach(function (line, li) {
      var lineEl = renderLine(line, g.num, li, g.lines.length, pitch);
      linesWrap.appendChild(lineEl);

      var lr = util.el('span', { class: 'lr' });
      lr.style.top = (li * lineEl.estimatedHeight) + 'px';
      grid.appendChild(lr);
    });

    amud.appendChild(linesWrap);
    return amud;
  }

  function renderLine(line, amudNum, li, totalInAmud, pitch) {
    var text = lineText(line);
    var num = pick(line, ['line_index', 'line_number', 'local_index'], li + 1);

    var el = util.el('div', {
      class: 'line' + (line.status && line.status !== 'pending' ? ' status-' + line.status : ''),
      dataset: { amud: String(amudNum), line: String(num) }
    });
    el.setAttribute('role', 'listitem');

    var gim = util.el('span', { class: 'lnum', text: util.gimatria(num) });
    gim.setAttribute('lang', 'he');
    el.appendChild(gim);

    var txt = util.el('span', { class: 'ltext' });
    txt.setAttribute('lang', 'he');
    txt.setAttribute('dir', 'rtl');

    appendLineContent(txt, line, text);

    el.appendChild(txt);

    // side note: leftover / width
    var leftover = pick(line, ['leftover_mm', 'leftover'], null);
    var width = pick(line, ['width_mm', 'width'], null);
    var side = [];
    if (leftover !== null && leftover !== undefined && util.isFiniteNum(leftover) && Number(leftover) !== 0) {
      side.push((Number(leftover) > 0 ? '+' : '') + util.fmt(leftover) + '\u00a0mm');
    }
    if (width !== null && width !== undefined && util.isFiniteNum(width)) {
      side.push(util.fmt(width) + '\u00a0mm');
    }
    if (side.length) {
      el.appendChild(util.el('span', { class: 'side', text: side.join(' · ') }));
    }

    // aria label: amud, line, verse ref
    var ref = pick(line, ['verse_ref', 'ref', 'verse'], '');
    el.setAttribute('aria-label', 'Amud ' + amudNum + ', line ' + num + (ref ? ', ' + ref : ''));

    // hover -> sargel tick (physical mm = (index)*pitch from column top)
    el.addEventListener('mouseenter', function () {
      bus.emit('sargel:tick', (li) * pitch);
    });
    el.addEventListener('mouseleave', function () {
      bus.emit('sargel:tick', null);
    });
    el.addEventListener('click', function () { selectLine(el, line, amudNum, num); });

    // store estimate for sirtut placement
    el.estimatedHeight = 18 * 1.5 + 4; // approx em height
    return el;
  }

  /* Render a line's content from MEASURED boxes (F-11): one positioned box per
   * word with width:width_mm, one element per items[] entry (setuma_gap /
   * segment_gap), per-letter spans for stretch/override and holy-name marks
   * marking driven only by exact human-authored letter metadata from the backend.
   * The browser never classifies a word as holy. */
  function appendLineContent(parent, line, text) {
    var words = Array.isArray(line.words) ? line.words : [];
    var items = Array.isArray(line.items) ? line.items : [];
    var stretch = mapStretch(line);
    var wi = 0;

    function wordBox(word, wordIndex) {
      var box = util.el('span', { class: 'word-box' });
      box.setAttribute('dir', 'rtl');
      box.setAttribute('lang', 'he');
      if (util.isFiniteNum(word.width_mm)) {
        box.style.setProperty('--word-width-mm', String(word.width_mm));
        var wordStretchMm = (word.letters || []).reduce(function (sum, letter) { return sum + Number(stretch[letter.id] && stretch[letter.id].stretch_mm || 0); }, 0);
        box.style.inlineSize = String(Number(word.width_mm) + wordStretchMm) + 'mm';
        box.style.columnGap = String(Number(line.inter_letter_gap_mm || 0)) + 'mm';
        box.dataset.widthMm = String(word.width_mm);
        box.title = 'word width ' + util.mm(Number(word.width_mm));
      }
      var isShem = !!word.isShem;
      var uncertain = !!(word.uncertain || (word.shem && word.shem.uncertain));
      if (isShem) {
        box.dataset.shem = '1';
        box.title = 'Holy letters (\u05e9\u05de\u05d5\u05ea \u05e7\u05d5\u05d3\u05e9) marked by human input';
      }
      var letters = Array.isArray(word.letters) ? word.letters : [];
      var overrides = {};
      (word.override || []).forEach(function (o) { if (o && o.id) overrides[o.id] = o; });
      var graphemes = util.graphemes(word.text || word.consonant || '');
      graphemes.forEach(function (g, li) {
        var lt = letters[li];
        var lid = lt ? lt.id : null;
        var s = util.el('span', { class: 'lk' });
        s.textContent = g;
        if (lt && util.isFiniteNum(lt.width_mm)) {
          s.style.inlineSize = String(Number(lt.width_mm) + Number(lid && stretch[lid] && stretch[lid].stretch_mm || 0)) + 'mm';
        }
        if (lt && lt.holy) {
          s.classList.add('holy-letter');
          s.title = 'Holy letter — human decision';
        }
        if (lt && lt.stam_letter_mark) {
          var markerType = lt.stam_letter_mark.type;
          s.classList.add('marker-' + markerType);
          if (markerType === 'backward_nun') s.textContent = '\u05e0';
        }
        if (g === '\u05dc' && wordIndex === 0 && li === 0) s.classList.add('lamed-line-start');
        if (g === '\u05dc' && wordIndex === words.length - 1 && li === graphemes.length - 1) s.classList.add('lamed-line-end');
        if (tagginOn && TAGGIN[g]) s.classList.add('taggin');
        if (lid && stretch[lid]) {
          s.classList.add('stretched');
          var dmm = Number(stretch[lid].stretch_mm || 0);
          s.title = 'stretched +' + util.mm(dmm);
          s.dataset.stretchMm = String(dmm);
        }
        if (lid && overrides[lid]) {
          var o = overrides[lid];
          if (Number(o.stam_hyphens) > 0) {
            box.appendChild(util.el('span', { class: 'hyphen-mark', text: '-'.repeat(Number(o.stam_hyphens)) }));
          }
          s.classList.add('unusual-letter');
          s.classList.add('ov-' + (o.type || 'large'));
          s.dataset.occurrence = o.occurrence_id || lid;
          s.dataset.overrideType = o.type || '';
          s.title = (o.type || 'unusual') + ' override ' + util.mm(Number(o.mm || 0));
        }
        box.appendChild(s);
      });
      return box;
    }

    function gapEl(it) {
      var cls = it.type === 'setuma_gap' ? 'setuma-gap' : 'segment-gap';
      var g = util.el('span', { class: cls });
      g.textContent = '\u00a0';
      if (util.isFiniteNum(it.width_mm)) {
        g.dataset.widthMm = String(it.width_mm);
        g.style.setProperty('--gap-width-mm', String(it.width_mm));
        g.title = cls + ' ' + util.mm(Number(it.width_mm));
      }
      return g;
    }

    if (items.length) {
      // Authoritative: render one element per items[] entry, consuming words in order.
      items.forEach(function (it, itemIndex) {
        if (it.type === 'word') {
          if (itemIndex > 0 && items[itemIndex - 1].type === 'word') {
            var wordGap = util.el('span', { class: 'word-gap', text: '\u00a0' });
            wordGap.style.inlineSize = String(Number(line.inter_word_gap_mm || 0)) + 'mm';
            parent.appendChild(wordGap);
          }
          parent.appendChild(wordBox(words[wi] || { text: it.text || it.consonant || '', width_mm: it.width_mm, letters: [], override: [] }, wi));
          wi++;
        } else if (it.type === 'setuma_gap' || it.type === 'segment_gap') {
          parent.appendChild(gapEl(it));
        }
      });
    } else if (words.length) {
      words.forEach(function (w, i) {
        if (i > 0) parent.appendChild(document.createTextNode(' '));
        parent.appendChild(wordBox(w, i));
      });
    } else {
      // Legacy fallback with NO backend metadata: raw text + honest label (F-12).
      parent.appendChild(document.createTextNode(text));
      parent.appendChild(util.el('span', { class: 't--2 faint legacy-note', text: ' (no backend metadata)' }));
    }
  }

  function mapStretch(line) {
    var map = {};
    var sd = pick(line, ['stretch_decisions', 'stretch'], []);
    if (!Array.isArray(sd)) return map;
    sd.forEach(function (d) {
      var id = pick(d, ['letter_occurrence_id', 'occurrence_id', 'id'], null);
      if (id !== null && id !== undefined) map[id] = d;
    });
    return map;
  }

  /* ---------- selection & jumps ---------- */
  function selectLine(el, line, amudNum, num) {
    if (!container) return;
    util.qsa('.line.is-selected', container).forEach(function (x) { x.classList.remove('is-selected'); });
    el.classList.add('is-selected');
    selectedKey = amudNum + ':' + num;
    var ref = pick(line, ['verse_ref', 'ref', 'verse'], '');
    if (refEl) refEl.textContent = 'Amud ' + amudNum + ' \u00b7 line ' + num + (ref ? ' \u00b7 ' + ref : '');
    bus.emit('line:selected', { amud: amudNum, line: num, ref: ref, raw: line });
  }

  function findLine(amud, num) {
    if (!container) return null;
    var cands = util.qsa('.line[data-amud="' + amud + '"]', container);
    for (var i = 0; i < cands.length; i++) {
      if (String(cands[i].dataset.line) === String(num)) return cands[i];
    }
    // fallback: positional line within amud
    return (num > 0 && num <= cands.length) ? cands[num - 1] : (cands[0] || null);
  }

  function jumpToLine(payload) {
    if (!payload) return;
    var amud = payload.amud != null ? payload.amud : payload.amud_index;
    var num = payload.line != null ? payload.line : payload.line_index;
    var el = findLine(amud, num);
    if (!el) { SS.toast && SS.toast('Line not found in current layout.', 'error'); return; }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    pulse(el);
  }

  function jumpToAmud(amud) {
    if (!container) return;
    var el = util.qs('.amud[data-amud="' + amud + '"]', container);
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function pulse(el) {
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.classList.add('pulse');
    if (!reduced) {
      setTimeout(function () { el.classList.remove('pulse'); }, 650);
    }
  }

  function flashToken(token) {
    if (!container || !token) return;
    util.qsa('.shem-tok', container).forEach(function (s) {
      if (s.dataset.shem && (s.textContent.indexOf(token) >= 0 || token.indexOf(s.textContent) >= 0)) {
        s.scrollIntoView({ block: 'center', behavior: 'smooth' });
        pulse(s);
      }
    });
  }

  function rerender() {
    if (state.layout) render(state.layout);
  }

  // Explicit fitting: scale the parchment so the measured column width maps to the
  // available viewport, but never clip — anything still wider scrolls horizontally.
  function applyFitScale(sheet, layout) {
    try {
      var g = layoutGeometry(layout);
      var lineWidthMm = g && g.line_width_mm;
      if (!lineWidthMm || !container) return;
      var pxPerMm = 96 / 25.4;
      var fullPx = lineWidthMm * pxPerMm;
      var avail = container.clientWidth - 120;
      if (!avail || avail < 40) avail = 640;
      var scale = Math.min(1, avail / fullPx);
      if (scale < 0.35) scale = 0.35;
      sheet.style.setProperty('--tf-scale', String(scale));
    } catch (e) { /* non-fatal */ }
  }

  function fillPrintNote(layout) {
    var el = util.byId('print-note');
    if (!el) return;
    var g = layoutGeometry(layout);
    var lines = layout.summary ? layout.summary.total_lines : null;
    el.textContent = 'Printer scaling note: this layout is measured in physical millimetres ' +
      '(line width ' + ((g && g.line_width_mm) ? util.mm(g.line_width_mm) : 'n/a') + '). ' +
      'A screen font is not proof of nib-calibrated dimensions — print at 100% scale, verify one ' +
      'amud against a real ruler, then adjust the printer scale factor.' +
      (lines != null ? (' Layout: ' + lines + ' lines.') : '');
  }

  SS.tikkun = {
    init: init,
    render: render,
    jumpToLine: jumpToLine,
    jumpToAmud: jumpToAmud,
    flashToken: flashToken
  };
})();
