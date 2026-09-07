// Read-only transaction: counts and hashes only, never workspace contents.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const Database = createRequire('/app/sofer-studio/db/db.js')('better-sqlite3');
const db = new Database(process.argv[2] || '/data/sofer.db', { readonly: true, fileMustExist: true });
const quote = s => '"' + s.replaceAll('"', '""') + '"';
const result = db.transaction(() => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return Object.fromEntries(tables.map(({ name }) => {
    const columns = db.prepare('PRAGMA table_info(' + quote(name) + ')').all();
    const order = columns.filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => quote(c.name));
    const hash = createHash('sha256'); let count = 0;
    for (const row of db.prepare('SELECT * FROM ' + quote(name) + ' ORDER BY ' + (order.join(',') || 'rowid')).iterate()) {
      hash.update(JSON.stringify(row)); hash.update('\n'); count++;
    }
    return [name, { count, sha256: hash.digest('hex') }];
  }));
})();
console.log(JSON.stringify(result));
db.close();
