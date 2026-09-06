/*
 * Sofer Studio — layouts.js
 * Saved layouts: card list with klaf thumbnail, status chip, snapshot summary,
 * and actions (Open / Lock / Duplicate as candidate / Compare).
 * Locked layouts are immutable — the only mutation path is a candidate.
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
    root = util.byId('layouts-body');
    if (!root) return;
    bus.on('layouts:list', function (list) { render(list || state.layouts); });
    render(state.layouts);
  }

  function render(list) {
    if (!root) return;
    util.clear(root);
    if (!list || !list.length) {
      root.appendChild(util.el('div', { class: 'empty', text: 'No saved layouts yet. Compute one to begin.' }));
      return;
    }
    list.slice().sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); })
      .forEach(function (lay) { root.appendChild(card(lay)); });
  }

  function card(lay) {
    var locked = lay.status === 'locked';
    var el = util.el('div', { class: 'layout-card' + (locked ? ' is-locked' : '') });

    var thumb = util.el('div', { class: 'thumb' });
    var cols = 4;
    for (var i = 1; i < cols; i++) {
      var ty = util.el('span', { class: 'tyeria' });
      ty.style.left = Math.round((i / cols) * 100) + '%';
      thumb.appendChild(ty);
    }
    el.appendChild(thumb);

    var body = util.el('div', { class: 'lbody' });
    body.appendChild(util.el('div', { class: 'lname', text: lay.name || ('Layout ' + lay.id) }));
    body.appendChild(util.el('div', { class: 'lmeta', html: snapshotSummary(lay) }));

    var actions = util.el('div', { class: 'lactions' });
    actions.appendChild(chipFor(lay));
    var open = util.el('button', { class: 'btn btn-ghost btn-sm', text: 'Open' });
    open.addEventListener('click', function () { openLayout(lay.id); });
    actions.appendChild(open);

    if (!locked) {
      var lockBtn = util.el('button', { class: 'btn btn-ghost btn-sm', text: 'Lock' });
      lockBtn.addEventListener('click', function () { lockLayout(lay.id); });
      actions.appendChild(lockBtn);
    }

    var cand = util.el('button', { class: 'btn btn-ghost btn-sm', text: 'Duplicate as candidate' });
    cand.addEventListener('click', function () { requestCandidate(lay.id); });
    if (!locked) { cand.disabled = true; cand.title = 'Lock the layout first'; }
    actions.appendChild(cand);

    var cmp = util.el('button', { class: 'btn btn-ghost btn-sm', text: 'Compare' });
    cmp.addEventListener('click', function () { bus.emit('compare:request', lay); SS.activateDrawer('compare'); });
    actions.appendChild(cmp);

    body.appendChild(actions);
    el.appendChild(body);
    return el;
  }

  function chipFor(lay) {
    var status = lay.status || 'draft';
    var map = {
      draft: ['chip draft', 'Draft'],
      locked: ['chip locked', '\u1f512 Locked'],
      candidate: ['chip candidate', 'Candidate']
    };
    var c = map[status] || map.draft;
    return util.el('span', { class: c[0], text: c[1] });
  }

  function snapshotSummary(lay) {
    var parts = [];
    if (lay.source_rev || lay.source_hash) parts.push('source ' + shortId(lay.source_rev || lay.source_hash));
    if (lay.profile_name) parts.push('profile ' + lay.profile_name);
    if (lay.geometry_name) parts.push('geom ' + lay.geometry_name);
    if (lay.created_at) parts.push(util.esc(String(lay.created_at).slice(0, 10)));
    if (lay.locked_at) parts.push('writing began ' + util.esc(String(lay.locked_at).slice(0, 10)));
    return parts.length ? parts.join(' · ') : 'snapshot';
  }
  function shortId(id) {
    return String(id || '').slice(0, 7);
  }

  async function openLayout(id) {
    try {
      var lay = await API.getLayout(id);
      state.layout = lay;
      state.active.layoutId = lay.id;
      bus.emit('layout:loaded', lay);
      SS.activateDrawer('progress');
      var bench = util.byId('lower-bench');
      if (bench) bench.classList.remove('is-collapsed');
      SS.toast('Opened layout ' + lay.id + '.');
    } catch (e) { SS.toast(e.message || String(e), 'error'); }
  }

  async function lockLayout(id) {
    try {
      await API.lockLayout(id);
      state.layouts = await API.listLayouts();
      bus.emit('layouts:list', state.layouts);
      if (state.active.layoutId === id && state.layout) state.layout.status = 'locked';
      bus.emit('layout:locked', state.layout);
      SS.toast('Layout locked.');
    } catch (e) { SS.toast(e.message || String(e), 'error'); }
  }

  function requestCandidate(id) {
    bus.emit('candidate:request', { layoutId: id });
    SS.activateDrawer('diff');
  }

  SS.layouts = { init: init };
})();
