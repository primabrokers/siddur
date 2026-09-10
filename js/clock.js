/* Clock tab: real alarms.
 *
 * This screen was entirely invented — hard-coded times, a hard-coded "Rosh
 * Hashana 5787" block, and day chips wired to classList.toggle. The luach_alarms
 * table and the scheduling engine were both already there; only the UI was
 * missing. Alarms here persist through Sync and are queued by Notify.
 *
 * The Shabbos rules are the reason this screen is not just a list:
 *   - Nothing may be set or dismissed during the block, so the whole block is
 *     queued before candle lighting.
 *   - Alarms stop themselves after ring_seconds. No snooze, no dismiss button.
 *   - An alarm is scoped: weekdays only, every Shabbos, or per-day within a
 *     Yom Tov block, because Day 1 falling on Shabbos and Day 2 on Sunday want
 *     different times.
 */
(function (global) {
  'use strict';

  const $ = id => document.getElementById(id);
  const DUR = [30, 60, 90, 120, 300];
  const DUR_LABEL = { 30: '30s', 60: '60s', 90: '90s', 120: '2 min', 300: '5 min' };
  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbos'];

  function fmt(hhmm) {
    const [h, m] = String(hhmm || '').split(':').map(Number);
    if (isNaN(h)) return '—';
    return ((h % 12) || 12) + ':' + String(m || 0).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM');
  }

  /* The next Shabbos / Yom Tov block: the upcoming Friday, plus any adjacent
     Yom Tov days either side, so a three-day block is presented as one. */
  function nextBlock() {
    if (!global.gRD || !global.eventsForRD) return null;
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);

    for (let i = 0; i < 21; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const isShabbos = d.getDay() === 6;
      const yt = isYomTov(d);
      if (!isShabbos && !yt) continue;

      // Walk forward over consecutive Shabbos/Yom Tov days.
      const days = [];
      let c = new Date(d);
      while (c.getDay() === 6 || isYomTov(c)) {
        days.push(new Date(c));
        c.setDate(c.getDate() + 1);
      }
      return days;
    }
    return null;
  }

  function isYomTov(d) {
    try {
      const rd = global.gRD(d.getFullYear(), d.getMonth() + 1, d.getDate());
      return global.eventsForRD(rd).some(e => e.type === 'yt');
    } catch (e) { return false; }
  }

  function ytLabel(d) {
    try {
      const rd = global.gRD(d.getFullYear(), d.getMonth() + 1, d.getDate());
      const ev = global.eventsForRD(rd).find(e => e.type === 'yt');
      return ev ? ev.name : (d.getDay() === 6 ? 'Shabbos' : '');
    } catch (e) { return ''; }
  }

  /* ---- render ---- */

  async function render() {
    const alarms = await Sync.alarms.list();
    renderBlock(alarms);
    renderList('clock-shabbos', alarms.filter(a => a.scope === 'every_shabbos'), true);
    renderList('clock-weekday', alarms.filter(a => a.scope === 'weekday'), false);
    renderArmed();
  }

  function renderArmed() {
    const el = $('clock-armed');
    if (!el) return;
    const sh = global.Zmanim && Zmanim.cachedShabbos();
    if (sh && sh.candles) {
      const c = new Date(sh.candles);
      el.textContent = 'Shabbos mode arms ' +
        c.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    } else {
      el.textContent = 'Set a location to arm Shabbos mode';
    }
  }

  function renderList(id, rows, armedStyle) {
    const el = $(id);
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '<div class="footnote" style="text-align:left;">None yet — add one below.</div>';
      return;
    }
    el.innerHTML = '';
    rows.sort((a, b) => String(a.time_of_day).localeCompare(String(b.time_of_day)));
    rows.forEach(a => {
      const d = document.createElement('div');
      d.className = 'alarm';
      const desc = [a.label,
        'rings ' + (DUR_LABEL[a.ring_seconds] || a.ring_seconds + 's') + ', stops by itself']
        .filter(Boolean).join(' · ');
      d.innerHTML = '<div><div class="at"></div><div class="an"></div></div>';
      d.querySelector('.at').textContent = fmt(a.time_of_day);
      d.querySelector('.an').textContent = desc;

      if (armedStyle) {
        /* No toggle on a Shabbos alarm inside the block: it cannot be changed
           then anyway, so a control implying otherwise would mislead. */
        const chip = document.createElement('span');
        chip.className = 'lockchip';
        chip.textContent = a.enabled ? 'Armed' : 'Off';
        if (!a.enabled) { chip.style.background = '#EFE9DA'; chip.style.color = 'var(--ink-2)'; }
        chip.style.cursor = 'pointer';
        chip.addEventListener('click', async () => {
          await Sync.alarms.update(a.id, { enabled: !a.enabled });
          await render(); if (global.Notify) Notify.reschedule();
        });
        d.appendChild(chip);
      } else {
        const t = document.createElement('button');
        t.className = 'toggle' + (a.enabled ? ' on' : '');
        t.setAttribute('aria-label', 'Toggle alarm');
        t.addEventListener('click', async () => {
          await Sync.alarms.update(a.id, { enabled: !a.enabled });
          await render(); if (global.Notify) Notify.reschedule();
        });
        d.appendChild(t);
      }

      let timer = null;
      d.addEventListener('pointerdown', () => {
        timer = setTimeout(async () => {
          if (confirm('Remove the ' + fmt(a.time_of_day) + ' alarm?')) {
            await Sync.alarms.remove(a.id);
            await render(); if (global.Notify) Notify.reschedule();
          }
        }, 600);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(e =>
        d.addEventListener(e, () => clearTimeout(timer)));
      el.appendChild(d);
    });
  }

  /* The block grid: one column per day, so an alarm can be on for Day 1 and off
     for Day 2. Assignments live in the alarm's day_assignments jsonb, keyed by
     ISO date, which keeps them meaningful across a block that shifts each year. */
  function renderBlock(alarms) {
    const head = $('clock-block-head'), body = $('clock-block'), title = $('clock-block-title');
    if (!head || !body) return;

    const days = nextBlock();
    if (!days || !days.length) {
      if (title) title.textContent = 'Next block';
      head.innerHTML = '';
      body.innerHTML = '<div class="footnote" style="text-align:left;">No Shabbos or Yom Tov found in the next three weeks.</div>';
      return;
    }

    if (title) {
      const first = days[0], last = days[days.length - 1];
      title.textContent = 'Next block · ' + (ytLabel(first) || 'Shabbos') +
        (days.length > 1 ? ' → ' + last.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '');
    }

    head.style.gridTemplateColumns = '1fr ' + days.map(() => '52px').join(' ');
    head.innerHTML = '<span></span>' + days.map(d =>
      '<span>' + d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      '<br><small>' + DOW[d.getDay()] + '</small></span>').join('');

    const inBlock = alarms.filter(a => a.scope === 'yomtov_block' || a.scope === 'every_shabbos');
    if (!inBlock.length) {
      body.innerHTML = '<div class="footnote" style="text-align:left;">No alarms for this block yet. ' +
        'Add one below and set which days it should ring.</div>';
      return;
    }

    body.innerHTML = '';
    inBlock.sort((a, b) => String(a.time_of_day).localeCompare(String(b.time_of_day)));
    inBlock.forEach(a => {
      const row = document.createElement('div');
      row.className = 'pdrow';
      row.style.gridTemplateColumns = '1fr ' + days.map(() => '52px').join(' ');

      const left = document.createElement('div');
      left.innerHTML = '<div class="at"></div><div class="an"></div>';
      left.querySelector('.at').textContent = fmt(a.time_of_day);

      const an = left.querySelector('.an');
      an.textContent = (a.label ? a.label + ' · ' : '') + 'rings ';
      const sel = document.createElement('select');
      sel.className = 'dur';
      sel.setAttribute('aria-label', 'Ring duration');
      DUR.forEach(s => {
        const o = document.createElement('option');
        o.value = s; o.textContent = DUR_LABEL[s];
        if (s === (a.ring_seconds || 60)) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', async () => {
        await Sync.alarms.update(a.id, { ring_seconds: Number(sel.value) });
        if (global.Notify) Notify.reschedule();
      });
      an.appendChild(sel);
      an.appendChild(document.createTextNode(' then stops'));
      row.appendChild(left);

      days.forEach(d => {
        const key = d.toISOString().slice(0, 10);
        const assigned = a.day_assignments && Object.prototype.hasOwnProperty.call(a.day_assignments, key)
          ? !!a.day_assignments[key]
          : a.enabled;   // default: follows the alarm's own state
        const chip = document.createElement('button');
        chip.className = 'daychip' + (assigned ? ' on' : '');
        chip.textContent = '✓';
        chip.setAttribute('aria-label', DOW[d.getDay()] + ' ' + fmt(a.time_of_day));
        chip.addEventListener('click', async () => {
          const next = Object.assign({}, a.day_assignments || {});
          next[key] = !assigned;
          await Sync.alarms.update(a.id, { day_assignments: next });
          await render(); if (global.Notify) Notify.reschedule();
        });
        row.appendChild(chip);
      });
      body.appendChild(row);
    });
  }

  /* ---- add ---- */

  function wire() {
    const add = $('al-add');
    if (add) add.addEventListener('click', async () => {
      const time = $('al-time').value, label = $('al-label').value.trim();
      if (!time) { alert('Pick a time for the alarm.'); return; }
      await Sync.alarms.add({
        label: label || 'Alarm',
        time_of_day: time,
        ring_seconds: Number($('al-dur').value),
        scope: $('al-scope').value,
        sound: 'chime',
        day_assignments: {},
        enabled: true
      });
      $('al-time').value = ''; $('al-label').value = '';
      await render();
      if (global.Notify) Notify.reschedule();
    });

    // Settings changes move candle lighting, which moves when the block arms.
    document.addEventListener('vecker:settings', () => render().catch(() => {}));
  }

  global.Clock = { render };
  document.addEventListener('DOMContentLoaded', () => {
    wire();
    render().catch(err => console.warn('Clock:', err));
  });
})(typeof window !== 'undefined' ? window : this);
