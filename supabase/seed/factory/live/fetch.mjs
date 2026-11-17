// Reads the live state through the public REST API into state.json. Prints counts only.
import fs from 'node:fs';
const root = '/Users/lybbnhmw/Desktop/דמו מפעל /super-admin';
const env = Object.fromEntries(fs.readFileSync(`${root}/.env.local`, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const auth = { apikey: key, Authorization: `Bearer ${key}` };
async function all(table, select = '*', extra = '') {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${url}/rest/v1/${table}?select=${select}&order=id${extra}`, { headers: { ...auth, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } });
    if (!r.ok) throw new Error(`${table}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    const page = await r.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}
const names = ['products', 'suppliers', 'workers', 'agents', 'orders', 'order_lines', 'movements', 'shelf_stock', 'supplier_items', 'faults', 'item_requests', 'documents'];
const state = {};
for (const n of names) {
  try { state[n] = await all(n); } catch (e) { state[n] = null; console.log('unreadable', n, String(e.message).slice(0, 80)); }
}
fs.writeFileSync('state.json', JSON.stringify(state));
console.log(Object.fromEntries(Object.entries(state).map(([k, v]) => [k, v?.length ?? null])));
