/* Turns the user's rules, minyanim and alarms into scheduled notifications.
 *
 * This is the piece that was missing: reminders.js already called
 * Notify.reschedule(), platform.js already knew how to hand items to the OS,
 * and nothing joined them — so nothing ever fired.
 *
 * Everything is computed and queued ahead of time. That is not an optimisation:
 * on Shabbos and Yom Tov the app must not be touched, so every alarm for the
 * whole block has to be in the OS queue before candle lighting. Web timers
 * cannot do this — they die with the tab — which is why the native wrapper
 * exists and why the web build says so rather than pretending.
 */
(function (global) {
  'use strict';

  // iOS caps pending local notifications at 64. Stay well under it: schedule a
  // horizon rather than everything, and re-queue as the window advances.
  const MAX_PENDING = 56;
  const HORIZON_DAYS = 8;

  /* Rule anchors map onto the zmanim keys Hebcal returns. 'fixed' has no anchor
     and uses the rule's own time. */
  const ANCHOR_KEY = {
    alos: 'alotHaShachar', netz: 'sunrise', sof_zman_shema: 'sofZmanShma',
    chatzos: 'chatzot', plag: 'plagHaMincha', shkia: 'sunset', tzeis: 'tzeit42min'
  };

  const dayStart = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  /* Stable small integer id per item. The OS replaces a notification with the
     same id, so re-scheduling updates rather than duplicating. */
  function idFor(kind, key, dayOffset) {
    let h = 0;
    const s = kind + ':' + key;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
    return (h % 100000) * 10 + (dayOffset % 10);
  }

  function isShabbosOrYomTov(date) {
    // Friday night through Motzei Shabbos, plus anything the calendar engine
    // marks as Yom Tov. Falls back to day-of-week alone if the engine is absent.
    const dw = date.getDay();
    if (dw === 6) return true;
    if (!global.eventsForRD || !global.gRD) return false;
    try {
      const rd = global.gRD(date.getFullYear(), date.getMonth() + 1, date.getDate());
      return global.eventsForRD(rd).some(e => e.type === 'yt');
    } catch (e) { return false; }
  }

  function dayMatches(filter, date) {
    const dw = date.getDay();
    switch (filter) {
      case 'daily': return true;
      case 'weekdays': return dw >= 0 && dw <= 4;         // Sun–Thu
      case 'erev_shabbos_yomtov': return dw === 5 || isErevYomTov(date);
      case 'motzei_shabbos': return dw === 6;
      case 'fast_days': return hasEvent(date, 'fast');
      case 'rosh_chodesh': return hasEvent(date, 'rc');
      default: return true;
    }
  }

  function hasEvent(date, type) {
    if (!global.eventsForRD || !global.gRD) return false;
    try {
      const rd = global.gRD(date.getFullYear(), date.getMonth() + 1, date.getDate());
      return global.eventsForRD(rd).some(e => e.type === type);
    } catch (e) { return false; }
  }

  function isErevYomTov(date) {
    return hasEvent(addDays(date, 1), 'yt');
  }

  /* Candle lighting and havdalah come from the Hebcal Shabbos payload, which is
     fetched weekly and cached — never requested on Shabbos itself. */
  function shabbosTimes() {
    const sh = global.Zmanim && Zmanim.cachedShabbos();
    if (!sh) return {};
    return {
      candles: sh.candles ? new Date(sh.candles) : null,
      havdalah: sh.havdalah ? new Date(sh.havdalah) : null
    };
  }

  function zmanFor(date, anchor) {
    if (anchor === 'candle_lighting') return shabbosTimes().candles;
    if (anchor === 'havdalah') return shabbosTimes().havdalah;
    const key = ANCHOR_KEY[anchor];
    if (!key || !global.Zmanim) return null;
    const r = Zmanim.forDate(date);
    return (r && r.times && r.times[key]) || null;
  }

  function atTimeOfDay(date, hhmm) {
    const [h, m] = String(hhmm || '').split(':').map(Number);
    if (isNaN(h)) return null;
    const x = dayStart(date); x.setHours(h, m || 0, 0, 0);
    return x;
  }

  async function buildQueue() {
    const now = new Date();
    const [rules, minyanim, alarms] = await Promise.all([
      Sync.rules.list(), Sync.minyanim.list(), Sync.alarms.list()
    ]);
    const out = [];

    for (let d = 0; d < HORIZON_DAYS; d++) {
      const day = addDays(dayStart(now), d);

      // --- zman-anchored rules ---
      for (const r of rules) {
        if (!r.enabled) continue;
        if (!dayMatches(r.day_filter, day)) continue;
        let at = r.anchor === 'fixed' ? atTimeOfDay(day, r.fixed_time) : zmanFor(day, r.anchor);
        if (!at) continue;
        at = new Date(at.getTime() + (r.offset_minutes || 0) * 60000);
        if (at <= now) continue;
        out.push({
          id: idFor('rule', r.id, d), at: at.toISOString(),
          title: r.message, body: '', kind: 'reminder', ringSeconds: 20
        });
      }

      // --- minyanim ---
      for (const m of minyanim) {
        if (!m.enabled) continue;
        // A minyan reminder on Shabbos would invite a tap; the Shabbos block
        // uses pre-set alarms instead, per the app's own rule.
        if (isShabbosOrYomTov(day)) continue;
        const t = atTimeOfDay(day, m.minyan_time);
        if (!t) continue;
        const at = new Date(t.getTime() - (m.remind_minutes_before || 15) * 60000);
        if (at <= now) continue;
        out.push({
          id: idFor('minyan', m.id, d), at: at.toISOString(),
          title: titleCase(m.tefillah) + ' in ' + (m.remind_minutes_before || 15) + ' min',
          body: m.shul_name || '', kind: 'reminder', ringSeconds: 20
        });
      }

      // --- alarms ---
      for (const a of alarms) {
        if (!a.enabled) continue;
        const shab = isShabbosOrYomTov(day);
        if (a.scope === 'weekday' && shab) continue;
        if (a.scope === 'every_shabbos' && !shab) continue;
        const at = atTimeOfDay(day, a.time_of_day);
        if (!at || at <= now) continue;
        out.push({
          id: idFor('alarm', a.id, d), at: at.toISOString(),
          title: a.label || 'Alarm', body: '', kind: 'alarm',
          // Alarms stop themselves: nothing on Shabbos may wait for a tap.
          ringSeconds: a.ring_seconds || 60, ongoing: true, sound: (a.sound || 'chime') + '.wav'
        });
      }
    }

    out.sort((a, b) => new Date(a.at) - new Date(b.at));
    // Soonest first, so a truncated queue loses the furthest-off items.
    return out.slice(0, MAX_PENDING);
  }

  function titleCase(s) {
    return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
  }

  let pending = null;

  const Notify = {
    /* Recompute and re-queue. Called whenever the user changes a rule, minyan,
       alarm or location, and on load. Coalesced: a burst of edits produces one
       reschedule rather than one per keystroke. */
    reschedule() {
      clearTimeout(pending);
      pending = setTimeout(() => Notify.now().catch(err =>
        console.warn('Notification scheduling deferred:', err.message)), 400);
    },

    async now() {
      if (!global.Luach || !global.Sync) return { scheduled: 0 };
      const items = await buildQueue();
      if (!items.length) return { scheduled: 0 };
      const n = await Luach.scheduleAll(items);
      await Store.set('notify:last', { at: new Date().toISOString(), count: items.length })
        .catch(() => {});
      return { scheduled: n, queued: items.length, next: items[0] };
    },

    /* What is queued, for the settings screen to show. Reading this is how a
       user confirms the thing actually works before relying on it for Shabbos. */
    async preview(limit) {
      const items = await buildQueue();
      return items.slice(0, limit || 5);
    },

    async permission() {
      if (!global.Luach || !Luach.requestNotificationPermission) return 'unsupported';
      return Luach.requestNotificationPermission();
    }
  };

  global.Notify = Notify;

  document.addEventListener('DOMContentLoaded', () => {
    // Wait for zmanim to settle: a queue built before times are known would be
    // mostly empty and would need rebuilding anyway.
    setTimeout(() => Notify.reschedule(), 1500);
  });
})(typeof window !== 'undefined' ? window : this);
