/* Settings: a bottom sheet, and the editors behind the Menu rows.
 *
 * Nine rows in Menu had no handler at all — they looked like settings and did
 * nothing. Each one here either edits real persisted state through Sync, or is
 * honest that it is not built yet. A row that cannot do anything should say so
 * rather than absorb a tap.
 *
 * Changes take effect immediately: candle offset and shitos feed the zmanim
 * engine, nusach feeds the siddur, and every save re-queues notifications
 * because a reminder anchored to candle lighting moves when the offset does.
 */
(function (global) {
  'use strict';

  const $ = id => document.getElementById(id);

  /* ---- sheet ---- */

  function sheet(title, bodyEl, onSave) {
    close();
    const back = document.createElement('div');
    back.className = 'sheet-back';
    const s = document.createElement('div');
    s.className = 'sheet';
    s.setAttribute('role', 'dialog');
    s.setAttribute('aria-modal', 'true');
    s.setAttribute('aria-label', title);

    const head = document.createElement('div');
    head.className = 'sheet-head';
    head.innerHTML = '<span></span>';
    head.firstChild.textContent = title;
    const x = document.createElement('button');
    x.className = 'sheet-x'; x.textContent = '✕';
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', close);
    head.appendChild(x);

    const foot = document.createElement('div');
    foot.className = 'sheet-foot';
    const save = document.createElement('button');
    save.className = 'cta';
    save.textContent = onSave ? 'Save' : 'Done';
    save.addEventListener('click', async () => {
      save.disabled = true;
      try { if (onSave) await onSave(); close(); }
      catch (e) { save.disabled = false; alert('Couldn’t save: ' + e.message); }
    });
    foot.appendChild(save);

    s.appendChild(head); s.appendChild(bodyEl); s.appendChild(foot);
    back.appendChild(s);
    back.addEventListener('click', e => { if (e.target === back) close(); });
    document.addEventListener('keydown', esc);
    document.body.appendChild(back);
    // Focus the sheet so a keyboard user is not left behind the backdrop.
    x.focus();
  }

  function esc(e){ if (e.key === 'Escape') close(); }
  function close(){
    document.querySelectorAll('.sheet-back').forEach(n => n.remove());
    document.removeEventListener('keydown', esc);
  }

  /* Builders for the controls the editors need. */
  function group(label, hint){
    const d = document.createElement('div');
    d.className = 'sg';
    d.innerHTML = '<div class="sg-l"></div>' + (hint ? '<div class="sg-h"></div>' : '');
    d.firstChild.textContent = label;
    if (hint) d.querySelector('.sg-h').textContent = hint;
    return d;
  }

  function choices(name, opts, value){
    const wrap = document.createElement('div');
    wrap.className = 'sg-opts';
    opts.forEach(o => {
      const b = document.createElement('button');
      b.className = 'sg-opt' + (o.value === value ? ' on' : '');
      b.dataset.value = o.value;
      b.innerHTML = '<span class="t"></span>' + (o.hint ? '<span class="h"></span>' : '');
      b.querySelector('.t').textContent = o.label;
      if (o.hint) b.querySelector('.h').textContent = o.hint;
      b.addEventListener('click', () => {
        wrap.querySelectorAll('.sg-opt').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
      });
      wrap.appendChild(b);
    });
    wrap.value = () => (wrap.querySelector('.sg-opt.on') || {}).dataset?.value;
    return wrap;
  }

  function number(value, min, max, suffix){
    const wrap = document.createElement('div');
    wrap.className = 'sg-num';
    const i = document.createElement('input');
    i.type = 'number'; i.value = value; i.min = min; i.max = max;
    i.setAttribute('aria-label', suffix || 'value');
    wrap.appendChild(i);
    if (suffix){ const s = document.createElement('span'); s.textContent = suffix; wrap.appendChild(s); }
    wrap.value = () => {
      const n = Number(i.value);
      if (isNaN(n) || n < min || n > max) throw new Error('enter a number between ' + min + ' and ' + max);
      return n;
    };
    return wrap;
  }

  async function profile(){ return (await Sync.profile.get()) || {}; }

  function applied(){
    // Anything anchored to a zman or candle lighting shifts when these change.
    if (global.Notify) Notify.reschedule();
    if (global.Reminders) Reminders.refresh();
    document.dispatchEvent(new CustomEvent('vecker:settings'));
  }

  /* ---- editors ---- */

  const Editors = {
    async nusach(){
      const p = await profile();
      const body = document.createElement('div'); body.className = 'sheet-body';
      const g = group('Nusach', 'Used for the siddur and for which tefillos are shown.');
      const c = choices('nusach', [
        { value: 'ashkenaz', label: 'Ashkenaz' },
        { value: 'sefard', label: 'Sefard', hint: 'Chassidish / Nusach Sefard' },
        { value: 'edot_hamizrach', label: 'Edot Hamizrach' }
      ], p.nusach || 'ashkenaz');
      g.appendChild(c); body.appendChild(g);
      sheet('Nusach', body, async () => {
        await Sync.profile.set({ nusach: c.value() });
        await Sync.siddurPrefs.set({ nusach: c.value() });
        applied();
      });
    },

    async minhag(){
      const p = await profile();
      const body = document.createElement('div'); body.className = 'sheet-body';

      const g1 = group('Candle lighting', 'Minutes before shkia. 18 is the common minhag; Yerushalayim is 40.');
      const off = number(p.candle_offset_minutes ?? 18, 0, 60, 'min before shkia');
      g1.appendChild(off); body.appendChild(g1);

      const g2 = group('Yom Tov', 'Two days outside Eretz Yisroel.');
      const dia = choices('dia', [
        { value: 'true', label: 'Diaspora', hint: 'Two-day Yom Tov' },
        { value: 'false', label: 'Eretz Yisroel', hint: 'One day' }
      ], String(p.diaspora !== false));
      g2.appendChild(dia); body.appendChild(g2);

      const g3 = group('Kiddush levana', 'Earliest time to say it after the molad.');
      const kl = choices('kl', [
        { value: '3', label: '3 days', hint: 'Common minhag' },
        { value: '7', label: '7 days', hint: 'Shulchan Aruch' }
      ], String(p.kl_wait_days || 3));
      g3.appendChild(kl); body.appendChild(g3);

      sheet('Minhag', body, async () => {
        await Sync.profile.set({
          candle_offset_minutes: off.value(),
          diaspora: dia.value() === 'true',
          kl_wait_days: Number(kl.value())
        });
        applied();
      });
    },

    async shitos(){
      const p = await profile();
      const z = p.zmanim_settings || {};
      const body = document.createElement('div'); body.className = 'sheet-body';

      const g1 = group('Sof zman krias shema', 'Which shita the Today screen highlights.');
      const shema = choices('shema', [
        { value: 'gra_and_ma', label: 'Show both', hint: 'GRA and Magen Avraham' },
        { value: 'gra', label: 'GRA only' },
        { value: 'ma', label: 'Magen Avraham only' }
      ], z.shema || 'gra_and_ma');
      g1.appendChild(shema); body.appendChild(g1);

      const g2 = group('Tzeis hakochavim', 'Minutes after shkia.');
      const tz = number(z.tzeis_minutes ?? 42, 13, 90, 'min after shkia');
      g2.appendChild(tz); body.appendChild(g2);

      const g3 = group('Alos hashachar', 'Minutes before netz.');
      const al = number(z.alos_minutes ?? 72, 60, 120, 'min before netz');
      g3.appendChild(al); body.appendChild(g3);

      const note = document.createElement('div');
      note.className = 'sg-h';
      note.style.padding = '0 2px 4px';
      note.textContent = 'Hebcal supplies several variants; these choose which are shown and ' +
        'which reminder anchors use. They do not change Hebcal’s own calculation.';
      body.appendChild(note);

      sheet('Zmanim shitos', body, async () => {
        await Sync.profile.set({
          zmanim_settings: Object.assign({}, z, {
            shema: shema.value(), tzeis_minutes: tz.value(), alos_minutes: al.value()
          })
        });
        applied();
      });
    },

    async notifications(){
      const body = document.createElement('div'); body.className = 'sheet-body';

      const g = group('Permission', 'Vecker needs permission before it can remind you of anything.');
      const state = document.createElement('div');
      state.className = 'sg-h';
      state.textContent = ('Notification' in window)
        ? 'Currently: ' + Notification.permission
        : 'This browser does not support notifications.';
      g.appendChild(state);
      const ask = document.createElement('button');
      ask.className = 'sg-opt'; ask.style.marginTop = '8px';
      ask.textContent = 'Grant permission';
      ask.addEventListener('click', async () => {
        const ok = await Notify.permission();
        state.textContent = ok ? 'Granted — reminders will fire.' : 'Not granted. Nothing can fire without it.';
        if (ok) Notify.reschedule();
      });
      g.appendChild(ask);
      body.appendChild(g);

      const g2 = group('Next few reminders', 'What is queued right now. If this is empty, nothing will fire.');
      const list = document.createElement('div');
      list.className = 'sg-h';
      list.textContent = 'Checking…';
      g2.appendChild(list); body.appendChild(g2);

      Notify.preview(6).then(items => {
        if (!items.length){
          list.textContent = 'Nothing queued. Add a minyan or a rule in Reminders, and make sure a location is set.';
          return;
        }
        list.innerHTML = items.map(i =>
          '<div style="padding:3px 0;">' +
          new Date(i.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) +
          ' — ' + i.title.replace(/[<>&]/g, '') + '</div>').join('');
      }).catch(() => { list.textContent = 'Couldn’t read the queue.'; });

      if (!global.Luach || !Luach.isNative){
        const warn = document.createElement('div');
        warn.className = 'sg-h';
        warn.style.color = 'var(--fast-ink)';
        warn.textContent = 'On the web, reminders only fire while a tab is open. Shabbos alarms ' +
          'need the installed iOS or Android app, which schedules them with the operating system.';
        body.appendChild(warn);
      }

      sheet('Notifications', body, null);
    },

    async shabbosMode(){
      const body = document.createElement('div'); body.className = 'sheet-body';
      const t = shabbosPreview();
      const g = group('Shabbos & Yom Tov mode', t);
      body.appendChild(g);
      const g2 = group('How it behaves',
        'At candle lighting the app locks to a single clock. Alarms ring for their set ' +
        'duration and stop by themselves — nothing to dismiss. It unlocks after havdalah.');
      body.appendChild(g2);
      const btn = document.createElement('button');
      btn.className = 'sg-opt';
      btn.textContent = 'Preview the locked screen';
      btn.addEventListener('click', () => { close(); const b = $('btnPreview'); if (b) b.click(); });
      body.appendChild(btn);
      sheet('Shabbos mode', body, null);
    },

    async notBuilt(name, why){
      const body = document.createElement('div'); body.className = 'sheet-body';
      const g = group(name + ' isn’t built yet', why);
      body.appendChild(g);
      sheet(name, body, null);
    }
  };

  function shabbosPreview(){
    const sh = global.Zmanim && Zmanim.cachedShabbos();
    if (sh && sh.candles){
      const c = new Date(sh.candles);
      return 'Arms at candle lighting, ' +
        c.toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' }) + '.';
    }
    return 'Arms at candle lighting. Set a location so Vecker knows when that is.';
  }

  /* ---- wire the Menu rows ----
     Matched on their visible label rather than by adding ids to nine elements,
     so the markup stays as-is and a renamed row fails loudly in testing rather
     than silently going dead again. */
  const WIRING = [
    ['Zmanim shitos', () => Editors.shitos()],
    ['Minhag', () => Editors.minhag()],
    ['Notifications', () => Editors.notifications()],
    ['Shabbos & Yom Tov mode', () => Editors.shabbosMode()],
    ['Yahrzeits', () => Editors.notBuilt('Yahrzeits',
      'The table exists and Hebrew-date recurrence is designed, but there is no editor yet. Coming next.')],
    ['Home screen widgets', () => Editors.notBuilt('Widgets',
      'Widgets need native iOS and Android extensions, which come after the first TestFlight build.')],
    ['Travel mode', () => Editors.notBuilt('Travel mode',
      'Zmanim already follow the location you set. Automatic updates while travelling are not built yet.')],
    ['Help & halachic sources', () => Editors.notBuilt('Help',
      'Per-zman halachic sources are being written. Until then: Today screen times come from Hebcal, and the source is labelled under the arc.')],
    ['Ask a rov / feedback', () => Editors.notBuilt('Ask a rov',
      'This needs a rov configured to receive questions. Not wired up yet.')]
  ];

  function wire(){
    document.querySelectorAll('#scr-menu .mrow').forEach(row => {
      const label = (row.querySelector('.mt') || {}).textContent || '';
      const hit = WIRING.find(w => w[0] === label.trim());
      if (!hit) return;
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => hit[1]());
    });

    // The profile card is the natural place to sign in from.
    const prof = document.querySelector('#scr-menu .profile');
    if (prof){
      prof.style.cursor = 'pointer';
      prof.addEventListener('click', () => Editors.nusach());
    }
  }

  global.Settings = { open: Editors, wire };
  document.addEventListener('DOMContentLoaded', wire);
})(typeof window !== 'undefined' ? window : this);
