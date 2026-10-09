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
  var reverseLines = false, reverseToggle, reflowToggle;

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
    [['letter-guides','Letter guides',false],['shortfall','ח״א marks',true],['numbers','Line numbers',true],['line-controls','Move words / word count',true],['hyphens','Hyphens',true],['red-words','Red words',true],['orange-lines','Orange lines (stage 3)',true]].forEach(function(spec){
      var checked = spec[2]; try { var saved=localStorage.getItem('sofer:preview-'+spec[0]); if(saved!=null)checked=saved==='1'; } catch(e){}
      var input=util.el('input',{type:'checkbox',id:'preview-'+spec[0],checked:checked});
      function apply(){container.classList.toggle('hide-'+spec[0],!input.checked); if(spec[0]==='letter-guides')container.classList.toggle('show-letter-guides',input.checked); scheduleFit();}
      input.addEventListener('change',function(){apply();try{localStorage.setItem('sofer:preview-'+spec[0],input.checked?'1':'0');}catch(e){}}); apply();
      toolbar.appendChild(util.el('label',{class:'toggle'},[input,util.el('span',{text:spec[1]})]));
    });
    reflowToggle=util.el('input',{type:'checkbox',id:'preview-reflow-words'});
    toolbar.appendChild(util.el('label',{class:'toggle'},[reflowToggle,util.el('span',{text:'Recalculate after word edits'})]));
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
    if (document.fonts) await document.fonts.load('24px "' + selectedFont().family + '"', 'אבגד');
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
    document.body.classList.remove('printing-multiple');
    util.byId('multiple-print-area')?.remove(); util.byId('multiple-page-style')?.remove();
    document.body.classList.remove('printing-sample');
    util.byId('sample-print-area')?.remove(); util.byId('sample-page-style')?.remove();
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

  function prepareMultiplePages(count, direction, paper) {
    if (!Number.isInteger(count) || count < 2 || count > 16) throw new Error('Choose between 2 and 16 pages per sheet.');
    if (!['down','across'].includes(direction)) throw new Error('Choose downwards or widthways.');
    var papers={'A4-portrait':[210,297],'A4-landscape':[297,210],'A3-portrait':[297,420],'A3-landscape':[420,297]};
    var size=papers[paper]; if(!size)throw new Error('Choose A4 or A3 paper.');
    util.byId('multiple-print-area')?.remove(); util.byId('multiple-page-style')?.remove();
    var area=util.el('div',{id:'multiple-print-area'});
    if(reverseLines)area.classList.add('reverse-lines');
    ['hide-shortfall','hide-numbers','hide-hyphens','hide-red-words','hide-orange-lines'].forEach(function(name){if(container.classList.contains(name))area.classList.add(name);});
    document.body.appendChild(area);
    var gap=4, availableW=size[0]-16, availableH=size[1]-16;
    var cellW=direction==='across'?(availableW-gap*(count-1))/count:availableW;
    var cellH=direction==='down'?(availableH-gap*(count-1))/count:availableH;
    container.classList.add('print-measuring');
    try {
    for(var start=0;start<pageEls.length;start+=count){
      var sheet=util.el('div',{class:'multiple-print-sheet'});
      sheet.style.width=availableW+'mm';sheet.style.height=availableH+'mm';area.appendChild(sheet);
      for(var j=0;j<count&&start+j<pageEls.length;j++){
        var cell=util.el('div',{class:'multiple-print-cell'}), clone=pageEls[start+j].cloneNode(true);
        clone.classList.remove('screen-page-hidden');
        clone.querySelectorAll('.line-move,.page-width-editor,.print-study-label').forEach(function(node){node.remove();});
        clone.style.transform='none';clone.style.margin='0';clone.style.width=pageEls[start+j].offsetWidth+'px';
        cell.style.width=cellW+'mm';cell.style.height=cellH+'mm';
        cell.style.left=(direction==='across'?j*(cellW+gap):0)+'mm';cell.style.top=(direction==='down'?j*(cellH+gap):0)+'mm';
        cell.appendChild(clone);sheet.appendChild(cell);
        var scale=Math.min(cellW*96/25.4/Math.max(clone.offsetWidth,clone.scrollWidth),cellH*96/25.4/Math.max(clone.offsetHeight,clone.scrollHeight));
        clone.style.transformOrigin='top left';clone.style.transform='scale('+scale+')';clone.dataset.printScale=String(scale);
      }
    }
    } finally { container.classList.remove('print-measuring'); }
    document.body.classList.add('printing-multiple');
    document.head.appendChild(util.el('style',{id:'multiple-page-style',text:'@page { size:'+size[0]+'mm '+size[1]+'mm; margin:8mm; }'}));
  }

  function selectedFont(layout) {
    var profile=(layout||renderedLayout)?.snapshot?.profile;
    return (profile?.document_rendering || profile?.stretch_policy?.rendering)?.font==='asirit'
      ? {family:'Sofer Asirit Unicode',em:1000,inkHeight:1489,roofTop:577,roofBottom:405,lamedRoof:973,lamedGuide:764}
      : {family:'Stam Ashkenaz CLM',em:2048,inkHeight:3080,roofTop:1050,roofBottom:700,lamedRoof:1960,lamedGuide:1410};
  }

  function prepareSamplePaper(paper) {
    var papers = {'A4-landscape':[297,210],'A4-portrait':[210,297],'A3-landscape':[420,297],'A3-portrait':[297,420],'A2-portrait':[420,594]};
    var dimensions=papers[paper]||papers['A4-landscape'], geometry=layoutGeometry(renderedLayout);
    var area=util.el('div',{id:'sample-print-area',class:'sheet sample-sheet',dir:'rtl'});
    area.style.width=dimensions[0]+'mm';area.style.height=dimensions[1]+'mm';
    var sampleFrame=util.el('div',{class:'sample-frame'}), row=util.el('div',{class:'amudim-row'});sampleFrame.appendChild(row);area.appendChild(sampleFrame);
    var used=0, perYeria=Number(geometry.amudim_per_yeria)||4;
    for(var i=0;i<pageEls.length&&used<dimensions[0]-6;i++){
      var clone=pageEls[i].cloneNode(true), width=Number(pageGroups[i].lines[0].column_width_mm)||geometry.line_width_mm;
      var right=i===0?Number(geometry.initial_margin_mm??geometry.outer_margin_mm):i%perYeria===0?2*Number(geometry.outer_margin_mm):Number(geometry.inter_column_gap_mm);
      var left=i===pageEls.length-1?Number(geometry.final_margin_mm??geometry.outer_margin_mm):0;
      clone.style.width=(width+right+left)+'mm';clone.style.padding=geometry.top_margin_mm+'mm '+right+'mm '+geometry.bottom_margin_mm+'mm '+left+'mm';
      clone.style.minHeight='0';
      clone.querySelectorAll('.line-move,.lnum,.side,.page-footer,.page-width-editor,.print-study-label').forEach(function(node){node.remove();});
      clone.querySelector('.lines').style.width=width+'mm';
      row.appendChild(clone);used+=width+right+left;
    }
    document.body.appendChild(area);document.body.classList.add('printing-sample');
    var sampleWidth = Math.min(used, dimensions[0]-6), sampleHeight = Math.min(dimensions[1]-6, Number(geometry.top_margin_mm) + Number(geometry.bottom_margin_mm) + Number(geometry.lines_per_amud) * Number(geometry.baseline_pitch_mm));
    sampleFrame.style.width=sampleWidth+'mm';sampleFrame.style.height=sampleHeight+'mm';
    [['top-right',0,0],['top-left',sampleWidth,0],['bottom-right',0,sampleHeight],['bottom-left',sampleWidth,sampleHeight]].forEach(function (corner) {
      var mark = util.el('span', { class: 'sample-cut-mark', 'aria-label': 'Trim ' + corner[0] });
      mark.style.right = (3+corner[1]) + 'mm'; mark.style.top = (3+corner[2]) + 'mm'; area.appendChild(mark);
    });
    var copyright = util.el('div', { class: 'sample-copyright', text: 'Copyright Yehuda Weisz — no one has rights to use this or copy without paying.' });
    copyright.style.top = Math.max(3, sampleHeight - 2) + 'mm'; area.appendChild(copyright);
    document.head.appendChild(util.el('style',{id:'sample-page-style',text:'@page { size: '+dimensions[0]+'mm '+dimensions[1]+'mm; margin:0; }'}));
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
      var offset = 0, roofTop = 0;
      if (ctx) {
        var glyphStyle = window.getComputedStyle(ink);
        ctx.font = glyphStyle.fontStyle+' '+glyphStyle.fontWeight+' '+glyphStyle.fontSize+' '+glyphStyle.fontFamily;
        ctx.textAlign = 'left'; ctx.direction = 'ltr';
        var bounds=ctx.measureText(ink.textContent), size=parseFloat(glyphStyle.fontSize), height=parseFloat(glyphStyle.lineHeight)||size*1.5;
        var ascent=bounds.fontBoundingBoxAscent||size*.8,descent=bounds.fontBoundingBoxDescent||size*.2;
        var baseline=(height-ascent-descent)/2+ascent;
        // STaM Ashkenaz's common roof occupies font units 700..1050 of 2048.
        // Align the roof itself, excluding crowns and the lamed's ascender.
        var fontMetrics=selectedFont();
        roofTop=baseline-size*fontMetrics.roofTop/fontMetrics.em;
        var roofBottom=baseline-size*fontMetrics.roofBottom/fontMetrics.em;
        offset=(1-vertical)*(vertical>1?roofBottom:roofTop);
        ink.parentNode.style.setProperty('--roof-top',(roofTop*vertical+offset)+'px');
        ink.parentNode.style.setProperty('--roof-middle',(((roofTop+roofBottom)/2)*vertical+offset)+'px');
        ink.parentNode.dataset.inkTop = String((baseline - (ink.textContent === 'ל' ? size * fontMetrics.lamedGuide / fontMetrics.em : bounds.actualBoundingBoxAscent)) * vertical + offset);
        ink.parentNode.dataset.inkBottom = String((baseline + bounds.actualBoundingBoxDescent) * vertical + offset);
        if(ink.parentNode.classList.contains('marker-four_tagin')){
          var crownRoof=ink.textContent==='ל'?baseline-size*fontMetrics.lamedRoof/fontMetrics.em:roofTop;
          ink.style.clipPath='inset('+Math.max(0,crownRoof)+'px -100% -100% -100%)';
          var crown=ink.parentNode.querySelector('.four-tagin');
          if(crown){crown.style.height=(size*360/2048*vertical)+'px';crown.style.top=(crownRoof*vertical+offset-size*360/2048*vertical)+'px';}
        }
      }
      ink.style.transformOrigin = vertical === 1 ? 'right bottom' : 'right top';
      ink.style.transform = 'translateX('+fit.translate+'px) translateY('+offset+'px) scaleX('+fit.scale+') scaleY('+vertical+')';
    });
    placePageNotes();
    util.qsa('.amud .lines', container).forEach(function (page) {
      var rows = Array.from(page.querySelectorAll('.line'));
      rows.forEach(function (line, index) {
        var bottom = Math.max(0, ...Array.from(line.querySelectorAll('.lk[data-ink-bottom]')).map(function (glyph) { return Number(glyph.dataset.inkBottom); }));
        var next = rows[index + 1], tops = next && Array.from(next.querySelectorAll('.lk[data-ink-top]')).map(function (glyph) { return Number(glyph.dataset.inkTop); });
        var top = line.offsetHeight + (tops?.length ? Math.min.apply(null, tops) : 0);
        line.style.setProperty('--separator-top', ((bottom + top) / 2) + 'px');
        var ownTops = Array.from(line.querySelectorAll('.lk[data-ink-top]')).map(function (glyph) { return Number(glyph.dataset.inkTop); });
        var inkTop = ownTops.length ? Math.min.apply(null, ownTops) : 0;
        var previous = rows[index - 1];
        var previousBottom = previous ? Math.max(0, ...Array.from(previous.querySelectorAll('.lk[data-ink-bottom]')).map(function (glyph) { return Number(glyph.dataset.inkBottom); })) - previous.offsetHeight : inkTop - line.offsetHeight / 2;
        line.style.setProperty('--annotation-top', Math.min(inkTop - 4, (previousBottom + inkTop) / 2) + 'px');
      });
    });
  }

  function letterMarks(letter) { return letter.stam_letter_marks || (letter.stam_letter_mark ? [letter.stam_letter_mark] : []); }
  function sizeNote(letter, word) {
    var types=letterMarks(letter).map(function(mark){return mark.type;});
    var override=(word.override||[]).find(function(value){return value.id===letter.id;});
    if(override?.type)types.push(override.type);
    return types.includes('large') ? letter.base+'׳ רבתי' : types.includes('small') ? letter.base+'׳ זעירא' : '';
  }
  function holyLabel(word) {
    var letters = word.letters || [], marked = letters.filter(function (letter) { return letter.holy; }).length;
    if (!marked || (word.consonant || letters.map(function (letter) { return letter.base; }).join('')).includes('יהוה')) return '';
    return marked === letters.length ? 'קדש' : 'ספק';
  }
  // Find the nearest free vertical position. If a margin column is full, use
  // the next column rather than overlap or print below the page.
  function notePosition(wanted, height, pageHeight, occupied) {
    var limit = Math.max(0, pageHeight - height), clamp = function (n) { return Math.max(0, Math.min(limit, n)); };
    var candidates = [clamp(wanted), 0, limit];
    occupied.forEach(function (box) { candidates.push(clamp(box.top + box.height + 3), clamp(box.top - height - 3)); });
    return candidates.filter(function (top) { return occupied.every(function (box) { return top + height + 2 <= box.top || top >= box.top + box.height + 2; }); })
      .sort(function (a, b) { return Math.abs(a - wanted) - Math.abs(b - wanted); })[0];
  }
  function placePageNotes() {
    var measure = typeof window.CanvasRenderingContext2D === 'function' ? document.createElement('canvas').getContext('2d') : null;
    if (measure) measure.font = '11px Arial';
    util.qsa('.amud .lines', container).forEach(function (page) {
      var lanes = [], maxHeight = page.clientHeight;
      if (!maxHeight) return;
      var scale = page.getBoundingClientRect().height / maxHeight || 1;
      Array.from(page.querySelectorAll('.margin-note')).forEach(function (note) {
        var line = note.closest('.line'), wanted = (line.getBoundingClientRect().top - page.getBoundingClientRect().top) / scale;
        note.style.maxHeight = maxHeight + 'px'; note.style.top = '0px';
        if (note.classList.contains('margin-comment')) note.style.height = Math.min(maxHeight, Math.ceil(measure ? measure.measureText(note.textContent).width + 2 : note.textContent.length * 6)) + 'px';
        var height = Math.min(maxHeight, note.offsetHeight), lane = 0, top;
        while (top == null) {
          lanes[lane] ||= []; top = notePosition(wanted, height, maxHeight, lanes[lane]);
          if ((note.classList.contains('holy-name-note') || note.classList.contains('size-note')) && top !== Math.max(0, Math.min(maxHeight - height, wanted))) top = undefined;
          if (top == null) lane++;
        }
        lanes[lane].push({ top: top, height: height, width: note.offsetWidth });
        var right = 8;
        for (var i = 0; i < lane; i++) right += Math.max(16, ...lanes[i].map(function (box) { return box.width; })) + 5;
        note.style.top = (top - wanted) + 'px'; note.style.right = -(right + note.offsetWidth) + 'px';
      });
      var extent = lanes.reduce(function (sum, lane) { return sum + Math.max(16, ...lane.map(function (box) { return box.width; })) + 5; }, 8);
      if (lanes.length) page.closest('.amud').style.setProperty('--notes-gutter', Math.max(34 * 96 / 25.4, extent + 8) + 'px');
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
       util.el('p', { class: 't--1', text: 'Choose a text, kulmus and klaf, then click “Compute layout”.' })]);
    container.appendChild(msg);
    if (refEl) refEl.textContent = '';
  }

  function render(layout) {
    var token = ++renderToken;
    if (document.fonts && layout?.snapshot?.profile) document.fonts.load('24px "'+selectedFont(layout).family+'"', 'אבגד').then(scheduleFit).catch(function(){SS.toast('The selected font could not load. Please reload before printing.','error');});
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
    if (!sameLayout) { pageIndex = 0; reflowToggle.checked=!!layoutGeometry(layout)?.document_flow?.reflow_word_moves; }

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
      el.appendChild(util.el('div', { class: 'print-study-label', text: 'Sofer Studio · ' + (layout.summary && layout.summary.layout_mode==='reflow' ? 'Reflowed from Tikkun · '+layout.summary.units_per_row+' units per line — new pagination; sofer review required' : layout.summary && layout.summary.reference ? 'Tikkun reference column '+g.lines[0].reference_page+' — sofer review required' : isStudyPreview ? 'STUDY PREVIEW — NOT WRITING-READY' : isExcerpt ? 'SAMPLE TEXT — NOT A FULL TORAH LAYOUT' : 'Study layout — verify text, calibration and special passages before writing.') }));
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
    var fontMetrics = selectedFont(layout);
    linesWrap.style.fontFamily = '"'+fontMetrics.family+'"';
    linesWrap.style.setProperty('--font-he','"'+fontMetrics.family+'"');
    var letterHeight = (songPage && songPage.letter_height_mm) || (profile && profile.letter_height_mm);
    if (letterHeight) linesWrap.style.fontSize = (Number(letterHeight) * ((profile?.document_rendering || profile?.stretch_policy?.rendering) ? fontMetrics.em/fontMetrics.inkHeight : 1.3)) + 'mm';
    var pageWidth = Math.max.apply(null, g.lines.map(function (l) { return l.column_width_mm || (geom && geom.line_width_mm) || 125; }));
    linesWrap.style.setProperty('--line-width', pageWidth + 'mm');
    amud.style.setProperty('--line-width', pageWidth + 'mm');
    linesWrap.style.minHeight = Number(geom?.lines_per_amud || g.lines.length) * Number(geom?.baseline_pitch_mm || pitch) + 'mm';
    if (songPage) { linesWrap.style.height=linesWrap.style.minHeight; linesWrap.style.overflow='visible'; }
    if (g.lines.some(function(line){return (line.words||[]).some(function(word){return word.hyphen_notes?.length || holyLabel(word) || (word.letters||[]).some(function(letter){return sizeNote(letter,word) || letterMarks(letter).some(function(mark){return mark.type==='margin_note';});});});})) amud.classList.add('has-margin-notes');

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
    var sourceName = layout.source_name || (source && source.name) || 'Untitled text';
    amud.appendChild(util.el('div', { class: 'page-footer', dir: 'ltr' }, [
      util.el('div', { class: 'page-source', dir: 'auto', text: sourceName }),
      util.el('div', { text: 'Line width: ' + util.fmt(pageWidth, 2) + ' mm · Line height: ' + util.fmt(pitch, 2) + ' mm · ' + (gi + 1) + ' of ' + pageGroups.length }),
      util.el('div', { class: 'page-copyright', text: 'Copyright Yehuda Weisz — no one has rights to use this or copy without paying.' })
    ]));
    if (!placeholder) {
      var unit=Number(g.lines[0]?.measurement_unit_mm), first=g.lines[0];
      var widthInput=util.el('input',{type:'number',min:'.01',step:'1',value:unit>0?+(pageWidth/unit).toFixed(3):'', 'aria-label':'Units on page '+g.num});
      widthInput.disabled=!(unit>0)||layout.status==='locked'||!!geom?.tefillin;
      widthInput.addEventListener('change',async function(){
        if(movingWord)return; movingWord=true; widthInput.disabled=true;
        try { await API.pageWidth(layout.id,{amud:g.num,line_key:first.line_key,units:Number(widthInput.value)}); await refreshEditedLayout(layout); }
        catch(error){SS.toast(error.message,'error');widthInput.value=+(pageWidth/unit).toFixed(3);}
        finally {movingWord=false;widthInput.disabled=false;}
      });
      amud.appendChild(util.el('label',{class:'page-width-editor',dir:'ltr'},[util.el('span',{text:'Page width (units)'}),widthInput,util.el('span',{text:'Recalculates from this page onward'})]));
    }
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
    el.style.setProperty('--row-pitch', pitch + 'mm');

    var gim = util.el('span', { class: 'lnum', text: String(li + 1), dir: 'ltr' });
    gim.setAttribute('lang', 'en');
    el.appendChild(wordMoveControls(line));
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
    if(line.secondary_stretch)el.classList.add('needs-secondary-stretch');
    (line.words||[]).forEach(function(word){
      (word.hyphen_notes || []).forEach(function (note) { el.appendChild(util.el('span', { class: 'margin-note margin-comment hyphen-note', dir: 'rtl', lang: 'he', text: '° ' + note })); });
      var label = holyLabel(word);
      if (label) el.appendChild(util.el('span', { class: 'margin-note holy-name-note', dir: 'rtl', text: '° ' + label }));
      (word.letters||[]).forEach(function(letter){
        var size=sizeNote(letter,word); if(size)el.appendChild(util.el('span',{class:'margin-note size-note',dir:'rtl',lang:'he',text:size}));
        letterMarks(letter).forEach(function(mark){
        if(mark.type==='margin_note') el.appendChild(util.el('span',{class:'margin-note margin-comment',dir:'auto',text:'° '+mark.note}));
      });});
    });

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

  async function refreshEditedLayout(layout) {
    if(SS.app?.reloadLayout) { await SS.app.reloadLayout(layout.id); return; }
    var refreshed=await API.getLayout(layout.id);
    if(state.active.layoutId===layout.id||state.layout===layout){state.layout=refreshed;bus.emit('layout:loaded',refreshed);}
  }
  function wordMoveControls(line) {
    var controls=util.el('span',{class:'line-move',dir:'ltr'});
    var disabled=!API||!line.line_id||renderedLayout.status==='locked'||line.fixed_pattern||(line.status&&line.status!=='pending');
    async function edit(values){
      if(movingWord)return; movingWord=true;
      var layout=renderedLayout,index=layout.lines.indexOf(line),next=layout.lines[index+1];
      try { await API.moveWord(layout.id,Object.assign({line_id:line.line_id,line_key:line.line_key,next_line_key:next?.line_key||null,reflow:!!reflowToggle.checked},values)); await refreshEditedLayout(layout); }
      catch(error){SS.toast(error.message||String(error),'error');count.value=line.words.length;}
      finally {movingWord=false;}
    }
    [['up','↑','Bring a word from the next line'],['down','↓','Move a word to the next line']].forEach(function(spec){
      var button=util.el('button',{type:'button',class:'btn btn-ghost btn-sm',text:spec[1],title:spec[2],'aria-label':spec[2],'data-move-word':spec[0],disabled:disabled});
      button.addEventListener('click',function(event){event.stopPropagation();edit({direction:spec[0]});}); controls.appendChild(button);
    });
    var count=util.el('input',{type:'number',class:'line-word-count',min:'0',max:'1000',step:'1',value:(line.words||[]).length,'aria-label':'Word count on line '+line.line_id,disabled:disabled});
    count.addEventListener('click',function(event){event.stopPropagation();});
    count.addEventListener('change',function(){edit({word_count:Number(count.value)});});controls.appendChild(count);
    return controls;
  }

  function suggestsDrop(line, next) {
    if (next && next.page_start || line.words?.at(-1)?.keep_with_previous) return false;
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
    var units = line.line_measurement ? line.line_measurement.reference_units - line.line_measurement.original_units : unit > 0 ? missing / unit : NaN, text = '—', title = 'Original line units unavailable';
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
        if (word.display_hyphen_after?.includes(li)) s.appendChild(util.el('span', { class: 'hyphen-mark source-hyphen', text: '-' }));
        if (lt && Number.isFinite(Number(lt.width_mm))) {
          var targetWidth = Number(lt.width_mm) + addedWidth;
          s.style.width = targetWidth + 'mm'; s.dataset.widthMm = String(targetWidth);
        }
        if (lt && lt.holy) {
          s.classList.add('holy-letter');
          ink.classList.add('holy-letter');
          s.title = 'Holy letter — human decision';
        }
        var marks = lt && (lt.stam_letter_marks || (lt.stam_letter_mark ? [lt.stam_letter_mark] : [])) || [];
        if (li === 0 && holyLabel(word)) s.appendChild(util.el('span', { class: 'note-anchor holy-note-anchor', text: '°', title: holyLabel(word) }));
        marks.forEach(function(mark){
          s.classList.add('marker-'+mark.type);
          if(mark.type==='backward_nun')ink.textContent='נ';
          if(mark.type==='margin_note')s.appendChild(util.el('span',{class:'note-anchor',title:mark.note,'aria-label':'Margin note'}));
          if(mark.type==='four_tagin'){
            var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 100 40');svg.setAttribute('class','four-tagin');svg.setAttribute('aria-label','Four tagin');svg.setAttribute('preserveAspectRatio','none');
            [14,38,62,86].forEach(function(x){var path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M'+x+' 40 V12 M'+(x-6)+' 10 L'+x+' 2 L'+(x+6)+' 10 Z');path.setAttribute('fill','currentColor');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','3');svg.appendChild(path);});s.appendChild(svg);
          }
        });
        if (li === 0 && word.hyphen_notes?.length && !s.querySelector('.note-anchor')) s.appendChild(util.el('span', { class: 'note-anchor', title: word.hyphen_notes.join('; '), 'aria-label': 'Hyphen note' }));
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
        } else if (it.type === 'setuma_gap' || it.type === 'segment_gap' || it.type === 'custom_gap') {
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
    holyLabel: holyLabel,
    notePosition: notePosition,
    layoutGeometry: layoutGeometry,
    isReady: function () { return pageEls.length > 0 && renderedCount === pageEls.length; },
    preparePrint: preparePrint,
    finishPrint: finishPrint,
    isPrintReady: function () { return printReady; },
    prepareTefillinPaper: prepareTefillinPaper,
    prepareSamplePaper: prepareSamplePaper,
    prepareMultiplePages: prepareMultiplePages,
    selectedFont: selectedFont,
    suggestsDrop: suggestsDrop,
    refreshPrintNote: function () { if (renderedLayout) fillPrintNote(renderedLayout); }
  };
})();
