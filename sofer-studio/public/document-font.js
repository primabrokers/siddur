(function () {
  'use strict';
  var SS = window.SS, u = SS.util, value = null, font, overlap;
  function initial() {
    var profile = SS.calibration?.getDraft() || SS.activeProfile?.() || {};
    var geometry = SS.geometry?.getDraft() || {}, pitch = Number(geometry.baseline_pitch_mm) || 7.5;
    return profile.stretch_policy?.rendering || { font: 'stam', overlap_percent: { stam: Math.max(-99, Math.min(300, (Number(profile.letter_height_mm) || 5) / pitch * 100 - 100)) } };
  }
  function get() { return JSON.parse(JSON.stringify(value || initial())); }
  function render() {
    if (!font) return;
    var r = get(); font.value = r.font;
    if (document.activeElement !== overlap) overlap.value = +(Number(r.overlap_percent?.[r.font] ?? 0)).toFixed(3);
  }
  function changed() { render(); SS.bus.emit('document-font:changed', get()); }
  SS.documentFont = {
    get: get,
    render: render,
    height: function (pitch) { var r = get(); return pitch * (1 + Number(r.overlap_percent?.[r.font] ?? 0) / 100); },
    initControls: function (host) {
      font = u.el('select', { id: 'cal-font' }, [u.el('option', { value: 'stam', text: 'STaM Ashkenaz' }), u.el('option', { value: 'asirit', text: 'Asirit — supplied font' })]);
      overlap = u.el('input', { id: 'cal-letter-overlap', type: 'number', min: '-99', max: '300', step: 'any', 'aria-label': 'Letter overlap (%)' });
      overlap.title = 'Letter height = line height × (1 + overlap / 100). Font settings belong to this document.';
      host.appendChild(u.el('label', { class: 'field' }, [u.el('span', { text: 'Font' }), font]));
      host.appendChild(u.el('label', { class: 'field' }, [u.el('span', { text: 'Letter overlap (%)' }), overlap]));
      font.addEventListener('change', function () { value = get(); value.font = font.value; value.overlap_percent ||= {}; value.overlap_percent[value.font] ??= 0; changed(); });
      overlap.addEventListener('input', function () { if (!overlap.validity.valid || overlap.value === '') return; value = get(); value.overlap_percent ||= {}; value.overlap_percent[value.font] = Number(overlap.value); changed(); });
      SS.bus.on('layout:loaded', function (layout) {
        var p = layout?.snapshot?.profile, g = layout?.snapshot?.geometry;
        if (!p || !g) return;
        value = JSON.parse(JSON.stringify(p.document_rendering || p.stretch_policy?.rendering || { font: 'stam', overlap_percent: { stam: p.letter_height_mm / g.baseline_pitch_mm * 100 - 100 } }));
        changed();
      });
      SS.bus.on('profileId:changed', render); SS.bus.on('geometry:draft-changed', render); render();
    }
  };
})();
