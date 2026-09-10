/* Luach — zmanim
   Primary source: Hebcal's free REST API (no key required).
     zmanim:  https://www.hebcal.com/zmanim?cfg=json&latitude=..&longitude=..&tzid=..&start=..&end=..
     shabbos: https://www.hebcal.com/shabbat?cfg=json&latitude=..&longitude=..&tzid=..&M=on

   Because Shabbos alarms and notification rules are anchored to these times, the app
   never fetches on demand at daven time. It prefetches a range (default 45 days),
   caches it, and falls back to a local NOAA solar calculation if it has never been
   online. Cached and computed values are labelled differently in the UI so the user
   always knows which they're looking at.

   Attribution: zmanim data by Hebcal (hebcal.com). */

(function () {
  'use strict';

  const HEBCAL = 'https://www.hebcal.com';
  const CACHE_KEY = 'luach.zmanim.v1';
  const LOC_KEY = 'luach.location.v1';
  const PREFETCH_DAYS = 45;

  const DEFAULT_LOC = { lat: 40.6501, lng: -73.9496, tz: 'America/New_York', city: 'Brooklyn, NY' };

  /* Which Hebcal keys we surface, in davening order. `label` is the full name for
     lists and notifications; `short` fits a tile on one line, so a grid of them
     keeps an even baseline instead of some cells wrapping to two rows. */
  const ROWS = [
    { key: 'alotHaShachar',   label: 'Alos hashachar',              short: 'Alos' },
    { key: 'misheyakir',      label: 'Misheyakir',                  short: 'Misheyakir' },
    { key: 'sunrise',         label: 'Netz hachama',                short: 'Netz' },
    { key: 'sofZmanShmaMGA',  label: 'Sof zman krias shema (M"A)',  short: 'Shema M"A' },
    { key: 'sofZmanShma',     label: 'Sof zman krias shema (GRA)',  short: 'Shema GRA' },
    { key: 'sofZmanTfilla',   label: 'Sof zman tefilla',            short: 'Tefilla' },
    { key: 'chatzot',         label: 'Chatzos',                     short: 'Chatzos' },
    { key: 'minchaGedola',    label: 'Mincha gedola',               short: 'Mincha gedola' },
    { key: 'minchaKetana',    label: 'Mincha ketana',               short: 'Mincha ketana' },
    { key: 'plagHaMincha',    label: 'Plag hamincha',               short: 'Plag' },
    { key: 'sunset',          label: 'Shkia',                       short: 'Shkia' },
    { key: 'tzeit42min',      label: 'Tzeis hakochavim',            short: 'Tzeis' },
    { key: 'tzeit72min',      label: 'Tzeis (Rabbeinu Tam)',        short: 'Tzeis R"T' }
  ];

  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch (e) { return {}; } }
  function writeCache(c) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e) {} }

  const Z = window.Zmanim = {
    rows: ROWS,
    source: 'unknown',   // 'hebcal' | 'cache' | 'computed'
    location: null,

    /* ---- location ---- */
    getLocation() {
      if (Z.location) return Z.location;
      try { Z.location = JSON.parse(localStorage.getItem(LOC_KEY)); } catch (e) {}
      if (!Z.location) Z.location = DEFAULT_LOC;
      return Z.location;
    },
    setLocation(loc) {
      Z.location = Object.assign({}, Z.getLocation(), loc);
      if (!Z.location.tz) {
        try { Z.location.tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { Z.location.tz = 'UTC'; }
      }
      try { localStorage.setItem(LOC_KEY, JSON.stringify(Z.location)); } catch (e) {}
      writeCache({});            // times are location-specific
      return Z.location;
    },
    async detectLocation() {
      if (!window.Luach) return Z.getLocation();
      try {
        const p = await window.Luach.getLocation();
        let tz = 'UTC';
        try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
        return Z.setLocation({ lat: p.lat, lng: p.lng, tz, city: null });
      } catch (e) { return Z.getLocation(); }
    },

    /* ---- fetching ---- */
    async prefetch(days) {
      const loc = Z.getLocation();
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = addDays(start, days || PREFETCH_DAYS);
      const url = `${HEBCAL}/zmanim?cfg=json&latitude=${loc.lat}&longitude=${loc.lng}` +
                  `&tzid=${encodeURIComponent(loc.tz)}&start=${iso(start)}&end=${iso(end)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('Hebcal zmanim HTTP ' + res.status);
      const data = await res.json();
      const cache = readCache();
      // Range responses key each zman by date: times.sunrise = { "2026-07-26": "...", ... }
      const t = data.times || {};
      Object.keys(t).forEach(zman => {
        const v = t[zman];
        if (v && typeof v === 'object') {
          Object.keys(v).forEach(day => {
            cache[day] = cache[day] || {};
            cache[day][zman] = v[day];
          });
        } else if (typeof v === 'string') {           // single-date shape
          const day = data.date || iso(start);
          cache[day] = cache[day] || {};
          cache[day][zman] = v;
        }
      });
      cache._meta = { fetched: new Date().toISOString(), loc: { lat: loc.lat, lng: loc.lng }, source: 'hebcal' };
      writeCache(cache);
      Z.source = 'hebcal';
      return cache;
    },

    /* Candle lighting, havdalah, and the parsha — Hebcal's shabbat endpoint. */
    async shabbos() {
      const loc = Z.getLocation();
      const url = `${HEBCAL}/shabbat?cfg=json&latitude=${loc.lat}&longitude=${loc.lng}` +
                  `&tzid=${encodeURIComponent(loc.tz)}&M=on&lg=s`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('Hebcal shabbat HTTP ' + res.status);
      const data = await res.json();
      const out = { candles: null, havdalah: null, parsha: null, holidays: [] };
      (data.items || []).forEach(i => {
        if (i.category === 'candles' && !out.candles) out.candles = i.date;
        else if (i.category === 'havdalah' && !out.havdalah) out.havdalah = i.date;
        else if (i.category === 'parashat' && !out.parsha) out.parsha = i.hebrew || i.title;
        else if (i.category === 'holiday') out.holidays.push(i.title);
      });
      try { localStorage.setItem('luach.shabbos.v1', JSON.stringify(Object.assign({ _fetched: Date.now() }, out))); } catch (e) {}
      return out;
    },
    cachedShabbos() {
      try { return JSON.parse(localStorage.getItem('luach.shabbos.v1')); } catch (e) { return null; }
    },

    /* ---- reading a day ---- */
    /* Returns { times: {key: Date}, source } — cache first, then a local computation. */
    forDate(date) {
      const day = iso(date || new Date());
      const cache = readCache();
      if (cache[day]) {
        const times = {};
        Object.keys(cache[day]).forEach(k => { const d = new Date(cache[day][k]); if (!isNaN(d)) times[k] = d; });
        if (Object.keys(times).length) return { times, source: 'cache' };
      }
      return { times: Z.compute(date || new Date()), source: 'computed' };
    },

    /* ---- offline fallback: NOAA solar position + halachic hours ----
       Used only when Hebcal has never been reached for this date. Fixed-minute
       shitos (alos/tzeis 72, tzeis 42) match the defaults the app ships with. */
    compute(date) {
      const loc = Z.getLocation();
      const rad = Math.PI / 180;
      const start = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0));
      const jd = start.getTime() / 86400000 + 2440587.5;   // noon-anchored: JD days begin at noon
      const n = jd - 2451545.0 + 0.0008;
      const Jstar = n - loc.lng / 360;
      const M = (357.5291 + 0.98560028 * Jstar) % 360;
      const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
      const lam = (M + C + 180 + 102.9372) % 360;
      const Jtransit = 2451545.0 + Jstar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lam * rad);
      const decl = Math.asin(Math.sin(lam * rad) * Math.sin(23.44 * rad));

      // hour angle for a given solar altitude (degrees, negative below horizon)
      function ha(alt) {
        const cosH = (Math.sin(alt * rad) - Math.sin(loc.lat * rad) * Math.sin(decl)) /
                     (Math.cos(loc.lat * rad) * Math.cos(decl));
        if (cosH > 1 || cosH < -1) return null;      // sun never reaches this altitude
        return Math.acos(cosH) / rad;
      }
      const jdToDate = j => new Date((j - 2440587.5) * 86400000);
      function at(alt, rising) {
        const H = ha(alt); if (H == null) return null;
        return jdToDate(Jtransit + (rising ? -H : H) / 360);
      }

      const sunrise = at(-0.833, true), sunset = at(-0.833, false);
      if (!sunrise || !sunset) return {};
      const chatzot = jdToDate(Jtransit);
      const shaa = (sunset - sunrise) / 12;                       // sha'ah zmanis (GRA)
      const mAlos = new Date(sunrise.getTime() - 72 * 60000);     // 72 fixed minutes
      const mTzeis = new Date(sunset.getTime() + 72 * 60000);
      const shaaMGA = (mTzeis - mAlos) / 12;

      const t = {
        alotHaShachar: mAlos,
        misheyakir: new Date(sunrise.getTime() - 39 * 60000),
        sunrise,
        sofZmanShmaMGA: new Date(mAlos.getTime() + 3 * shaaMGA),
        sofZmanShma: new Date(sunrise.getTime() + 3 * shaa),
        sofZmanTfilla: new Date(sunrise.getTime() + 4 * shaa),
        chatzot,
        minchaGedola: new Date(sunrise.getTime() + 6.5 * shaa),
        minchaKetana: new Date(sunrise.getTime() + 9.5 * shaa),
        plagHaMincha: new Date(sunrise.getTime() + 10.75 * shaa),
        sunset,
        tzeit42min: new Date(sunset.getTime() + 42 * 60000),
        tzeit72min: mTzeis
      };
      Z.source = 'computed';
      return t;
    },

    /* ---- helpers ---- */
    fmt(d) {
      if (!d) return '—';
      const loc = Z.getLocation();
      try {
        return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: loc.tz }).format(d);
      } catch (e) {
        return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(d);
      }
    },
    /* Next upcoming zman today, for the "shkia in 2h 14m" line and rule anchoring. */
    next(times, now) {
      now = now || new Date();
      let best = null;
      ROWS.forEach(r => {
        const d = times[r.key];
        if (d && d > now && (!best || d < best.at)) best = { key: r.key, label: r.label, at: d };
      });
      return best;
    },
    until(d, now) {
      const ms = d - (now || new Date());
      if (ms <= 0) return null;
      const h = Math.floor(ms / 3600000), m = Math.round((ms % 3600000) / 60000);
      return (h ? h + 'h ' : '') + m + 'm';
    },

    /* Called once on load: use cache immediately, refresh in the background. */
    async init() {
      const cache = readCache();
      const meta = cache._meta;
      const stale = !meta || (Date.now() - new Date(meta.fetched).getTime()) > 7 * 86400000;
      if (stale) { try { await Z.prefetch(); } catch (e) { /* offline — cache or compute */ } }
      try { await Z.shabbos(); } catch (e) { /* fall back to cachedShabbos() */ }
      return Z.forDate(new Date());
    }
  };
})();
