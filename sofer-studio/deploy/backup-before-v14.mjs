// Read-only online SQLite backup. Never print workspace content.
import {createRequire} from 'node:module';
import {chmodSync,existsSync} from 'node:fs';
const Database=createRequire('/app/sofer-studio/db/db.js')('better-sqlite3');
const source='/data/sofer.db',backup='/backup/sofer-before-v14.sqlite';
if(existsSync(backup))throw new Error('Backup already exists; do not overwrite');
const db=new Database(source,{readonly:true,fileMustExist:true});
await db.backup(backup);chmodSync(backup,0o600);
const copy=new Database(backup,{readonly:true,fileMustExist:true});
const integrity=copy.pragma('integrity_check',{simple:true});
if(integrity!=='ok')throw new Error('Backup integrity failed');
const counts=Object.fromEntries(['profiles','sources','geometries','layouts','layout_lines'].map(t=>[t,copy.prepare('SELECT count(*) AS n FROM '+t).get().n]));
const version=copy.prepare('SELECT max(version) AS n FROM schema_migrations').get().n;
console.log(JSON.stringify({backupComplete:true,integrity,counts,version}));
copy.close();db.close();
