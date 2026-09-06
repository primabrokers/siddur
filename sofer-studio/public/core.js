/*
 * Sofer Studio — core.js
 * Shared namespace, event bus, global state, and utilities.
 * Loaded FIRST. Defines window.SS used by every other module.
 */
(function () {
  'use strict';

  var NS = window.SS = window.SS || {};

  /* ------------------------------------------------------------------ *
   * Event bus (cross-panel communication; panels never reach into each
   * other's DOM directly — they listen for events here).
   * ------------------------------------------------------------------ */
  var listeners = {};
  var bus = {
    on: function (evt, fn) {
      (listeners[evt] = listeners[evt] || []).push(fn);
      return function () { bus.off(evt, fn); };
    },
    off: function (evt, fn) {
      var arr = listeners[evt];
      if (!arr) return;
      var i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    emit: function (evt, payload) {
      var arr = (listeners[evt] || []).slice();
      for (var i = 0; i < arr.length; i++) {
        try { arr[i](payload); }
        catch (e) { console.error('[bus][' + evt + ']', e); }
      }
    }
  };
  NS.bus = bus;

  /* ------------------------------------------------------------------ *
   * Global application state. Every displayed value flows from here and
   * from API responses — nothing is hardcoded sample data.
   * ------------------------------------------------------------------ */
  NS.state = {
    sessionToken: null,
    ready: false,
    sources: [],      // from GET /api/sources
    profiles: [],     // from GET /api/profiles
    geometries: [],   // from GET /api/geometries
    patterns: [],     // from GET /api/patterns
    layouts: [],      // from GET /api/layouts
    active: {
      sourceId: null,
      profileId: null,
      geometryId: null,
      layoutId: null
    },
    layout: null,     // full layout: { id, lines[], summary{}, validation[] }
    candidate: null,  // candidate layout (if created)
    diff: null        // { locked{}, candidate{}, changes[] }
  };

  /* ------------------------------------------------------------------ *
   * Static domain constants (shared across calibration/geometry/tikkun).
   * These are DEFAULTS, never used as halachic truth — every parameter is
   * editable and confirms against the rav/mumcheh via the first-run notice.
   * ------------------------------------------------------------------ */
  NS.LETTERS = [
    '\u05d0','\u05d1','\u05d2','\u05d3','\u05d4','\u05d5','\u05d6','\u05d7',
    '\u05d8','\u05d9','\u05db','\u05da','\u05dc','\u05de','\u05dd','\u05e0',
    '\u05df','\u05e1','\u05e2','\u05e4','\u05e3','\u05e6','\u05e5','\u05e7',
    '\u05e8','\u05e9','\u05ea'
  ]; // 27 letters incl. five sofiyot: ך ם ן ף ץ
  NS.SOFIYOT = ['\u05da','\u05dd','\u05df','\u05e3','\u05e5'];
  NS.DEFAULT_NON_STRETCH = ['\u05d9','\u05d5','\u05d6','\u05df','\u05e0','\u05d2','\u05e6','\u05e5'];
  NS.DEFAULT_STRETCH = ['\u05d3','\u05d4','\u05d7','\u05dc','\u05e8','\u05ea','\u05d1','\u05db','\u05dd','\u05e1'];

  /* ------------------------------------------------------------------ *
   * Utilities
   * ------------------------------------------------------------------ */
  var util = {};
  NS.util = util;

  util.esc = function (s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split('"').join('&quot;')
      .split("'").join('&#39;');
  };

  // Format a number to fixed decimals; em-dash for null/NaN.
  util.fmt = function (n, digits) {
    if (n === null || n === undefined) return '\u2014';
    var v = Number(n);
    if (Number.isNaN(v) || !isFinite(v)) return '\u2014';
    return v.toFixed(digits === undefined ? 2 : digits);
  };

  // Millimetre value with unit suffix.
  util.mm = function (n, digits) { return util.fmt(n, digits) + '\u00a0mm'; };

  // Klaf length in metres (klaf_length_m is ALREADY metres in the contract).
  util.m = function (n) { return util.fmt(n, 2) + '\u00a0m'; };

  // Arabic/plain number parse for mm inputs (tolerates comma decimal).
  util.parseNum = function (v) {
    if (typeof v === 'number') return v;
    if (v === null || v === undefined || v === '') return NaN;
    return parseFloat(String(v).trim().split(',').join('.'));
  };

  util.isFiniteNum = function (v) {
    var n = util.parseNum(v);
    return !Number.isNaN(n) && isFinite(n);
  };

  util.clamp = function (n, lo, hi) {
    return Math.min(Math.max(n, lo), hi);
  };

  util.debounce = function (fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || 120);
    };
  };

  /* --- Hebrew grapheme handling (Intl.Segmenter) -------------------- *
   * Combining marks (niqqud/taamim) must never be split from their base
   * letter. All client-side counting goes through grapheme segmentation.
   * ----------------------------------------------------------------*/
  var segmenter = null;
  function getSegmenter() {
    if (segmenter) return segmenter;
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      try { segmenter = new Intl.Segmenter('he', { granularity: 'grapheme' }); }
      catch (e) { segmenter = null; }
    }
    return segmenter;
  }
  util.graphemes = function (s) {
    if (s === null || s === undefined) return [];
    var str = String(s);
    var seg = getSegmenter();
    if (!seg) return Array.from(str);
    return Array.from(seg.segment(str), function (x) { return x.segment; });
  };
  util.graphemeCount = function (s) { return util.graphemes(s).length; };

  // Hebrew consonant-letter count (excludes niqqud/taamim code points).
  util.isHebrew = function (ch) {
    if (!ch) return false;
    var cp = ch.codePointAt(0);
    return cp >= 0x05d0 && cp <= 0x05ea;
  };
  util.hebrewLetterCount = function (s) {
    var n = 0;
    util.graphemes(s).forEach(function (g) { if (util.isHebrew(g)) n++; });
    return n;
  };

  /* --- Gimatria numerals (Hebrew letters) for line/amud labels ------ */
  var G_UNITS = ['\u05d0','\u05d1','\u05d2','\u05d3','\u05d4','\u05d5','\u05d6','\u05d7','\u05d8'];
  var G_TENS = ['\u05d9','\u05db','\u05dc','\u05de','\u05e0','\u05e1','\u05e2','\u05e4','\u05e6'];
  var G_HUNDREDS = ['\u05e7','\u05e8','\u05e9','\u05ea'];
  util.gimatriaLetters = function (n) {
    n = Math.max(1, Math.floor(Number(n) || 1));
    var s = '';
    var h = Math.floor(n / 100) % 10;
    var t = Math.floor(n / 10) % 10;
    var u = n % 10;
    if (h > 0) s += G_HUNDREDS[h - 1];
    if (t > 0) s += G_TENS[t - 1];
    if (u > 0) s += G_UNITS[u - 1];
    return s || '\u05d0';
  };
  util.gimatria = function (n) {
    n = Math.max(1, Math.floor(Number(n) || 1));
    if (n === 15) return '\u05d8\u05f4\u05d5';
    if (n === 16) return '\u05d8\u05f4\u05d6';
    var letters = util.gimatriaLetters(n);
    if (letters.length === 1) return letters + '\u05f3';
    return letters.slice(0, -1) + '\u05f4' + letters.slice(-1);
  };

  /* --- DOM helpers -------------------------------------------------- */
  var BOOL_PROPS = ['checked','disabled','selected','hidden','multiple','required','readonly'];
  util.el = function (tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'dataset') { Object.keys(v).forEach(function (dk) { el.dataset[dk] = v[dk]; }); }
        else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (BOOL_PROPS.indexOf(k) >= 0) el[k] = !!v;
        else if (k === 'value') el.value = v;
        else if (k === 'style') el.setAttribute('style', v);
        else el.setAttribute(k, v);
      });
    }
    if (children !== undefined && children !== null) {
      var arr = Array.isArray(children) ? children : [children];
      arr.forEach(function (c) {
        if (c === null || c === undefined) return;
        el.appendChild((typeof c === 'string' || typeof c === 'number') ? document.createTextNode(String(c)) : c);
      });
    }
    return el;
  };
  util.clear = function (el) { while (el.firstChild) el.removeChild(el.firstChild); };
  util.qs = function (sel, root) { return (root || document).querySelector(sel); };
  util.qsa = function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };
  util.byId = function (id) { return document.getElementById(id); };

  // Delegated click helper: util.delegate(root, '.sel', handler)
  util.delegate = function (root, sel, handler) {
    root.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest(sel) : null;
      if (t && root.contains(t)) handler(ev, t);
    });
  };

  // File download helper (used by export).
  util.download = function (filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };

  // Healthy-ish slug for filenames.
  util.slug = function (s) {
    return String(s || 'layout').trim()
      .split(/[^a-zA-Z0-9\u05d0-\u05ea]+/).filter(Boolean).join('-').toLowerCase() || 'layout';
  };

  NS.util = util;
})();
