// Draws one photographed paper per document and uploads it to the path its row already names.
// usage: node receipts.mjs [limit] [--upload] [--only=out|in]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const root = '/Users/lybbnhmw/Desktop/דמו מפעל /super-admin';
const env = Object.fromEntries(fs.readFileSync(`${root}/.env.local`, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const auth = { apikey: key, Authorization: `Bearer ${key}` };
const args = process.argv.slice(2);
const limit = Number(args.find((a) => /^\d+$/.test(a)) ?? 1e9);
const upload = args.includes('--upload');
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1];
const outDir = new URL('./receipts/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });

async function all(table, select = '*', extra = '') {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${url}/rest/v1/${table}?select=${select}&order=id${extra}`, { headers: { ...auth, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } });
    if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`);
    const page = await r.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

const [documents, orders, lines, products, agents, workers, suppliers, moves] = await Promise.all([
  all('documents'), all('orders', 'id,number,customer,customer_phone,agent_id,note,created_at'), all('order_lines', 'order_id,product_id,qty'),
  all('products', 'id,sku,name,unit'), all('agents', 'id,name'), all('workers', 'id,name'), all('suppliers', 'id,name,phone,email'),
  all('movements', 'document_id,product_id,qty,external_name,supplier_id', '&type=eq.in'),
]);
const P = new Map(products.map((p) => [p.id, p]));
const W = new Map(workers.map((w) => [w.id, w.name]));
const A = new Map(agents.map((a) => [a.id, a.name]));
const S = new Map(suppliers.map((s) => [s.id, s]));
const byNumber = new Map(orders.map((o) => [o.number, o]));
const linesOf = new Map();
for (const l of lines) (linesOf.get(l.order_id) ?? linesOf.set(l.order_id, []).get(l.order_id)).push(l);
const movesOf = new Map();
for (const m of moves) if (m.document_id) (movesOf.get(m.document_id) ?? movesOf.set(m.document_id, []).get(m.document_id)).push(m);

const fmt = (iso) => new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
const hour = (iso) => new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

const page_html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:900px;height:1200px;overflow:hidden;background:#555}
#desk{position:absolute;inset:0;overflow:hidden}
#desk.steel{background:linear-gradient(115deg,#9ea3a6,#7f8487 45%,#94999c)}
#desk.steel::before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(92deg,rgba(255,255,255,.035) 0 1px,rgba(0,0,0,.035) 1px 3px)}
#desk.mat{background:radial-gradient(120% 90% at 30% 20%,#3a3d41,#23262a)}
#desk.sheet{background:linear-gradient(100deg,#c9ccce,#b2b6b9 50%,#c3c6c8)}
#desk.sheet::before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(1deg,rgba(255,255,255,.05) 0 2px,rgba(0,0,0,.03) 2px 5px)}
#desk.board{background:linear-gradient(160deg,#5e6a70,#47525a)}
#paper{position:absolute;left:50%;top:50%;width:760px;height:1040px;margin:-520px 0 0 -380px;background:var(--paper,#f6f4ec);box-shadow:0 26px 40px rgba(0,0,0,.38),0 3px 6px rgba(0,0,0,.3);padding:44px 46px 40px;color:#23242a;font-family:"Courier New",monospace;font-weight:600;transform-origin:50% 50%;overflow:hidden}
#paper::after{content:"";position:absolute;inset:0;pointer-events:none;background:
 linear-gradient(180deg,transparent 33.2%,rgba(0,0,0,.05) 33.4%,rgba(255,255,255,.28) 33.6%,transparent 34%),
 linear-gradient(180deg,transparent 66.4%,rgba(0,0,0,.05) 66.6%,rgba(255,255,255,.22) 66.8%,transparent 67.2%),
 linear-gradient(120deg,rgba(0,0,0,.02),transparent 40%,rgba(0,0,0,.05))}
#clip{position:absolute;left:50%;top:50%;width:270px;height:64px;margin-left:-135px;background:linear-gradient(180deg,#d9dbdd,#8f9396 55%,#b9bcbf);border-radius:8px 8px 3px 3px;box-shadow:0 8px 14px rgba(0,0,0,.4);display:none}
.brand{font-family:"Arial Hebrew","Arial",sans-serif;font-weight:700;font-size:31px;letter-spacing:-.3px;color:var(--ink,#1f2a44)}
.tag{font-family:"Arial Hebrew","Arial",sans-serif;font-weight:400;font-size:15px;color:#3c3f46;margin-top:3px}
.rule{height:3px;background:var(--ink,#1f2a44);margin:12px 0 16px}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
.doc{font-size:23px;font-weight:700;white-space:nowrap}
.doc small{display:block;font-size:14px;font-weight:600;margin-top:4px}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;font-size:17px;margin-bottom:16px}
.meta b{font-weight:700}
table{width:100%;border-collapse:collapse;font-size:16.5px}
th{background:rgba(0,0,0,.07);border:1.5px solid #33343a;padding:6px 7px;font-weight:700;text-align:right}
td{border:1.5px solid #55565c;padding:8px 7px;vertical-align:middle;height:42px}
td.n{text-align:center;direction:ltr;unicode-bidi:plaintext}
td.c{direction:ltr;text-align:left;font-size:14.5px;white-space:nowrap}
.foot{position:absolute;left:46px;right:46px;bottom:40px;font-size:16px}
.sig{display:flex;justify-content:space-between;gap:36px;margin-top:10px}
.sig div{flex:1;border-top:1.5px solid #33343a;padding-top:5px}
.copy{position:absolute;left:46px;top:22px;font-size:13px;font-weight:700;opacity:.75}
.note{font-size:15.5px;margin-top:12px}
svg.ink{position:absolute;overflow:visible;pointer-events:none}
.stamp{position:absolute;border:3px double #1e4fa3;color:#1e4fa3;padding:6px 16px;font-family:"Arial Hebrew",Arial,sans-serif;font-weight:700;font-size:21px;text-align:center;opacity:.72;mix-blend-mode:multiply;line-height:1.25}
.stamp small{display:block;font-size:15px;font-weight:400}
.hand{position:absolute;font-family:"Corsiva Hebrew","Raanana",cursive;color:#1b3f8f;font-size:25px;opacity:.86;mix-blend-mode:multiply}
#light{position:absolute;inset:0;pointer-events:none;mix-blend-mode:multiply}
#grain{position:absolute;inset:0;pointer-events:none;opacity:.05;mix-blend-mode:overlay;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2'/></filter><rect width='300' height='300' filter='url(%23n)'/></svg>")}
</style></head><body><div id="desk"><div id="paper"></div><div id="clip"></div><div id="light"></div><div id="grain"></div></div>
<script>
function rng(seed){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function scribble(r,w,h){let x=4,y=h*.6,d='M'+x+' '+y;const n=5+Math.floor(r()*5);for(let i=0;i<n;i++){const nx=x+w/n*(.6+r()*.8),ny=h*(.15+r()*.75),c1x=x+(nx-x)*.4,c1y=y-(30*r()-6),c2x=x+(nx-x)*.7,c2y=ny+(26*r()-10);d+=' C'+c1x.toFixed(1)+' '+c1y.toFixed(1)+' '+c2x.toFixed(1)+' '+c2y.toFixed(1)+' '+nx.toFixed(1)+' '+ny.toFixed(1);x=nx;y=ny}d+=' M'+(4+r()*20)+' '+h*.8+' L'+(w*.9)+' '+(h*(.55+r()*.3));return d}
function ink(p,x,y,w,h,d,sw){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('class','ink');s.setAttribute('width',w);s.setAttribute('height',h);s.style.left=x+'px';s.style.top=y+'px';s.innerHTML='<path d="'+d+'" fill="none" stroke="#1b3f8f" stroke-width="'+sw+'" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>';p.appendChild(s)}
window.paint=(d)=>{
 const r=rng(d.seed),paper=document.getElementById('paper'),desk=document.getElementById('desk'),clip=document.getElementById('clip');
 const tints=d.kind==='out'?['#f6f4ec','#f6f4ec','#fbeee9','#f7f1cf']:['#f7f5ee','#f3efe2','#f6f2d6','#eef1f2'];
 paper.style.setProperty('--paper',tints[Math.floor(r()*tints.length)]);
 paper.style.setProperty('--ink',d.color);
 desk.className=['steel','mat','sheet','board'][Math.floor(r()*4)];
 paper.innerHTML=d.html;
 const rz=(r()-.5)*5.5,rx=2+r()*7,ry=(r()-.5)*7,scale=.93+r()*.035,dx=(r()-.5)*22,dy=(r()-.5)*18;
 paper.style.transform='translate('+dx+'px,'+dy+'px) perspective(1500px) rotateX('+rx+'deg) rotateY('+ry+'deg) rotateZ('+rz+'deg) scale('+scale+')';
 clip.style.display=r()<.3?'block':'none';
 clip.style.transform='translateY(-'+(535-dy)+'px) rotate('+rz*.6+'deg)';
 const a=r()*360;
 document.getElementById('light').style.background='linear-gradient('+a+'deg,rgba(255,255,255,1),rgba(205,202,195,1) 55%,rgba(160,158,152,1))';
 document.querySelectorAll('tbody tr').forEach((row)=>{ if(r()<.9){const b=row.getBoundingClientRect(),q=paper.getBoundingClientRect();void q;const m=document.createElementNS('http://www.w3.org/2000/svg','svg');m.setAttribute('class','ink');m.setAttribute('width',26);m.setAttribute('height',22);m.style.position='absolute';m.style.left='-30px';m.style.top=(6+r()*6)+'px';m.innerHTML='<path d="M3 '+(10+r()*3)+' L'+(9+r()*2)+' '+(17+r()*3)+' L'+(22+r()*3)+' '+(2+r()*4)+'" fill="none" stroke="#1b3f8f" stroke-width="2.2" stroke-linecap="round" opacity=".8"/>';const c=row.lastElementChild;c.style.position='relative';c.appendChild(m)}});
 const sig=paper.querySelector('[data-sign]');
 if(sig){const q=paper.getBoundingClientRect(),b=sig.getBoundingClientRect(),k=paper.offsetWidth/q.width;ink(paper,(b.left-q.left)*k+10+r()*50,(b.top-q.top)*k-52-r()*10,200,62,scribble(r,190,58),2.3)}
 return true};
</script></body></html>`;

const FACTORY = { name: 'נ.ל. אלומיניום פרופילים ולוחות בע״מ', tag: 'אזור התעשייה הצפוני · ת.ד. 214 · טל׳ 04-5550100 · ע.מ. 515550214' };
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const short = (s) => s.replace(/\s*\(מוט \d מ׳\)/, '');
const seedOf = (id) => [...id].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
const COLORS = ['#1f2a44', '#23402f', '#4a2323', '#2b2f36', '#123f5c', '#3a2d55', '#1c1c1c', '#264653', '#3f3a1c', '#2d3b2a'];

function outHtml(doc) {
  const number = Number(String(doc.reference ?? '').replace(/\D/g, ''));
  const o = byNumber.get(number);
  if (!o) return null;
  const rows = (linesOf.get(o.id) ?? []).map((l) => ({ p: P.get(l.product_id), q: l.qty })).filter((x) => x.p);
  if (rows.length === 0) return null;
  const copy = ['העתק לקוח', 'מקור', 'העתק מחסן'][Math.abs(seedOf(doc.id)) % 3];
  const body = rows.map((x, i) => `<tr><td class="n">${i + 1}</td><td class="c">${esc(x.p.sku)}</td><td>${esc(short(x.p.name))}</td><td class="n">${Number(x.q)}</td><td>${esc(x.p.unit)}</td></tr>`).join('');
  return `<div class="copy">${copy}</div><div class="top"><div><div class="brand">${FACTORY.name}</div><div class="tag">${FACTORY.tag}</div></div><div class="doc">תעודת משלוח<small dir="ltr">${40000 + number}</small></div></div><div class="rule"></div>
  <div class="meta"><div><b>לכבוד:</b> ${esc(o.customer)}</div><div><b>תאריך:</b> ${fmt(doc.created_at)} ${hour(doc.created_at)}</div><div><b>הזמנה:</b> ${number}</div><div><b>סוכן:</b> ${esc(A.get(o.agent_id) ?? '')}</div>${o.customer_phone ? `<div><b>טלפון:</b> <span dir="ltr">${esc(o.customer_phone)}</span></div>` : ''}<div><b>יצא ע״י:</b> ${esc(W.get(doc.worker_id) ?? 'משרד')}</div></div>
  <table><thead><tr><th style="width:38px">#</th><th style="width:150px">מק״ט</th><th>תיאור</th><th style="width:64px">כמות</th><th style="width:62px">יח׳</th></tr></thead><tbody>${body}</tbody></table>
  ${o.note ? `<div class="note"><b>הערה:</b> ${esc(o.note)}</div>` : ''}
  <div class="foot"><div>הסחורה נמסרה שלמה ובמצב תקין. בעלות על הסחורה עוברת עם התשלום המלא.</div><div class="sig"><div>שם המקבל</div><div data-sign>חתימת המקבל</div></div></div>`;
}

function inHtml(doc) {
  const s = S.get(doc.supplier_id);
  const rows = (movesOf.get(doc.id) ?? []).map((m) => ({ p: P.get(m.product_id), q: m.qty, n: m.external_name })).filter((x) => x.p);
  if (!s || rows.length === 0) return null;
  const number = String(doc.reference ?? '').replace(/\D/g, '');
  const code = (x) => x.p.sku.replace(/-/g, '').slice(0, 9);
  const body = rows.slice(0, 13).map((x, i) => `<tr><td class="n">${i + 1}</td><td class="c">${esc(code(x))}</td><td>${esc(short(x.n ?? x.p.name))}</td><td class="n">${Number(x.q)}</td></tr>`).join('');
  return `<div class="top"><div><div class="brand">${esc(s.name)}</div><div class="tag">טל׳ ${esc(s.phone ?? '')} · ${esc(s.email ?? '')}</div></div><div class="doc">תעודת משלוח<small dir="ltr">${number}${rows.length > 13 ? ' · 1/2' : ''}</small></div></div><div class="rule"></div>
  <div class="meta"><div><b>לכבוד:</b> ${FACTORY.name}</div><div><b>תאריך:</b> ${fmt(doc.created_at)}</div><div><b>נהג:</b> ${esc(['סלים','אבי','מוחמד','דוד','ואסים','רפי'][Math.abs(seedOf(doc.id)) % 6])}</div><div><b>שורות:</b> ${rows.length}</div></div>
  <table><thead><tr><th style="width:38px">#</th><th style="width:130px">קוד</th><th>פריט</th><th style="width:72px">כמות</th></tr></thead><tbody>${body}</tbody></table>
  <div class="stamp" style="left:${70 + Math.abs(seedOf(doc.id)) % 90}px;bottom:${150 + Math.abs(seedOf(doc.id)) % 60}px;transform:rotate(${-9 + Math.abs(seedOf(doc.id)) % 16}deg)">התקבל במחסן<small>${fmt(doc.created_at)} · ${esc((W.get(doc.worker_id) ?? '').split(' ')[0])}</small></div>
  <div class="foot"><div class="sig"><div>שם הנהג</div><div data-sign>חתימת המקבל</div></div></div>`;
}

const CH = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const b = await chromium.launch({ executablePath: CH, headless: true, args: ['--headless=new'] });
const c = await b.newContext({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1 });
const page = await c.newPage();
await page.setContent(page_html);

const list = documents.filter((d) => (!only || d.kind === only)).sort((x, y) => (x.created_at < y.created_at ? 1 : -1)).slice(0, limit);
let drawn = 0, skipped = 0;
const files = [];
for (const doc of list) {
  const file = path.join(outDir, doc.storage_path.replace('/', '_'));
  if (!fs.existsSync(file)) {
    const html = doc.kind === 'out' ? outHtml(doc) : inHtml(doc);
    if (!html) { skipped += 1; continue; }
    await page.evaluate((d) => window.paint(d), { html, kind: doc.kind, seed: seedOf(doc.id), color: doc.kind === 'out' ? COLORS[0] : COLORS[Math.abs(seedOf(doc.supplier_id ?? 'x')) % COLORS.length] });
    await page.screenshot({ path: file, type: 'jpeg', quality: 66 });
    drawn += 1;
    if (drawn % 100 === 0) console.log('drawn', drawn);
  }
  files.push({ file, storage: doc.storage_path });
}
await b.close();
console.log({ documents: list.length, drawn, skipped, ready: files.length });

if (upload) {
  let done = 0, failed = 0, next = 0;
  const worker = async () => {
    while (next < files.length) {
      const f = files[next++];
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await fetch(`${url}/storage/v1/object/delivery-notes/${f.storage}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'image/jpeg', 'x-upsert': 'false', 'cache-control': '3600' }, body: fs.readFileSync(f.file) });
        if (r.ok || r.status === 409 || (await r.clone().text()).includes('Duplicate')) { done += 1; break; }
        if (attempt === 2) { failed += 1; console.log('fail', f.storage, r.status, (await r.text()).slice(0, 120)); }
      }
      if ((done + failed) % 200 === 0) console.log('uploaded', done, 'failed', failed);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log({ uploaded: done, failed });
}
