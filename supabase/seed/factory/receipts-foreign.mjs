// Redraws the papers that 09_foreign_suppliers.sql moved to a supplier abroad: an English packing list (an Italian
// delivery note for the hardware), with the warehouse's own Hebrew stamp on it, as the paper really comes in.
// No packages: the cached Chrome for Testing takes the photo headless, macOS sips turns it into a JPEG.
// usage: node receipts-foreign.mjs <out-dir> [--upload]
// Prints one line per document; with --upload, writes <out-dir>/paths.json for the storage_path update.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const env = Object.fromEntries(fs.readFileSync(`${root}/.env.local`, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const auth = { apikey: key, Authorization: `Bearer ${key}` };
const outDir = path.resolve(process.argv[2] ?? '');
const upload = process.argv.includes('--upload');
if (!process.argv[2]) throw new Error('usage: node receipts-foreign.mjs <out-dir> [--upload]');
fs.mkdirSync(outDir, { recursive: true });

const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

// The same desk, paper, light and ink as receipts.mjs, read left to right.
const source = fs.readFileSync(path.join(here, 'receipts.mjs'), 'utf8');
const from = source.indexOf('const page_html = `') + 'const page_html = `'.length;
const to = source.indexOf('</script></body></html>`;') + '</script></body></html>'.length;
const page = source.slice(from, to)
  .replace('<html dir="rtl">', '<html dir="ltr">')
  .replace('font-weight:700;text-align:right}', 'font-weight:700;text-align:left}')
  .replace("m.style.left='-30px'", "m.style.right='-30px'");
if (!page.includes('<html dir="ltr">') || !page.includes("m.style.right='-30px'")) throw new Error('receipts.mjs changed: the template no longer matches');

async function rows(table, query) {
  const r = await fetch(`${url}/rest/v1/${table}?${query}`, { headers: auth });
  if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`);
  return r.json();
}

const FOREIGN = {
  'de900000-0000-4000-8000-000000000001': { title: 'PACKING LIST', address: 'Nilüfer Organize Sanayi Bölgesi, Bursa, Türkiye', route: 'Gemlik → Haifa', box: ['MSKU', 'TGHU', 'ZIMU'], transit: 9 },
  'de900000-0000-4000-8000-000000000002': { title: 'PACKING LIST', address: 'Sindos Industrial Area, Thessaloniki, Greece', route: 'Thessaloniki → Haifa', box: ['MSCU', 'CMAU', 'ZIMU'], transit: 6 },
  'de900000-0000-4000-8000-000000000003': { title: 'PACKING LIST', address: 'Wujin High-Tech Zone, Changzhou, Jiangsu, China', route: 'Shanghai → Ashdod', box: ['CMAU', 'OOLU', 'ZIMU'], transit: 34 },
  'de900000-0000-4000-8000-000000000004': { title: 'DELIVERY NOTE (DDT)', address: "Via dell'Artigianato 18, Lissone (MB), Italia", route: 'Groupage Genova → Ashdod', box: null, transit: 12 },
};
const FACTORY = 'N.L. Aluminium Profiles & Sheets Ltd, Israel';

const ids = Object.keys(FOREIGN);
const [suppliers, docs, workers, products] = await Promise.all([
  rows('suppliers', `select=id,name,phone,email&id=in.(${ids.join(',')})`),
  rows('documents', `select=id,supplier_id,reference,storage_path,worker_id,created_at&kind=eq.in&supplier_id=in.(${ids.join(',')})&order=created_at`),
  rows('workers', 'select=id,name'),
  rows('products', 'select=id,sku,unit'),
]);
const moves = await rows('movements', `select=document_id,product_id,qty,external_name&type=eq.in&document_id=in.(${docs.map((d) => d.id).join(',')})&order=id`);
const names = await rows('supplier_items', `select=supplier_id,product_id,external_sku&supplier_id=in.(${ids.join(',')})`);
if (docs.length !== 24) throw new Error(`expected 24 papers abroad, found ${docs.length}`);

const S = new Map(suppliers.map((s) => [s.id, s]));
const W = new Map(workers.map((w) => [w.id, w.name]));
const P = new Map(products.map((p) => [p.id, p]));
const code = new Map(names.map((n) => [`${n.supplier_id}:${n.product_id}`, n.external_sku]));

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const seedOf = (id) => [...id].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
const COLORS = ['#1f2a44', '#23402f', '#4a2323', '#2b2f36', '#123f5c', '#3a2d55', '#1c1c1c', '#264653', '#3f3a1c', '#2d3b2a'];
const day = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d).replace(/\//g, '.');
const heDay = (d) => new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
const unitOf = (p) => (p.sku.startsWith('COL-') ? 'COIL' : p.unit === 'מטר' ? 'M' : p.unit === 'אריזה' ? 'PK' : 'PCS');

function paperOf(doc) {
  const s = S.get(doc.supplier_id), f = FOREIGN[doc.supplier_id], seed = Math.abs(seedOf(doc.id));
  const lines = moves.filter((m) => m.document_id === doc.id).map((m) => ({ p: P.get(m.product_id), m })).filter((x) => x.p);
  const arrived = new Date(doc.created_at), shipped = new Date(arrived.getTime() - (f.transit + (seed % 4)) * 86400000);
  const box = f.box ? `${f.box[seed % f.box.length]} ${String(1000000 + (seed % 8999999)).slice(0, 7)}` : `GRP-${String(seed % 90000 + 10000)}`;
  const body = lines.map((x, i) => `<tr><td class="n">${i + 1}</td><td class="c">${esc(code.get(`${doc.supplier_id}:${x.p.id}`) ?? '')}</td><td style="font-size:15px">${esc(x.m.external_name)}</td><td class="n">${Number(x.m.qty)}</td><td>${unitOf(x.p)}</td></tr>`).join('');
  const who = (W.get(doc.worker_id) ?? '').split(' ')[0];
  return `<div class="top"><div><div class="brand">${esc(s.name)}</div><div class="tag">${esc(f.address)}<br>Tel ${esc(s.phone)} · ${esc(s.email)}</div></div><div class="doc">${f.title}<small>No. ${esc(doc.reference)}</small></div></div><div class="rule"></div>
  <div class="meta"><div><b>Consignee:</b> ${esc(FACTORY)}</div><div><b>Date:</b> ${day(shipped)}</div><div><b>${f.box ? 'Container' : 'Shipment'}:</b> ${box}</div><div><b>Route:</b> ${esc(f.route)}</div><div><b>Lines:</b> ${lines.length}</div><div><b>Terms:</b> ${f.box ? 'CIF' : 'DAP'}</div></div>
  <table><thead><tr><th style="width:38px">#</th><th style="width:118px">Code</th><th>Description</th><th style="width:66px">Qty</th><th style="width:60px">Unit</th></tr></thead><tbody>${body}</tbody></table>
  <div class="stamp" style="right:${70 + seed % 90}px;bottom:${150 + seed % 60}px;transform:rotate(${-9 + seed % 16}deg)">התקבל במחסן<small>${heDay(arrived)} · ${esc(who)}</small></div>
  <div class="foot"><div class="sig"><div>Driver</div><div data-sign>Received by</div></div></div>`;
}

const out = [];
for (const doc of docs) {
  const html = paperOf(doc);
  const d = { html, kind: 'in', seed: seedOf(doc.id), color: COLORS[Math.abs(seedOf(doc.supplier_id)) % COLORS.length] };
  const name = doc.id.slice(-6);
  const file = path.join(outDir, `${name}.html`);
  fs.writeFileSync(file, page.replace('</body></html>', `<script>paint(${JSON.stringify(d).replace(/</g, '\\u003c')})</script></body></html>`));
  const png = path.join(outDir, `${name}.png`), jpg = path.join(outDir, `${name}.jpg`);
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=900,1200', `--screenshot=${png}`, `file://${file}`], { stdio: 'ignore' });
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '66', png, '--out', jpg], { stdio: 'ignore' });
  const stamp = doc.storage_path.match(/^in\/(\d+)-/)?.[1];
  if (!stamp) throw new Error(`unexpected path ${doc.storage_path}`);
  const storage = `in/${stamp}-${crypto.createHash('sha1').update(`packing-list:${doc.id}`).digest('hex').slice(0, 6)}.jpg`;
  out.push({ id: doc.id, storage_path: storage, file: jpg });
  console.log(doc.id, S.get(doc.supplier_id).name, doc.reference, storage);
}

if (upload) {
  for (const f of out) {
    const r = await fetch(`${url}/storage/v1/object/delivery-notes/${f.storage_path}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'image/jpeg', 'x-upsert': 'false', 'cache-control': '3600' }, body: fs.readFileSync(f.file) });
    const text = await r.text();
    if (!r.ok && !text.includes('Duplicate') && r.status !== 409) throw new Error(`upload ${f.storage_path}: ${r.status} ${text.slice(0, 160)}`);
  }
  fs.writeFileSync(path.join(outDir, 'paths.json'), JSON.stringify(out.map(({ id, storage_path }) => ({ id, storage_path })), null, 1));
  console.log('uploaded', out.length);
}
