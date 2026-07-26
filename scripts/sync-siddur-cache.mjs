#!/usr/bin/env node
// Walks a Sefaria siddur index, prints an English-coverage report, and (optionally)
// upserts every section into the Supabase shared cache (luach_siddur_texts).
//
// Coverage report only:
//   node scripts/sync-siddur-cache.mjs "Siddur Sefard"
// Report + populate Supabase cache (service role key required; NEVER ship this key client-side):
//   SUPABASE_URL=https://qdofumucgrggpehrxvdr.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/sync-siddur-cache.mjs "Siddur Sefard"

const [,, indexTitle = 'Siddur Ashkenaz'] = process.argv;
const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API = 'https://www.sefaria.org/api';
const NUS = { 'Siddur Ashkenaz': 'ashkenaz', 'Siddur Sefard': 'sefard', 'Siddur Edot HaMizrach': 'edot_hamizrach' };

async function getJSON(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}
function walk(node, path, out) {
  const t = node.title || '';
  const p = t ? [...path, t] : path;
  if (node.nodes && node.nodes.length) node.nodes.forEach(n => walk(n, p, out));
  else out.push(p.join(', '));
}
function flat(x, out = []) {
  if (Array.isArray(x)) x.forEach(v => flat(v, out));
  else if (x != null && String(x).trim()) out.push(String(x));
  return out;
}
async function upsert(row) {
  const r = await fetch(`${SB}/rest/v1/luach_siddur_texts`, {
    method: 'POST',
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify(row)
  });
  if (!r.ok) console.warn(`  ! upsert failed for ${row.ref}: HTTP ${r.status}`);
}

const idx = await getJSON(`${API}/v2/index/${encodeURIComponent(indexTitle.replace(/ /g, '_'))}`);
const refs = [];
walk(idx.schema, [], refs);
console.log(`${indexTitle}: ${refs.length} sections\n`);

let totalHe = 0, totalEn = 0;
for (const ref of refs) {
  try {
    const d = await getJSON(`${API}/texts/${encodeURIComponent(ref).replace(/%2C/g, ',').replace(/%20/g, '_')}?context=0&commentary=0&pad=0`);
    const he = flat(d.he), en = flat(d.text);
    totalHe += he.length; totalEn += Math.min(en.length, he.length);
    console.log(`${ref} — EN ${en.length}/${he.length}`);
    if (SB && KEY) await upsert({
      ref, nusach: NUS[indexTitle] || indexTitle, payload: d,
      english_segments: en.length, total_segments: he.length,
      // Sent explicitly: merge-duplicates only updates columns present in the
      // payload, so relying on the column default would leave a re-synced row
      // showing the timestamp of its first insert.
      fetched_at: new Date().toISOString()
    });
  } catch (e) {
    console.warn(`skip ${ref}: ${e.message}`);
  }
  await new Promise(r => setTimeout(r, 200));
}
console.log(`\nTOTAL ${indexTitle}: ${totalEn}/${totalHe} segments with English (${totalHe ? (100 * totalEn / totalHe).toFixed(1) : 0}%)`);
