/*
 * Sofer Studio — export.js
 * Export the ACTIVE layout via the same measured layout as the preview:
 * Browser print / Save as PDF, plus JSON and CSV from the server export endpoint.
 */
(function () {
  'use strict';
  var SS = window.SS;
  var util = SS.util;
  var bus = SS.bus;
  var state = SS.state;
  var API;

  var root = null;

  function init(ctx) {
    API = ctx.api;
    root = util.byId('export-controls');
    if (!root) return;
    build();
    bus.on('layout:loaded', updateState);
    bus.on('app:ready', updateState);
    bus.on('preview:ready', updateState);
    window.addEventListener('beforeprint', function () {
      if (!SS.tikkun) return;
      SS.tikkun.refreshPrintNote();
      if (!SS.tikkun.isPrintReady()) util.byId('print-note').textContent = 'To print ALL pages, close this dialog and use the Sofer Print / Save PDF button. It prepares the complete layout first.';
    });
    window.addEventListener('afterprint', finishPrint);
  }

  function build() {
    util.clear(root);
    var row = util.el('div', { class: 'btn-row' });
    var bPrint = util.el('button', { class: 'btn btn-primary', text: 'Print / Save PDF' });
    var bJson = util.el('button', { class: 'btn btn-ghost btn-sm', text: 'Download JSON', 'data-format': 'json' });
    var bCsv = util.el('button', { class: 'btn btn-ghost btn-sm', text: 'Download CSV', 'data-format': 'csv' });

    bPrint.addEventListener('click', printLayout);
    bJson.addEventListener('click', function () { doExport('json'); });
    bCsv.addEventListener('click', function () { doExport('csv'); });

    row.appendChild(bPrint);
    root.appendChild(row);
    var pagesPerSheet = util.el('input', { id:'print-pages-per-sheet', type:'number', min:'1', max:'16', step:'1', value:'1' });
    var direction = util.el('select', { id:'print-page-direction' }, [util.el('option',{value:'down',text:'Downwards'}),util.el('option',{value:'across',text:'Widthways'})]);
    var nupPaper = util.el('select', {id:'print-sheet-paper'}, ['A4-portrait','A4-landscape','A3-portrait','A3-landscape'].map(function(value){return util.el('option',{value:value,text:value.replace('-',' ')});}));
    root.appendChild(util.el('div',{class:'print-sheet-controls'},[
      util.el('label',{class:'field'},[util.el('span',{text:'Pages per sheet'}),pagesPerSheet]),
      util.el('label',{class:'field'},[util.el('span',{text:'Arrange pages'}),direction]),
      util.el('label',{class:'field'},[util.el('span',{text:'Sheet size'}),nupPaper]),
      util.el('p',{class:'profile-help',text:'Multiple pages per sheet are reduced proportionally to fit the selected paper.'})]));
    var samplePaper=util.el('select',{id:'sample-paper'},['A4-landscape','A4-portrait','A3-landscape','A3-portrait','A2-portrait'].map(function(value){return util.el('option',{value:value,text:value.replace('-',' ')});}));
    var sampleButton=util.el('button',{class:'btn btn-ghost',text:'Print sample at actual size',id:'print-sample'});
    sampleButton.addEventListener('click',function(){printLayout('sample');});
    root.appendChild(util.el('div',{class:'sample-print-controls'},[util.el('label',{class:'field'},[util.el('span',{text:'Sample paper'}),samplePaper]),sampleButton,
      util.el('p',{class:'profile-help',text:'Print the first columns side by side with the real top, bottom and side margins and column gaps. Content beyond the paper edges is clipped. Choose 100% scale in the print dialog.'})]));
    var reverse = util.el('input', { type: 'checkbox', id: 'export-reverse-lines', checked: !!(SS.tikkun && SS.tikkun.isReversed()) });
    root.appendChild(util.el('label', { class: 'toggle' }, [reverse, util.el('span', { text: 'Reverse lines — line 1 at the bottom of each page' })]));
    reverse.addEventListener('change', function () { SS.tikkun.setReverseLines(reverse.checked); });
    bus.on('preview:reverse-lines', function (on) { reverse.checked = on; });
    var paper=util.el('select',{id:'export-tefillin-paper'},[util.el('option',{value:'A4',text:'A4 landscape'}),util.el('option',{value:'A3',text:'A3 landscape'})]);
    root.appendChild(util.el('label',{id:'export-tefillin',class:'field',hidden:true},[util.el('span',{text:'All four Tefillin pages on one sheet'}),paper]));
    root.appendChild(util.el('div',{class:'offline-download'},[
      util.el('a',{class:'btn btn-ghost',href:'/downloads/Sofer-Studio-Windows-x64.zip',download:'Sofer-Studio-Windows-x64.zip',text:'Download Sofer for Windows — work offline'}),
      util.el('p',{class:'profile-help',text:'Extract the ZIP to a folder, then open Start Sofer.cmd. Includes the program, fonts and Torah text. Offline work is saved in that folder; it is separate from your online workspace.'})]));
    root.appendChild(util.el('ol', { class: 'download-instructions' }, [
      util.el('li', { text: 'Click Print / Save PDF and wait while all pages are prepared.' }),
      util.el('li', { text: 'Choose “Save as PDF” as the destination, select All pages, then Save.' }),
      util.el('li', { text: 'Choose paper that fits your column. For physical measurements, print at 100% and verify with a ruler.' })]));
    var data = util.el('details', { class: 'download-data' }, [util.el('summary', { text: 'Layout data (JSON / CSV)' }),
      util.el('p', { text: 'For backups and analysis — these files are not a visual document.' }), util.el('div', { class: 'btn-row' }, [bJson, bCsv])]);
    root.appendChild(data);
    updateState();
  }

  function updateState() {
    if (!root) return;
    var t=state.layout&&state.layout.summary&&state.layout.summary.tefillin;
    util.byId('export-tefillin').hidden=!t;
    if(t)util.byId('export-tefillin-paper').value=t.paper||'A4';
    var has = !!state.active.layoutId;
    var study = !!(state.layout && state.layout.summary && state.layout.summary.study_preview);
    util.qsa('button', root).forEach(function (b) { b.disabled = !has || study; });
    var previewPrint = util.byId('preview-print');
    if (previewPrint) previewPrint.disabled = !has || study || !SS.tikkun || !SS.tikkun.isReady();
  }

  var preparingPrint = false;
  var returnView = null;
  function finishPrint() {
    if (SS.tikkun) SS.tikkun.finishPrint();
    if (returnView && SS.workspace) SS.workspace.open(returnView);
    returnView = null;
  }
  async function printLayout(kind) {
    if (preparingPrint) return;
    if (!state.active.layoutId || !state.layout) { SS.toast('Open or compute a layout first.', 'error'); return; }
    if (state.layout.summary && state.layout.summary.study_preview) { SS.toast('This study preview has unverified special passages. Complete their verification before export.', 'error'); return; }
    if (!SS.tikkun || !SS.tikkun.isReady()) { SS.toast('The pages are still rendering. Please wait before printing.', 'error'); return; }
    var count=Number(util.byId('print-pages-per-sheet').value);
    if(kind!=='sample'&&(!Number.isInteger(count)||count<1||count>16)){SS.toast('Choose between 1 and 16 pages per sheet.', 'error');return;}
    preparingPrint = true;
    returnView = SS.workspace ? SS.workspace.current() : null;
    if (SS.workspace) SS.workspace.open('layout');
    SS.toast('Preparing all pages for printing…');
    try {
      if (!await SS.tikkun.preparePrint()) { SS.toast('Layout changed. Please try printing again.', 'error'); finishPrint(); return; }
      SS.tikkun.refreshPrintNote();
      if(kind==='sample')SS.tikkun.prepareSamplePaper(util.byId('sample-paper').value);
      else if(count>1) SS.tikkun.prepareMultiplePages(count,util.byId('print-page-direction').value,util.byId('print-sheet-paper').value);
      else if(SS.tikkun.prepareTefillinPaper)SS.tikkun.prepareTefillinPaper(util.byId('export-tefillin-paper').value);
      // Browser print includes every amud, not only the page on screen.
      window.print();
    } catch (e) { finishPrint(); SS.toast(e.message || String(e), 'error'); }
    finally { preparingPrint = false; }
  }

  async function doExport(format) {
    var id = state.active.layoutId;
    if (state.layout && state.layout.summary && state.layout.summary.study_preview) {
      SS.toast('This is a study preview — not writing-ready. Exports are disabled.', 'error');
      return;
    }
    if (!id) { SS.toast('Open or compute a layout first.', 'error'); return; }
    try {
      var res = await API.exportLayout(id, format);
      if (res.kind === 'blob') {
        util.download(res.filename, res.blob);
      } else {
        var blob = new Blob([res.text], { type: format === 'csv' ? 'text/csv' : 'application/json' });
        util.download(res.filename, blob);
      }
    } catch (e) { SS.toast(e.message || String(e), 'error'); }
  }

  SS.export = { init: init, printLayout: printLayout };
})();
