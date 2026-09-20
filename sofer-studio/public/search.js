/*
 * Sofer Studio — search.js
 * Panel 10: verse search (jump to amud/line) plus source management — import
 * via file upload or paste (POST /api/sources/import), and the source list
 * with honest letter/verse counts. The app-bar search field mirrors this.
 */
(function () {
  'use strict';
  var SS = window.SS;
  var util = SS.util;
  var bus = SS.bus;
  var state = SS.state;
  var API;

  var root = null;

  // Windows STAM exports are commonly UTF-16, not UTF-8. File.text() always
  // decodes as UTF-8 and corrupts those letters before the server sees them.
  function decodeSourceFile(buffer) {
    var bytes = new Uint8Array(buffer);
    var encoding = 'utf-8';
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\ufeff/u, '');
    } catch (e) {
      throw new Error('Cannot read this file encoding. Save it as UTF-8 or UTF-16 with a Unicode byte-order mark; no text was imported.');
    }
  }
  SS.decodeSourceFile = decodeSourceFile;

  function init(ctx) {
    API = ctx.api;
    root = util.byId('search-body');
    if (!root) return;
    buildStatic();
    bindAppBarSearch();
    renderBuiltinSources();
    initReferenceStarter();
    bus.on('selection:changed', renderSources);
    bus.on('app:ready', renderSources);
    renderSources();
  }

  function initReferenceStarter() {
    var bench=util.byId('bench') || util.qs('main');
    if(!bench)return;
    var select=util.el('select',{'aria-label':'Layout 1 book'});
    [['Genesis','Bereishis · בראשית'],['Exodus','Shemos · שמות'],['Leviticus','Vayikra · ויקרא'],['Numbers','Bamidbar · במדבר'],['Deuteronomy','Devarim · דברים'],['all','Full Torah · כל התורה']].forEach(function(b){select.appendChild(util.el('option',{value:b[0],text:b[1]}));});
    var load=util.el('button',{class:'btn btn-primary',text:'Load Layout 1'});
    var panel=util.el('section',{class:'reference-start','aria-label':'Tikkun reference'},[
      util.el('strong',{text:'Start from the classic Tikkun'}),select,load,
      util.el('p',{text:'The Tikkun supplies the verified Torah text, פ/ס markers and special passages; it does not force its page breaks. Your saved Classic profile is the default measurement baseline. Loading it creates an editable reflow copy, so the saved Classic profile is not changed. The selected units per row — 62 initially — reflow complete words and determine the new number of amudim. Exact reference columns remain optional in Measurements. Review with your sofer before writing.'})
    ]);
    bench.parentNode.insertBefore(panel,bench);
    load.addEventListener('click',async function(){
      if(SS.calibration && SS.calibration.isDirty && SS.calibration.isDirty()){SS.toast('Save or discard your edited profile first.','error');return;}
      load.disabled=true;load.textContent='Loading reference…';
      try {
        var rules=SS.calibration&&SS.calibration.requestedRules&&SS.calibration.requestedRules();
        if(!state.active.profileId){
          var p=await API.createProfile({name:'Classic Sefer Torah — starter measurements',letter_height_units:2.5,letter_height_mm:4.5,unit_mm:.5,stroke_mm:0,min_nib_mm:0,
            ...(rules?{units_per_row:62,unit_basis:'line_units',layout_mode:'reflow',stretch_policy:rules,non_stretchable:SS.LETTERS.filter(function(ch){return !rules.caps_percent[ch];})}:{})});
          state.profiles=await API.listProfiles();state.active.profileId=p.id;
          if(SS.calibration.selectSaved)SS.calibration.selectSaved();bus.emit('profiles:list');bus.emit('profileId:changed');
        } else {
          // The saved Classic reference is the measurement source, not a
          // page-break lock.  Preserve it by cloning before switching modes.
          var active=await API.getProfile(state.active.profileId);
          if(active && (active.layout_mode!=='reflow' || active.unit_basis!=='line_units')){
            var copied=await API.duplicateProfile(active.id,{name:active.name+' — editable reflow draft'});
            var updated=await API.updateProfile(copied.id,Object.assign({},copied,{
              units_per_row:Number(active.units_per_row)||62,
              unit_basis:'line_units',
              layout_mode:'reflow',
              stretch_policy:rules||active.stretch_policy,
              non_stretchable:rules?SS.LETTERS.filter(function(ch){return !rules.caps_percent[ch];}):active.non_stretchable
            }));
            state.profiles=await API.listProfiles();state.active.profileId=updated.id;
            if(SS.calibration.selectSaved)SS.calibration.selectSaved();bus.emit('profiles:list');bus.emit('profileId:changed');
          }
        }
        var g=await API.createGeometry({name:'45 cm Torah',line_width_mm:125,lines_per_amud:42,baseline_pitch_mm:7.5,top_margin_mm:60,bottom_margin_mm:75,outer_margin_mm:30,inter_column_gap_mm:20,amudim_per_yeria:4,max_letters_per_line:0});
        state.geometries=await API.listGeometries();state.active.geometryId=g.id;bus.emit('geometryId:changed');
        await loadBuiltin('tikkun:'+select.value);
        await SS.app.compute();
      }catch(e){SS.toast(e.message||String(e),'error');}
      finally{load.disabled=false;load.textContent='Load Layout 1';}
    });
  }

  function buildStatic() {
    // Sources sub-section
    root.appendChild(util.el('div', { class: 'eyebrow', text: 'Sources' }));
    root.appendChild(util.el('div', { id: 'sources-list' }));

    // F-20: built-in study-text picker — honest labels, never certified.
    root.appendChild(util.el('div', { class: 'eyebrow', text: 'Built-in study text' }));
    root.appendChild(util.el('div', { id: 'builtin-list', class: 'builtin-list' }));

    var imp = util.el('div', { class: 'import-block' });
    var nameInput = util.el('input', { type: 'text', placeholder: 'Source name', 'data-i': 'name' });
    var tradInput = util.el('input', { type: 'text', placeholder: 'Tradition (optional)', 'data-i': 'tradition' });
    var fmtSel = util.el('select', { 'data-i': 'format' },
      [util.el('option', { value: 'txt', text: 'Text / STAM — detect English markers automatically' }),
       util.el('option', { value: 'stam', text: 'STAM keyboard text (capitals, p / s / l, m / e, + / -)' }),
       util.el('option', { value: 'json', text: 'JSON' }),
       util.el('option', { value: 'sefaria', text: 'Sefaria' })]);
    imp.appendChild(util.el('div', { class: 'import-row' }, [nameInput, tradInput]));
    imp.appendChild(fmtSel);

    var paste = util.el('textarea', { 'data-i': 'text', placeholder: 'Paste Hebrew or STAM text. Capitals mark holy letters (H = י, V = ה); p = pesucha, s = setuma, l = blank line.', rows: 4 });
    imp.appendChild(paste);

    var btnRow = util.el('div', { class: 'btn-row' });
    var fileInput = util.el('input', { type: 'file', accept: '.stam,.txt,.json,text/plain,application/json', hidden: true });
    var bFile = util.el('button', { class: 'btn btn-ghost btn-sm', text: 'Upload file' });
    var bPaste = util.el('button', { class: 'btn btn-primary btn-sm', text: 'Import pasted text' });
    bFile.addEventListener('click', function () { fileInput.click(); });
    bPaste.addEventListener('click', importPasted);
    fileInput.addEventListener('change', function () { importFile(fileInput); });
    btnRow.appendChild(bFile); btnRow.appendChild(bPaste); btnRow.appendChild(fileInput);
    imp.appendChild(btnRow);

    var aside = util.el('details', { class: 'import-hint' },
      [util.el('summary', { text: 'Import notes' }),
       util.el('p', { class: 't--2 faint', text: 'The original is preserved. Capitals use the Hebrew keyboard and mark only those letters as holy (שמות קודש), with a white strike. Lowercase p = pesucha, s = setuma, l = blank line, even attached to a word. Put + immediately before a letter for 1.5× width and height, or - for half size; both align at the top. For a song row, m makes a middle break and e ends the row: use one m for two sections or two for three. The program never decides holiness from a word’s spelling. Unsupported STAM characters are reported, not silently removed.' })]);
    imp.appendChild(aside);
    root.appendChild(imp);

    root.appendChild(util.el('div', { class: 'sirtut' }));

    // Search sub-section
    root.appendChild(util.el('div', { class: 'eyebrow', text: 'Verse search' }));
    var searchBox = util.el('div', { class: 'mm-input' },
      [util.el('input', { type: 'search', id: 'panel-search-input', placeholder: 'בראשית א:ד / Gen 1:4 / text' }),
       util.el('span', { class: 'unit' })]);
    root.appendChild(searchBox);
    var sbtn = util.el('button', { class: 'btn btn-primary btn-sm', style: 'margin-top:6px', text: 'Search' });
    sbtn.addEventListener('click', doSearchFromPanel);
    root.appendChild(sbtn);
    root.appendChild(util.el('div', { id: 'search-results' }));
  }

  function bindAppBarSearch() {
    var el = util.byId('search-input');
    if (!el) return;
    el.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { doSearch(el.value); }
    });
  }

  /* ------------------------------------------------------------------ *
   * Sources
   * ------------------------------------------------------------------ */
  function renderSources() {
    var list = util.byId('sources-list');
    if (!list) return;
    util.clear(list);
    if (!state.sources || !state.sources.length) {
      list.appendChild(util.el('div', { class: 'empty', text: 'No sources imported yet.' }));
      return;
    }
    state.sources.forEach(function (s) {
      var row = util.el('div', { class: 'source-row' });
      row.appendChild(util.el('div', { class: 'source-name', text: s.name || s.id }));
      var meta = [];
      if (s.tradition) meta.push(s.tradition);
      if (s.book_count != null) meta.push(s.book_count + ' books');
      if (s.verse_count != null) meta.push(s.verse_count + ' verses');
      if (s.letter_count != null) meta.push(s.letter_count.toLocaleString() + ' letters');
      row.appendChild(util.el('div', { class: 'mono t--2 faint', text: meta.join(' · ') }));
      if (s.revision_hash) row.appendChild(util.el('div', { class: 'mono t--2 faint', text: 'rev ' + String(s.revision_hash).slice(0, 8) }));
      if (s.excerpt) row.appendChild(util.el('span', { class: 'chip warn', text: 'excerpt (unverified)' }));
      else if (s.partial_corpus) row.appendChild(util.el('span', { class: 'chip warn', text: 'partial corpus' }));
      list.appendChild(row);
    });
  }

  // F-20: render the built-in study-text picker with counts + sha256 + honest label.
  async function renderBuiltinSources() {
    var list = util.byId('builtin-list');
    if (!list) return;
    util.clear(list);
    var items = [];
    try { items = (await API.listBuiltinSources()) || []; }
    catch (e) { list.appendChild(util.el('div', { class: 't--2 faint', text: 'Built-in sources unavailable.' })); return; }
    var note = util.el('div', { class: 'mono t--2 faint', text: 'Study text only — not a certified scribal corpus.' });
    list.appendChild(note);
    items.forEach(function (b) {
      var row = util.el('div', { class: 'builtin-row' });
      var label = util.el('span', { class: 'heb', lang: 'he', text: b.name || b.book });
      var meta = [];
      if (b.verse_count != null) meta.push(b.verse_count + ' verses');
      if (b.letter_count != null) meta.push(b.letter_count.toLocaleString() + ' letters');
      if (b.sha256) meta.push('sha256 ' + String(b.sha256).slice(0, 8));
      var metaEl = util.el('span', { class: 'mono t--2 faint', text: meta.join(' · ') });
      var load = util.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Load' });
      load.addEventListener('click', function () { loadBuiltin(b.book).catch(function(){}); });
      if (b.partial_corpus) metaEl.title = b.note || 'concatenated study text';
      row.appendChild(label); row.appendChild(metaEl); row.appendChild(load);
      list.appendChild(row);
    });
  }

  async function loadBuiltin(book) {
    try {
      var res = await API.importSource({ builtin: book });
      state.sources = await API.listSources();
      renderSources();
        state.active.sourceId = res.id;
        bus.emit('sourceId:changed');
      bus.emit('sources:updated');
      bus.emit('selection:changed');
      SS.toast('Loaded ' + book + ': ' + (res.letter_count != null ? res.letter_count.toLocaleString() + ' letters' : ''));
      } catch (e) { SS.toast(e.message || String(e), 'error'); throw e; }
  }

  async function importPasted() {
    var name = util.qs('[data-i="name"]', root).value.trim();
    var tradition = util.qs('[data-i="tradition"]', root).value.trim();
    var format = util.qs('[data-i="format"]', root).value;
    var text = util.qs('[data-i="text"]', root).value;
    if (!name) { SS.toast('Give the source a name.', 'error'); return; }
    if (!text.trim()) { SS.toast('Paste some text to import.', 'error'); return; }
    await doImport({ name: name, tradition: tradition || null, text: text, format: format });
  }

  async function importFile(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    var name = util.qs('[data-i="name"]', root).value.trim() || file.name;
    var format = util.qs('[data-i="format"]', root).value;
    try {
      var text = decodeSourceFile(await file.arrayBuffer());
      if (/\.stam(?:\.txt)?$/i.test(file.name)) format = 'stam';
      await doImport({ name: name, tradition: null, text: text, format: format });
    } catch (e) { SS.toast('Import failed: ' + (e.message || String(e)), 'error'); }
    finally { input.value = ''; }
  }

  async function doImport(body) {
    try {
      var res = await API.importSource(body);
      var warnings = res.warnings || [];
      state.sources = await API.listSources();
      renderSources();
      state.active.sourceId = res.id;
      bus.emit('sources:updated');
      bus.emit('selection:changed');
      var sections = res.section_breaks || {};
      SS.toast('Source imported: ' + res.letter_count + ' letters; ' + Number(sections.petucha || 0) + ' pesucha, ' + Number(sections.setuma || 0) + ' setuma' + (warnings.length ? ' (' + warnings.length + ' warnings)' : ''));
    } catch (e) { SS.toast(e.message || String(e), 'error'); }
  }

  /* ------------------------------------------------------------------ *
   * Search
   * ------------------------------------------------------------------ */
  function doSearchFromPanel() {
    doSearch(util.byId('panel-search-input').value);
  }

  async function doSearch(q) {
    var resultsEl = util.byId('search-results');
    if (!resultsEl) return;
    q = String(q || '').trim();
    if (!q) { util.clear(resultsEl); return; }
    var layoutId = state.active.layoutId;
    if (!layoutId) {
      util.clear(resultsEl);
      resultsEl.appendChild(util.el('div', { class: 'empty', text: 'Compute a layout first — search resolves verse → amud/line.' }));
      return;
    }
    try {
      var res = await API.searchLayout(layoutId, q);
      var results = (res && res.results) ? res.results : [];
      util.clear(resultsEl);
      if (!results.length) {
        resultsEl.appendChild(util.el('div', { class: 'empty', text: 'No verse matches — try chapter:verse like ג:יב.' }));
        return;
      }
      results.forEach(function (r) {
        var cardEl = util.el('div', { class: 'search-result' });
        var vtext = r.verse_ref || r.ref || r.verse || '';
        cardEl.appendChild(util.el('div', { class: 'vtext', lang: 'he', text: vtext }));
        var span = (r.line_start != null && r.line_end != null && r.line_start !== r.line_end);
        var pos = 'Amud ' + (r.amud != null ? r.amud : '?') + (span ? (' · lines ' + r.line_start + '\u2013' + r.line_end) : (r.line_start != null ? ' · line ' + r.line_start : ''));
        cardEl.appendChild(util.el('div', { class: 'vpos', text: pos }));
        var jump = util.el('button', { class: 'btn btn-ghost btn-sm', text: 'Jump' });
        jump.addEventListener('click', function () {
          bus.emit('jump:line', { amud: r.amud, line: r.line_start != null ? r.line_start : r.line });
        });
        cardEl.appendChild(jump);
        resultsEl.appendChild(cardEl);
      });
    } catch (e) {
      util.clear(resultsEl);
      resultsEl.appendChild(util.el('div', { class: 'empty', text: e.message || 'Search failed.' }));
    }
  }

  SS.search = { init: init, doSearch: doSearch };
})();
