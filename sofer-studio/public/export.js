/*
 * Sofer Studio — export.js
 * Export the ACTIVE layout via the same measured layout as the preview:
 * Print (print CSS), PDF, JSON, CSV — served by GET /api/layouts/:id/export.
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
  }

  function build() {
    util.clear(root);
    var label = util.el('span', { class: 'eyebrow', text: 'Export layout' });
    root.appendChild(label);

    var row = util.el('div', { class: 'btn-row' });
    var bPrint = util.el('button', { class: 'btn btn-ghost btn-sm', text: 'Print' });
    // F-17: PDF is not implemented server-side (501). Disable the button outright
    // and point the sofer to browser print instead, rather than firing a request
    // guaranteed to fail.
    var bPdf = util.el('button', { class: 'btn btn-ghost btn-sm', id: 'export-pdf', text: 'PDF', disabled: true, title: 'PDF not yet supported — use browser print' });
    var bJson = util.el('button', { class: 'btn btn-ghost btn-sm', text: 'JSON' });
    var bCsv = util.el('button', { class: 'btn btn-ghost btn-sm', text: 'CSV' });

    bPrint.addEventListener('click', function () {
      // Fill the print note with scaling explanation, then print.
      var note = util.byId('print-note');
      var g = SS.activeGeometry ? SS.activeGeometry() : null;
      var txt = 'Sofer Studio \u2014 measured layout. Print at 100% scale; verify one amud against a ruler and adjust the printer scale factor to match ' +
        ((g && g.line_width_mm) ? util.mm(g.line_width_mm) + ' line width.' : 'the configured line width.');
      if (g && g.lines_per_amud) txt += ' ' + g.lines_per_amud + ' lines \u00d7 ' + util.mm(g.baseline_pitch_mm) + ' pitch.';
      note.textContent = txt;
      window.print();
    });
    bJson.addEventListener('click', function () { doExport('json'); });
    bCsv.addEventListener('click', function () { doExport('csv'); });

    row.appendChild(bPrint); row.appendChild(bPdf); row.appendChild(bJson); row.appendChild(bCsv);
    root.appendChild(row);
    root.appendChild(util.el('div', { class: 't--2 faint', text: 'Print, JSON and CSV use the same measured layout as the preview; PDF is not yet supported.' }));
    updateState();
  }

  function updateState() {
    if (!root) return;
    var has = !!state.active.layoutId;
    util.qsa('button', root).forEach(function (b) { b.disabled = (b.id === 'export-pdf') ? true : !has; });
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

  SS.export = { init: init };
})();
