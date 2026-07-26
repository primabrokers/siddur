/* Shared text loader for Tehillim and Mishnayos.
 *
 * Both readers want the same thing the siddur already does: try the Supabase
 * shared cache, fall back to Sefaria, keep a local copy so a text read once is
 * readable with no network. That logic lived inside siddur.html; this is it
 * extracted, so a second and third reader do not each reimplement it — and so
 * every text in the app benefits from the same offline guarantee.
 *
 * Mishnayos have a second source: this project's Supabase database already holds
 * the full text (sedarim, masechtos, perakim, mishnayos — 4,192 records), so
 * those are read from there rather than fetched per-perek from Sefaria.
 */
(function (global) {
  'use strict';

  const CFG = global.CONFIG;
  const mem = {};

  function restHeaders() {
    return { apikey: CFG.SUPABASE_KEY, Authorization: 'Bearer ' + CFG.SUPABASE_KEY };
  }

  /* Sefaria ref encoding: commas and underscores must survive, everything else
     is escaped. Matches what the siddur and the sync script already send. */
  function sefariaUrl(ref) {
    return CFG.SEFARIA_URL + '/texts/' +
      encodeURIComponent(ref).replace(/%2C/g, ',').replace(/%20/g, '_') +
      '?context=0&commentary=0&pad=0';
  }

  async function fromSharedCache(ref) {
    const url = CFG.SUPABASE_URL + '/rest/v1/luach_siddur_texts?ref=eq.' +
      encodeURIComponent(ref) + '&select=payload';
    const r = await fetch(url, { headers: restHeaders() });
    if (!r.ok) return null;
    const rows = await r.json();
    return (rows.length && rows[0].payload) || null;
  }

  /* he/text from Sefaria arrive as nested arrays of HTML. Flatten to plain
     paired segments; a missing translation yields an empty string rather than
     dropping the Hebrew alongside it. */
  function strip(html) {
    const d = document.createElement('div');
    d.innerHTML = String(html);
    return (d.textContent || '').trim();
  }

  function pairs(he, en, out) {
    if (Array.isArray(he)) {
      for (let i = 0; i < he.length; i++) pairs(he[i], Array.isArray(en) ? en[i] : undefined, out);
    } else if (he != null && String(he).trim()) {
      out.push({ he: strip(he), en: (en != null && !Array.isArray(en)) ? strip(en) : '' });
    }
    return out;
  }

  const Texts = {
    /* A Sefaria section, cached at three levels: memory, IndexedDB, and the
       shared Supabase table that every user benefits from. */
    async section(ref) {
      const key = 'txt:' + ref;
      if (mem[key]) return mem[key];

      const local = await Store.get(key);
      if (local) { mem[key] = local; return local; }

      let data = null;
      try { data = await fromSharedCache(ref); } catch (e) { /* offline: try Sefaria */ }
      if (!data) {
        const r = await fetch(sefariaUrl(ref));
        if (!r.ok) throw new Error('Sefaria HTTP ' + r.status);
        data = await r.json();
      }
      mem[key] = data;
      // Not awaited: a full cache must not stop the text being read.
      Store.set(key, data).catch(e => console.warn('Text cache write failed', e));
      return data;
    },

    segments(data) { return pairs(data.he, data.text, []); },

    attribution(data) {
      const bits = [];
      if (data.heVersionTitle) bits.push('Hebrew: ' + data.heVersionTitle +
        (data.heLicense ? ' (' + data.heLicense + ')' : ''));
      if (data.versionTitle) bits.push('English: ' + data.versionTitle +
        (data.license ? ' (' + data.license + ')' : ''));
      return (bits.length ? bits.join(' · ') + ' · ' : '') + 'via Sefaria';
    },

    /* ---- Mishnayos, from this project's own database ---- */

    async sedarim() {
      const key = 'mishna:sedarim';
      const cached = await Store.get(key);
      if (cached) return cached;
      const r = await fetch(CFG.SUPABASE_URL +
        '/rest/v1/sedarim?select=id,slug,name,hebrew_name,sort_order&order=sort_order', { headers: restHeaders() });
      if (!r.ok) throw new Error('sedarim HTTP ' + r.status);
      const rows = await r.json();
      await Store.set(key, rows).catch(() => {});
      return rows;
    },

    async masechtos(sederId) {
      const key = 'mishna:masechtos:' + sederId;
      const cached = await Store.get(key);
      if (cached) return cached;
      const r = await fetch(CFG.SUPABASE_URL +
        '/rest/v1/masechtos?seder_id=eq.' + encodeURIComponent(sederId) +
        '&select=id,name,hebrew_name,sefaria_title,chapter_count,mishnah_count&order=sort_order', { headers: restHeaders() });
      if (!r.ok) throw new Error('masechtos HTTP ' + r.status);
      const rows = await r.json();
      await Store.set(key, rows).catch(() => {});
      return rows;
    },

    async perakim(masechtaId) {
      const key = 'mishna:perakim:' + masechtaId;
      const cached = await Store.get(key);
      if (cached) return cached;
      const r = await fetch(CFG.SUPABASE_URL +
        '/rest/v1/perakim?masechta_id=eq.' + encodeURIComponent(masechtaId) +
        '&select=id,chapter_number,mishnah_count&order=chapter_number', { headers: restHeaders() });
      if (!r.ok) throw new Error('perakim HTTP ' + r.status);
      const rows = await r.json();
      await Store.set(key, rows).catch(() => {});
      return rows;
    },

    async mishnayos(perekId) {
      const key = 'mishna:text:' + perekId;
      const cached = await Store.get(key);
      if (cached) return cached;
      const r = await fetch(CFG.SUPABASE_URL +
        '/rest/v1/mishnayos?perek_id=eq.' + encodeURIComponent(perekId) +
        '&select=mishnah_number,hebrew_text,english_text,sefaria_ref&order=mishnah_number', { headers: restHeaders() });
      if (!r.ok) throw new Error('mishnayos HTTP ' + r.status);
      const rows = await r.json();
      await Store.set(key, rows).catch(() => {});
      return rows;
    }
  };

  global.Texts = Texts;
})(typeof window !== 'undefined' ? window : this);
