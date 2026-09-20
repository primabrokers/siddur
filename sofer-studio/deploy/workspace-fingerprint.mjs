// Read-only fingerprints; output only counts and hashes, never saved content.
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const Database=createRequire('/app/sofer-studio/db/db.js')('better-sqlite3');
const db=new Database(process.argv[2]||'/data/sofer.db',{readonly:true,fileMustExist:true});
const result=db.transaction(()=>{
  const tables={};
  for(const table of ['profiles','sources','geometries','layouts','layout_lines']){
    const hash=createHash('sha256');let count=0;
    for(const row of db.prepare('SELECT * FROM '+table+' ORDER BY id').iterate()){
      hash.update(JSON.stringify(row)+'\n');count++;
    }
    tables[table]={count,sha256:hash.digest('hex')};
  }
  return {version:db.prepare('SELECT max(version) AS n FROM schema_migrations').get().n,tables};
})();
db.close();console.log(JSON.stringify(result));
