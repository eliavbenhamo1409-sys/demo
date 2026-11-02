"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Dot } from "@/components/ui/Dot";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { cx } from "@/components/ui/cx";
import { useData } from "@/lib/store";
import { deliverOrder, useCurrentWorker, useOpenOrders, useRecentCustomers, useReceiptUpload, type OpenOrder } from "@/lib/worker-store";
import type { ScannedLine } from "@/lib/worker/ocr";
import { useDocumentScan, type ReadLine } from "@/lib/worker/scan";
import { buildDictionary, matchLine, type Candidate } from "@/lib/worker/match";
import { changeWords, compareOrder, rowChanges, rowOpen, type Answers, type OrderChange, type OrderRow } from "@/lib/worker/order-check";
import { fmtName, fmtPromised, fmtQty } from "@/lib/format";
import { Boot, CameraButton, Cta, Done, Flow, Hint, Picker, Row, Section, StepHead, Summary, pointAt, productPick, useBackToClose, useSteps, type PickItem, type SummaryLine } from "@/components/worker";
import { OrderRowCard } from "@/components/worker/OrderRowCard";
import { Scanner, type Compared } from "@/components/worker/Scanner";

type Step = "start" | "lines" | "summary" | "done";
/**
 * `hint` is the wording read from the receipt and `read` its figure. `candidates` are products it resembles, for the worker to confirm.
 * `route` hands the line to the manager; with an order, "gone" says it didn't leave and `confirmed` that it did. `added` is the worker's own line.
 */
type Line = { id: string; productId: string | null; qty: number; hint?: string; read?: number; candidates?: Candidate[]; scanned?: boolean; route?: "manager" | "new" | "gone"; confirmed?: boolean; added?: boolean; proposedName?: string; workerNote?: string };

const ORDER: readonly Step[] = ["start", "lines", "summary", "done"];
const STEPS = [
  { key: "start", label: "לקוח" },
  { key: "lines", label: "שורות" },
  { key: "summary", label: "אישור" },
];
const newLine = (partial: Partial<Line> = {}): Line => ({ id: Math.random().toString(36).slice(2), productId: null, qty: 1, ...partial });
const unanswered = (l: Line) => !!l.hint && !l.productId && !l.route;
const routedTitle = (l: Line) => l.proposedName ?? l.hint ?? "";
const routedSub = (l: Line) => (l.route === "new" ? "מוצר חדש, אצל המנהל" : "אצל המנהל");
/** A line that left, or didn't, off the order. */
const lineChange = (l: Line): OrderChange => {
  const manager = !!l.route && l.route !== "gone";
  return { product_id: manager ? null : l.productId, name: l.proposedName ?? l.hint ?? null, read: l.read ?? null, delivered: l.route === "gone" ? 0 : l.qty, manager };
};
/** The database refuses in Hebrew; anything else is the connection talking. */
const HEBREW = /[א-ת]/;
/** Nothing leaves without its receipt, so a photo that didn't land stops the save. */
const RECEIPT_NOT_SAVED = "הקבלה לא עלתה. לבדוק אינטרנט וללחוץ שוב.";

/** The worker asks to add a product to the warehouse dictionary; the manager approves it later. */
function AddToDictionary({ initialName, initialNote, onSubmit, onClose }: { initialName: string; initialNote: string; onSubmit: (name: string, note: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initialName);
  const [note, setNote] = useState(initialNote);
  useBackToClose(onClose);
  return (
    <div className="wk-sheet" role="dialog" aria-modal="true" aria-label="מוצר חדש">
      <div className="wk-sheet-inner">
        <StepHead title="מוצר חדש" onBack={onClose} />
        <p className="wk-sheet-lead">המנהל יאשר לפני שהכמות תרד מהמלאי</p>
        <div className="wk-sheet-form">
          <Input id="new-product" size="touch" label="שם המוצר" aria-required placeholder="לדוגמה: לוח אלומיניום 2 מ״מ" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <Input size="touch" label="הערה למנהל" optional placeholder="מידה, צבע" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
          <div className="wk-sheet-actions">
            <Cta label="העברה למנהל" onClick={() => onSubmit(name.trim(), note.trim())} blocked={name.trim() ? null : { reason: "חסר שם מוצר", onTap: () => document.getElementById("new-product")?.focus() }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DeliverPage() {
  const router = useRouter();
  const { state, issue, createItemRequest, product } = useData();
  const { worker, ready } = useCurrentWorker();
  const { recent, remember } = useRecentCustomers();
  const { step, dir, go } = useSteps(ORDER, "start");
  const { scan, start: startScan, close: closeScan } = useDocumentScan();
  const receipt = useReceiptUpload("out");
  const { orders, refresh } = useOpenOrders();

  const [customer, setCustomer] = useState("");
  /** The agent's order these goods leave under. It replaces the lines, so the stock can't drop twice. */
  const [chosen, setChosen] = useState<OpenOrder | null>(null);
  const [lines, setLines] = useState<Line[]>([newLine()]);
  /** What the worker said really left, per order line. */
  const [answers, setAnswers] = useState<Answers>({});
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [addFor, setAddFor] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  /** How many lines the last reading produced; null when nothing was read. */
  const [readCount, setReadCount] = useState<number | null>(null);
  /** Work lines read from the receipt (cutting, delivery…): recorded in the note, never deducted. */
  const [services, setServices] = useState<ScannedLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ issued: SummaryLine[]; routed: SummaryLine[] } | null>(null);
  /** Lines already saved, so retrying after a failure never issues or sends one twice. */
  const saved = useRef(new Map<string, SummaryLine>());

  useEffect(() => {
    if (ready && !worker) router.replace("/worker");
  }, [ready, worker, router]);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  const dictionary = useMemo(() => buildDictionary(state.products, state.supplierItems, state.itemRequests), [state.products, state.supplierItems, state.itemRequests]);

  /** A line read from the receipt: mapped when it's in the dictionary, otherwise the worker confirms what it resembles. */
  const scannedLine = useCallback((l: ScannedLine, suggested?: string) => {
    const m = matchLine(dictionary, l.externalName, l.externalSku);
    const candidates = m.status === "near" ? m.candidates : suggested ? [{ productId: suggested, alias: null }] : undefined;
    return newLine({ productId: m.status === "sure" ? m.productId : null, qty: Math.max(1, Math.round(l.qty)), read: l.qty, hint: l.externalName, candidates, scanned: true });
  }, [dictionary]);

  /** What the last photo said no longer stands. */
  const forgetReading = useCallback(() => {
    setReadCount(null);
    setServices([]);
    setAnswers({});
    setLines((ls) => ls.filter((l) => !l.scanned).concat(ls.every((l) => l.scanned) ? [newLine()] : []));
  }, []);

  /* ── receipt photo: preview now, OCR to prefill lines or to check the order, upload when continuing ── */
  const onPhoto = useCallback((file: File | undefined) => {
    if (!file) return;
    forgetReading();
    setPhoto((prev) => { if (prev) URL.revokeObjectURL(prev.url); return { file, url: URL.createObjectURL(file) }; });
    void startScan(file, { dictionary, products: state.products });
  }, [dictionary, forgetReading, startScan, state.products]);

  const startUpload = () => { if (photo) receipt.start(photo.file); };

  const removePhoto = () => {
    setPhoto(null);
    forgetReading();
  };

  const productItems = useMemo<PickItem[]>(() => state.products.map((p) => productPick(p, true)), [state.products]);

  const patch = (id: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)));
  /** The worker says a scanned line is work, not goods: move it to the services list. */
  const toService = (l: Line) => {
    setServices((sv) => [...sv, { externalName: l.hint ?? product(l.productId)?.name ?? "", qty: l.qty, kind: "service" }]);
    setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.id !== l.id) : [newLine()]));
  };
  /** The worker says a service line is actually goods: move it back as a line to map. */
  const toLine = (i: number) => {
    const sv = services[i];
    setServices((list) => list.filter((_, j) => j !== i));
    setLines((ls) => [...ls.filter((x) => x.productId || x.hint), scannedLine(sv)]);
  };
  const servicesNote = services.length ? ` · עבודות: ${services.map((sv) => `${sv.externalName}${sv.qty !== 1 ? ` ×${sv.qty}` : ""}`).join(", ")}` : "";
  const removeLine = (id: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : [newLine()]));
  const wasRead = readCount !== null;
  const rows = chosen ? compareOrder(chosen.order_lines, lines, answers, wasRead) : [];
  const onOrder = (productId: string | null) => rows.some((r) => r.productId === productId);
  /** With an order, the lines the order doesn't cover: a reading's, or one the worker added. */
  const shown = chosen ? lines.filter((l) => !onOrder(l.productId) && (l.hint || l.productId || l.added)) : lines;
  const valid = shown.filter((l) => l.productId && l.route !== "gone" && l.qty > 0);
  const routed = shown.filter((l) => !l.productId && l.route && l.route !== "gone" && l.qty > 0);
  /** With an order, a line off it waits for the worker to say whether it left. */
  const asks = (l: Line) => (chosen ? !!l.hint && !l.confirmed && !l.route : unanswered(l));
  const open = shown.filter(asks).length + rows.filter(rowOpen).length;
  const changes = [...rowChanges(rows, wasRead), ...(chosen ? shown.filter((l) => l.productId || l.hint).map(lineChange) : [])];
  const nothingLeft = !rows.some((r) => r.left) && valid.length === 0;
  /** With an order: the comparison has nothing more to ask, so the worker can go straight to the confirmation. */
  const settled = !!chosen && open === 0 && !nothingLeft;
  const verdict = !wasRead ? "לא נקראה" : changes.length ? `${changeWords(changes.length)} מול ההזמנה` : "תואמת להזמנה";
  const name = customer.trim();

  /** A tap takes the order's customer too, so a second tap clears both and the other orders come back. A message about the last order no longer applies. */
  const chooseOrder = (order: OpenOrder | null) => {
    setChosen(order);
    setError(null);
    setCustomer(order?.customer ?? "");
    setAnswers({});
    // Only an order asks whether a line left, so without one the question comes back as the line's own.
    if (!order) setLines((ls) => ls.map((l) => (l.route === "gone" ? { ...l, route: undefined } : l)));
  };
  /** An order belongs to its customer, so another name lets go of it. */
  const changeCustomer = (value: string) => {
    if (chosen && value.trim() !== name) chooseOrder(null);
    setCustomer(value);
  };
  const rowLine = (r: OrderRow): SummaryLine => {
    const p = product(r.productId);
    return { key: r.id, title: p ? fmtName(p.name) : "—", sub: r.left === r.ordered ? p?.sku : `בהזמנה ${fmtQty(r.ordered)}`, qty: r.left ?? r.ordered, unit: p?.unit, product: p };
  };
  const answer = (r: OrderRow, left: number) => setAnswers((a) => ({ ...a, [r.id]: { left, read: r.read } }));

  /** The reading against the chosen order, for the sheet that closes the scan. */
  const compared = useMemo<Compared | null>(() => {
    if (!chosen || scan.status !== "read") return null;
    const read = scan.goods.map((l) => scannedLine(l, l.suggested));
    const off = read.filter((l) => !chosen.order_lines.some((o) => o.product_id === l.productId));
    const against = compareOrder(chosen.order_lines, read, {}, true).filter((r) => r.state !== "waiting");
    const count = against.filter((r) => r.state !== "same").length + off.length;
    return {
      title: count ? `${changeWords(count)} מול ההזמנה` : "הקבלה תואמת להזמנה",
      lead: `הזמנה ${chosen.number}`,
      cta: count ? "מעבר לחריגות" : "המשך לאישור",
      rows: [
        ...against.map((r) => {
          const p = product(r.productId);
          return { key: r.id, name: p ? fmtName(p.name) : "—", sub: r.state === "same" ? "כמו בהזמנה" : r.state === "qty" ? `בהזמנה ${fmtQty(r.ordered)}` : "לא בקבלה", qty: r.read ?? undefined, product: p, fine: r.state === "same" };
        }),
        ...off.map((l) => ({ key: l.id, name: l.hint ?? "", sub: l.productId ? "לא בהזמנה" : "מחכה לתשובה שלך", qty: l.read, product: product(l.productId), fine: false })),
      ],
    };
  }, [chosen, product, scan, scannedLine]);

  /** Reading finished and the worker agreed: the lines land on the items step. */
  const takeReading = () => {
    if (scan.status !== "read") return;
    setServices(scan.services);
    setLines(scan.goods.length ? scan.goods.map((l) => scannedLine(l, l.suggested)) : [newLine()]);
    setReadCount(scan.goods.length + scan.services.length);
    setAnswers({});
    closeScan();
    startUpload();
    go("lines");
    // Nothing to mark: the comparison stays one step back, where a change can still be made.
    if (compared?.rows.every((r) => r.fine)) go("summary");
  };
  const fillByHand = () => {
    closeScan();
    startUpload();
    go("lines");
  };
  const identify = (l: ReadLine) => (l.match.status === "sure" ? product(l.match.productId) : undefined);

  /** Each line once, so a retry after a failure doesn't send it twice. */
  const sendRouted = async (note: string, documentId: string) => {
    if (!worker) return;
    for (const l of routed) {
      if (saved.current.has(l.id)) continue;
      await createItemRequest({
        kind: l.route === "new" ? "new_product" : "unknown", externalName: l.hint ?? routedTitle(l), proposedName: l.proposedName ?? null,
        qty: l.qty, customer: name, note, workerNote: l.workerNote ?? null, workerId: worker.id, documentId,
      });
      saved.current.set(l.id, { key: l.id, title: routedTitle(l), sub: routedSub(l), qty: l.qty });
      setProgress(saved.current.size);
    }
  };

  const submit = async () => {
    if (!worker || !photo) return;
    setBusy(true);
    setError(null);
    setProgress(saved.current.size);
    try {
      const documentId = await receipt.save(photo.file, { customer: name, workerId: worker.id });
      if (!documentId) throw new Error(RECEIPT_NOT_SAVED);
      const note = `ללקוח: ${name} · קבלה צולמה${servicesNote}`;
      for (const l of valid) {
        if (saved.current.has(l.id)) continue;
        const p = product(l.productId)!;
        await issue({ productId: p.id, qty: l.qty, workerId: worker.id, note, documentId });
        saved.current.set(l.id, { key: l.id, title: fmtName(p.name), sub: p.sku, qty: l.qty, unit: p.unit, product: p });
        setProgress(saved.current.size);
      }
      await sendRouted(note, documentId);
      remember(name);
      const pick = (ls: Line[]) => ls.map((l) => saved.current.get(l.id)).filter((x): x is SummaryLine => !!x);
      setResult({ issued: pick(valid), routed: pick(routed) });
      go("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** The database posts the whole order in one call, so only that call and the lines sent to the manager are guarded on a retry. */
  const submitOrder = async (issued: SummaryLine[], sent: SummaryLine[]) => {
    if (!worker || !chosen || !photo) return;
    setBusy(true);
    setError(null);
    setProgress(saved.current.size);
    try {
      const documentId = await receipt.save(photo.file, { customer: name, reference: `הזמנה ${chosen.number}`, workerId: worker.id });
      if (!documentId) throw new Error(RECEIPT_NOT_SAVED);
      if (!saved.current.has(chosen.id)) {
        await deliverOrder(chosen.id, worker.id, documentId, wasRead, changes);
        saved.current.set(chosen.id, { key: chosen.id, title: `הזמנה ${chosen.number}`, qty: 0 });
        setProgress(saved.current.size);
      }
      await sendRouted(`ללקוח: ${name} · הזמנה ${chosen.number}`, documentId);
      remember(name);
      setResult({ issued, routed: sent });
      go("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!ready || !worker) return <Boot />;
  if (step === "done" && result) {
    return (
      <Done
        title={chosen || result.issued.length ? "ההוצאה נשמרה" : "הועבר למנהל"}
        sub={chosen ? `הזמנה ${chosen.number} ללקוח: ${name}` : `ללקוח: ${name}`}
        lines={[...result.issued, ...result.routed]}
      />
    );
  }

  const back = () => {
    if (step === "start") router.replace("/worker");
    else if (step === "lines" || chosen) {
      // An order someone else closed meanwhile can't stay chosen.
      if (chosen && !orders.some((o) => o.id === chosen.id)) chooseOrder(null);
      go("start");
    } else go("lines");
  };

  const pickContext = lines.find((l) => l.id === pickFor)?.hint;
  const addLine = lines.find((l) => l.id === addFor);
  const overlay = (
    <>
      {pickFor ? (
        <Picker
          title="בחירת מוצר מהמחסן"
          context={pickContext}
          items={productItems}
          placeholder='חיפוש לפי שם, מק"ט או ברקוד'
          onPick={(id) => { patch(pickFor, { productId: id, route: undefined, proposedName: undefined, workerNote: undefined, confirmed: true }); setPickFor(null); }}
          onClose={() => setPickFor(null)}
          emptyTitle="לא נמצאו מוצרים"
          extra={{ label: "מוצר חדש", onClick: () => { setAddFor(pickFor); setPickFor(null); } }}
        />
      ) : null}
      {addFor && addLine ? (
        <AddToDictionary
          initialName={addLine.proposedName ?? addLine.hint ?? ""}
          initialNote={addLine.workerNote ?? ""}
          onClose={() => setAddFor(null)}
          onSubmit={(proposed, note) => { patch(addFor, { productId: null, route: "new", proposedName: proposed, workerNote: note || undefined, hint: addLine.hint ?? proposed }); setAddFor(null); }}
        />
      ) : null}
      <Scanner scan={scan} docName="הקבלה" unit={{ one: "שורה", many: "שורות" }} identify={identify} onContinue={takeReading} onManual={fillByHand} onRetake={onPhoto} onCancel={() => { closeScan(); setPhoto(null); }} needsDocument checking={!!chosen} compared={compared} />
    </>
  );

  if (step === "start") {
    const matching = orders.filter((o) => o.customer.toLowerCase().includes(name.toLowerCase()));
    return (
      <Flow
        flow="הוצאת סחורה ללקוח"
        steps={STEPS}
        current="start"
        dir={dir}
        onBack={back}
        title="למי מסרת את הסחורה?"
        overlay={overlay}
        foot={{
          label: !chosen ? "המשך לשורות" : settled ? "המשך לאישור" : "מעבר לחריגות",
          onClick: () => { startUpload(); go("lines"); if (settled) go("summary"); },
          blocked: !name ? { reason: "חסר שם לקוח", onTap: () => pointAt("customer") } : !photo ? { reason: "חסר צילום קבלה", onTap: () => pointAt("receipt") } : null,
        }}
      >
        <Section id="customer" title="שם הלקוח" need="required" done={!!name}>
          <Input size="touch" aria-label="שם הלקוח" placeholder="לדוגמה: מסגריית כהן" value={customer} onChange={(e) => changeCustomer(e.target.value)} autoComplete="off" />
          {recent.length ? (
            <div className="wk-recent-list">
              {recent.map((c) => <button key={c} type="button" className={cx("wk-recent-item", c === name && "is-selected")} onClick={() => changeCustomer(c)}>{c}</button>)}
            </div>
          ) : null}
        </Section>
        {matching.length ? (
          <Section title="הזמנות פתוחות" need="required">
            <div className="wk-group">
              {matching.map((o) => (
                <Row
                  key={o.id}
                  title={o.customer}
                  sub={`${o.promised_on ? `מסירה ${fmtPromised(o.promised_on)} · ` : ""}הזמנה ${o.number} · ${o.order_lines.length === 1 ? "שורה אחת" : `${o.order_lines.length} שורות`} · ${o.agents.name}`}
                  selected={o.id === chosen?.id}
                  onClick={() => chooseOrder(o.id === chosen?.id ? null : o)}
                />
              ))}
            </div>
          </Section>
        ) : null}
        <Section id="receipt" title="צילום הקבלה" need="required" done={!!photo} lead={chosen ? "נבדקת מול ההזמנה" : "השורות יתמלאו לבד"}>
          {!name ? (
            <button type="button" className="wk-photo is-locked" onClick={() => pointAt("customer")}>קודם שם לקוח</button>
          ) : photo ? (
            <>
              <div className="wk-shot">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="תצלום הקבלה" />
                <p className="wk-shot-text">
                  הקבלה צולמה
                  <span>{chosen ? verdict : readCount === null ? "לא נקראו שורות" : readCount === 1 ? "נקראה שורה אחת" : `נקראו ${readCount} שורות`}</span>
                </p>
                <button type="button" className="wk-textlink" onClick={removePhoto}>הסרה</button>
              </div>
              <CameraButton quiet label="צילום מחדש" onFile={onPhoto} />
            </>
          ) : (
            <CameraButton quiet label="צילום הקבלה" onFile={onPhoto} />
          )}
        </Section>
      </Flow>
    );
  }

  if (step === "lines") {
    const scanned = lines.some((l) => l.scanned);
    const firstOpen = rows.find(rowOpen) ?? shown.find(asks);
    const lead = chosen
      ? !wasRead ? "יורד לפי ההזמנה" : changes.length ? `${changeWords(changes.length)} מול ההזמנה` : undefined
      : scanned && open === 0 ? "לבדוק מוצרים וכמויות" : undefined;
    const blocked = firstOpen
      ? { reason: open === 1 ? "שורה אחת בלי תשובה" : `${open} שורות בלי תשובה`, onTap: () => pointAt(`line-${firstOpen.id}`) }
      : chosen
        ? nothingLeft ? { reason: "לא יצא כלום מההזמנה", onTap: () => pointAt(`line-${rows[0].id}`) } : null
        : valid.length + routed.length === 0 ? { reason: "לא נבחר מוצר", onTap: () => pointAt(`line-${lines[0].id}`) } : null;
    const same = rows.filter((r) => r.state === "same" && !answers[r.id]);
    return (
      <Flow
        flow={`הוצאה ל${name}`}
        steps={STEPS}
        current="lines"
        dir={dir}
        onBack={back}
        title={!chosen ? "מה מסרת ללקוח?" : !wasRead ? "הקבלה לא נקראה" : changes.length ? "מה יצא בפועל?" : "הקבלה תואמת להזמנה"}
        lead={lead}
        overlay={overlay}
        foot={{ label: "המשך לאישור", onClick: () => go("summary"), blocked }}
      >
        {state.products.length === 0 ? <Hint title="אין מוצרים במלאי" /> : null}
        <div className="wk-lines">
          {rows.filter((r) => r.state !== "waiting" && !same.includes(r)).map((r) => (
            <OrderRowCard key={r.id} row={r} product={product(r.productId)} wasRead={wasRead} onAnswer={(left) => answer(r, left)} />
          ))}
          {shown.map((l, i) => {
            const p = product(l.productId);
            const over = p ? l.qty > p.qty : false;
            const held = p && !over ? l.qty > p.qty - p.reserved : false;
            const unknown = !p && !!l.hint;
            const fromOrder = chosen ? l.candidates?.filter((c) => onOrder(c.productId)) : undefined;
            const candidates = fromOrder?.length ? fromOrder : l.candidates;
            return (
              <article key={l.id} id={`line-${l.id}`} className="wk-line">
                <div className="wk-line-head">
                  <span className="wk-line-n">{!chosen ? `שורה ${i + 1}` : fromOrder?.length ? "שם דומה" : "לא בהזמנה"}</span>
                  <span className="wk-line-state">
                    {asks(l) ? <Badge tone="warning">צריך תשובה</Badge> : l.route === "gone" ? <Badge tone="neutral">לא יצא</Badge> : over ? <Badge tone="warning">מעל המלאי</Badge> : p ? <Badge tone="success">מוכן</Badge> : l.route ? <Badge tone="neutral">אצל המנהל</Badge> : null}
                  </span>
                  {(chosen ? !l.hint : lines.length > 1) ? <button type="button" className="wk-line-remove" aria-label={`הסרת שורה ${i + 1}`} onClick={() => removeLine(l.id)}>הסרה</button> : null}
                </div>
                {unknown ? (
                  <div className="wk-receipt">
                    <span className="wk-receipt-k">{l.scanned ? "כתוב בקבלה" : "שורה"}</span>
                    <span className="wk-receipt-name">{l.hint}</span>
                  </div>
                ) : (
                  <Row
                    product={p}
                    title={p ? fmtName(p.name) : "בחירת מוצר"}
                    sub={p ? <><span className="sa-num">{p.sku}</span>{l.hint ? ` · בקבלה: ${l.hint}` : ""}</> : undefined}
                    selected={!!p}
                    end={<Icon name="chevron-left" size={20} />}
                    onClick={() => setPickFor(l.id)}
                  />
                )}
                {unanswered(l) ? (
                  <div className="wk-choices">
                    <p className="wk-ask">{candidates?.length ? "זה המוצר?" : "לא מזוהה. מה עושים?"}</p>
                    <div className="wk-group">
                      {candidates?.map((c) => {
                        const match = product(c.productId);
                        return match ? <Row key={c.productId} product={match} title={match.name} sub={c.alias && c.alias !== match.name ? `במילון: ${c.alias}` : match.sku} onClick={() => patch(l.id, { productId: match.id, confirmed: true })} /> : null;
                      })}
                      <Row title={candidates?.length ? "זה מוצר אחר מהמחסן" : "יש כזה במחסן"} end={<Icon name="chevron-left" size={20} />} onClick={() => setPickFor(l.id)} />
                      <Row title="העברה למנהל" end={<Icon name="user" size={20} />} onClick={() => patch(l.id, { route: "manager" })} />
                      <Row title="מוצר חדש" end={<Icon name="chevron-left" size={20} />} onClick={() => setAddFor(l.id)} />
                      {chosen ? <Row title="לא יצא" onClick={() => patch(l.id, { route: "gone" })} /> : null}
                    </div>
                  </div>
                ) : null}
                {chosen && p && asks(l) ? (
                  <div className="wk-choices">
                    <p className="wk-ask">יצא ללקוח?</p>
                    <div className="wk-group">
                      <Row title="יצא" onClick={() => patch(l.id, { confirmed: true })} />
                      <Row title="לא יצא" onClick={() => patch(l.id, { route: "gone" })} />
                    </div>
                  </div>
                ) : null}
                {l.route && (!p || l.route === "gone") ? (
                  <div className="wk-routed">
                    <span className="wk-routed-text">
                      {l.route === "gone" ? "לא יצא" : l.route === "new" ? "מוצר חדש, אצל המנהל" : "אצל המנהל"}
                      {l.proposedName && l.proposedName !== l.hint ? <span className="wk-row-sub">{l.proposedName}</span> : null}
                    </span>
                    <button type="button" className="wk-textlink" onClick={() => patch(l.id, { route: undefined, proposedName: undefined, workerNote: undefined })}>שינוי</button>
                  </div>
                ) : null}
                {p && l.route !== "gone" ? (
                  <div className={cx("wk-status", !over && !held && "is-muted")}>
                    {over || held ? <Dot tone="warning" /> : null}
                    <span>במלאי <span className="sa-num">{fmtQty(p.qty)}</span> {p.unit}{p.reserved > 0 ? <> · משוריין <span className="sa-num">{fmtQty(p.reserved)}</span></> : null}{over ? ", הכמות גדולה מהמלאי" : held ? ", חלק מהכמות משוריין" : ""}</span>
                  </div>
                ) : null}
                {l.route === "gone" ? null : (
                  <div className="wk-qty-row">
                    <span className="wk-qty-label">כמות{p?.unit ? ` (${p.unit})` : ""}</span>
                    <QuantityStepper value={l.qty} min={1} onChange={(n) => patch(l.id, { qty: n })} />
                  </div>
                )}
                {l.scanned && unanswered(l) ? <button type="button" className="wk-textlink is-start" onClick={() => toService(l)}>זו עבודה, לא מוצר</button> : null}
              </article>
            );
          })}
          <Row quiet title="הוספת שורה" onClick={() => setLines((ls) => [...ls, newLine({ added: true })])} />
        </div>
        {same.length ? (
          <section className="wk-section">
            <p className="wk-ask">{wasRead ? "תואם להזמנה" : "לפי ההזמנה"}</p>
            <div className="wk-group">
              {same.map((r) => {
                const p = product(r.productId);
                return <Row key={r.id} product={p} title={p ? fmtName(p.name) : "—"} sub={`${fmtQty(r.ordered)} ${p?.unit ?? ""}`} end="שינוי" onClick={() => answer(r, r.ordered)} />;
              })}
            </div>
          </section>
        ) : null}
        {services.length ? (
          <section className="wk-section">
            <p className="wk-ask">עבודות, לא יורד מהמלאי</p>
            <div className="wk-group">
              {services.map((sv, i) => (
                <Row key={`${sv.externalName}-${i}`} title={sv.externalName} sub={sv.qty !== 1 ? `כמות: ${sv.qty}` : undefined} end="זה מוצר?" onClick={() => toLine(i)} />
              ))}
            </div>
          </section>
        ) : null}
      </Flow>
    );
  }

  const issuedLines: SummaryLine[] = [
    ...rows.filter((r) => r.left !== 0).map(rowLine),
    ...valid.map((l) => { const p = product(l.productId)!; return { key: l.id, title: fmtName(p.name), sub: chosen ? "לא בהזמנה" : p.sku, qty: l.qty, unit: p.unit, product: p }; }),
  ];
  const routedLines: SummaryLine[] = routed.map((l) => ({ key: l.id, title: routedTitle(l), sub: routedSub(l), qty: l.qty }));
  /** What the order or the receipt named and didn't leave. */
  const stayedLines: SummaryLine[] = [
    ...rows.filter((r) => r.left === 0).map(rowLine),
    ...shown.filter((l) => l.route === "gone").map((l) => ({ key: l.id, title: l.hint ?? "", sub: l.read === undefined ? undefined : `בקבלה ${fmtQty(l.read)}`, qty: 0 })),
  ];
  const leaving = chosen ? [...rows.map((r) => ({ productId: r.productId, qty: r.left ?? r.ordered })), ...valid] : valid;
  const anyOver = leaving.some((l) => { const p = product(l.productId); return p ? l.qty > p.qty : false; });
  const total = (chosen ? 1 : valid.length) + routed.length;
  return (
    <Flow
      flow={`הוצאה ל${name}`}
      steps={STEPS}
      current="summary"
      dir={dir}
      onBack={back}
      title="בדיקה ואישור"
      lead="עדיין לא נשמר כלום"
      overlay={overlay}
      foot={{ label: chosen || valid.length ? "אישור ההוצאה" : "העברה למנהל", onClick: chosen ? () => void submitOrder(issuedLines, routedLines) : submit, busy: busy ? (total > 1 ? `שומר ${Math.min(progress + 1, total)} מתוך ${total}` : "שומר") : null }}
    >
      {error ? <Hint tone="attention" title={HEBREW.test(error) ? error : "לא נשמר. לבדוק אינטרנט וללחוץ שוב."} /> : null}
      {anyOver ? <Hint tone="attention" title="הכמות גדולה מהמלאי" /> : null}
      <Summary
        heading="פרטי ההוצאה"
        meta={[
          { k: "לקוח", v: name },
          ...(chosen ? [{ k: "הזמנה", v: chosen.number }, { k: "סוכן", v: chosen.agents.name }] : []),
          ...(photo ? [{ k: "קבלה", v: chosen ? verdict : "צולמה" }] : []),
          ...(services.length && !chosen ? [{ k: "עבודות", v: services.map((sv) => `${sv.externalName}${sv.qty !== 1 ? ` ×${sv.qty}` : ""}`).join(", ") }] : []),
        ]}
        lines={[]}
      />
      <Summary heading="יורד מהמלאי" lines={issuedLines} direction="out" />
      <Summary heading="לא יצא" lines={stayedLines} />
      <Summary heading="יועבר למנהל" lines={routedLines} />
    </Flow>
  );
}
