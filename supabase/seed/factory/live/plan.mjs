// Plans the factory's days from 2026-11-03 to now, forward from the live state, in the year's own rhythm.
// The order generator is a port of supabase/seed/factory/03_orders.sql; trucks follow each supplier's calendar.
// usage: node plan.mjs <cutoffISO> [seed]
import fs from 'node:fs';
import crypto from 'node:crypto';

const S = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const CUTOFF = Date.parse(process.argv[2] ?? new Date().toISOString());
const SEED = Number(process.argv[3] ?? 1116);
const K1 = Number(process.env.K1 ?? 1.3), K2 = Number(process.env.K2 ?? 12);

/* ───────── randomness ───────── */
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let random = mulberry32(SEED);
const gauss = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
const poisson = (l) => { let k = 0, p = 1; const t = Math.exp(-l); do { k++; p *= random(); } while (p > t); return k - 1; };
const pick = (a) => a[Math.floor(random() * a.length)];
/** Weighted sample without replacement, the seed's `order by -ln(1 - random()) / w limit k`. */
const wsample = (items, w, k) => items.map((x) => [x, -Math.log(1 - random()) / w(x)]).filter(([, key]) => Number.isFinite(key)).sort((a, b) => a[1] - b[1]).slice(0, k).map(([x]) => x);
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const uuidOf = (s) => { const h = md5(s); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; };
/** This batch's ids: the generated prefix of its kind, then 1116, so the batch can be told apart and taken out alone. */
const sid = (kind, n) => `${kind}00000-1116-4000-8000-${n.toString(16).padStart(12, '0')}`;

/* ───────── calendar, Israel time (UTC+2 in November) ───────── */
const TZ = '+02:00';
const dow = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const isWork = (d) => ![5, 6].includes(dow(d));
const wd = (d0, n) => { let d = d0, left = Math.abs(n); const step = n < 0 ? -1 : 1; while (left > 0) { d = addDays(d, step); if (isWork(d)) left--; } return d; };
/** A moment on a day, minutes after midnight plus random seconds. */
const at = (d, minutes, secs = Math.floor(random() * 60)) => Date.parse(`${d}T00:00:00${TZ}`) + (minutes * 60 + secs) * 1000;
const iso = (t) => new Date(t).toISOString();
const dayOf = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(t));
const TODAY = dayOf(CUTOFF);
const FIRST = '2026-11-03';
const DAYS = []; for (let d = FIRST; d <= TODAY; d = addDays(d, 1)) DAYS.push(d);
const M = 12; // months since 2025-11, as the seed counts them

/* ───────── the live state ───────── */
const P = new Map(S.products.map((p) => [p.id, { ...p, qty: Number(p.qty), reserved: Number(p.reserved), min_qty: Number(p.min_qty ?? 0), price: p.price === null ? null : Number(p.price) }]));
const BY_SKU = new Map([...P.values()].map((p) => [p.sku, p]));
const SUP = new Map(S.suppliers.map((s) => [s.id, s]));
const SUP_BY_NAME = new Map(S.suppliers.map((s) => [s.name, s]));
const W = new Map(S.workers.map((w) => [w.name, w.id]));
const wid = (n) => { const id = W.get(n); if (!id) throw new Error('no worker ' + n); return id; };
const AGENTS = ['63bd97d7-e6bd-45aa-a113-96d91b0a489c', 'ba6eac84-0bb7-44d4-8379-b4d3b72cf5f4', 'de500000-0000-4000-8000-000000000001', 'de500000-0000-4000-8000-000000000002'];
const AGENT_NAME = new Map(S.agents.map((a) => [a.id, a.name]));
const linesOf = new Map();
for (const l of S.order_lines) (linesOf.get(l.order_id) ?? linesOf.set(l.order_id, []).get(l.order_id)).push({ ...l, qty: Number(l.qty), unit_price: l.unit_price === null ? null : Number(l.unit_price) });

// Snapshot of what the apply step must still find.
const START = new Map([...P.values()].map((p) => [p.id, { qty: p.qty, reserved: p.reserved }]));

/* ───────── the seed's tables (03_orders.sql) ───────── */
const CUST = [
  [1,'קבוצת נווה',1,3,9,1.6,0,99],[2,'אלומיניום הגליל בע״מ',2,1,8,1.4,0,99],[3,'חלונות זוהר',1,1,6,1,0,99],[4,'בניין הכרמל',3,3,6,1.5,0,99],[5,'מסגריית קדם',1,4,5.5,.8,0,99],[6,'קבלן דרום',4,4,5,1.1,0,99],
  [7,'מרכז הזגגות',2,1,4.5,.8,0,99],[8,'אגם מעקות',3,2,4.5,.9,0,99],[9,'י.ד. חזיתות בע״מ',4,3,4,1.3,0,99],[10,'פרגולות השרון',2,11,4,.8,0,99],[11,'תעשיות לביא',1,6,3.5,.9,0,99],[12,'דלתות ארגמן',3,9,3.2,.7,0,99],
  [13,'שילוט אור עד',4,13,3,.6,0,99],[14,'גדרות הנגב',4,12,3,.8,0,99],[15,'סטודיו ויטרינה',1,10,2.6,.6,0,99],[16,'מערכות זיגוג ע.מ',2,1,2.4,.7,0,8],[17,'קורת גג הנדסה',3,4,2.2,.8,0,99],[18,'ב.ר. קונסטרוקציות',2,4,2,.9,2,99],
  [19,'מפעלי טל מתכת',1,4,1.8,.7,0,99],[20,'ארגזי רכב הדרום',4,14,1.6,.6,5,99],[21,'מרפסות הים',3,2,1.4,.6,7,99],[22,'סדנת רמות',2,1,1.2,.5,0,99],[23,'עבודות פח דיין',1,5,1.2,.5,0,99],[24,'מעקות יפו',3,2,1,.5,3,99],
  [25,'אלומיניום שקד בע״מ',2,1,3.4,1.1,0,99],[26,'חלונות נוף הגליל',2,1,2.6,.8,0,99],[27,'זגגות המעפילים',3,1,1.8,.6,0,99],[28,'דלתות המסילה',1,9,2,.7,0,99],[29,'ש.י. חלונות ודלתות',4,1,2.4,.8,0,99],[30,'מעבדת הזגג',3,1,1,.4,0,99],
  [31,'א.ב. אלומיניום ובניין',1,1,2.8,.9,1,99],[32,'חלונות נתיב השיירה',2,1,1.5,.6,0,99],[33,'אור חלונות מודיעין',1,1,1.6,.6,4,99],[34,'ג.מ. אלומיניום רהט',4,1,1.4,.6,0,99],[35,'חלונות הר חברון',4,1,1.2,.5,2,99],[36,'אלומיניום גיא אוני',2,1,1,.5,0,99],
  [37,'חזיתות המרכז בע״מ',1,3,3.2,1.3,0,99],[38,'מגדלי הירדן ביצוע',3,3,2.8,1.7,3,99],[39,'א. שפירא הנדסת חזיתות',1,3,2.2,1.2,0,99],[40,'פרויקטים ג׳י.אס',4,3,1.8,1.1,0,10],[41,'קבוצת הבונים הצפון',2,3,2,1.2,0,99],[42,'חיפויי אילת',4,3,1,.7,0,99],[43,'רום חזיתות',3,3,1.6,1,6,99],
  [44,'מעקות עמק חפר',3,2,1.6,.6,0,99],[45,'פרגולות בית הכרם',3,11,1.8,.7,0,99],[46,'גדרות ושערים אשדוד',4,12,1.5,.6,0,99],[47,'צל וגג פרגולות',1,11,2,.7,0,99],[48,'מעקות גלבוע',2,2,1,.5,0,99],[49,'שערי הדרום',4,12,1.2,.6,2,99],
  [50,'מסגריית המושבה',1,4,2,.6,0,99],[51,'מסגרות אבן יהודה',3,4,1.4,.5,0,99],[52,'קונסטרוקציות עכו',2,4,1.6,.8,0,99],[53,'מפעלי ברזל ואלומיניום גדרה',4,4,1.6,.8,0,99],[54,'מסגריית אל־נור נצרת',2,4,1.2,.5,0,99],[55,'ח.ר. מבני פלדה',3,4,1.3,.8,4,99],
  [56,'פחחות דיוק',1,5,1.8,.6,0,99],[57,'שילוט רקיע',4,13,1.4,.5,0,99],[58,'ארגזי רכב השומרון',1,14,1.2,.6,0,99],[59,'מיזוג ותעלות חורב',3,15,2.4,1,0,99],[60,'תעלות אוויר סביון',1,15,1.8,.8,0,99],[61,'מטבחים תעשייתיים ברק',3,5,1,.5,0,99],
  [62,'מכונות חגי',2,6,2.2,.7,0,99],[63,'אוטומציה ירושלים',1,6,1.6,.5,0,99],[64,'רובוטיקה בקעת הירח',2,6,1.4,.6,1,99],[65,'מערכות ייצור ניר',3,6,1.8,.8,0,99],[66,'טכנו־קו מסועים',1,6,2,.7,0,99],[67,'נגב מיגון תעשייתי',4,6,1.3,.6,0,99],[68,'מספנת גליל ים',3,8,1,.9,0,99],
  [69,'מחסני אלומיניום באר שבע',4,7,3,1.5,0,99],[70,'אלו־מרכז שיווק',1,7,3.4,1.6,0,99],[71,'מרכז המתכת חדרה',3,7,2.6,1.3,0,99],[72,'מחסן הפרופיל קריות',2,7,2.4,1.2,0,99],
].map(([i, name, agent, trade, weight, size, from_m, to_m]) => ({ i, name, agent, trade, weight, size, from_m, to_m }));
const FAM = { sht1: [5, 40], sht2: [4, 34], plt: [1, 6], mar: [1, 5], trd: [3, 16], prf: [3, 14], pnt: [4, 20], ano: [3, 14], acp: [6, 40], col: [1, 2], tub: [8, 60], ang: [8, 60], flt: [8, 60], tee: [8, 50], chn: [8, 50], rod: [5, 40], tsl: [12, 120], acc: [1, 8] };
const TF = {};
for (const [t, l] of [[1,'tub:2 ang:1.5 sht2:.6 acc:.6'],[2,'tub:3 flt:2 ang:1'],[3,'acp:7 pnt:2.5 ano:1.5 ang:1.2 tub:1.4 sht2:.8'],[4,'tub:9 ang:5 flt:4 chn:3 tee:2 sht2:4 trd:2 plt:1 acc:1.2'],
  [5,'sht1:8 sht2:8 trd:3 prf:3 pnt:3 ano:1.5 ang:.6'],[6,'tsl:9 plt:6 rod:4 acc:3 sht2:2 flt:1.5'],[7,'tub:6 ang:4 flt:3 sht1:3 sht2:4 trd:2 chn:2 tee:1.5 tsl:1.5 col:.9'],
  [8,'mar:9 plt:4 ang:2 flt:2 tub:2'],[9,'tub:1 ang:1'],[10,'acp:3 ano:2 pnt:2 tub:1'],[11,'tub:3 flt:1.5 ang:1'],[12,'tub:5 flt:2 ang:1.5'],[13,'acp:7 sht1:3 pnt:4 tub:2 ang:1'],[14,'trd:8 sht2:4 ang:3 tub:2 flt:1'],[15,'sht1:10 sht2:3 ang:2 flt:1 col:.7']])
  TF[t] = Object.fromEntries(l.split(' ').map((x) => [x.split(':')[0], Number(x.split(':')[1])]));
const KIT = [
  ['WIN-45','WIN-45-FR-%',1,true],['WIN-45','WIN-45-SA-%',1.7,true],['WIN-45','WIN-45-MD-%',.6,true],['WIN-45','WIN-45-TR-%',.9,true],['WIN-45','ACC-RLR-45',.08,false],['WIN-45','ACC-LCK-45',.05,false],['WIN-45','GSK-BR-45',.04,false],['WIN-45','ACC-SCR-48',.03,false],
  ['WIN-60','WIN-60-FR-%',1,true],['WIN-60','WIN-60-SA-%',1.25,true],['WIN-60','WIN-60-MU-%',.3,true],['WIN-60','ACC-HNG-60',.05,false],['WIN-60','ACC-HDL-60',.05,false],['WIN-60','ACC-CRN-60',.04,false],['WIN-60','GSK-IN-60',.05,false],['WIN-60','GSK-OUT-60',.05,false],
  ['DOR-70','DOR-70-FR-%',1,true],['DOR-70','DOR-70-LF-%',.85,true],['DOR-70','DOR-70-TH-%',.2,true],['DOR-70','ACC-HNG-70',.06,false],['DOR-70','ACC-CLS-70',.04,false],
  ['CWL-50','CWL-50-MU-%',1,true],['CWL-50','CWL-50-TR-%',1.3,true],['CWL-50','CWL-50-PP-%',2.2,true],['CWL-50','CWL-50-CC-%',2.2,true],['CWL-50','GSK-CWL',.1,false],['CWL-50','ACC-BKT-CW',.08,false],['CWL-50','ACC-ANC-10',.06,false],
  ['PRG-A','PRG-12040-%',1,true],['PRG-A','SLT-10020-%',3.2,true],['PRG-A','ACC-SCR-48',.06,false],['PRG-B','PRG-15060-%',1,true],['PRG-B','LOU-120-%',4,true],['PRG-B','ACC-SCR-48',.06,false],['PRG-C','PRG-20060-%',1,true],['PRG-C','SLT-10020-%',3,true],['PRG-C','ACC-ANC-10',.05,false],
  ['RAL-G','RAL-BASE-%',1,true],['RAL-G','RAL-TOP-%',.6,true],['RAL-G','ACC-ANC-10',.1,false],['RAL-G','ACC-SIL',.03,false],['RAL-P','RAL-POST-%',1,true],['RAL-P','RAL-TOP-%',1.4,true],['RAL-P','ACC-RLG-PT',.12,false],['RAL-P','ACC-ANC-10',.1,false],
  ['FNC','FNC-10016-%',1,true],['FNC','RAL-POST-%',.16,true],['FNC','ACC-SCR-48',.04,false],
].map(([kit, part, ratio, must]) => ({ kit, part, ratio, must }));
const KS = { 'WIN-45': [6, 44], 'WIN-60': [6, 40], 'DOR-70': [4, 26], 'CWL-50': [8, 46], 'PRG-A': [3, 18], 'PRG-B': [3, 16], 'PRG-C': [2, 12], 'RAL-G': [4, 24], 'RAL-P': [6, 30], FNC: [10, 60] };
const TK = [[1,'WIN-45',.5,.9],[1,'WIN-60',.38,.9],[1,'DOR-70',.12,.9],[2,'RAL-G',.5,.9],[2,'RAL-P',.5,.9],[3,'CWL-50',.85,.55],[3,'WIN-60',.15,.55],[9,'DOR-70',.85,.9],[9,'WIN-60',.15,.9],[10,'WIN-60',.55,.75],[10,'DOR-70',.45,.75],[11,'PRG-A',.4,.9],[11,'PRG-B',.35,.9],[11,'PRG-C',.25,.9],[12,'FNC',1,.9]]
  .map(([trade, kit, w, p]) => ({ trade, kit, w, p }));
const famOf = (sku) => /^SHT-(1|1\.5)-/.test(sku) ? 'sht1' : /^SHT-(2|2\.5|3|4|5)-1/.test(sku) ? 'sht2' : /^SHT-(5083|6082)/.test(sku) ? 'mar' : /^SHT-TRD/.test(sku) ? 'trd' : /^SHT-PRF/.test(sku) ? 'prf'
  : /^SHT-(WH|GR|BK-2)/.test(sku) ? 'pnt' : /^SHT-(AN|BR|MIR|BK-15)/.test(sku) ? 'ano' : /^SHT-/.test(sku) ? 'plt' : /^ACP/.test(sku) ? 'acp' : /^COL/.test(sku) ? 'col' : /^TUB/.test(sku) ? 'tub'
  : /^ANG|^2A35/.test(sku) ? 'ang' : /^FLT/.test(sku) ? 'flt' : /^TEE/.test(sku) ? 'tee' : /^CHN|^2435/.test(sku) ? 'chn' : /^RND/.test(sku) ? 'rod' : /^PRF/.test(sku) ? 'tsl'
  : /^(WIN|FRM|DOR|CWL|PRG|SLT|LOU|RAL|FNC)/.test(sku) ? 'sys' : /^GSK/.test(sku) ? 'gsk' : /^(CUT|OIL|BLD|WLD|FLM)/.test(sku) ? 'con' : 'acc';
const POP = Object.fromEntries('SHT-1-1225:6 SHT-1.5-1225:7 SHT-2-1225:10 SHT-2-1530:7 SHT-2.5-1225:2.5 SHT-3-1225:9 SHT-3-1530:9 SHT-4-1530:6 SHT-5-1530:6 SHT-6-1530:5 SHT-8-1530:4 SHT-10-1530:4 SHT-12-1530:2.5 SHT-15-1530:2 SHT-20-1530:1.5 SHT-25-1530:1 SHT-30-1530:.6 SHT-5-2040:2 SHT-8-2040:1.5 SHT-10-2040:1.2 SHT-5083-6:3 SHT-5083-10:2 SHT-6082-20:1.5 TUB-2020:5 TUB-2525:6 TUB-3030:9 TUB-4040:12 TUB-4040-3:6 TUB-5050:10 TUB-5050-3:6 TUB-6060:5 TUB-8080:3 TUB-10010:1.5 TUB-5025:6 TUB-6030:8 TUB-8040:8 TUB-8040-3:5 TUB-10050:5 TUB-12060:3 TUB-15050:2 TUB-20050:1 TUB-25:4 TUB-30:4 TUB-40:4 TUB-50:5 TUB-60:3 TUB-80:2 TUB-100:1 TUB-4040-BK:4 TUB-5050-WH:3 TUB-8040-GR:3 ANG-4040:2 2A35Q4R:2 FLT-5005:2 FLT-4004:1.6 PRF-4040:3 PRF-3030:2 PRF-4080:1.6 PRF-2020:1.2 PRF-8080:.7 RND-80:.5 COL-1-1250:1.4 ACP-4-WH:3 ACP-4-GR:3 ACP-3-WH:2 ACC-SCR-48:3 ACC-RVT-48:3'.split(' ').map((x) => [x.split(':')[0], Number(x.split(':')[1])]));
const UNTIL = { 'SHT-BR-15': 5, 'SHT-MIR-1': 4 };
const PROD = [...P.values()].filter((p) => p.price !== null && (UNTIL[p.sku] ?? 99) >= M).map((p) => ({ id: p.id, sku: p.sku, unit: p.unit, price: p.price, fam: famOf(p.sku), pop: POP[p.sku] ?? 1 }));
{ const sum = {}; for (const p of PROD) sum[p.fam] = (sum[p.fam] ?? 0) + p.pop; for (const p of PROD) p.pop /= sum[p.fam]; }
const PROD_BY_SKU = new Map(PROD.map((p) => [p.sku, p]));
const soft = (q, u) => { const r = Math.max(1, Math.round(q)); if (u === 'מטר') return r; if (r >= 100 && random() < .3) return Math.round(r / 10) * 10; if (r >= 30 && random() < .25) return Math.round(r / 5) * 5; return r; };
const NOTE_S = ['פריקה עד 10:00','איסוף עצמי','להתקשר לפני שיוצאים','דחוף, העבודה עומדת','להעמיס אחרון, יורד ראשון','פריקה בכניסה האחורית','הלקוח שולח נהג','לתאם יום לפני','לא לפני 9','מלגזה אצל הלקוח'];
const NOTE_L = ['לתאם עם מנהל הפרויקט לפני הובלה','הובלה לאתר, יש מנוף','חשבונית לפי פרויקט','לספק לפי התקדמות האתר','לוודא גוון מול האצווה הקודמת','חיתוך לפי רשימה שנשלחה במייל','מנהל העבודה מאשר פריקה','קומה 9, יש מנוף עד 14:00'];

/** One job's lines, raw (before the sales factor), exactly as 03_orders.sql builds them. */
function basket(c) {
  const lines = [];
  const add = (sku, raw) => { const p = PROD_BY_SKU.get(sku); if (p && !lines.some((l) => l.p.id === p.id)) lines.push({ p, raw }); };
  const addKit = (k, colour, n, top) => {
    let made = 0; const most = 1 + Math.floor(random() * 3);
    for (const r of KIT.filter((x) => x.kit === k).sort(() => random() - .5)) {
      if (top) { if (made >= most) continue; } else if (!r.must && random() < .18) continue;
      add(r.part.replace('%', colour), n * r.ratio * (.92 + random() * .16)); made++;
    }
  };
  let j = Math.exp(0.6 * gauss()) * c.size;
  if (c.size >= 1.1 && random() < .03) j *= 4;
  j = Math.min(j, 3 + 5 * c.size);
  const tks = TK.filter((t) => t.trade === c.trade);
  if (tks.length && random() < tks[0].p) {
    const tk = wsample(tks, (t) => t.w, 1)[0].kit;
    const u = random(); const colour = u < .42 ? 'W' : u < .85 ? 'G' : 'B';
    const kc = /^(DOR|PRG|RAL|FNC)/.test(tk) && colour === 'B' ? 'G' : tk === 'CWL-50' && colour === 'W' ? 'G' : colour;
    const [lo, hi] = KS[tk]; const kn = (lo + random() * random() * (hi - lo)) * j;
    addKit(tk, kc, kn, random() < .28);
    if (c.trade === 1 && c.size >= .8 && random() < .14) addKit(tk === 'WIN-45' ? 'WIN-60' : 'WIN-45', colour, kn * .7, false);
    if (random() < .4) {
      const pool = PROD.filter((p) => TF[c.trade][p.fam] && p.fam !== 'col' && !lines.some((l) => l.p.id === p.id));
      for (const p of wsample(pool, (p) => TF[c.trade][p.fam] * p.pop, 1 + Math.floor(random() * 2))) { const [lo2, hi2] = FAM[p.fam]; lines.push({ p, raw: (lo2 + random() * random() * (hi2 - lo2)) * Math.min(j, 2) }); }
    }
  } else {
    const u = random();
    const nl = u < .24 ? 1 + Math.floor(random() * 2) : u < .72 ? 3 + Math.floor(random() * 4) : u < .94 ? 7 + Math.floor(random() * 6) : 13 + Math.floor(random() * 10);
    const pool = PROD.filter((p) => TF[c.trade][p.fam]);
    for (const p of wsample(pool, (p) => TF[c.trade][p.fam] * p.pop, nl)) { const [lo2, hi2] = FAM[p.fam]; lines.push({ p, raw: (lo2 + random() * random() * (hi2 - lo2)) * (p.fam === 'col' ? 1 : j) }); }
  }
  return lines;
}
const customers = CUST.filter((c) => M >= c.from_m && M <= c.to_m);
const pickCustomer = () => wsample(customers, (c) => c.weight, 1)[0];

// The seed scaled raw baskets to ₪42M a year; find the same factor from a large sample against the recent order worth.
{
  const save = random; random = mulberry32(99);
  let raw = 0, coil = 0; const n = 4000;
  for (let i = 0; i < n; i++) for (const l of basket(pickCustomer())) { if (l.p.fam === 'col') coil += Math.max(1, Math.round(l.raw)) * l.p.price; else raw += l.raw * l.p.price; }
  random = save;
  // Orders created August to October 2026 averaged ₪46,770 each (176,326 a day over 3.77 orders).
  var FACTOR = (46770 - coil / n) / (raw / n);
}

/* ───────── phones and the customers' habits from their own history ───────── */
const phoneOf = new Map();
for (const o of [...S.orders].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) if (o.customer_phone) phoneOf.set(o.customer, o.customer_phone);

/* ───────── pace of goods out per product, the last 365 days ───────── */
const yearAgo = Date.parse('2025-11-16T00:00:00+02:00');
const annual = new Map();
for (const m of S.movements) if (m.type === 'out' && Date.parse(m.created_at) >= yearAgo) annual.set(m.product_id, (annual.get(m.product_id) ?? 0) + Number(m.qty));

/* ───────── suppliers: calendars, gaps, last note numbers ───────── */
const GAP = { 'מתכות המרכז בע״מ': 14, 'שחר לוחות ומתכת': 14, 'הצפון אביזרים': 21, 'שיחולי הערבה בע״מ': 14, 'נמל מתכות יבוא ושיווק': 28, 'ציפויי גליל עליון': 14, 'קומפוזיט פאנל יבוא': 21, 'אטמי השפלה': 28, 'להב־טק כלי חיתוך': 45, 'גזית מחברים בע״מ': 28 };
const COMES = {
  'מתכות המרכז בע״מ': (d) => [1, 4].includes(dow(d)), 'ציפויי גליל עליון': (d) => [1, 4].includes(dow(d)), 'שחר לוחות ומתכת': (d) => dow(d) === 2,
  'הצפון אביזרים': (d) => [0, 3].includes(dow(d)), 'שיחולי הערבה בע״מ': (d) => [0, 3].includes(dow(d)),
  // The importers and the small makers come every few weeks; these are their next visits after the last ones on record.
  'נמל מתכות יבוא ושיווק': (d) => d === '2026-11-15', 'קומפוזיט פאנל יבוא': (d) => d === '2026-11-10', 'גזית מחברים בע״מ': (d) => d === '2026-11-09', 'אטמי השפלה': (d) => d === '2026-11-11', 'להב־טק כלי חיתוך': () => false,
};
const lastRef = new Map();
for (const m of S.movements) if (m.type === 'in' && m.reference) { const n = Number(m.reference.replace(/\D/g, '')); if (n > (lastRef.get(m.supplier_id) ?? 0)) lastRef.set(m.supplier_id, n); }
const extName = new Map();
for (const i of S.supplier_items) if (i.status === 'approved' && i.product_id) { const k = i.supplier_id + '|' + i.product_id; if (!extName.has(k) || i.created_at < extName.get(k).created_at) extName.set(k, i); }
// Where a product's goods go when they arrive: its fullest shelf, else where the product stands.
const shelvesOf = new Map();
for (const s of S.shelf_stock) (shelvesOf.get(s.product_id) ?? shelvesOf.set(s.product_id, []).get(s.product_id)).push(s);
const placeOf = (p) => { const s = (shelvesOf.get(p.id) ?? []).sort((a, b) => b.qty - a.qty)[0]; return s?.place ?? p.location ?? null; };

const kindOf = (p) => /^COL/.test(p.sku) ? 'col' : /^(CUT|OIL|BLD|WLD|FLM)/.test(p.sku) ? 'con' : ['SHT-BR-15', 'SHT-MIR-1'].includes(p.sku) ? 'dead' : 'std';
const lotOf = (p) => {
  const gap = GAP[SUP.get(p.primary_supplier_id)?.name] ?? 14; const a = annual.get(p.id) ?? 0; const k = kindOf(p);
  if (k === 'col') return 1;
  const step = p.unit === 'מטר' ? 60 : p.price >= 2000 ? 1 : /^(SHT|ACP)/.test(p.sku) ? 5 : /^GSK/.test(p.sku) ? 20 : p.unit === 'אריזה' ? 5 : k === 'con' ? 2 : 10;
  return Math.max(step, Math.ceil(a / 365 * gap / step) * step);
};
const daily = (p) => (annual.get(p.id) ?? 0) / 365;

/* ───────── people, as 04_ledger.sql picks them ───────── */
const DISPATCH = ['שחר אלמקאייס', 'דביר חיימוב', 'אביתר זגורי', 'סהר טולדנו', 'ליאל סויסה', 'מתן רוזנבלט', 'ניב לוצקי'].map(wid);
const RECV = ['יהלי קרסנטי', 'ניב לוצקי', 'מתן רוזנבלט', 'יהלי קרסנטי'].map(wid);
const COUNT = ['נועם נאמן', 'עידו פרידלנדר', 'יהלי קרסנטי', 'ניב לוצקי', 'מתן רוזנבלט', 'יהלי קרסנטי'].map(wid);
const OSHER = wid('אושר קלנטר');
const dispatcher = () => (random() < .025 ? null : random() < .1 ? OSHER : pick(DISPATCH));

/* ───────── the plan ───────── */
const orders = [];      // new orders
const deliveries = [];  // {order, at, worker, lines}
const cancels = [];
const trucks = [];      // {supplier, at, ref, worker, lines:[{p, qty, at, worker, place, ext}]}
const counts = [];      // {p, qty, at, worker, note}
const late = [];

// Open orders already in the database. The owner's own tests (not generated) stay as they are.
const open = S.orders.filter((o) => o.status === 'open' && o.id.startsWith('de200000-0000-')).map((o) => ({ ...o, lines: linesOf.get(o.id) ?? [], isNew: false }));
const shiftOf = () => { const u = random(); return u < .72 ? 0 : u < .85 ? -1 - Math.floor(random() * 2) : 1 + Math.floor(random() * random() * 5); };
for (const o of open) {
  let d = wd(o.promised_on, shiftOf());
  if (o.promised_on < FIRST) d = wd(addDays(FIRST, -1), 1 + Math.floor(random() * 3)); // late at the cut, caught up in the first days
  if (o.number === 903) d = '2026-11-04';
  if (d < FIRST) d = FIRST;
  o.due = d;
}

const reservedNow = (p) => p.reserved;
let orderSeq = 0, truckSeq = 0;
const nextNumber = (() => { let n = Math.max(...S.orders.map((o) => o.number)); return () => ++n; })();

for (const d of DAYS) {
  const dw = dow(d);
  if (dw === 6) continue;
  const friday = dw === 5;
  const dayStart = at(d, 0, 0);
  if (dayStart > CUTOFF) break;

  /* counts first thing, before the floor starts */
  if (!friday) {
    const n = poisson(2.06);
    const pool = [...P.values()].filter((p) => p.qty > 0 && kindOf(p) !== 'dead');
    let t = at(d, 390 + Math.floor(random() * 6));
    for (const p of wsample(pool, () => 1, n)) {
      t += (2 + Math.floor(random() * 9)) * 60000 + Math.floor(random() * 50000);
      if (t > CUTOFF) break;
      let q = p.qty;
      if (kindOf(p) === 'std' && p.price < 900 && random() < .12) q += 1 + Math.floor(random() * Math.max(1, p.qty * .01)); // found a little more than the books said
      counts.push({ p, qty: q, at: t, worker: pick(COUNT), note: 'ספירת מחזור' });
      p.qty = q;
    }
  }

  /* trucks: each supplier that comes today brings what fell under its mark */
  if (!friday) {
    const dueSoon = new Map(); // what open orders due in the next two working days need beyond the shelf
    for (const o of [...open, ...orders].filter((x) => !x.done && !x.cancelled && x.due && x.due <= wd(d, 2))) for (const l of o.lines) dueSoon.set(l.product_id, (dueSoon.get(l.product_id) ?? 0) + l.qty);
    for (const [name, comes] of Object.entries(COMES)) {
      if (!comes(d)) continue;
      const s = SUP_BY_NAME.get(name);
      // The buyer fills a truck on its day: whatever sits under its mark for the coming weeks rides along.
      const items = [];
      for (const p of [...P.values()].filter((x) => x.primary_supplier_id === s.id && kindOf(x) !== 'dead')) {
        const free = p.qty - p.reserved;
        const care = 0.55 + (parseInt(md5('care' + p.sku).slice(0, 4), 16) % 100) / 100 * 0.9; // some products are watched closer than others
        const top = Math.max(p.min_qty * K1, daily(p) * K2) * care;
        const lack = (dueSoon.get(p.id) ?? 0) - p.qty;
        if (free >= top && lack <= 0) continue;
        if ((annual.get(p.id) ?? 0) === 0 && p.reserved <= p.qty) continue;
        const lot = lotOf(p);
        const want = Math.max(top - free, lack);
        const q = lot * Math.max(1, Math.ceil(want / lot));
        items.push({ p, qty: q });
      }
      if (!items.length) continue;
      const start = 430 + (Math.abs(parseInt(md5(name + d).slice(0, 6), 16)) % 170);
      let t = at(d, start, 0);
      const worker0 = pick(RECV);
      const ref = (lastRef.get(s.id) ?? 1000) + 3 + (parseInt(md5(s.id + d).slice(0, 4), 16) % 14);
      lastRef.set(s.id, ref);
      const truck = { id: sid('de6', 100000 + ++truckSeq), supplier: s, ref: 'תעודה ' + ref, worker: worker0, lines: [] };
      for (const it of items.sort(() => random() - .5)) {
        t += (12 + Math.floor(random() * 40)) * 1000;
        truck.lines.push({ p: it.p, qty: it.qty, at: t, worker: random() < .7 ? worker0 : pick(RECV), place: placeOf(it.p), ext: extName.get(s.id + '|' + it.p.id)?.external_name ?? null });
      }
      truck.at = truck.lines[0].at;
      if (truck.lines.at(-1).at > CUTOFF) continue; // still on the road
      for (const l of truck.lines) l.p.qty += l.qty;
      trucks.push(truck);
    }
  }
  const arrivedToday = new Map();
  for (const tr of trucks.filter((x) => dayOf(x.at) === d)) for (const l of tr.lines) arrivedToday.set(l.p.id, Math.max(arrivedToday.get(l.p.id) ?? 0, l.at));

  /* deliveries: what is due today, if the shelf holds it */
  let due = [...open, ...orders].filter((o) => !o.done && !o.cancelled && o.due === d).sort((a, b) => a.number - b.number);
  // A working day with nothing due still sends something out: the next day's first orders leave early.
  if (!due.length && !friday) {
    for (const o of [...open, ...orders].filter((x) => !x.done && !x.cancelled && x.due === wd(d, 1)).sort((a, b) => a.number - b.number).slice(0, 1 + Math.floor(random() * 2))) o.due = d;
    due = [...open, ...orders].filter((o) => !o.done && !o.cancelled && o.due === d).sort((a, b) => a.number - b.number);
  }
  const slots = due.map(() => at(d, 420 + Math.floor(random() * (friday ? 280 : 560)))).sort((a, b) => a - b);
  for (const [i, o] of due.entries()) {
    let t = slots[i];
    const needsTruck = Math.max(0, ...o.lines.map((l) => arrivedToday.get(l.product_id) ?? 0));
    if (needsTruck && t < needsTruck + 15 * 60000) t = needsTruck + (15 + Math.floor(random() * 50)) * 60000;
    const short = o.lines.some((l) => P.get(l.product_id).qty < l.qty);
    if (short || t > CUTOFF) {
      if (short) { o.due = wd(d, 1); late.push({ o, day: d }); }
      continue;
    }
    for (const l of o.lines) { const p = P.get(l.product_id); p.qty -= l.qty; p.reserved -= l.qty; }
    o.done = true;
    deliveries.push({ order: o, at: t, worker: dispatcher() });
  }

  /* new orders through the day */
  const lam = 3.45 * 1.0 * (1 + 0.006 * M) * (friday ? 0.16 : dw === 4 ? 0.92 : dw === 0 ? 1.12 : 1);
  const n = poisson(lam);
  for (let k = 0; k < n; k++) {
    const c = pickCustomer();
    const created = at(d, 450 + Math.floor(random() * (friday ? 240 : 600)));
    if (created > CUTOFF) continue;
    const lead = random() < 0.3 ? 6 + Math.floor(random() * 18) : 1 + Math.floor(random() * random() * 7);
    const promised = wd(d, lead);
    let close = wd(promised, shiftOf());
    if (close <= d) close = wd(d, 1);
    const cancelled = random() < .04;
    const raw = basket(c);
    if (!raw.length) continue;
    const lines = raw.map((l) => ({ product_id: l.p.id, qty: l.p.fam === 'col' ? Math.max(1, Math.round(l.raw)) : soft(l.raw * FACTOR, l.p.unit), unit_price: l.p.price }));
    const o = {
      id: sid('de2', ++orderSeq), number: 0, customer: c.name, agent_id: AGENTS[c.agent - 1], customer_phone: phoneOf.get(c.name) ?? null,
      note: random() < 0.18 ? (lead <= 3 ? pick(NOTE_S) : pick(NOTE_L)) : null,
      created_at: created, promised_on: promised, due: close, lines, isNew: true,
    };
    orders.push(o);
    for (const l of lines) P.get(l.product_id).reserved += l.qty;
    if (cancelled) { const t = at(wd(d, 1 + Math.floor(random() * 2)), 480 + Math.floor(random() * 480)); o.cancelAt = t; }
  }
  // Cancellations whose day has come.
  for (const o of orders.filter((x) => x.cancelAt && !x.done && !x.cancelled && x.cancelAt <= Math.min(CUTOFF, at(d, 1439, 0)))) {
    o.cancelled = true; cancels.push(o);
    for (const l of o.lines) P.get(l.product_id).reserved -= l.qty;
  }
}

// Numbers follow the order in which orders came in, after the last number on record.
orders.sort((a, b) => a.created_at - b.created_at).forEach((o) => { o.number = nextNumber(); });
for (const o of orders) for (const [i, l] of o.lines.entries()) l.id = sid('de3', parseInt(o.id.slice(-6), 16) * 100 + i + 1);

/* ───────── faults: what the floor reported, and the two old ones somebody finally closed ───────── */
const fault = (o) => o;
const faults = [
  fault({ id: sid('de4', 1), sku: 'SHT-3-1225', description: 'פינה מקופלת בהובלה', reporter: 'יהלי קרסנטי', at: Date.parse('2026-11-04T08:17:42+02:00'), moved: 2, resolvedAt: Date.parse('2026-11-05T10:42:10+02:00'), resolution: 'נחתך לפורמט קטן והוחזר למלאי', by: 'עידו פרידלנדר' }),
  fault({ id: sid('de4', 2), asset: 'M-04', description: 'להב שחוק, חיתוך לא ישר', reporter: 'ליאל סויסה', at: Date.parse('2026-11-09T11:31:05+02:00'), resolvedAt: Date.parse('2026-11-09T15:06:48+02:00'), resolution: 'טכנאי תיקן במקום, המכונה חזרה לעבוד', by: 'נועם נאמן' }),
  fault({ id: sid('de4', 3), sku: 'WIN-60-FR-G', description: 'שריטות בצבע', reporter: 'דביר חיימוב', at: Date.parse('2026-11-12T13:22:19+02:00'), moved: 3, resolvedAt: Date.parse('2026-11-15T09:48:33+02:00'), resolution: 'הספק החליף בלי תשלום', by: 'נועם נאמן' }),
  fault({ id: sid('de4', 4), sku: 'TUB-6030', description: 'מוט כפוף בקצה', reporter: 'ניב לוצקי', at: Date.parse(`${TODAY}T09:41:27+02:00`), moved: 2 }),
  fault({ id: sid('de4', 5), asset: 'M-05', description: 'לחץ חנקן נמוך', reporter: 'שחר אלמקאייס', at: Date.parse(`${TODAY}T11:06:52+02:00`) }),
].filter((f) => f.at <= CUTOFF);
const closeOld = [
  { id: 'de400000-0000-4000-8000-00000000232b', resolvedAt: Date.parse('2026-11-03T10:38:14+02:00'), resolution: 'טכנאי תיקן במקום, המכונה חזרה לעבוד', by: 'נועם נאמן' },
  { id: 'de400000-0000-4000-8000-00000000232a', resolvedAt: Date.parse('2026-11-04T09:21:40+02:00'), resolution: 'נבדק, תקין לשימוש', by: 'יהלי קרסנטי' },
];

/* ───────── checks before anything is written ───────── */
// Replay every touched product from the start, in time order; nothing may go under zero, and it must land where the simulation did.
const events = [];
for (const c of counts) events.push({ t: c.at, p: c.p.id, kind: 'adjust', qty: c.qty });
for (const tr of trucks) for (const l of tr.lines) events.push({ t: l.at, p: l.p.id, kind: 'in', qty: l.qty });
for (const dv of deliveries) for (const l of dv.order.lines) events.push({ t: dv.at, p: l.product_id, kind: 'out', qty: l.qty });
events.sort((a, b) => a.t - b.t || (a.kind === 'adjust' ? -1 : 0));
const bal = new Map([...START].map(([id, s]) => [id, s.qty]));
const problems = [];
for (const e of events) {
  const b = bal.get(e.p);
  if (e.kind === 'adjust') { if (e.qty < b) problems.push(['count lower', e]); bal.set(e.p, e.qty); }
  else if (e.kind === 'in') bal.set(e.p, b + e.qty);
  else { if (b - e.qty < 0) problems.push(['under zero', P.get(e.p).sku, e]); bal.set(e.p, b - e.qty); }
}
for (const [id, b] of bal) if (Math.abs(b - P.get(id).qty) > 1e-9) problems.push(['drift', P.get(id).sku, b, P.get(id).qty]);
if (events.some((e) => e.t > CUTOFF)) problems.push(['future']);

/* ───────── summary ───────── */
const worth = (id, q) => q * (P.get(id).price ?? 0);
const byDay = {};
const g = (d) => (byDay[d] ??= { ord: 0, ordW: 0, del: 0, delW: 0, trucks: 0, inL: 0, inW: 0, cnt: 0 });
for (const o of orders) { const x = g(dayOf(o.created_at)); x.ord++; x.ordW += o.lines.reduce((s, l) => s + l.qty * l.unit_price, 0); }
for (const dv of deliveries) { const x = g(dayOf(dv.at)); x.del++; x.delW += dv.order.lines.reduce((s, l) => s + worth(l.product_id, l.qty), 0); }
for (const tr of trucks) { const x = g(dayOf(tr.at)); x.trucks++; x.inL += tr.lines.length; x.inW += tr.lines.reduce((s, l) => s + worth(l.p.id, l.qty), 0); }
for (const c of counts) g(dayOf(c.at)).cnt++;
const stockW = (m) => [...P.values()].reduce((s, p) => s + (m ? START.get(p.id).qty : p.qty) * (p.price ?? 0), 0);
const states = { short: [], out: [], low: [] };
for (const p of P.values()) { const free = p.qty - p.reserved; if (free < 0) states.short.push(p.sku); else if (p.qty <= 0) states.out.push(p.sku); else if (p.min_qty > 0 && free < p.min_qty) states.low.push(p.sku); }
const stillOpen = [...open, ...orders].filter((o) => !o.done && !o.cancelled);
if (!process.argv.includes('--score')) console.log(JSON.stringify({ cutoff: iso(CUTOFF), today: TODAY, factor: +FACTOR.toFixed(3), problems: problems.slice(0, 8), nProblems: problems.length,
  days: Object.fromEntries(Object.entries(byDay).sort().map(([d, x]) => [d, `ord ${x.ord} ₪${Math.round(x.ordW / 1000)}K · del ${x.del} ₪${Math.round(x.delW / 1000)}K · trucks ${x.trucks}/${x.inL} ₪${Math.round(x.inW / 1000)}K · cnt ${x.cnt}`])),
  stock: { before: Math.round(stockW(true)), after: Math.round(stockW(false)) }, states, late: late.map((l) => `${l.o.number}@${l.day}`),
  open: stillOpen.sort((a, b) => (a.promised_on < b.promised_on ? -1 : 1)).map((o) => `${o.number} ${o.promised_on} due ${o.due}`), cancels: cancels.map((o) => o.number), faults: faults.length }, null, 1));

if (process.argv.includes('--score')) {
  const wk = (from, to, f) => Object.entries(byDay).filter(([d]) => d >= from && d <= to).reduce((s, [, x]) => s + f(x), 0);
  const outNow = wk('2026-11-10', TODAY, (x) => x.delW), outBefore = wk('2026-11-03', '2026-11-09', (x) => x.delW);
  const inNow = wk('2026-11-10', TODAY, (x) => x.inW), inBefore = wk('2026-11-03', '2026-11-09', (x) => x.inW);
  const t = byDay[TODAY] ?? {};
  const maxDel = Math.max(...Object.values(byDay).map((x) => x.del));
  const openW = stillOpen.reduce((s, o) => s + o.lines.reduce((a, l) => a + l.qty * (l.unit_price ?? 0), 0), 0);
  console.error(JSON.stringify({ seed: SEED, problems: problems.length, todayDel: t.del ?? 0, todayTrucks: t.trucks ?? 0, todayOrd: t.ord ?? 0, todayCnt: t.cnt ?? 0,
    outPct: Math.round((outNow / outBefore - 1) * 100), inPct: Math.round((inNow / inBefore - 1) * 100), maxDel, late: new Set(late.map((l) => l.o.id)).size,
    short: states.short.length, out: states.out.length, low: states.low.length, openW: Math.round(openW), stock: Math.round(stockW(false)), lateOpen: stillOpen.filter((o) => o.promised_on < TODAY).length, inLines: trucks.reduce((a, t) => a + t.lines.length, 0), todayIn: t.inL ?? 0, zeroDays: Object.entries(byDay).filter(([d, x]) => dow(d) < 5 && x.del === 0).length, nTrucks: trucks.length, k1: K1, k2: K2 }));
  process.exit(0);
}
/* ───────── write the plan ───────── */
const docOut = (dv) => ({ id: sid('de6', parseInt(dv.order.id.slice(-6), 16) + (dv.order.isNew ? 0 : 50000)), kind: 'out', at: dv.at - (20 + Math.floor(random() * 70)) * 1000 });
const plan = {
  cutoff: iso(CUTOFF), start: Object.fromEntries([...START].filter(([id]) => events.some((e) => e.p === id) || orders.some((o) => o.lines.some((l) => l.product_id === id)) || deliveries.some((d) => d.order.lines.some((l) => l.product_id === id))).map(([id, s]) => [id, s])),
  orders: orders.map((o) => ({ id: o.id, number: o.number, request_id: uuidOf('live-1116-' + o.id), agent_id: o.agent_id, customer: o.customer, customer_phone: o.customer_phone, note: o.note, created_at: iso(o.created_at), promised_on: o.promised_on, lines: o.lines.map((l) => ({ id: l.id, product_id: l.product_id, qty: l.qty, unit_price: l.unit_price })) })),
  cancels: cancels.map((o) => ({ id: o.id, at: iso(o.cancelAt) })),
  deliveries: deliveries.map((dv) => {
    const doc = docOut(dv);
    return { order_id: dv.order.id, number: dv.order.number, customer: dv.order.customer, agent: AGENT_NAME.get(dv.order.agent_id), phone: dv.order.customer_phone, note: dv.order.note, at: iso(dv.at), worker: dv.worker,
      doc: { id: doc.id, created_at: iso(doc.at), path: `out/${dv.at - 41000}-${md5('live1116' + dv.order.id).slice(0, 6)}.jpg` },
      lines: dv.order.lines.map((l, i) => ({ line_id: l.id, product_id: l.product_id, qty: l.qty, mid: sid('de1', (parseInt(dv.order.id.slice(-6), 16) + (dv.order.isNew ? 0 : 50000)) * 100 + i + 1) })) };
  }),
  trucks: trucks.map((tr, k) => ({ supplier_id: tr.supplier.id, supplier: tr.supplier.name, ref: tr.ref, worker: tr.worker,
    doc: { id: tr.id, created_at: iso(tr.at - (30 + Math.floor(random() * 90)) * 1000), path: `in/${tr.at - 55000}-${md5('live1116' + tr.supplier.id + tr.ref).slice(0, 6)}.jpg` },
    lines: tr.lines.map((l, i) => ({ mid: sid('de1', 900000 + k * 100 + i + 1), product_id: l.p.id, qty: l.qty, at: iso(l.at), worker: l.worker, place: l.place, ext: l.ext })) })),
  counts: counts.map((c, i) => ({ mid: sid('de1', 950000 + i + 1), product_id: c.p.id, qty: c.qty, at: iso(c.at), worker: c.worker, note: c.note })),
  faults: faults.map((f) => ({ id: f.id, product_id: f.sku ? BY_SKU.get(f.sku).id : null, asset: f.asset ?? null, description: f.description, reporter: wid(f.reporter), at: iso(f.at),
    movement: f.moved ? { mid: sid('de1', 990000 + parseInt(f.id.slice(-4), 16)), qty: f.moved } : null,
    resolved: f.resolvedAt && f.resolvedAt <= CUTOFF ? { at: iso(f.resolvedAt), resolution: f.resolution, by: f.by } : null })),
  closeOld: closeOld.map((f) => ({ ...f, resolvedAt: iso(f.resolvedAt) })),
};
fs.writeFileSync('plan.json', JSON.stringify(plan, null, 1));
