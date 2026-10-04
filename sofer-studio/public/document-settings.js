(function () {
  'use strict';
  var SS = window.SS, u = SS.util, host, getDraft, API, controls = {}, sourceId = null, revision = 0;
  function settings() {
    var d = getDraft();
    d.document_flow ||= { column_start: d.vavei_haamudim ? 'vav' : 'none' };
    return d.document_flow;
  }
  function unit() {
    var p = SS.calibration?.getDraft() || SS.activeProfile?.() || {}, d = getDraft();
    return p.unit_basis === 'line_units' && p.units_per_row > 0 ? d.line_width_mm / p.units_per_row : Number(p.unit_mm) || .5;
  }
  function toggle(label, key) {
    var input = u.el('input', { type: 'checkbox', checked: !!settings()[key], id: 'flow-' + key });
    input.addEventListener('change', function () { settings()[key] = input.checked; });
    return u.el('label', { class: 'toggle' }, [input, u.el('span', { text: label })]);
  }
  function render() {
    if (!host || !getDraft()) return;
    u.clear(host); var flow = settings();
    if (flow.source_id && sourceId && flow.source_id !== sourceId) { flow.starts = {}; flow.gaps = {}; flow.page_widths = {}; flow.source_id = sourceId; }
    var mode = u.el('select', { id: 'flow-column-start' }, [['none','Ordinary page starts'],['vav','Vavei — start with ו'],['hamelech','Hamelech — start with המלך']].map(function (x) { return u.el('option', { value: x[0], text: x[1] }); }));
    mode.value = flow.column_start || 'none';
    mode.addEventListener('change', function () { settings().column_start = mode.value; getDraft().vavei_haamudim = mode.value === 'vav'; });
    host.appendChild(u.el('label', { class: 'field' }, [u.el('span', { text: 'Column starts' }), mode]));
    host.appendChild(toggle('Narrow columns after Vavei / Hamelech moves to fill every line', 'fit_boundary_page'));
    var fitting = u.el('select', { id: 'flow-page-fit' }, [['none','Keep column widths'],['last','Fit the last page of each segment'],['balance','Balance every page in each segment']].map(function (item) { return u.el('option', { value: item[0], text: item[1] }); }));
    fitting.value = flow.balance_segments ? 'balance' : flow.fit_last_page ? 'last' : 'none';
    fitting.addEventListener('change', function () { settings().fit_last_page = fitting.value === 'last'; settings().balance_segments = fitting.value === 'balance'; });
    host.appendChild(u.el('label', { class: 'field' }, [u.el('span', { text: 'Page fitting — round segment page count to the nearest whole page' }), fitting]));
    host.appendChild(toggle('Follow Davidovitch 245 page starts (v); unchecked ignores these markers', 'follow_reference_pages'));
    host.appendChild(toggle('Recalculate following text after moving words', 'reflow_word_moves'));
    host.appendChild(u.el('p', { class: 'profile-help', text: 'Page fitting changes column width in mm and units. Base letter size stays the same. Explicit song rows and paragraph spacing remain fixed.' }));
    var starts = u.el('details', { class: 'flow-list' }, [u.el('summary', { text: 'Selected page starts (t)' })]);
    (controls.page_starts || []).forEach(function (item) {
      var value = flow.starts?.[item.id] || { enabled: true }, mm = value.width_mm || getDraft().line_width_mm;
      var check = u.el('input', { type: 'checkbox', checked: value.enabled !== false, 'aria-label': 'Start a page before ' + item.first_word });
      var millimetres = u.el('input', { type: 'number', min: '.01', max: '1000', step: '.1', value: mm, 'aria-label': 'Section width in mm before ' + item.first_word });
      var units = u.el('input', { type: 'number', min: '.01', step: '1', value: +(mm / unit()).toFixed(3), 'aria-label': 'Section width in units before ' + item.first_word });
      function save() { var f = settings(); f.source_id = sourceId; f.starts ||= {}; f.starts[item.id] = { enabled: check.checked, width_mm: Number(millimetres.value) }; }
      check.addEventListener('change', function(){save();millimetres.disabled=!check.checked;units.disabled=!check.checked;});
      millimetres.disabled=!check.checked;units.disabled=!check.checked;
      millimetres.addEventListener('input', function () { units.value = +(Number(millimetres.value) / unit()).toFixed(3); save(); });
      units.addEventListener('input', function () { millimetres.value = +(Number(units.value) * unit()).toFixed(4); save(); });
      starts.appendChild(u.el('div', { class: 'flow-row' }, [u.el('label', { class: 'toggle' }, [check, u.el('span', { dir: 'rtl', text: item.first_word })]), u.el('label', { class: 'field' }, [u.el('span', { text: 'mm' }), millimetres]), u.el('label', { class: 'field' }, [u.el('span', { text: 'units' }), units])]));
    });
    if (!controls.page_starts?.length) starts.appendChild(u.el('p', { class: 'profile-help', text: 'No t markers in the selected source.' }));
    host.appendChild(starts);
    var gaps = u.el('details', { class: 'flow-list' }, [u.el('summary', { text: 'Individual custom gaps (g)' })]);
    (controls.custom_gaps || []).forEach(function (item) {
      var value = flow.gaps?.[item.id] || { preset: 'yod-2.5', units: 0 };
      var select = u.el('select', { 'aria-label': 'Gap between ' + item.before + ' and ' + item.after }, [
        ['yod-2.5','2.5 × י'],['asher-less-half','אשר minus 0.5 unit'],['nine-yods','ייייייייי'],['three-asher','אשראשראשר'],['three-asher-spaced','אשר אשר אשר'],['custom','Custom units']
      ].map(function (x) { return u.el('option', { value: x[0], text: x[1] }); }));
      select.value = value.preset;
      var input = u.el('input', { type: 'number', min: '0', max: '1000', step: '.1', value: value.units || 0, 'aria-label': 'Custom gap units', hidden: value.preset !== 'custom' });
      function save() { var f = settings(); f.source_id = sourceId; f.gaps ||= {}; f.gaps[item.id] = { preset: select.value, units: Number(input.value) }; input.hidden = select.value !== 'custom'; }
      select.addEventListener('change', save); input.addEventListener('input', save);
      gaps.appendChild(u.el('label', { class: 'field' }, [u.el('span', { dir: 'rtl', text: item.before + ' … ' + item.after }), select, input]));
    });
    if (!controls.custom_gaps?.length) gaps.appendChild(u.el('p', { class: 'profile-help', text: 'No g markers in the selected source.' }));
    host.appendChild(gaps);
  }
  async function loadSource() {
    var id = SS.state.active.sourceId;
    if (id === sourceId) return;
    sourceId = id; var request = ++revision; controls = {}; render();
    if (!id) return;
    try {
      var source = await API.getSource(id);
      if (request !== revision) return;
      controls = source.controls || {};
      var flow = settings();
      if (flow.source_id && flow.source_id !== id) { flow.starts = {}; flow.gaps = {}; flow.page_widths = {}; }
      render();
    } catch (error) { if (request === revision) SS.toast(error.message, 'error'); }
  }
  SS.documentSettings = { render: render, init: function (api, root, draft) {
    API = api; getDraft = draft; host = u.el('div', { id: 'document-flow-settings' }); root.appendChild(host);
    SS.bus.on('selection:changed', loadSource); SS.bus.on('sourceId:changed', loadSource); SS.bus.on('app:ready', loadSource);
    SS.bus.on('calibration:draft-changed', render); render(); loadSource();
  } };
})();
