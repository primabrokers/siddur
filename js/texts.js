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
    },

    /* Sefaria's calendar feed: this week's parsha with its exact ref, plus Daf
       Yomi and friends. Using it avoids hand-writing 54 parsha ranges, which is
       the kind of table that is wrong in one place and nobody notices for a year.
       Cached per day — the answer only changes at midnight. */
    async calendars() {
      const key = 'cal:' + new Date().toISOString().slice(0, 10);
      const cached = await Store.get(key);
      if (cached) return cached;
      const r = await fetch(CFG.SEFARIA_URL + '/calendars');
      if (!r.ok) throw new Error('calendars HTTP ' + r.status);
      const data = await r.json();
      await Store.set(key, data).catch(() => {});
      return data;
    },

    /* The parsha as {name, hebrewName, ref, book, startChapter, endChapter}.
       Returns null rather than guessing when the feed is unavailable. */
    async parsha() {
      let data;
      try { data = await Texts.calendars(); } catch (e) { return null; }
      const item = (data.calendar_items || []).find(i =>
        i.title && /Parashat Hashavua|Parashat/i.test(i.title.en || ''));
      if (!item || !item.ref) return null;
      // ref looks like "Deuteronomy 3:23-7:11"
      const m = String(item.ref).match(/^(.+?)\s+(\d+):\d+-(?:(\d+):)?\d+$/);
      if (!m) return { name: (item.displayValue || {}).en || '', ref: item.ref };
      return {
        name: (item.displayValue || {}).en || '',
        hebrewName: (item.displayValue || {}).he || '',
        ref: item.ref,
        book: m[1],
        startChapter: Number(m[2]),
        endChapter: Number(m[3] || m[2])
      };
    },

    /* Chumash with its meforshim. Three refs fetched together, because a posuk
       without its Onkelos is not shnayim mikra. Each is cached separately, so a
       second visit to the same perek needs no network at all. */
    async chumashPerek(book, chapter) {
      const base = book + ' ' + chapter;
      const [torah, onkelos, rashi] = await Promise.all([
        Texts.section(base),
        Texts.section('Onkelos ' + base).catch(() => null),
        Texts.section('Rashi on ' + base).catch(() => null)
      ]);
      const flat = x => Array.isArray(x) ? x : (x == null ? [] : [x]);
      const he = flat(torah.he), en = flat(torah.text);
      const onk = onkelos ? flat(onkelos.he) : [];
      // Rashi comes back as one array of comments per posuk.
      const rHe = rashi ? flat(rashi.he) : [], rEn = rashi ? flat(rashi.text) : [];

      const out = [];
      for (let i = 0; i < he.length; i++) {
        out.push({
          n: i + 1,
          he: strip(he[i]),
          en: strip(flat(en)[i] || ''),
          onkelos: strip(onk[i] || ''),
          rashi: (Array.isArray(rHe[i]) ? rHe[i] : flat(rHe[i])).map((c, j) => ({
            he: strip(c),
            en: strip((Array.isArray(rEn[i]) ? rEn[i] : flat(rEn[i]))[j] || '')
          })).filter(c => c.he)
        });
      }
      return {
        posukim: out,
        attribution: Texts.attribution(torah),
        hasOnkelos: onk.length > 0,
        hasRashi: rHe.length > 0
      };
    }
  };

  global.Texts = Texts;
})(typeof window !== 'undefined' ? window : this);
