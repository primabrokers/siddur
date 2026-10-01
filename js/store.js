/* Text store — IndexedDB, with a one-time migration out of localStorage.
 *
 * Cached texts used to live in localStorage. That caps at roughly 5MB per
 * origin, which the siddur alone can approach; adding Tehillim (150 kapitlach)
 * and Mishnayos (4,192 records) goes past it comfortably. The failure mode was
 * the dangerous part: setItem throws QuotaExceededError, the old caller
 * swallowed it, and the cache silently stopped filling. Nothing surfaced until
 * a section was needed offline — on Shabbos, when there is no way to recover.
 *
 * IndexedDB has no comparable practical ceiling and reports its own usage, so
 * a filling cache can be measured instead of guessed. Writes here reject
 * loudly rather than failing quietly; callers decide what to do about it.
 */
(function (global) {
  'use strict';

  const DB_NAME = 'luach';
  const DB_VERSION = 1;
  const STORE = 'texts';
  const MIGRATED_FLAG = 'luach:idb-migrated';
  // Keys the localStorage era used, and that migration should sweep up:
  // 'txt:<ref>' for section texts, 'idx:<title>' for a nusach's index.
  const LEGACY_PREFIXES = ['txt:', 'idx:'];

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!global.indexedDB) return reject(new Error('IndexedDB unavailable'));
      const req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      // Another tab holding an older version open blocks the upgrade; surface
      // it rather than hanging forever on a promise that never settles.
      req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let result;
      // Resolve on transaction completion, not on request success: in a
      // readwrite transaction the write is not durable until oncomplete.
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('transaction aborted'));
      const req = fn(store);
      if (req) req.onsuccess = () => { result = req.result; };
    }));
  }

  /* localStorage fallback. Private-browsing modes in some browsers refuse
     IndexedDB entirely; a small cache beats none, and the quota ceiling that
     motivated this module is still better than failing to start. */
  const fallback = {
    get(k) { try { const v = localStorage.getItem(k); return Promise.resolve(v ? JSON.parse(v) : null); } catch (e) { return Promise.resolve(null); } },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return Promise.resolve(); }
      catch (e) { return Promise.reject(e); }
    },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} return Promise.resolve(); },
    keys() {
      const out = [];
      try { for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)); } catch (e) {}
      return Promise.resolve(out);
    },
    clear() {
      return fallback.keys().then(ks => {
        ks.filter(k => LEGACY_PREFIXES.some(p => k.startsWith(p))).forEach(k => {
          try { localStorage.removeItem(k); } catch (e) {}
        });
      });
    }
  };

  let usingFallback = false;
  function withFallback(name, args, run) {
    if (usingFallback) return fallback[name].apply(null, args);
    return run().catch(err => {
      // A rejected write is a real signal (disk full, quota) and must reach the
      // caller. Only fall back when IndexedDB itself is unusable.
      if (!/unavailable|blocked/i.test(String(err && err.message))) throw err;
      usingFallback = true;
      return fallback[name].apply(null, args);
    });
  }

  const Store = {
    get(key) {
      return withFallback('get', [key], () =>
        tx('readonly', s => s.get(key)).then(v => (v === undefined ? null : v)));
    },

    set(key, value) {
      return withFallback('set', [key, value], () =>
        tx('readwrite', s => s.put(value, key)));
    },

    del(key) {
      return withFallback('del', [key], () => tx('readwrite', s => s.delete(key)));
    },

    keys() {
      return withFallback('keys', [], () => tx('readonly', s => s.getAllKeys()));
    },

    clear() {
      return withFallback('clear', [], () => tx('readwrite', s => s.clear()));
    },

    /* Bytes used and available, when the browser will say. Returns null where
       the Storage API is absent rather than inventing a number. */
    estimate() {
      if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(null);
      return navigator.storage.estimate().then(e => ({
        usage: e.usage || 0,
        quota: e.quota || 0,
        pct: e.quota ? Math.round((e.usage / e.quota) * 100) : 0
      })).catch(() => null);
    },

    /* Ask the browser not to evict this origin's data under pressure. Texts
       are only useful offline if they are still there when offline happens.
       Advisory: browsers may decline, and Safari ignores it. */
    persist() {
      if (!navigator.storage || !navigator.storage.persist) return Promise.resolve(false);
      return navigator.storage.persisted()
        .then(already => already || navigator.storage.persist())
        .catch(() => false);
    },

    /* Move anything the localStorage era left behind, once, then free that
       quota. Idempotent: the flag stays in localStorage so a cleared
       IndexedDB re-runs it and recovers whatever is still there. */
    migrate() {
      return withFallback('keys', [], () => {
        let done = false;
        try { done = localStorage.getItem(MIGRATED_FLAG) === '1'; } catch (e) { return Promise.resolve(0); }
        if (done) return Promise.resolve(0);

        const legacy = [];
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && LEGACY_PREFIXES.some(p => k.startsWith(p))) legacy.push(k);
          }
        } catch (e) { return Promise.resolve(0); }

        if (!legacy.length) {
          try { localStorage.setItem(MIGRATED_FLAG, '1'); } catch (e) {}
          return Promise.resolve(0);
        }

        // Copy first and only delete what landed, so an interrupted migration
        // loses nothing and simply resumes on the next load.
        return legacy.reduce((chain, k) => chain.then(n => {
          let parsed;
          try { parsed = JSON.parse(localStorage.getItem(k)); }
          catch (e) { try { localStorage.removeItem(k); } catch (e2) {} return n; }
          return Store.set(k, parsed)
            .then(() => { try { localStorage.removeItem(k); } catch (e) {} return n + 1; })
            .catch(() => n);
        }), Promise.resolve(0)).then(moved => {
          if (moved === legacy.length) {
            try { localStorage.setItem(MIGRATED_FLAG, '1'); } catch (e) {}
          }
          return moved;
        });
      });
    }
  };

  global.Store = Store;
})(typeof window !== 'undefined' ? window : this);
