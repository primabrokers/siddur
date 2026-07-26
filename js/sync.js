/* Offline-first sync for the user's own data.
 *
 * Reads never touch the network. Every collection is held locally and served
 * from there, because this app is used at times when a request is impossible
 * by design — on Shabbos there is no network, and an alarm whose definition
 * lives on a server is an alarm that does not ring.
 *
 * Writes apply locally first and are queued. The queue drains when there is a
 * connection and someone is signed in; until then the app is fully usable and
 * simply has unsent changes. Nothing blocks on the server.
 *
 * Signing in is therefore optional. A guest's data lives on the device, and
 * stamps itself with a user id and uploads the first time they sign in, so
 * nothing set up before creating an account is lost.
 *
 * Conflict handling is last-write-wins by updated_at. This is single-user data
 * across a person's own devices, so the ordering that matters is the one they
 * would expect: the most recent edit is the one that survives.
 */
(function (global) {
  'use strict';

  // Local key in Store per table, plus the pending write queue.
  const DATA_PREFIX = 'data:';
  const QUEUE_KEY = 'sync:queue';

  const COLLECTIONS = {
    alarms:    'luach_alarms',
    minyanim:  'luach_minyanim',
    rules:     'luach_notification_rules',
    yahrzeits: 'luach_yahrzeits'
  };

  // One row per user. The primary key differs between these two tables, which
  // is why the column is named rather than assumed.
  const SINGLETONS = {
    profile:     { table: 'luach_profiles',      key: 'id' },
    siddurPrefs: { table: 'luach_siddur_prefs',  key: 'user_id' }
  };

  /* Automatic syncing is gated so the app can refuse to open a connection when
     it should not — over Shabbos and Yom Tov above all. The calendar engine
     owns that decision; this module only obeys it. Manual calls still work, so
     a deliberate user action is never silently ignored. */
  let autoAllowed = () => true;

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    // Older WebViews: not cryptographically strong, but these ids only need to
    // avoid collision within one person's own records.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
    });
  }

  const now = () => new Date().toISOString();

  function localGet(table, fallback) {
    return Store.get(DATA_PREFIX + table).then(v => (v == null ? fallback : v));
  }
  function localSet(table, value) {
    return Store.set(DATA_PREFIX + table, value);
  }

  /* ---- pending write queue ---- */

  function readQueue() { return Store.get(QUEUE_KEY).then(q => q || []); }

  function enqueue(entry) {
    return readQueue().then(q => {
      // Collapse repeated edits to the same row: only the latest state matters,
      // and a queue that grows per keystroke would push the same row endlessly.
      const i = q.findIndex(e => e.table === entry.table && e.id === entry.id);
      if (i >= 0) q[i] = entry; else q.push(entry);
      // A delete replaces a queued upsert rather than cancelling it out. The
      // row may have reached the server in an earlier session and been edited
      // since, in which case dropping both would leave it there for good.
      // Deleting a row that was never uploaded is a harmless no-op.
      return Store.set(QUEUE_KEY, q);
    }).then(() => { if (autoAllowed()) Sync.push().catch(() => {}); });
  }

  /* ---- collections ---- */

  function collection(name) {
    const table = COLLECTIONS[name];

    return {
      list() { return localGet(table, []); },

      async add(row) {
        const user = Auth.user();
        const record = Object.assign({}, row, {
          id: row.id || uuid(),
          // Stamped at sign-in time for guests; see adoptGuestData().
          user_id: user ? user.id : null,
          created_at: row.created_at || now(),
          updated_at: now()
        });
        const rows = await localGet(table, []);
        rows.push(record);
        await localSet(table, rows);
        await enqueue({ op: 'upsert', table, id: record.id, row: record, unsent: true });
        return record;
      },

      async update(id, patch) {
        const rows = await localGet(table, []);
        const i = rows.findIndex(r => r.id === id);
        if (i < 0) throw new Error(`${name}: no row ${id}`);
        rows[i] = Object.assign({}, rows[i], patch, { id, updated_at: now() });
        await localSet(table, rows);
        await enqueue({ op: 'upsert', table, id, row: rows[i], unsent: true });
        return rows[i];
      },

      async remove(id) {
        const rows = await localGet(table, []);
        await localSet(table, rows.filter(r => r.id !== id));
        await enqueue({ op: 'delete', table, id });
      }
    };
  }

  /* ---- singletons ---- */

  function singleton(name) {
    const { table, key } = SINGLETONS[name];

    return {
      get() { return localGet(table, null); },

      async set(patch) {
        const user = Auth.user();
        const current = await localGet(table, {});
        const record = Object.assign({}, current, patch, { updated_at: now() });
        if (user) record[key] = user.id;
        await localSet(table, record);
        // Keyed by the user id: there is only ever one such row, and before
        // sign-in there is no id to key it by, so it waits in the queue.
        await enqueue({ op: 'upsert', table, id: record[key] || name, row: record, unsent: true, singleton: true });
        return record;
      }
    };
  }

  /* ---- server exchange ---- */

  let pushing = null;   // single-flight guard for Sync.push()

  /* Drain the queue. Rows that fail stay queued: being offline is the normal
     case, not an error, and a change must never be dropped because a request
     did not land. */
  async function doPush() {
    if (!Auth.signedIn()) return { pushed: 0, pending: (await readQueue()).length };
    const user = Auth.user();
    const queue = await readQueue();
    const remaining = [];
    let pushed = 0;

    for (const entry of queue) {
      try {
        if (entry.op === 'delete') {
          await Api.remove(entry.table, '?id=eq.' + encodeURIComponent(entry.id));
        } else {
          // A guest's rows carry no user_id until now. RLS would reject them.
          const row = Object.assign({}, entry.row);
          if (entry.singleton) row[SINGLETONS[nameForTable(entry.table)].key] = user.id;
          else if (!row.user_id) row.user_id = user.id;
          await Api.upsert(entry.table, row);
        }
        pushed++;
      } catch (err) {
        // 4xx other than auth means the server refused this row on its
        // merits — retrying forever would wedge the queue behind it.
        if (err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403) {
          console.warn('Dropping a change the server rejected:', entry, err.message);
          continue;
        }
        remaining.push(entry);
      }
    }

    await Store.set(QUEUE_KEY, remaining);
    return { pushed, pending: remaining.length };
  }

  const Sync = {
    alarms:    collection('alarms'),
    minyanim:  collection('minyanim'),
    rules:     collection('rules'),
    yahrzeits: collection('yahrzeits'),
    profile:     singleton('profile'),
    siddurPrefs: singleton('siddurPrefs'),

    /* The calendar engine calls this with a predicate that is false on Shabbos
       and Yom Tov, so nothing this module does opens a connection then. */
    gate(fn) { autoAllowed = typeof fn === 'function' ? fn : () => true; },

    pendingCount() { return readQueue().then(q => q.length); },

    /* Drain the queue. Rows that fail stay queued: being offline is the normal
       case, not an error, and a change must never be dropped because a request
       did not land. */
    push() {
      // Every write triggers a push, so overlapping runs are routine. Without
      // a single-flight guard two of them read the same queue, send the same
      // rows twice, and the slower one's write-back resurrects entries the
      // faster one already cleared.
      if (!pushing) pushing = doPush().finally(() => { pushing = null; });
      return pushing;
    },

    /* Replace local copies with the server's. Called after sign-in on a new
       device. Pushes first so unsent local work is not overwritten by it. */
    async pull() {
      if (!Auth.signedIn()) return { pulled: 0 };
      await Sync.push().catch(() => {});

      let pulled = 0;
      for (const table of Object.values(COLLECTIONS)) {
        const rows = await Api.select(table, '?select=*');
        await localSet(table, rows || []);
        pulled += (rows || []).length;
      }
      for (const { table } of Object.values(SINGLETONS)) {
        const rows = await Api.select(table, '?select=*&limit=1');
        if (rows && rows.length) { await localSet(table, rows[0]); pulled++; }
      }
      return { pulled };
    },

    /* Stamp anything created before sign-in with the new user id, so a guest's
       setup survives creating an account instead of silently staying local. */
    async adoptGuestData() {
      const user = Auth.user();
      if (!user) return 0;
      let adopted = 0;

      for (const table of Object.values(COLLECTIONS)) {
        const rows = await localGet(table, []);
        let touched = false;
        for (const r of rows) {
          if (!r.user_id) {
            r.user_id = user.id;
            touched = true;
            adopted++;
            await enqueue({ op: 'upsert', table, id: r.id, row: r, unsent: true });
          }
        }
        if (touched) await localSet(table, rows);
      }
      return adopted;
    }
  };

  function nameForTable(table) {
    return Object.keys(SINGLETONS).find(k => SINGLETONS[k].table === table);
  }

  /* Sign-in adopts local work and then reconciles with the server. Sign-out
     leaves local data alone: it is the user's, and wiping it would lose
     anything still queued. */
  if (global.Auth && Auth.onChange) {
    let lastUserId = (Auth.user() || {}).id || null;
    Auth.onChange(session => {
      const id = (session && session.user && session.user.id) || null;
      // onChange also fires on hourly token refresh. Reconcile only when the
      // identity actually changes, or a full pull would run every hour.
      if (id === lastUserId) return;
      lastUserId = id;
      if (!id) return;
      Sync.adoptGuestData()
        .then(() => Sync.pull())
        .catch(err => console.warn('Sync after sign-in deferred:', err.message));
    });
  }

  // A returning connection is the natural moment to flush.
  if (global.addEventListener) {
    global.addEventListener('online', () => {
      if (autoAllowed()) Sync.push().catch(() => {});
    });
  }

  global.Sync = Sync;
})(typeof window !== 'undefined' ? window : this);
