/*
 * Sofer Studio — api.js
 * API client matching the FROZEN contract in docs/sofer-studio/API_CONTRACT.md.
 *
 * Responsibilities:
 *  - fetch wrapper with per-session token (GET /api/session -> X-Sofer-Token)
 *  - token required on all mutations, attached automatically
 *  - typed wrappers for every endpoint (returns parsed JSON)
 *  - file download path for exports (json/csv/pdf)
 *
 * Loaded SECOND (after core.js). Exposes window.SS.api.
 */
(function () {
  'use strict';
  var SS = window.SS;
  var state = SS.state;

  /* ------------------------------------------------------------------ *
   * Low-level request
   * ------------------------------------------------------------------ */
  function currentToken() {
    if (state.sessionToken) return state.sessionToken;
    // Fall back to sessionStorage so a refresh keeps the same token
    // session (the server also re-issues on first /api/session hit).
    try { return sessionStorage.getItem('sofer-token') || null; } catch (e) { return null; }
  }

  function rememberToken(v) {
    if (!v) return;
    state.sessionToken = v;
    try { sessionStorage.setItem('sofer-token', v); } catch (e) { /* ignore */ }
  }

  async function request(method, path, body) {
    var headers = {};
    if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
    var tok = currentToken();
    if (tok) headers['X-Sofer-Token'] = tok;

    var resp;
    try {
      resp = await fetch('/api' + path, {
        method: method,
        headers: headers,
        body: (body === undefined || body === null) ? undefined : JSON.stringify(body)
      });
    } catch (e) {
      throw networkError(e);
    }

    var newTok = resp.headers.get('X-Sofer-Token');
    if (newTok) rememberToken(newTok);

    var ct = resp.headers.get('content-type') || '';
    var data;
    if (ct.indexOf('application/json') >= 0) {
      try { data = await resp.json(); }
      catch (e) { data = null; }
    } else {
      data = await resp.text();
    }

    if (!resp.ok) {
      var msg = (data && data.error) ? data.error : ('HTTP ' + resp.status);
      var err = new Error(msg);
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function networkError(e) {
    var err = new Error('Cannot reach Sofer Studio server at /api — is it running? (' +
      (e && e.message ? e.message : 'network') + ')');
    err.status = 0;
    err.network = true;
    return err;
  }

  /* ------------------------------------------------------------------ *
   * Endpoints — mirrors API_CONTRACT.md exactly.
   * ------------------------------------------------------------------ */
  var api = {};

  // Session & health
  api.session = function () { return request('GET', '/session'); };
  api.health = function () { return request('GET', '/health'); };

  // Sources
  api.listSources = function () { return request('GET', '/sources'); };
  api.listBuiltinSources = function () { return request('GET', '/sources/builtin'); };
  api.getSource = function (id) { return request('GET', '/sources/' + encodeURIComponent(id)); };
  api.importSource = function (body) { return request('POST', '/sources/import', body); };

  // Profiles
  api.listProfiles = function () { return request('GET', '/profiles'); };
  api.createProfile = function (body) { return request('POST', '/profiles', body); };
  api.getProfile = function (id) { return request('GET', '/profiles/' + encodeURIComponent(id)); };
  api.updateProfile = function (id, body) { return request('PUT', '/profiles/' + encodeURIComponent(id), body); };
  api.deleteProfile = function (id) { return request('DELETE', '/profiles/' + encodeURIComponent(id)); };
  api.duplicateProfile = function (id, body) { return request('POST', '/profiles/' + encodeURIComponent(id) + '/duplicate', body || {}); };
  api.importProfile = function (body) { return request('POST', '/profiles/import', body); };

  // Geometries
  api.listGeometries = function () { return request('GET', '/geometries'); };
  api.createGeometry = function (body) { return request('POST', '/geometries', body); };
  api.getGeometry = function (id) { return request('GET', '/geometries/' + encodeURIComponent(id)); };

  // Patterns
  api.listPatterns = function () { return request('GET', '/patterns'); };
  api.createPattern = function (body) { return request('POST', '/patterns', body); };
  api.getPattern = function (id) { return request('GET', '/patterns/' + encodeURIComponent(id)); };

  // Layouts
  api.computeLayout = function (body) { return request('POST', '/layout/compute', body); };
  api.listLayouts = function () { return request('GET', '/layouts'); };
  api.getLayout = function (id, opts) {
    var q = '';
    if (opts && (opts.from != null || opts.limit != null)) {
      q = '?from=' + (opts.from || 0) + '&limit=' + (opts.limit || 500);
    }
    return request('GET', '/layouts/' + encodeURIComponent(id) + q);
  };
  api.computeJob = function (id) { return request('GET', '/layout/compute-job/' + encodeURIComponent(id)); };
  api.lockLayout = function (id) { return request('POST', '/layouts/' + encodeURIComponent(id) + '/lock'); };
  api.updateProgress = function (id, body) { return request('POST', '/layouts/' + encodeURIComponent(id) + '/progress', body); };
  api.createCandidate = function (id, body) { return request('POST', '/layouts/' + encodeURIComponent(id) + '/candidate', body); };
  api.getDiff = function (id) { return request('GET', '/layouts/' + encodeURIComponent(id) + '/diff'); };
  api.searchLayout = function (id, q) {
    return request('GET', '/layouts/' + encodeURIComponent(id) + '/search?q=' + encodeURIComponent(q));
  };
  api.compare = function (body) { return request('POST', '/compare', body); };

  // Stretch & justification
  api.stretch = function (id, body) { return request('POST', '/layouts/' + encodeURIComponent(id) + '/stretch', body); };
  api.autoSuggest = function (id, body) { return request('POST', '/layouts/' + encodeURIComponent(id) + '/auto-suggest', body); };
  api.adoptCandidate = function (id, body) { return request('POST', '/layouts/' + encodeURIComponent(id) + '/adopt-candidate', body); };

  // Validation
  api.validateLine = function (body) { return request('POST', '/validate/line', body); };

  // Exports — return a parsed JSON object (json/csv) or a Blob (pdf).
  api.exportLayout = async function (id, format) {
    format = format || 'json';
    var headers = {};
    var tok = currentToken();
    if (tok) headers['X-Sofer-Token'] = tok;
    var resp;
    try {
      resp = await fetch('/api/layouts/' + encodeURIComponent(id) + '/export?format=' + encodeURIComponent(format), {
        method: 'GET', headers: headers
      });
    } catch (e) { throw networkError(e); }
    var newTok = resp.headers.get('X-Sofer-Token');
    if (newTok) rememberToken(newTok);
    if (!resp.ok) {
      var d = null;
      try { d = await resp.json(); } catch (e) { /* ignore */ }
      var err = new Error((d && d.error) ? d.error : 'Export failed (' + resp.status + ')');
      err.status = resp.status;
      throw err;
    }
    var ctd = resp.headers.get('content-disposition') || '';
    var nameMatch = ctd.match(/filename="?([^";]+)"?/);
    var filename = nameMatch ? nameMatch[1] : ('layout-' + id + '.' + (format === 'pdf' ? 'pdf' : format));
    if (format === 'pdf') {
      var blob = await resp.blob();
      return { blob: blob, filename: filename, kind: 'blob' };
    }
    var text = await resp.text();
    return { text: text, filename: filename, kind: 'text' };
  };

  // Export profile as JSON (download).
  api.exportProfile = async function (id) {
    var headers = {};
    var tok = currentToken();
    if (tok) headers['X-Sofer-Token'] = tok;
    var resp = await fetch('/api/profiles/' + encodeURIComponent(id) + '/export', { headers: headers });
    var newTok = resp.headers.get('X-Sofer-Token');
    if (newTok) rememberToken(newTok);
    if (!resp.ok) throw new Error('Profile export failed (' + resp.status + ')');
    return await resp.json();
  };

  SS.api = api;
})();
