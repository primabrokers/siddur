/* Luach platform layer
   One file that makes the same HTML behave correctly as a website, an installed PWA,
   and a native iOS/Android app (Capacitor). Include it on every page:
     <script src="js/platform.js" defer></script> */

(function () {
  'use strict';

  const isNative    = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const isStandalone = isNative ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true;
  const platform = isNative
    ? (window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : 'native')
    : (/iPad|iPhone|iPod/.test(navigator.userAgent) ? 'ios-web'
      : /Android/.test(navigator.userAgent) ? 'android-web' : 'web');

  const root = document.documentElement;
  root.classList.add(isStandalone ? 'app-standalone' : 'app-browser');
  root.classList.add('plat-' + platform);
  if (isNative) root.classList.add('app-native');

  const Luach = window.Luach = {
    isNative, isStandalone, platform,
    /* ---- Notifications: native local notifications when wrapped, Web Notifications otherwise ---- */
    async requestNotificationPermission() {
      if (isNative) {
        const LN = window.Capacitor.Plugins.LocalNotifications;
        const res = await LN.requestPermissions();
        return res.display === 'granted';
      }
      if (!('Notification' in window)) return false;
      const p = await Notification.requestPermission();
      return p === 'granted';
    },

    /* Schedule a batch of alarms/reminders AHEAD OF TIME.
       This is the whole reason for the native wrapper: on Shabbos and Yom Tov nothing
       may be scheduled, dismissed, or interacted with, so everything for the entire
       block is queued before candle lighting and fires with the app closed.
       items: [{ id, title, body, at: Date, ringSeconds, sound, ongoing }] */
    async scheduleAll(items) {
      if (isNative) {
        const LN = window.Capacitor.Plugins.LocalNotifications;
        await LN.schedule({
          notifications: items.map(i => ({
            id: i.id,
            title: i.title,
            body: i.body || '',
            schedule: { at: i.at, allowWhileIdle: true },
            sound: i.sound || 'chime.wav',
            // Android: keep the alarm audible for its full window, then stop by itself
            ongoing: !!i.ongoing,
            autoCancel: true,
            extra: { ringSeconds: i.ringSeconds || 60, kind: i.kind || 'alarm' }
          }))
        });
        return items.length;
      }
      // Web fallback: setTimeout only survives while a tab is alive — good enough for
      // in-session reminders, never relied on for Shabbos alarms.
      let n = 0;
      for (const i of items) {
        const delay = new Date(i.at).getTime() - Date.now();
        if (delay <= 0 || delay > 24 * 3600 * 1000) continue;
        setTimeout(() => Luach.notify(i.title, i.body, i.ringSeconds), delay);
        n++;
      }
      return n;
    },

    async cancelAll(ids) {
      if (isNative) {
        const LN = window.Capacitor.Plugins.LocalNotifications;
        const pending = ids ? { notifications: ids.map(id => ({ id })) } : await LN.getPending();
        if (pending.notifications && pending.notifications.length) await LN.cancel(pending);
      }
    },

    notify(title, body, ringSeconds) {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const n = new Notification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-96.png', tag: 'luach' });
      if (ringSeconds) setTimeout(() => n.close(), ringSeconds * 1000);
    },

    /* ---- Shabbos clock needs the screen to stay on and untouched ---- */
    async keepAwake(on) {
      if (isNative && window.Capacitor.Plugins.KeepAwake) {
        const K = window.Capacitor.Plugins.KeepAwake;
        return on ? K.keepAwake() : K.allowSleep();
      }
      try {
        if (on) {
          if ('wakeLock' in navigator) Luach._wl = await navigator.wakeLock.request('screen');
        } else if (Luach._wl) { Luach._wl.release(); Luach._wl = null; }
      } catch (e) { /* wake lock unsupported or blocked */ }
    },

    /* ---- Location for zmanim ---- */
    async getLocation() {
      if (isNative && window.Capacitor.Plugins.Geolocation) {
        const G = window.Capacitor.Plugins.Geolocation;
        await G.requestPermissions();
        const p = await G.getCurrentPosition({ enableHighAccuracy: false });
        return { lat: p.coords.latitude, lng: p.coords.longitude };
      }
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('no geolocation'));
        navigator.geolocation.getCurrentPosition(
          p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
          reject, { maximumAge: 600000, timeout: 8000 }
        );
      });
    },

    haptic() {
      if (isNative && window.Capacitor.Plugins.Haptics) window.Capacitor.Plugins.Haptics.impact({ style: 'LIGHT' });
      else if (navigator.vibrate) navigator.vibrate(8);
    }
  };

  /* ---- Native chrome: status bar + splash ---- */
  if (isNative) {
    const P = window.Capacitor.Plugins;
    if (P.StatusBar) {
      P.StatusBar.setStyle({ style: 'DARK' }).catch(() => {});
      if (platform === 'android') P.StatusBar.setBackgroundColor({ color: '#1C2440' }).catch(() => {});
    }
    if (P.SplashScreen) setTimeout(() => P.SplashScreen.hide().catch(() => {}), 200);
    if (P.App) P.App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) history.back(); else P.App.exitApp();
    });
  }

  /* ---- Service worker (web + PWA only; Capacitor serves locally already) ---- */
  if (!isNative && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const w = reg.installing || reg.waiting;
          if (w) w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast(reg);
          });
        });
      }).catch(() => {});
    });
  }

  function showUpdateToast(reg) {
    const t = document.createElement('div');
    t.className = 'luach-toast';
    t.innerHTML = '<span>A new version is ready.</span>';
    const b = document.createElement('button');
    b.textContent = 'Reload';
    b.addEventListener('click', () => {
      if (reg.waiting) reg.waiting.postMessage('skipWaiting');
      location.reload();
    });
    t.appendChild(b);
    document.body.appendChild(t);
  }

  /* ---- Install prompt (Android/desktop Chrome) + iOS Safari instructions ---- */
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferred = e;
    if (!localStorage.getItem('luach.installDismissed')) showInstall(false);
  });

  function showInstall(iosMode) {
    if (document.querySelector('.luach-install')) return;
    const bar = document.createElement('div');
    bar.className = 'luach-install';
    const txt = document.createElement('span');
    txt.textContent = iosMode
      ? 'Add Luach to your home screen: tap Share, then “Add to Home Screen”.'
      : 'Install Luach for offline zmanim, siddur, and Shabbos alarms.';
    bar.appendChild(txt);
    if (!iosMode) {
      const go = document.createElement('button');
      go.textContent = 'Install';
      go.addEventListener('click', async () => {
        bar.remove();
        if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; }
      });
      bar.appendChild(go);
    }
    const x = document.createElement('button');
    x.className = 'ghost'; x.setAttribute('aria-label', 'Dismiss'); x.textContent = '✕';
    x.addEventListener('click', () => { bar.remove(); localStorage.setItem('luach.installDismissed', '1'); });
    bar.appendChild(x);
    document.body.appendChild(bar);
  }

  // iOS Safari never fires beforeinstallprompt — prompt manually, once.
  if (platform === 'ios-web' && !isStandalone && !localStorage.getItem('luach.installDismissed')) {
    window.addEventListener('load', () => setTimeout(() => showInstall(true), 2500));
  }

  /* ---- Styles for standalone chrome, safe areas, toasts ---- */
  const css = document.createElement('style');
  css.textContent = `
  .luach-install,.luach-toast{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));
    z-index:9999;background:#1C2440;color:#F4E9CF;border-radius:14px;padding:12px 14px;display:flex;gap:10px;
    align-items:center;font:500 13px/1.45 'Heebo',-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
    box-shadow:0 8px 28px rgba(20,26,48,.32);max-width:520px;margin:0 auto;}
  .luach-install span,.luach-toast span{flex:1;}
  .luach-install button,.luach-toast button{background:#F0D896;color:#1C2440;border:none;border-radius:9px;
    padding:8px 13px;font:700 12.5px 'Heebo',Arial,sans-serif;cursor:pointer;flex:none;}
  .luach-install button.ghost{background:transparent;color:#8E96B8;padding:6px 4px;font-size:14px;}
  @media (prefers-reduced-motion:no-preference){.luach-install,.luach-toast{animation:luachUp .25s ease;}}
  @keyframes luachUp{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}
  html.app-standalone,html.app-native{-webkit-text-size-adjust:100%;}
  html.app-standalone body,html.app-native body{overscroll-behavior-y:none;}
  html.app-standalone,html.app-native{--sat:env(safe-area-inset-top);--sab:env(safe-area-inset-bottom);}
  `;
  document.head.appendChild(css);
})();
