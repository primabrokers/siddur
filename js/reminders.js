/* Reminders screen: minyanim, notification rules, and the omer count.
 *
 * Everything here was hard-coded sample data — three invented shuls, four fixed
 * rules, and an omer count frozen at 33 regardless of the date. This replaces it
 * with the user's own records via Sync (so they survive a reload and follow them
 * between devices) and an omer count computed from the calendar engine.
 *
 * Depends on the globals index.html already defines: gRD, rdToHeb, hebToRD,
 * dow, and Sync/Zmanim.
 */
(function (global) {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = t => { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; };

  const TEF = { shacharis: 'Shacharis', mincha: 'Mincha', maariv: 'Maariv' };

  /* ---- Sefiras haomer ----
     Day 1 is 16 Nissan, so the count is the number of days elapsed since 15
     Nissan. Sefira runs 49 days; outside that window there is nothing to show.
     The count belongs to the night, so after shkia it moves to the next day. */
  function omerForDate(date) {
    if (!global.rdToHeb || !global.hebToRD || !global.gRD) return null;
    const rd = global.gRD(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const [hy] = global.rdToHeb(rd);

    let effective = rd;
    // After shkia the halachic day has turned, so the evening's count is tomorrow's.
    const z = global.Zmanim && global.Zmanim.forDate(date);
    if (z && z.times && z.times.sunset && date >= z.times.sunset) effective = rd + 1;

    const firstDay = global.hebToRD(hy, 1, 16);          // 16 Nissan = day 1
    const n = effective - firstDay + 1;
    if (n < 1 || n > 49) return null;

    const weeks = Math.floor(n / 7), days = n % 7;
    let parts = [];
    if (weeks) parts.push(weeks === 1 ? 'one week' : weeks + ' weeks');
    if (days) parts.push(days === 1 ? 'one day' : days + ' days');
    return { n, text: n < 7 ? (n === 1 ? 'one day' : n + ' days') : parts.join(' and ') };
  }

  function renderOmer() {
    const card = $('omer-card'), body = $('omer-body');
    if (!card || !body) return;
    const o = omerForDate(new Date());
    if (!o) {
      // Hidden rather than shown empty: a count of nothing is not information.
      card.classList.add('hide');
      return;
    }
    card.classList.remove('hide');
    body.innerHTML =
      '<div class="omer-n">' + o.n + '</div>' +
      '<div class="omer-s">' + esc('Day ' + o.n + ' · ' + o.text + ' of the omer') + '</div>';
  }

  /* ---- Minyanim ---- */
  async function renderMinyanim() {
    const list = $('minyan-list');
    if (!list) return;
    const rows = await Sync.minyanim.list();
    if (!rows.length) {
      list.innerHTML = '<div class="footnote" style="text-align:left;">No minyanim yet. Add the ones you daven at and Vecker will remind you before each.</div>';
      return;
    }
    list.innerHTML = '';
    rows.sort((a, b) => String(a.minyan_time).localeCompare(String(b.minyan_time)));
    rows.forEach(r => {
      const el = document.createElement('div');
      el.className = 'rem';
      el.innerHTML = '<div><div class="rn"></div><div class="rd"></div></div>' +
                     '<button class="toggle" aria-label="Toggle reminder"></button>';
      el.querySelector('.rn').textContent = TEF[r.tefillah] || r.tefillah;
      el.querySelector('.rd').textContent =
        [r.shul_name, fmtTime(r.minyan_time), 'remind ' + r.remind_minutes_before + ' min before']
          .filter(Boolean).join(' · ');
      const t = el.querySelector('.toggle');
      if (r.enabled) t.classList.add('on');
      t.addEventListener('click', async () => {
        t.classList.toggle('on');
        await Sync.minyanim.update(r.id, { enabled: t.classList.contains('on') });
        scheduleAll();
      });
      // Long-press to delete: there is no room for a row of buttons, and a
      // stray tap must not remove a minyan.
      let timer = null;
      el.addEventListener('pointerdown', () => {
        timer = setTimeout(async () => {
          if (confirm('Remove ' + (TEF[r.tefillah] || r.tefillah) + ' at ' + r.shul_name + '?')) {
            await Sync.minyanim.remove(r.id); renderMinyanim(); scheduleAll();
          }
        }, 600);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(e =>
        el.addEventListener(e, () => clearTimeout(timer)));
      list.appendChild(el);
    });
  }

  function fmtTime(hhmm) {
    if (!hhmm) return '';
    const [h, m] = String(hhmm).split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + ' ' + ap;
  }

  /* ---- Notification rules ---- */
  const ANCHOR_LABEL = {
    candle_lighting: 'candle lighting', shkia: 'shkia', tzeis: 'tzeis', alos: 'alos',
    netz: 'netz', chatzos: 'chatzos', plag: 'plag hamincha',
    sof_zman_shema: 'sof zman shema', havdalah: 'havdalah', fixed: 'a fixed time'
  };
  const DAY_LABEL = {
    daily: 'every day', weekdays: 'weekdays', erev_shabbos_yomtov: 'every erev Shabbos & Yom Tov',
    fast_days: 'every fast day', rosh_chodesh: 'Rosh Chodesh', motzei_shabbos: 'Motzei Shabbos'
  };

  function ruleText(r) {
    const off = r.offset_minutes === 0 ? 'At' :
      (r.offset_minutes < 0 ? Math.abs(r.offset_minutes) + ' min before' : r.offset_minutes + ' min after');
    return off + ' ' + (ANCHOR_LABEL[r.anchor] || r.anchor) + ' · ' + (DAY_LABEL[r.day_filter] || r.day_filter);
  }

  async function renderRules() {
    const list = $('rule-list');
    if (!list) return;
    const rows = await Sync.rules.list();
    if (!rows.length) {
      list.innerHTML = '<div class="footnote" style="text-align:left;">No rules yet. Build one below — any zman, any offset, any days.</div>';
      return;
    }
    list.innerHTML = '';
    rows.forEach(r => {
      const el = document.createElement('div');
      el.className = 'rem';
      el.innerHTML = '<div><div class="rn"></div><div class="rd"></div></div>' +
                     '<button class="toggle" aria-label="Toggle rule"></button>';
      el.querySelector('.rn').textContent = r.message;
      el.querySelector('.rd').textContent = ruleText(r);
      const t = el.querySelector('.toggle');
      if (r.enabled) t.classList.add('on');
      t.addEventListener('click', async () => {
        t.classList.toggle('on');
        await Sync.rules.update(r.id, { enabled: t.classList.contains('on') });
        scheduleAll();
      });
      let timer = null;
      el.addEventListener('pointerdown', () => {
        timer = setTimeout(async () => {
          if (confirm('Remove "' + r.message + '"?')) { await Sync.rules.remove(r.id); renderRules(); scheduleAll(); }
        }, 600);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(e =>
        el.addEventListener(e, () => clearTimeout(timer)));
      list.appendChild(el);
    });
  }

  /* First run gets the rules almost everyone wants, as real editable records
     rather than the fixed decoration that used to sit here. */
  const DEFAULT_RULES = [
    { anchor: 'candle_lighting', offset_minutes: -60, message: 'Shabbos in one hour', day_filter: 'erev_shabbos_yomtov' },
    { anchor: 'shkia', offset_minutes: -30, message: 'Daven Mincha', day_filter: 'daily' },
    { anchor: 'tzeis', offset_minutes: 5, message: 'Maariv', day_filter: 'daily' },
    { anchor: 'alos', offset_minutes: 0, message: 'Fast begins', day_filter: 'fast_days' }
  ];

  async function seedDefaults() {
    const seeded = await Store.get('seed:rules');
    if (seeded) return;
    if ((await Sync.rules.list()).length === 0) {
      for (const r of DEFAULT_RULES) await Sync.rules.add(r);
    }
    await Store.set('seed:rules', true);
  }

  function scheduleAll() {
    if (global.Notify && global.Notify.reschedule) global.Notify.reschedule();
  }

  async function refresh() {
    renderOmer();
    await renderMinyanim();
    await renderRules();
  }

  function wire() {
    const add = $('mn-add');
    if (add) add.addEventListener('click', async () => {
      const shul = $('mn-shul').value.trim(), time = $('mn-time').value;
      if (!shul || !time) { alert('A shul name and a time are both needed.'); return; }
      await Sync.minyanim.add({
        shul_name: shul, tefillah: $('mn-tef').value,
        minyan_time: time, remind_minutes_before: Number($('mn-before').value), enabled: true
      });
      $('mn-shul').value = ''; $('mn-time').value = '';
      await renderMinyanim(); scheduleAll();
    });

    const rbAdd = $('rb-add');
    if (rbAdd) rbAdd.addEventListener('click', async () => {
      const msg = $('rb-msg').value.trim();
      if (!msg) { alert('Give the reminder some text.'); return; }
      const offTxt = $('rb-off').value, anchorTxt = $('rb-anchor').value;
      const m = offTxt.match(/(\d+)/);
      let off = m ? Number(m[1]) : 0;
      if (/before/.test(offTxt)) off = -off;
      const anchor = Object.keys(ANCHOR_LABEL).find(k => ANCHOR_LABEL[k] === anchorTxt) || 'shkia';
      await Sync.rules.add({ anchor, offset_minutes: off, message: msg, day_filter: 'daily', enabled: true });
      $('rb-msg').value = '';
      await renderRules(); scheduleAll();
    });
  }

  global.Reminders = { refresh, omerForDate };

  document.addEventListener('DOMContentLoaded', () => {
    wire();
    seedDefaults().then(refresh).catch(err => console.warn('Reminders:', err));
  });
})(typeof window !== 'undefined' ? window : this);
