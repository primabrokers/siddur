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
  function sefariaUrl(ref, enVersion) {
    return CFG.SEFARIA_URL + '/texts/' +
      encodeURIComponent(ref).replace(/%2C/g, ',').replace(/%20/g, '_') +
      '?context=0&commentary=0&pad=0' +
      (enVersion ? '&ven=' + encodeURIComponent(enVersion).replace(/%20/g, '_') : '');
  }

  /* Older translations, asked for by name rather than taking whatever Sefaria
     serves by default. The default drifts — it is currently the 2006 JPS, which
     this app will not show — so pinning is the difference between a text that
     renders and one that is silently withheld.
     Tried in order; the first that comes back with text wins, and if none do the
     default is used and still runs through the block. Exact titles could not be
     checked against the live API from here, so the list is deliberately several
     spellings deep rather than one guess. */
  const PREFERRED_EN = [
    'The Holy Scriptures: A New Translation (JPS 1917)',
    'Tanakh: The Holy Scriptures, published by JPS, 1917',
    'The Holy Scriptures (JPS 1917)',
    'JPS 1917'
  ];

  function hasText(data) {
    const t = data && data.text;
    if (!t) return false;
    return Array.isArray(t) ? t.some(x => Array.isArray(x) ? x.length : String(x || '').trim())
                            : !!String(t).trim();
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
  /* Sefaria embeds footnotes inline: a <sup class="footnote-marker"> letter plus
     an <i class="footnote"> containing the note. Taking textContent of the lot
     splices the note into the posuk — "When God began to createaWhen God began
     to create In contrast to others..." — which is unreadable and, in a text
     people daven and learn from, unacceptable. Roughly one verse in six of the
     Torah carries one, so this is the common case rather than an edge. */
  function strip(html) {
    const d = document.createElement('div');
    d.innerHTML = String(html);
    d.querySelectorAll('.footnote-marker, .footnote, sup.footnote-marker, i.footnote')
      .forEach(n => n.remove());
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /* The notes themselves, kept rather than discarded — they are worth showing,
     just not spliced mid-posuk. */
  function footnotes(html) {
    const d = document.createElement('div');
    d.innerHTML = String(html);
    return Array.from(d.querySelectorAll('.footnote, i.footnote'))
      .map(n => (n.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  function pairs(he, en, out) {
    if (Array.isArray(he)) {
      for (let i = 0; i < he.length; i++) pairs(he[i], Array.isArray(en) ? en[i] : undefined, out);
    } else if (he != null && String(he).trim()) {
      out.push({ he: strip(he), en: (en != null && !Array.isArray(en)) ? strip(en) : '' });
    }
    return out;
  }


  /* Which English versions are safe to present to a traditional readership.
   *
   * This is a real constraint, not a preference: every English Torah translation
   * a chareidi reader would accept — ArtScroll/Stone, Metsudah, Judaica Press,
   * Kaplan's Living Torah — is under copyright and not on Sefaria. Everything
   * Sefaria can serve freely is academic or non-Orthodox in provenance, and the
   * recent JPS editions in particular render shemos and gendered language in ways
   * that are contested well outside chareidi circles.
   *
   * The app therefore does not pick a translation on the user's behalf. English is
   * off by default, Onkelos carries the meaning instead — it is the traditional
   * targum and the one shnayim mikra requires — and any English that is shown is
   * named, with a caution where the version is known to be non-traditional.
   */
  const VERSION_NOTES = [
    { match: /gender[- ]sensitive/i,
      note: 'JPS Gender-Sensitive Edition — renders shemos and gendered language non-traditionally.' },
    { match: /contemporary torah/i,
      note: 'JPS Contemporary Torah (2006) — gender-neutral rendering of shemos.' },
    { match: /^the schocken bible/i,
      note: 'Academic translation.' },
    { match: /jps.*(1985|new jps|njps)/i,
      note: 'New JPS (1985) — academic; follows critical scholarship in places.' },
    { match: /community translation/i,
      note: 'Crowd-sourced on Sefaria; not reviewed by a rabbinic authority.' },
    { match: /jps.*1917|holy scriptures/i,
      note: 'JPS 1917 — public domain and literal, though not produced under Orthodox auspices.' }
  ];

  /* Versions that must never render, whatever the user has toggled.
   *
   * Gender-neutral renderings of shemos are not a matter of taste for this
   * audience — they change how the Name is represented, so the app refuses them
   * outright rather than showing them with a caution. A blocked version means the
   * Hebrew stands alone and the reason is stated; it never means a silent gap.
   *
   * Matched on the version title Sefaria returns, because the API decides which
   * version to serve and can change that default without notice. Checking at
   * render time is the only point where the answer is known. */
  const BLOCKED = [
    /gender[- ]sensitive/i,
    /contemporary torah/i,          // JPS 2006: gender-neutral for shemos
    /revised edition.*gender/i,
    /inclusive/i
  ];

  const Versions = {
    /* Hard refusal. Distinct from note(): a note informs, this forbids. */
    blocked(versionTitle) {
      if (!versionTitle) return false;
      return BLOCKED.some(re => re.test(versionTitle));
    },

    /* Whether a fetched text's English may be shown at all, with the reason when
       it may not, so every caller refuses identically and says the same thing. */
    englishAllowed(data) {
      const v = (data && data.versionTitle) || '';
      if (Versions.blocked(v)) {
        return { ok: false, version: v,
                 reason: 'This translation uses gender-neutral language for shemos, ' +
                         'so Vecker does not show it. The Hebrew is unaffected.' };
      }
      return { ok: true, version: v };
    },

    /* A caution for this version, or null when nothing is known against it.
       Rosenbaum-Silbermann Rashi and Onkelos raise nothing: both are traditional
       and both are out of copyright. */
    note(versionTitle) {
      if (!versionTitle) return null;
      const hit = VERSION_NOTES.find(v => v.match.test(versionTitle));
      return hit ? hit.note : null;
    },

    /* True where a version is known to be contested for a traditional reader, as
       opposed to merely unfamiliar. Drives the warning styling. */
    contested(versionTitle) {
      return /gender[- ]sensitive|contemporary torah|schocken/i.test(versionTitle || '');
    }
  };

  const Texts = {
    /* A Sefaria section, cached at three levels: memory, IndexedDB, and the
       shared Supabase table that every user benefits from. */
    async section(ref, opts) {
      // Cache key carries the preference: a pinned version is a different text.
      const key = 'txt:' + ref + ((opts && opts.preferOlderEnglish) ? '|en1917' : '');
      if (mem[key]) return mem[key];

      const local = await Store.get(key);
      if (local) { mem[key] = local; return local; }

      let data = null;
      try { data = await fromSharedCache(ref); } catch (e) { /* offline: try Sefaria */ }

      if (!data && opts && opts.preferOlderEnglish) {
        for (const v of PREFERRED_EN) {
          try {
            const r = await fetch(sefariaUrl(ref, v));
            if (!r.ok) continue;
            const d = await r.json();
            if (hasText(d) && !Versions.blocked(d.versionTitle)) { data = d; break; }
          } catch (e) { /* try the next spelling */ }
        }
      }

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
        Texts.section(base, { preferOlderEnglish: true }),
        Texts.section('Onkelos ' + base).catch(() => null),
        Texts.section('Rashi on ' + base).catch(() => null)
      ]);
      const flat = x => Array.isArray(x) ? x : (x == null ? [] : [x]);
      const he = flat(torah.he), en = flat(torah.text);
      const onk = onkelos ? flat(onkelos.he) : [];
      // Rashi comes back as one array of comments per posuk.
      const rHe = rashi ? flat(rashi.he) : [], rEn = rashi ? flat(rashi.text) : [];

      // Refused at the source, so no caller can render it by accident.
      const allowed = Versions.englishAllowed(torah);
      const out = [];
      for (let i = 0; i < he.length; i++) {
        out.push({
          n: i + 1,
          he: strip(he[i]),
          en: allowed.ok ? strip(flat(en)[i] || '') : '',
          notes: allowed.ok ? footnotes(flat(en)[i] || '') : [],
          onkelos: strip(onk[i] || ''),
          rashi: (Array.isArray(rHe[i]) ? rHe[i] : flat(rHe[i])).map((c, j) => ({
            he: strip(c),
            en: strip((Array.isArray(rEn[i]) ? rEn[i] : flat(rEn[i]))[j] || '')
          })).filter(c => c.he)
        });
      }
      return {
        posukim: out,
        englishVersion: torah.versionTitle || '',
        englishBlocked: !allowed.ok,
        englishBlockedReason: allowed.reason || '',
        attribution: Texts.attribution(torah),
        hasOnkelos: onk.length > 0,
        hasRashi: rHe.length > 0
      };
    }
  };

  global.Texts = Texts;
  global.Versions = Versions;
})(typeof window !== 'undefined' ? window : this);
