// tests/run-all.js — run every test file in order and report a summary.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const files = ['engine.test.js', 'layout.test.js', 'security.test.js', 'persistence.test.js', 'diff.test.js', 'fixes.test.js', 'remaining.test.js', 'frontend.test.js', 'stam-input.test.js', 'stam-web-import.test.js', 'stam-annotations.test.js'];
let failures = 0;

for (const f of files) {
  console.log('\n===== ' + f + ' =====');
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./' + f, import.meta.url))], { stdio: 'inherit' });
  if (r.status !== 0) {
    failures += 1;
    console.error('  >> ' + f + ' FAILED');
  }
}

console.log('\n===== SUMMARY =====');
if (failures === 0) {
  console.log('ALL ' + files.length + ' TEST FILES PASSED');
  process.exit(0);
} else {
  console.error(failures + ' of ' + files.length + ' test files failed');
  process.exit(1);
}
