/*
 * Sofer Studio — first-run.js
 * First-run notice modal carrying the required halachic disclaimer:
 * defaults are a starting point only, confirm with a rav/mumcheh, the app
 * plans layout but does not replace hagahah or a computer check, and every
 * halachic parameter is an editable setting — never hard-coded.
 */
(function () {
  'use strict';
  var SS = window.SS;
  var util = SS.util;

  var KEY = 'sofer:first-run-dismissed';

  function init(ctx) {
    if (hasShown()) return;
    show();
  }

  function hasShown() {
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }

  function show() {
    var backdrop = util.byId('first-run-modal');
    if (!backdrop) return;
    backdrop.hidden = false;
    util.clear(backdrop);

    var modal = util.el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fr-title' });
    modal.appendChild(util.el('h2', { id: 'fr-title', text: 'Before you begin' }));
    modal.appendChild(util.el('div', { class: 'mheb', lang: 'he', text: '\u05dc\u05e4\u05e0\u05d9 \u05e9\u05de\u05ea\u05d7\u05d9\u05dc\u05d9\u05dd' }));

    var body = util.el('div', { class: 'mbody' });
    var ul = util.el('ul');
    [
      'Defaults are a starting point only. They should be confirmed with a rav or mumcheh before writing.',
      'Every halachic parameter is an editable setting \u2014 margins, line counts, minimum column width, stretchable letters, setuma gap, and special-passage schemes are never hard-coded.',
      'This application plans layout. It does not replace hagahah, a computer check, or the sofer\u2019s own judgment.',
      'Tikkun and totals are generated from your imported source and calibration \u2014 a screen rendering is not proof of physical nib-calibrated dimensions.'
    ].forEach(function (t) { ul.appendChild(util.el('li', { text: t })); });
    body.appendChild(ul);
    body.appendChild(util.el('div', { class: 'disclaimer',
      text: '\u05e0\u05d9\u05e1\u05d9\u05d5\u05df: \u05d1\u05e8\u05d9\u05e8\u05d5\u05ea \u05de\u05d7\u05d9\u05d9\u05d1\u05d5\u05ea \u05d0\u05d9\u05e9\u05d5\u05e8 \u05e2\u05dd \u05e8\u05d1 \u05d0\u05d5 \u05de\u05d5\u05de\u05d7\u05d4. \u05d4\u05d0\u05e4\u05dc\u05d9\u05e7\u05e6\u05d9\u05d4 \u05de\u05ea\u05db\u05e0\u05e0\u05ea \u05d0\u05ea \u05d4\u05ea\u05e7\u05df; \u05d4\u05d9\u05d0 \u05d0\u05d9\u05e0\u05d4 \u05ea\u05d7\u05dc\u05d9\u05e3 \u05dc\u05d4\u05d2\u05d4\u05d4.' }));
    modal.appendChild(body);

    var actions = util.el('div', { class: 'mactions' });
    var ok = util.el('button', { class: 'btn btn-primary', text: 'I understand \u2014 continue' });
    ok.addEventListener('click', function () {
      try { localStorage.setItem(KEY, '1'); } catch (e) { /* ignore */ }
      backdrop.hidden = true;
    });
    actions.appendChild(ok);
    modal.appendChild(actions);

    backdrop.appendChild(modal);
    ok.focus();
  }

  SS.firstRun = { init: init, show: show };
})();
