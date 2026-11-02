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
import { fmtName, fmtQty } from "@/lib/format";
import { Boot, CameraButton, Cta, Done, Flow, Hint, Picker, Row, Section, StepHead, Summary, pointAt, productPick, useBackToClose, useSteps, type PickItem, type SummaryLine } from "@/components/worker";
import { Scanner } from "@/components/worker/Scanner";

type Step = "start" | "lines" | "summary" | "done";
/** `hint` is the wording read from the receipt. `candidates` are products it resembles, for the worker to confirm. `route` hands the line to the manager. */
type Line = { id: string; productId: string | null; qty: number; hint?: string; candidates?: Candidate[]; scanned?: boolean; route?: "manager" | "new"; proposedName?: string; workerNote?: string };

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
    return newLine({ productId: m.status === "sure" ? m.productId : null, qty: Math.max(1, Math.round(l.qty)), hint: l.externalName, candidates, scanned: true });
  }, [dictionary]);

  /* ── receipt photo: preview now, OCR to prefill lines, upload when continuing; with an order it is only attached ── */
  const onPhoto = useCallback((file: File | undefined) => {
    if (!file) return;
    setReadCount(null);
    setPhoto((prev) => { if (prev) URL.revokeObjectURL(prev.url); return { file, url: URL.createObjectURL(file) }; });
    if (!chosen) void startScan(file, { dictionary, products: state.products });
  }, [chosen, dictionary, startScan, state.products]);

  const startUpload = () => { if (photo) receipt.start(photo.file); };

  const removePhoto = () => {
    setPhoto(null);
    setReadCount(null);
    setServices([]);
    setLines((ls) => ls.filter((l) => !l.scanned).concat(ls.every((l) => l.scanned) ? [newLine()] : []));
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
  const removeLine = (id: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));
  const valid = lines.filter((l) => l.productId && l.qty > 0);
  const routed = lines.filter((l) => !l.productId && l.route && l.qty > 0);
  const open = lines.filter(unanswered).length;
  const name = customer.trim();

  /** A tap takes the order's customer too, so a second tap clears both and the other orders come back. A message about the last order no longer applies. */
  const chooseOrder = (order: OpenOrder | null) => {
    setChosen(order);
    setError(null);
    setCustomer(order?.customer ?? "");
  };
  /** An order belongs to its customer, so another name lets go of it. */
  const changeCustomer = (value: string) => {
    if (chosen && value.trim() !== name) chooseOrder(null);
    setCustomer(value);
  };
  const orderLines = (order: OpenOrder): SummaryLine[] => order.order_lines.map((l) => {
    const p = product(l.product_id);
    return { key: l.id, title: p ? fmtName(p.name) : "—", sub: p?.sku, qty: l.qty, unit: p?.unit, product: p };
  });

  /** Reading finished and the worker agreed: the lines land on the items step. */
  const takeReading = () => {
    if (scan.status !== "read") return;
    setServices(scan.services);
    setLines(scan.goods.length ? scan.goods.map((l) => scannedLine(l, l.suggested)) : [newLine()]);
    setReadCount(scan.goods.length + scan.services.length);
    closeScan();
    startUpload();
    go("lines");
  };
  const fillByHand = () => {
    closeScan();
    startUpload();
    go("lines");
  };
  const identify = (l: ReadLine) => (l.match.status === "sure" ? product(l.match.productId) : undefined);

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
      for (const l of routed) {
        if (saved.current.has(l.id)) continue;
        await createItemRequest({
          kind: l.route === "new" ? "new_product" : "unknown", externalName: l.hint ?? routedTitle(l), proposedName: l.proposedName ?? null,
          qty: l.qty, customer: name, note, workerNote: l.workerNote ?? null, workerId: worker.id, documentId,
        });
        saved.current.set(l.id, { key: l.id, title: routedTitle(l), sub: routedSub(l), qty: l.qty });
        setProgress(saved.current.size);
      }
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

  /** The database posts the whole order in one call, so there are no lines to guard on a retry. */
  const submitOrder = async () => {
    if (!worker || !chosen || !photo) return;
    setBusy(true);
    setError(null);
    try {
      const documentId = await receipt.save(photo.file, { customer: name, reference: `הזמנה ${chosen.number}`, workerId: worker.id });
      if (!documentId) throw new Error(RECEIPT_NOT_SAVED);
      await deliverOrder(chosen.id, worker.id, documentId);
      remember(name);
      setResult({ issued: orderLines(chosen), routed: [] });
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
          onPick={(id) => { patch(pickFor, { productId: id, route: undefined, proposedName: undefined, workerNote: undefined }); setPickFor(null); }}
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
      <Scanner scan={scan} docName="הקבלה" unit={{ one: "שורה", many: "שורות" }} identify={identify} onContinue={takeReading} onManual={fillByHand} onRetake={onPhoto} onCancel={() => { closeScan(); setPhoto(null); }} needsDocument />
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
          label: chosen ? "המשך לאישור" : "המשך לשורות",
          onClick: () => { startUpload(); go(chosen ? "summary" : "lines"); },
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
                  sub={`הזמנה ${o.number} · ${o.order_lines.length === 1 ? "שורה אחת" : `${o.order_lines.length} שורות`} · ${o.agents.name}`}
                  selected={o.id === chosen?.id}
                  onClick={() => chooseOrder(o.id === chosen?.id ? null : o)}
                />
              ))}
            </div>
          </Section>
        ) : null}
        <Section id="receipt" title="צילום הקבלה" need="required" done={!!photo} lead={chosen ? undefined : "השורות יתמלאו לבד"}>
          {!name ? (
            <button type="button" className="wk-photo is-locked" onClick={() => pointAt("customer")}>קודם שם לקוח</button>
          ) : photo ? (
            <>
              <div className="wk-shot">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="תצלום הקבלה" />
                <p className="wk-shot-text">
                  הקבלה צולמה
                  {chosen ? null : <span>{readCount === null ? "לא נקראו שורות" : readCount === 1 ? "נקראה שורה אחת" : `נקראו ${readCount} שורות`}</span>}
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
    const firstOpen = lines.find(unanswered);
    const lead = scanned && open === 0 ? "לבדוק מוצרים וכמויות" : undefined;
    const blocked = firstOpen
      ? { reason: open === 1 ? "שורה אחת בלי תשובה" : `${open} שורות בלי תשובה`, onTap: () => pointAt(`line-${firstOpen.id}`) }
      : valid.length + routed.length === 0 ? { reason: "לא נבחר מוצר", onTap: () => pointAt(`line-${lines[0].id}`) } : null;
    return (
      <Flow
        flow={`הוצאה ל${name}`}
        steps={STEPS}
        current="lines"
        dir={dir}
        onBack={back}
        title="מה מסרת ללקוח?"
        lead={lead}
        overlay={overlay}
        foot={{ label: "המשך לאישור", onClick: () => go("summary"), blocked }}
      >
        {state.products.length === 0 ? <Hint title="אין מוצרים במלאי" /> : null}
        <div className="wk-lines">
          {lines.map((l, i) => {
            const p = product(l.productId);
            const over = p ? l.qty > p.qty : false;
            const held = p && !over ? l.qty > p.qty - p.reserved : false;
            const unknown = !p && !!l.hint;
            return (
              <article key={l.id} id={`line-${l.id}`} className="wk-line">
                <div className="wk-line-head">
                  <span className="wk-line-n">שורה {i + 1}</span>
                  <span className="wk-line-state">
                    {unanswered(l) ? <Badge tone="warning">צריך תשובה</Badge> : over ? <Badge tone="warning">מעל המלאי</Badge> : p ? <Badge tone="success">מוכן</Badge> : l.route ? <Badge tone="neutral">אצל המנהל</Badge> : null}
                  </span>
                  {lines.length > 1 ? <button type="button" className="wk-line-remove" aria-label={`הסרת שורה ${i + 1}`} onClick={() => removeLine(l.id)}>הסרה</button> : null}
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
                    <p className="wk-ask">{l.candidates?.length ? "זה המוצר?" : "לא מזוהה. מה עושים?"}</p>
                    <div className="wk-group">
                      {l.candidates?.map((c) => {
                        const match = product(c.productId);
                        return match ? <Row key={c.productId} product={match} title={match.name} sub={c.alias && c.alias !== match.name ? `במילון: ${c.alias}` : match.sku} onClick={() => patch(l.id, { productId: match.id })} /> : null;
                      })}
                      <Row title={l.candidates?.length ? "זה מוצר אחר מהמחסן" : "יש כזה במחסן"} end={<Icon name="chevron-left" size={20} />} onClick={() => setPickFor(l.id)} />
                      <Row title="העברה למנהל" end={<Icon name="user" size={20} />} onClick={() => patch(l.id, { route: "manager" })} />
                      <Row title="מוצר חדש" end={<Icon name="chevron-left" size={20} />} onClick={() => setAddFor(l.id)} />
                    </div>
                  </div>
                ) : null}
                {!p && l.route ? (
                  <div className="wk-routed">
                    <span className="wk-routed-text">
                      {l.route === "new" ? "מוצר חדש, אצל המנהל" : "אצל המנהל"}
                      {l.proposedName && l.proposedName !== l.hint ? <span className="wk-row-sub">{l.proposedName}</span> : null}
                    </span>
                    <button type="button" className="wk-textlink" onClick={() => patch(l.id, { route: undefined, proposedName: undefined, workerNote: undefined })}>שינוי</button>
                  </div>
                ) : null}
                {p ? (
                  <div className={cx("wk-status", !over && !held && "is-muted")}>
                    {over || held ? <Dot tone="warning" /> : null}
                    <span>במלאי <span className="sa-num">{fmtQty(p.qty)}</span> {p.unit}{p.reserved > 0 ? <> · משוריין <span className="sa-num">{fmtQty(p.reserved)}</span></> : null}{over ? ", הכמות גדולה מהמלאי" : held ? ", חלק מהכמות משוריין" : ""}</span>
                  </div>
                ) : null}
                <div className="wk-qty-row">
                  <span className="wk-qty-label">כמות{p?.unit ? ` (${p.unit})` : ""}</span>
                  <QuantityStepper value={l.qty} min={1} onChange={(n) => patch(l.id, { qty: n })} />
                </div>
                {l.scanned && unanswered(l) ? <button type="button" className="wk-textlink is-start" onClick={() => toService(l)}>זו עבודה, לא מוצר</button> : null}
              </article>
            );
          })}
          <Row quiet title="הוספת שורה" onClick={() => setLines((ls) => [...ls, newLine()])} />
        </div>
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

  const issuedLines: SummaryLine[] = chosen ? orderLines(chosen) : valid.map((l) => { const p = product(l.productId)!; return { key: l.id, title: fmtName(p.name), sub: p.sku, qty: l.qty, unit: p.unit, product: p }; });
  const routedLines: SummaryLine[] = chosen ? [] : routed.map((l) => ({ key: l.id, title: routedTitle(l), sub: routedSub(l), qty: l.qty }));
  const leaving = chosen ? chosen.order_lines.map((l) => ({ productId: l.product_id, qty: l.qty })) : valid;
  const anyOver = leaving.some((l) => { const p = product(l.productId); return p ? l.qty > p.qty : false; });
  const total = chosen ? 1 : valid.length + routed.length;
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
      foot={{ label: chosen || valid.length ? "אישור ההוצאה" : "העברה למנהל", onClick: chosen ? submitOrder : submit, busy: busy ? (total > 1 ? `שומר ${Math.min(progress + 1, total)} מתוך ${total}` : "שומר") : null }}
    >
      {error ? <Hint tone="attention" title={HEBREW.test(error) ? error : "לא נשמר. לבדוק אינטרנט וללחוץ שוב."} /> : null}
      {anyOver ? <Hint tone="attention" title="הכמות גדולה מהמלאי" /> : null}
      <Summary
        heading="פרטי ההוצאה"
        meta={[
          { k: "לקוח", v: name },
          ...(chosen ? [{ k: "הזמנה", v: chosen.number }, { k: "סוכן", v: chosen.agents.name }] : []),
          ...(photo ? [{ k: "קבלה", v: "צולמה" }] : []),
          ...(services.length && !chosen ? [{ k: "עבודות", v: services.map((sv) => `${sv.externalName}${sv.qty !== 1 ? ` ×${sv.qty}` : ""}`).join(", ") }] : []),
        ]}
        lines={[]}
      />
      <Summary heading="יורד מהמלאי" lines={issuedLines} direction="out" />
      <Summary heading="יועבר למנהל" lines={routedLines} />
    </Flow>
  );
}
