import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { openDatabase } from '../db/db.js';
import { createApp } from '../server/app.js';

// Each extracted copy owns its database and receives an unused loopback port.
// No network connection, installer, system Node, or administrator rights needed.
const db = openDatabase(fileURLToPath(new URL('../data/sofer.db', import.meta.url)));
const server = createApp({ db, publicDir: fileURLToPath(new URL('../public', import.meta.url)), port: 0 });
server.listen(0, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + server.address().port;
  console.log('Sofer Studio offline: ' + url);
  console.log('Your work is saved in this program folder. Keep this window open while working.');
  if (!process.argv.includes('--no-browser')) {
    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, stdio: 'ignore' });
    browser.on('error', () => console.log('Open the address above in your browser.'));
  }
});
server.on('error', () => { console.error('Could not start Sofer. Check that the extracted folder is writable.'); db.close(); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
