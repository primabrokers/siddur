import {openDatabase} from '/app/sofer-studio/db/db.js';
import {createApp} from '/app/sofer-studio/server/app.js';

// Each guest gets a separate process: database, jobs and mutation token cannot
// leak through the application's module-level state into another guest.
const db = openDatabase(':memory:');
// The full fixed-reference import and layout use about 101 MiB. Keep a finite
// 256 MiB SQLite ceiling, including room for the original and stretched copy.
db.pragma('max_page_count = 65536');
const app = createApp({db,publicDir:'/app/sofer-studio/public',port:0});
app.listen(0,'127.0.0.1',()=>process.send({port:app.address().port}));
function stop(){app.close(()=>{db.close();process.exit(0);});setTimeout(()=>process.exit(0),1000).unref();}
process.on('SIGTERM',stop);
process.on('disconnect',stop);
