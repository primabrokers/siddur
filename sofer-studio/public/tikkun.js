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
  var API, movingWord = false;

  var container = null;   // #tikkun-scroll
  var refEl = null;       // #tikkun-ref
  var renderToken = 0;    // cancels stale renders
  var tagginOn = false;
  var selectedKey = null; // "amud:line"
  var pageIndex = 0, pageEls = [], fitMode = 'width', frame = null, currentSheet = null;
  var toolbar, pageSelect, fitSelect, scaleLabel, prevButton, nextButton, expandButton;
  var fitPending = false, renderedLayout = null, renderedCount = 0;
  var buildPage = null, pageGroups = [], printReady = false, preparingPrint = false;
  var scrollPending = false;
  var reverseLines = false, reverseToggle;

  // The seven letters that traditionally receive taggin (visual only).
  var TAGGIN = { '\u05e9': 1, '\u05e2': 1, '\u05d8': 1, '\u05e0': 1, '\u05d6': 1, '\u05d2': 1, '\u05e5': 1 };

  function init(ctx) {
    API = ctx.api || SS.api;
    container = util.byId('tikkun-scroll');
    refEl = util.byId('tikkun-ref');
    buildPreviewControls();
    container.addEventListener('scroll', scheduleVisiblePages, { passive: true });
    if (window.ResizeObserver) new ResizeObserver(scheduleFit).observe(container);
    window.addEventListener('resize', scheduleFit);
    if (document.fonts) document.fonts.load('24px "Stam Ashkenaz CLM"', 'אבגד').then(scheduleFit).catch(function () {
      SS.toast && SS.toast('STaM font could not load. Do not use the fallback preview for writing.', 'error');
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') setExpanded(false);
    });

    bus.on('layout:loaded', function (layout) { render(layout); });
    bus.on('taggin:toggle', function (on) { tagginOn = !!on; rerender(); });
    bus.on('jump:line', function (payload) { jumpToLine(payload); });
    bus.on('jump:amud', function (amud) { jumpToAmud(amud); });
    bus.on('flash:shem', function (token) { flashToken(token); });
    bus.on('line:status', function () { rerender(); });

    renderEmpty();
  }

  function buildPreviewControls() {
    toolbar = util.el('div', { class: 'preview-toolbar', 'aria-label': 'Preview controls' });
    prevButton = util.el('button', { class: 'btn btn-ghost btn-sm', text: 'Previous', 'aria-label': 'Previous page' });
    nextButton = util.el('button', { class: 'btn btn-ghost btn-sm', text: 'Next', 'aria-label': 'Next page' });
    pageSelect = util.el('select', { 'aria-label': 'Preview page' });
    fitSelect = util.el('select', { 'aria-label': 'Preview zoom' }, [
      util.el('option', { value: 'page', text: 'Fit whole page' }),
      util.el('option', { value: 'width', text: 'Fit width' }),
      util.el('option', { value: 'actual', text: '100% view' })
    ]);
    fitSelect.value = fitMode;
    scaleLabel = util.el('span', { class: 'mono t--2', 'aria-live': 'polite' });
    expandButton = util.el('button', { class: 'btn btn-ghost btn-sm', text: 'Focus mode', 'aria-pressed': 'false' });
    var printButton = util.el('button', { class: 'btn btn-primary btn-sm', text: 'Download', id: 'preview-print' });
    var sectionToggle = util.el('input', { type: 'checkbox', checked: true, id: 'section-guides-toggle' });
    var sectionLabel = util.el('label', { class: 'toggle' }, [sectionToggle,
      util.el('span', { text: 'פ/ס guides' })]);
    sectionLabel.title = 'Section markers are screen-only guides and are not printed.';
    var help = util.el('details', { class: 'preview-help' }, [util.el('summary', { text: 'Reading the preview' }), util.el('p', { text: 'Scroll down through every page. The note to the right of each line shows its missing units before stretching: ש״ת = complete, ח״א = 1 unit, ח״ב = 2 units. Section and book-end spaces stay open. Downloads include all pages.' })]);
    [prevButton, pageSelect, nextButton, fitSelect, scaleLabel, expandButton, printButton].forEach(function (e) { toolbar.appendChild(e); });
    toolbar.appendChild(sectionLabel);
    reverseToggle = util.el('input', { type: 'checkbox', id: 'preview-reverse-lines' });
    toolbar.appendChild(util.el('label', { class: 'toggle', title: 'Line 1 at the bottom; keep every line on its original page.' }, [reverseToggle, util.el('span', { text: 'Reverse lines' })]));
    reverseToggle.addEventListener('change', function () { setReverseLines(reverseToggle.checked); });
    sectionToggle.addEventListener('change', function () {
      container.classList.toggle('hide-section-guides', !sectionToggle.checked);
    });
    toolbar.appendChild(help);
    container.parentNode.insertBefore(toolbar, container);
    prevButton.addEventListener('click', function () { selectPage(pageIndex - 1); });
    nextButton.addEventListener('click', function () { selectPage(pageIndex + 1); });
    pageSelect.addEventListener('change', function () { selectPage(Number(pageSelect.value)); });
    fitSelect.addEventListener('change', function () { fitMode = fitSelect.value; scheduleFit(); });
    expandButton.addEventListener('click', function () { setExpanded(!util.byId('tikkun-region').classList.contains('preview-expanded')); });
    printButton.addEventListener('click', function () { if (SS.workspace) SS.workspace.open('download'); else if (SS.export) SS.export.printLayout(); });
  }

  function setExpanded(on) {
    var region = util.byId('tikkun-region');
    if (!region || !expandButton) return;
    region.classList.toggle('preview-expanded', !!on);
    document.body.classList.toggle('document-focus', !!on);
    expandButton.textContent = on ? 'Exit focus' : 'Focus mode';
    expandButton.setAttribute('aria-pressed', String(!!on));
    scheduleFit();
  }

  function setReverseLines(on) {
    reverseLines = !!on;
    if (reverseToggle) reverseToggle.checked = reverseLines;
    if (currentSheet) currentSheet.classList.toggle('reverse-lines', reverseLines);
    bus.emit('preview:reverse-lines', reverseLines);
    scheduleFit();
  }

  function selectPage(index) {
    if (!pageEls.length) return;
    pageIndex = Math.max(0, Math.min(pageEls.length - 1, index));
    printReady = false;
    container.classList.remove('print-ready');
    renderPageWindow(pageIndex, pageIndex);
    updatePageControls();
    fitPage();
    pageEls[pageIndex].scrollIntoView({ block: 'start' });
    scheduleVisiblePages();
  }

  function updatePageControls() {
    pageSelect.value = String(pageIndex);
    prevButton.disabled = pageIndex === 0; nextButton.disabled = pageIndex === pageEls.length - 1;
  }

  function renderPageWindow(first, last) {
    if (printReady || preparingPrint) return false;
    var changed = false;
    pageEls.forEach(function (el, i) {
      var needed = i >= first - 1 && i <= last + 1;
      if (needed === !!el.dataset.rendered) return;
      var replacement = buildPage(i, !needed);
      el.replaceWith(replacement); pageEls[i] = replacement; changed = true;
    });
    return changed;
  }

  function scheduleVisiblePages() {
    if (scrollPending || printReady || preparingPrint) return;
    scrollPending = true;
    requestAnimationFrame(function () {
      scrollPending = false;
      if (!pageEls.length || renderedCount !== pageEls.length || !container.clientHeight || printReady || preparingPrint) return;
      var viewport = container.getBoundingClientRect(), first = -1, last = -1;
      pageEls.forEach(function (el, i) {
        var rect = el.getBoundingClientRect();
        if (rect.bottom > viewport.top && rect.top < viewport.bottom) {
          if (first < 0) first = i;
          last = i;
        }
      });
      if (first < 0) return;
      pageIndex = first; updatePageControls();
      if (renderPageWindow(first, last)) scheduleFit();
    });
  }

  async function preparePrint() {
    if (document.fonts) await document.fonts.load('24px "Stam Ashkenaz CLM"', 'אבגד');
    if (!pageEls.length || !buildPage) return false;
    preparingPrint = true;
    try {
    var token = renderToken;
    for (var i = 0; i < pageEls.length; i++) {
      if (token !== renderToken) return false;
      if (!pageEls[i].dataset.rendered) {
        var built = buildPage(i);
        pageEls[i].replaceWith(built); pageEls[i] = built;
      }
      if (i % 2 === 1) await new Promise(function (resolve) { setTimeout(resolve, 0); });
    }
    if (token !== renderToken) return false;
    // Hidden screen pages need layout boxes while their ink is measured for print.
    container.classList.add('print-measuring');
    try { fitGlyphs(); } finally { container.classList.remove('print-measuring'); }
    printReady = true; container.classList.add('print-ready');
    return true;
    } finally { preparingPrint = false; }
  }

  function finishPrint() {
    if(currentSheet)currentSheet.classList.remove('tefillin-print');
    document.body.classList.remove('printing-tefillin');
    var style=util.byId('tefillin-page-style');if(style)style.remove();
    if (pageEls.length) selectPage(pageIndex);
  }
  function prepareTefillinPaper(paper) {
    var t=renderedLayout&&renderedLayout.summary&&renderedLayout.summary.tefillin;
    if(!t)return;
    var geometry=layoutGeometry(renderedLayout),available=(paper==='A3'?420:297)-20,height=(paper==='A3'?297:210)-20;
    var footerHeight = Math.max.apply(null, pageEls.map(function (el) { var footer = el.querySelector('.page-footer'); return footer ? footer.offsetHeight * 25.4 / 96 + 4 : 0; }));
    var widths=t.widths_mm,gap=10,rowHeight=geometry.lines_per_amud*geometry.baseline_pitch_mm+Math.max(12,footerHeight);
    var one=widths.reduce(function(a,b){return a+b;},0)+gap*3<=available&&rowHeight<=height;
    var cols=one?widths:[Math.max(widths[0],widths[2]),Math.max(widths[1],widths[3])];
    if(!one&&(cols[0]+cols[1]+gap>available||rowHeight*2+gap>height))throw new Error('These four page measurements do not fit '+paper+'. Choose A3 or adjust the page widths / line height. Text will not be shrunk.');
    if(renderedLayout.lines.some(function(l){return l.leftover_mm<-.01;}))throw new Error('Resolve the overfull Tefillin lines before printing at their chosen page widths.');
    currentSheet.classList.add('tefillin-print');document.body.classList.add('printing-tefillin');
    currentSheet.style.setProperty('--tefillin-columns',cols.map(function(w){return w+'mm';}).join(' '));
    var style=util.el('style',{id:'tefillin-page-style',text:'@page { size: '+paper+' landscape; margin: 10mm; }'});document.head.appendChild(style);
  }

  // Fit the entire rendered page, not just its font. Width and height both
  // constrain the scale. No minimum zoom is imposed that could cause clipping.
  function fitScale(mode, width, height, availableWidth, availableHeight) {
    if (![width, height, availableWidth, availableHeight].every(function (n) { return Number.isFinite(n) && n > 0; })) return 1;
    if (mode === 'actual') return 1;
    return Math.min(1, availableWidth / width, mode === 'width' ? 1 : availableHeight / height);
  }

  function scheduleFit() {
    if (fitPending) return;
    fitPending = true;
    requestAnimationFrame(function () { fitPending = false; fitPage(); });
  }

  function fitPage() {
    if (!currentSheet || !frame || !pageEls.length || !container.clientWidth || !container.clientHeight) return;
    // Preserve the same place in the document when zoom or viewport size changes.
    // offsetWidth/Height already ignore transforms; removing the transform first
    // changes the scroll range and can send a later page to an empty placeholder.
    var viewportTop = container.getBoundingClientRect().top;
    var before = currentSheet.getBoundingClientRect();
    var oldScale = currentSheet.offsetWidth ? before.width / currentSheet.offsetWidth : 1;
    var anchor = oldScale > 0 ? (viewportTop - before.top) / oldScale : 0;
    fitGlyphs();
    var width = Math.max(currentSheet.offsetWidth, currentSheet.scrollWidth);
    var height = Math.max(currentSheet.offsetHeight, currentSheet.scrollHeight);
    var pageHeight = pageEls[pageIndex].offsetHeight + 44;
    var scale = fitScale(fitMode, width, pageHeight, Math.max(1, container.clientWidth - 56), Math.max(1, container.clientHeight - 56));
    currentSheet.style.transform = 'scale(' + scale + ')';
    frame.style.width = Math.ceil(width * scale) + 'px';
    frame.style.height = Math.ceil(height * scale) + 'px';
    if (oldScale > 0) container.scrollTop += currentSheet.getBoundingClientRect().top + anchor * scale - viewportTop;
    scaleLabel.textContent = Math.round(scale * 100) + '%';
    scheduleVisiblePages();
  }

  function fitGlyphs() {
    if (!container) return;
    var ctx = null, metrics = new Map();
    if (typeof window.CanvasRenderingContext2D === 'function') ctx = document.createElement('canvas').getContext('2d');
    util.qsa('.lk[data-width-mm] > .ink-glyph', container).forEach(function (ink) {
      // Fractional layout widths exclude both the page zoom and the previous
      // glyph transform. Measuring transformed rectangles during a transition
      // feeds the old scale back into the next pass and leaves only boxes wide.
      var natural = parseFloat(window.getComputedStyle(ink).width);
      var target = parseFloat(window.getComputedStyle(ink.parentNode).width);
      if (!(natural > 0 && target > 0)) return;
      var fit = glyphFit(natural, target);
      // At ordinary line edges align visible ink, not a font's invisible side
      // bearing or lamed overhang. Interior font spacing stays unchanged.
      if (ctx && ink.dataset.marginEdge && ink.textContent !== '\u05dc') {
        var style = window.getComputedStyle(ink), font = style.fontStyle+' '+style.fontWeight+' '+style.fontSize+' '+style.fontFamily;
        var key = font+'|'+ink.textContent, m = metrics.get(key);
        if (!m) { ctx.font=font;ctx.textAlign='left';ctx.direction='ltr';m=ctx.measureText(ink.textContent);metrics.set(key,m); }
        fit = glyphFit(natural,target,m.actualBoundingBoxLeft,m.actualBoundingBoxRight);
      }
      var vertical = ink.parentNode.classList.contains('marker-large') ? 1.5 : ink.parentNode.classList.contains('marker-small') ? Number(renderedLayout?.snapshot?.profile?.small_letter_scale ?? 0.5) : 1;
      var offset = 0;
      if (vertical !== 1 && ctx) {
        var glyphStyle = window.getComputedStyle(ink);
        ctx.font = glyphStyle.fontStyle+' '+glyphStyle.fontWeight+' '+glyphStyle.fontSize+' '+glyphStyle.fontFamily;
        ctx.textAlign = 'left'; ctx.direction = 'ltr';
        var bounds = ctx.measureText(ink.textContent);
        var size = parseFloat(glyphStyle.fontSize), height = parseFloat(glyphStyle.lineHeight) || size * 1.5;
        var ascent = bounds.fontBoundingBoxAscent || size * 0.8, descent = bounds.fontBoundingBoxDescent || size * 0.2;
        var inkTop = (height - ascent - descent) / 2 + ascent - (bounds.actualBoundingBoxAscent || ascent);
        offset = (1 - vertical) * inkTop;
      }
      ink.style.transformOrigin = vertical === 1 ? 'right bottom' : 'right top';
      ink.style.transform = 'translateX('+fit.translate+'px) translateY('+offset+'px) scaleX('+fit.scale+') scaleY('+vertical+')';
    });
  }

  function glyphFit(natural,target,left,right) {
    if(Number.isFinite(left)&&Number.isFinite(right)&&left+right>0){
      var scale=target/(left+right);
      return {scale:scale,translate:(natural-right)*scale};
    }
    return {scale:target/natural,translate:0};
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
    printReady = false; container.classList.remove('print-ready');
    currentSheet = null; frame = null; pageEls = []; pageGroups = []; buildPage = null; printReady = false;
    if (pageSelect) { util.clear(pageSelect); pageSelect.disabled = true; prevButton.disabled = true; nextButton.disabled = true; scaleLabel.textContent = ''; }
    var msg = util.el('div', { class: 'empty' },
      [util.el('span', { class: 'emark', text: '\u05e1\u05e4\u05e8' }),
       util.el('p', { text: 'No layout computed yet.' }),
       util.el('p', { class: 't--1', text: 'Choose a source, profile and geometry, then click “Compute layout”.' })]);
    container.appendChild(msg);
    if (refEl) refEl.textContent = '';
  }

  function render(layout) {
    var token = ++renderToken;
    renderedCount = 0;
    if (!container) return;
    if (!layout || !Array.isArray(layout.lines) || layout.lines.length === 0) {
      renderEmpty();
      return;
    }
    util.clear(container);
    var sameLayout = renderedLayout && renderedLayout.id === layout.id;
    printReady = false; container.classList.remove('print-ready');
    renderedLayout = layout;
    if (!sameLayout) pageIndex = 0;

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

    var sheet = util.el('div', { class: 'sheet' + (reverseLines ? ' reverse-lines' : '') });
    sheet.setAttribute('lang', 'he');
    sheet.setAttribute('dir', 'rtl');
    sheet.style.setProperty('--tf-scale', '1');
    currentSheet = sheet;

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

    // Lazy page DOM. A full book contains hundreds of thousands of glyph spans;
    // constructing all of them up front freezes the browser unnecessarily.
    pageGroups = amudim;
    buildPage = function (gi, placeholder) {
      var g = amudim[gi];
      var lastYeria = layout.summary && layout.summary.amudim_per_yeria &&
        (g.num % layout.summary.amudim_per_yeria === 0);
      var el = buildAmud(g, gi, layout, lastYeria, placeholder);
      el.appendChild(util.el('div', { class: 'print-study-label', text: 'Sofer Studio · ' + (layout.summary && layout.summary.layout_mode==='reflow' ? 'Reflowed from Tikkun · '+layout.summary.units_per_row+' units per line — new pagination; sofer review required' : layout.summary && layout.summary.reference ? 'Tikkun reference column '+g.lines[0].reference_page+' — sofer review required' : isStudyPreview ? 'STUDY PREVIEW — NOT WRITING-READY' : isExcerpt ? 'SAMPLE TEXT — NOT A FULL TORAH LAYOUT' : 'Study layout — verify source, calibration and special passages before writing.') }));
      // Reserve the complete column height even for a short sample. This is a
      // viewport treatment only; no lines, words or measured boxes are changed.
      var geometry = layoutGeometry(layout) || {};
      var fullHeight = Number(geometry.lines_per_amud || g.lines.length) * Number(geometry.baseline_pitch_mm || 8);
      if (Number.isFinite(fullHeight) && fullHeight > 0) el.style.minHeight = fullHeight + 'mm';
      if (!placeholder) el.dataset.rendered = 'true';
      return el;
    };
    var amudEls = amudim.map(function (g, i) { return buildPage(i, true); });
    pageEls = amudEls;
    util.clear(pageSelect);
    amudim.forEach(function (g, i) { pageSelect.appendChild(util.el('option', { value: String(i), text: 'Page ' + (i + 1) + ' of ' + amudim.length + ' · Amud ' + g.num })); });
    pageSelect.disabled = false;

    // Chunked append: wire horizontal seams per yeria handled in buildAmud.
    var chunk = 4;
    (function appendNext(start) {
      if (token !== renderToken) return;
      var end = Math.min(start + chunk, amudEls.length);
      for (var i = start; i < end; i++) row.appendChild(pageEls[i]);
      renderedCount = end;
      if (end < amudEls.length) {
        setTimeout(function () { appendNext(end); }, 0);
      } else {
        // Restore a selected page even when it was beyond the first append chunk.
        if (frame) selectPage(pageIndex);
        bus.emit('preview:ready'); scheduleFit();
      }
    })(0);

    frame = util.el('div', { class: 'preview-page-frame' });
    frame.appendChild(sheet); container.appendChild(frame);
    selectPage(pageIndex);
    fillPrintNote(layout);
  }

  function buildAmud(g, gi, layout, isYeriaEdge, placeholder) {
    var amud = util.el('div', { class: 'amud' + (isYeriaEdge ? ' onde' : '') });
    if (layout.summary && layout.summary.tefillin) amud.classList.add('tefillin-page');
    amud.dataset.amud = String(g.num);

    var linesWrap = util.el('div', { class: 'lines' });

    var geom = layoutGeometry(layout);
    var songPage = g.lines[0] && g.lines[0].song_page;
    var pitch = (songPage && songPage.baseline_pitch_mm) || (geom && geom.baseline_pitch_mm) || 10;
    var profile = layout.snapshot && layout.snapshot.profile;
    var letterHeight = (songPage && songPage.letter_height_mm) || (profile && profile.letter_height_mm);
    if (letterHeight) linesWrap.style.fontSize = (Number(letterHeight) * 1.3) + 'mm';
    var pageWidth = Math.max.apply(null, g.lines.map(function (l) { return l.column_width_mm || (geom && geom.line_width_mm) || 125; }));
    linesWrap.style.setProperty('--line-width', pageWidth + 'mm');
    amud.style.setProperty('--line-width', pageWidth + 'mm');
    linesWrap.style.minHeight = ((songPage && songPage.lines) || (geom && geom.lines_per_amud) || g.lines.length) * pitch + 'mm';

    if (placeholder) {
      // Keep the page's full geometry in the scroll track without its glyph DOM.
      // Metadata gutters have fixed widths so lazy pages never shift the text.
      linesWrap.classList.add('page-placeholder');
    } else g.lines.forEach(function (line, li) {
      var lineEl = renderLine(line, g.num, li, g.lines.length, pitch);
      linesWrap.appendChild(lineEl);

    });

    amud.appendChild(linesWrap);
    var source = (state.sources || []).find(function (s) { return s.id === layout.source_id; });
    var sourceName = layout.source_name || (source && source.name) || 'Untitled source';
    amud.appendChild(util.el('div', { class: 'page-footer', dir: 'ltr' }, [
      util.el('div', { class: 'page-source', dir: 'auto', text: sourceName }),
      util.el('div', { text: 'Line width: ' + util.fmt(pageWidth, 2) + ' mm · Line height: ' + util.fmt(pitch, 2) + ' mm · ' + (gi + 1) + ' of ' + pageGroups.length })
    ]));
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
    el.style.height = pitch + 'mm';
    el.style.minHeight = '0'; el.style.padding = '0';

    var gim = util.el('span', { class: 'lnum', text: String(li + 1), dir: 'ltr' });
    gim.setAttribute('lang', 'en');
    el.appendChild(gim);
    el.appendChild(shortfallNote(line));

    var txt = util.el('span', { class: 'ltext' });
    if(line.column_width_mm) txt.style.width=line.column_width_mm+'mm';
    txt.setAttribute('lang', 'he');
    txt.setAttribute('dir', 'rtl');
    var gap=Number(line.leftover_mm),intentional=!!(line.fixed_pattern||line.petucha_end||line.sefer_end||line.setuma_at_edge||(line.has_setuma&&!line.setuma_stretch_enabled));
    var alignment=intentional?'intentional':!Number.isFinite(gap)?'unknown':gap<-.001?'overfull':gap>=.001?'short':'aligned';
    el.classList.add('alignment-'+alignment);el.dataset.alignment=alignment;
    txt.setAttribute('aria-label','Measured text column — '+alignment);

    appendLineContent(txt, line, text);
    if (line.petucha_end) {
      // Zero-width annotation AFTER the preceding word, not part of its ink.
      // The actual end-of-line whitespace remains owned by the measured layout.
      var anchor = util.el('span', { class: 'parasha-anchor', 'aria-label': 'Petuchah after this word; line-end space' });
      anchor.appendChild(sectionGuide('petucha', 'פ', 'Petuchah — פתוחה: line-end space'));
      txt.appendChild(anchor);
    }

    el.appendChild(txt);
    el.appendChild(wordMoveControls(line));

    // aria label: amud, line, verse ref
    var ref = pick(line, ['verse_ref', 'ref', 'verse'], '');
    el.setAttribute('aria-label', 'Amud ' + amudNum + ', line ' + num + (ref ? ', ' + ref : ''));

    // hover -> sargel tick (physical mm = (index)*pitch from column top)
    el.addEventListener('mouseenter', function () {
      var rows = (line.song_page && line.song_page.lines) || Number((layoutGeometry(renderedLayout) || {}).lines_per_amud) || totalInAmud;
      bus.emit('sargel:tick', (reverseLines ? rows - 1 - li : li) * pitch);
    });
    el.addEventListener('mouseleave', function () {
      bus.emit('sargel:tick', null);
    });
    el.addEventListener('click', function () { selectLine(el, line, amudNum, num); });

    // store estimate for sirtut placement
    el.estimatedHeight = 18 * 1.5 + 4; // approx em height
    return el;
  }

  function wordMoveControls(line) {
    var controls = util.el('span', { class: 'line-move', dir: 'ltr' });
    var overflow = Math.max(0, -Number(line.base_leftover_mm || 0));
    if (overflow) controls.style.marginRight = (overflow + 3) + 'mm';
    [['up', '↑', 'Bring the first word from the next line'], ['down', '↓', 'Move the last word to the next line']].forEach(function(spec) {
      var button = util.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: spec[1], title: spec[2], 'aria-label': spec[2], 'data-move-word': spec[0] });
      button.disabled = !API || !API.moveWord || !line.line_id || renderedLayout.status === 'locked' || line.fixed_pattern || (line.status && line.status !== 'pending');
      if (renderedLayout.status === 'locked') button.title = 'Locked layout: compute a new draft before changing line breaks';
      button.addEventListener('click', async function(event) {
        event.stopPropagation();
        if (movingWord) return;
        movingWord = true;
        var layout = renderedLayout, index = layout.lines.indexOf(line), next = layout.lines[index + 1];
        try {
          await API.moveWord(layout.id, { line_id: line.line_id, direction: spec[0], line_key: line.line_key, next_line_key: next ? next.line_key : null });
          var refreshed = await API.getLayout(layout.id);
          if (state.active.layoutId === layout.id || state.layout === layout) {
            state.layout = refreshed; bus.emit('layout:loaded', refreshed);
          }
        } catch(error) { SS.toast(error.message || String(error), 'error'); }
        finally { movingWord = false; }
      });
      controls.appendChild(button);
    });
    return controls;
  }

  function suggestsDrop(line, next) {
    var blocked=function(l){return !l||l.fixed_pattern||l.petucha_end||l.sefer_end||l.has_setuma||l.setuma_at_edge||(l.status&&l.status!=='pending');};
    if(blocked(line)||blocked(next)||line.tefillin_section!==next.tefillin_section||!line.words||line.words.length<2||!next.words||!next.words.length) return false;
    var before=Number(line.base_leftover_mm),after=Number(next.base_leftover_mm),word=Number(line.words[line.words.length-1].width_mm);
    var freed=word+Number(line.inter_word_gap_mm||0),used=word+Number(next.inter_word_gap_mm||0);
    return Number.isFinite(before)&&Number.isFinite(after)&&before>=-.001&&after-used>=-.001&&Math.max(before+freed,after-used)<Math.max(before,after)-.01;
  }

  function shortfallNote(line) {
    var geometry = layoutGeometry(renderedLayout) || {};
    var profile = renderedLayout && renderedLayout.snapshot && renderedLayout.snapshot.profile || {};
    var summary = renderedLayout && renderedLayout.summary || {};
    var rowUnits = Number(profile.units_per_row || summary.units_per_row);
    var unit = rowUnits > 0 && profile.unit_basis !== 'skeleton' ? Number(geometry.line_width_mm) / rowUnits :
      Number(profile.unit_mm) * Number(profile.letter_height_mm || 1) / Number(profile.reference_height_mm || 1);
    var missing = line.base_leftover_mm != null ? Number(line.base_leftover_mm) :
      line.width_mm != null ? Number(geometry.line_width_mm) - Number(line.width_mm) :
      line.leftover_mm != null ? Number(line.leftover_mm) + (line.stretch_decisions || []).reduce(function (sum, d) { return sum + Number(d.stretch_mm || 0); }, 0) : NaN;
    // A petuchah can be overfull even if its ink fits: reserve its required
    // end gap before deciding whether to hide an intentional-space indicator.
    if (line.petucha_end && !line.fixed_pattern && profile.stretch_policy?.version === 2) {
      var reserved = Math.max(20, Number(profile.special_widths_units?.petucha || profile.stretch_policy?.special_widths_units?.petucha || 20)) * unit;
      if (missing < reserved - 0.001) missing -= reserved;
    }
    var units = unit > 0 ? missing / unit : NaN, text = '—', title = 'Original line units unavailable';
    if (Number.isFinite(units)) {
      // The engine rounds millimetres to 0.001. Remove that rounding noise only.
      if (Math.abs(units - Math.round(units)) * unit <= 0.0011) units = Math.round(units);
      var absolute = Math.abs(units), whole = Math.round(absolute);
      var amount = '';
      while (whole >= 400) { amount += 'ת'; whole -= 400; }
      amount += whole > 0 ? util.gimatriaLetters(whole) : '';
      var parsha = line.blank_line || line.petucha_end || line.has_setuma || line.setuma_at_edge || line.sefer_end || line.fixed_pattern;
      text = parsha && units >= 0 ? '' : Math.round(absolute) === 0 ? 'ש״ת' : (units < 0 ? 'י״' : 'ח״') + amount;
      title = units === 0 ? 'שורה תמה — complete before stretching' :
        util.fmt(absolute, 2) + ' units ' + (units < 0 ? 'overfull' : 'missing') + ' before stretching';
    }
    return util.el('span', { class: 'side'+(units<-.001?' is-overfull':''), text: text, title: title, 'aria-label': title, lang: 'he', dir: 'rtl',
      'data-missing-units': Number.isFinite(units) ? String(units) : '' });
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
    var wordGap = Number(line.inter_word_gap_mm);
    var letterGap = Number(line.inter_letter_gap_mm);

    function wordBox(word, wordIndex) {
      if (wordIndex == null) wordIndex = wi;
      var box = util.el('span', { class: 'word-box' });
      box.setAttribute('dir', 'rtl');
      box.setAttribute('lang', 'he');
      if (util.isFiniteNum(word.width_mm)) {
        var added = (word.letters || []).reduce(function (sum, l) { return sum + (Number(stretch[l.id] && stretch[l.id].stretch_mm || 0) + Number(stretch['hyphen-'+l.id] && stretch['hyphen-'+l.id].stretch_mm || 0)); }, 0);
        var measuredWidth = Number(word.width_mm) + added;
        box.style.width = measuredWidth + 'mm';
        box.dataset.widthMm = String(measuredWidth);
        box.title = 'word width ' + util.mm(measuredWidth);
      }
      if(wordIndex===words.length-1&&renderedLayout&&renderedLayout.status!=='locked'&&suggestsDrop(line,renderedLayout.lines[renderedLayout.lines.indexOf(line)+1])){
        box.classList.add('suggested-drop');box.title='Suggested: move this word to the next line to reduce uneven stretching.';
      }
      if (Number.isFinite(letterGap)) box.style.gap = letterGap + 'mm';
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
        var addedWidth = Number(stretch[lid] && stretch[lid].stretch_mm || 0) + Number(stretch['hyphen-'+lid] && stretch['hyphen-'+lid].stretch_mm || 0);
        var s = util.el('span', { class: 'lk' });
        var ink = util.el('span', {class:'ink-glyph', text:g});
        s.appendChild(ink);
        if (lt && Number.isFinite(Number(lt.width_mm))) {
          var targetWidth = Number(lt.width_mm) + addedWidth;
          s.style.width = targetWidth + 'mm'; s.dataset.widthMm = String(targetWidth);
        }
        if (lt && lt.holy) {
          s.classList.add('holy-letter');
          ink.classList.add('holy-letter');
          s.title = 'Holy letter — human decision';
        }
        if (lt && lt.stam_letter_mark) {
          var markerType = lt.stam_letter_mark.type;
          s.classList.add('marker-' + markerType);
          if (markerType === 'backward_nun') ink.textContent = '\u05e0';
        }
        if (g === '\u05dc' && wordIndex === 0 && li === 0) s.classList.add('lamed-line-start');
        if (g === '\u05dc' && wordIndex === words.length - 1 && li === graphemes.length - 1) s.classList.add('lamed-line-end');
        if (tagginOn && TAGGIN[g]) s.classList.add('taggin');
        if (lid && (stretch[lid] || stretch['hyphen-'+lid])) {
          s.classList.add('stretched');
          var dmm = addedWidth;
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
          if (Number(o.stam_hyphens) > 0) {
            s.classList.add('stam-width-mark');
            s.dataset.stamMarker = Array(Math.min(8, Number(o.stam_hyphens)) + 1).join('-');
            s.dataset.stamHyphenUnits = String(o.stam_hyphen_units == null ? '' : o.stam_hyphen_units);
          }
          s.title = (o.type || 'unusual') + ' override ' + util.mm(Number(o.mm || 0)) + (Number(o.stam_hyphens) > 0 ? ' · STAM ' + o.stam_hyphens + ' hyphen mark(s), ' + o.stam_hyphen_units + ' unit(s) each' : '');
        }
        box.appendChild(s);
      });
      return box;
    }

    function gapEl(it, index) {
      if (it.type === 'setuma_gap' && stretch['setuma-gap-' + index]) {
        it = Object.assign({}, it, {width_mm: Number(it.width_mm) + Number(stretch['setuma-gap-' + index].stretch_mm || 0)});
      }
      var cls = it.type === 'setuma_gap' ? 'setuma-gap' : 'segment-gap';
      var g = util.el('span', { class: cls });
      g.textContent = '\u00a0';
      if (util.isFiniteNum(it.width_mm)) {
        g.dataset.widthMm = String(it.width_mm);
        g.style.setProperty('--gap-width-mm', String(it.width_mm));
        g.style.width = Number(it.width_mm) + 'mm'; g.style.minWidth = '0';
        g.title = cls + ' ' + util.mm(Number(it.width_mm));
      }
      if (it.type === 'setuma_gap') {
        g.setAttribute('aria-label', 'Setumah after preceding word; measured space ' + it.width_mm + ' mm');
        g.appendChild(sectionGuide('setuma', 'ס', 'Setumah — סתומה: measured internal space'));
      }
      return g;
    }

    if(line.song_layout){
      line.song_layout.segments.forEach(function(segment){
        var original=parent,part=util.el('span',{class:'song-segment'});
        part.style.right=segment.start_mm+'mm';part.style.width=segment.width_mm+'mm';
        parent.appendChild(part);parent=part;
        for(var index=0;index<segment.word_count;index++){wi=segment.word_start+index;if(index)appendWordGap();parent.appendChild(wordBox(words[wi]));}
        parent=original;
      });
    } else if (items.length) {
      // Authoritative: render one element per items[] entry, consuming words in order.
      items.forEach(function (it, index) {
        if (it.type === 'word') {
          if (index && items[index-1].type === 'word') appendWordGap();
          parent.appendChild(wordBox(words[wi] || { text: it.text || it.consonant || '', width_mm: it.width_mm, letters: [], override: [] }));
          wi++;
        } else if (it.type === 'setuma_gap' || it.type === 'segment_gap') {
          parent.appendChild(gapEl(it, index));
        } else if(it.type === 'nun_hafucha') {
          // Use the same measured STaM nun as the ! command. U+05C6 in a
          // fallback Times font was a tiny punctuation mark, not the letter.
          var nun=util.el('span',{class:'nun-hafucha lk marker-backward_nun',title:'Backward nun from reference','aria-label':'Backward nun'});
          nun.appendChild(util.el('span',{class:'ink-glyph',text:'נ'}));
          nun.style.width=it.width_mm+'mm';nun.dataset.widthMm=String(it.width_mm);parent.appendChild(nun);
        }
      });
    } else if (words.length) {
      words.forEach(function (w, i) {
        wi = i;
        if (i > 0) appendWordGap();
        parent.appendChild(wordBox(w));
      });
    } else if (text || (!line.blank_line && !line.spacing_metadata_complete && !line.fixed_pattern)) {
      // Legacy fallback with NO backend metadata: raw text + honest label (F-12).
      parent.appendChild(document.createTextNode(text));
      parent.appendChild(util.el('span', { class: 't--2 faint legacy-note', text: ' (no backend metadata)' }));
    }
    if(!line.fixed_pattern&&!line.petucha_end&&!line.setuma_at_edge&&(!line.has_setuma||line.setuma_stretch_enabled)&&!line.sefer_end){
      var edgeGlyphs=parent.querySelectorAll('.lk > .ink-glyph');
      if(edgeGlyphs.length){edgeGlyphs[0].dataset.marginEdge='start';edgeGlyphs[edgeGlyphs.length-1].dataset.marginEdge='end';}
    }
    function appendWordGap() {
      if (!Number.isFinite(wordGap)) { parent.appendChild(document.createTextNode(' ')); return; }
      var gap = util.el('span', {class:'word-gap', 'aria-hidden':'true', text:' '});
      var extra = Number(stretch['word-space-before-' + wi] && stretch['word-space-before-' + wi].stretch_mm || 0);
      gap.style.width = (wordGap + extra) + 'mm'; gap.dataset.widthMm = String(wordGap + extra); parent.appendChild(gap);
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

  function sectionGuide(kind, letter, title) {
    return util.el('span', { class: 'parasha-mark', 'data-section-kind': kind,
      lang: 'he', title: title + ' (guide only; not printed)', text: letter, 'aria-hidden': 'true' });
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
    showAmud(amud);
    var el = findLine(amud, num);
    if (!el) { SS.toast && SS.toast('Line not found in current layout.', 'error'); return; }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    pulse(el);
  }

  function jumpToAmud(amud) {
    if (!container) return;
    showAmud(amud);
    var el = util.qs('.amud[data-amud="' + amud + '"]', container);
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function showAmud(amud) {
    var index = pageEls.findIndex(function (el) { return String(el.dataset.amud) === String(amud); });
    if (index >= 0) selectPage(index);
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
    var groupIndex = pageGroups.findIndex(function (g) { return g.lines.some(function (l) { return lineText(l).indexOf(token) >= 0; }); });
    if (groupIndex >= 0) selectPage(groupIndex);
    util.qsa('.shem-tok', container).forEach(function (s) {
      if (s.dataset.shem && (s.textContent.indexOf(token) >= 0 || token.indexOf(s.textContent) >= 0)) {
        var amud = s.closest('.amud'); if (amud) showAmud(amud.dataset.amud);
        s.scrollIntoView({ block: 'center', behavior: 'smooth' });
        pulse(s);
      }
    });
  }

  function rerender() {
    if (state.layout) render(state.layout);
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
    flashToken: flashToken,
    fitScale: fitScale,
    setExpanded: setExpanded,
    setReverseLines: setReverseLines,
    isReversed: function () { return reverseLines; },
    glyphFit: glyphFit,
    layoutGeometry: layoutGeometry,
    isReady: function () { return pageEls.length > 0 && renderedCount === pageEls.length; },
    preparePrint: preparePrint,
    finishPrint: finishPrint,
    isPrintReady: function () { return printReady; },
    prepareTefillinPaper: prepareTefillinPaper,
    suggestsDrop: suggestsDrop,
    refreshPrintNote: function () { if (renderedLayout) fillPrintNote(renderedLayout); }
  };
})();
