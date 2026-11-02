"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ProductThumb } from "@/components/app/Viz";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { useData, type Product } from "@/lib/store";
import { useCurrentWorker, useReceiptUpload } from "@/lib/worker-store";
import type { ScannedLine } from "@/lib/worker/ocr";
import { useDocumentScan, type ReadLine } from "@/lib/worker/scan";
import { buildDictionary, matchLine, type Candidate } from "@/lib/worker/match";
import { fmtName, fmtQty } from "@/lib/format";
import { buildMapModel } from "@/lib/map3d/model";
import { placeWords, resolvePlace } from "@/lib/map3d/place";
import { useShelves } from "@/lib/map3d/shelves";
import { suggestPlaces, WHY_WORD } from "@/lib/map3d/suggest";
import { Boot, CameraButton, Cta, Done, Flow, Hint, Picker, Row, Section, StepHead, Summary, pointAt, productPick, useBackToClose, useSteps, type PickItem, type SummaryLine } from "@/components/worker";
import { useFloorObjects } from "@/components/map3d/use-floor-objects";
import { PlaceSheet } from "@/components/worker/PlaceSheet";
import { Scanner } from "@/components/worker/Scanner";

type Step = "start" | "lines" | "place" | "summary" | "done";

/** One part of a line and where it was put away. */
type Stored = { place: string; qty: number };

type Line = {
  id: string;
  externalName: string;
  /** Supplier's SKU, when the note printed one. */
  sku?: string | null;
  /** What the model thinks this line is, for the worker to confirm. */
  suggestedId?: string;
  productId: string | null;
  /** The worker chose "לא יודע": keep for the manager, don't receive. */
  unknown: boolean;
  qty: number;
  scanned: boolean;
  /** Where it went. More than one when a delivery didn't fit on one shelf; the first takes what the others leave. */
  stored: Stored[];
};

const ORDER: readonly Step[] = ["start", "lines", "place", "summary", "done"];
const STEPS = [
  { key: "start", label: "ספק" },
  { key: "lines", label: "שורות" },
  { key: "place", label: "מיקום" },
  { key: "summary", label: "אישור" },
];

const newLine = (partial: Partial<Line> = {}): Line => ({
  id: Math.random().toString(36).slice(2), externalName: "", productId: null, unknown: false, qty: 1, scanned: false, stored: [], ...partial,
});

/** A supplier missing from the list must never stop the worker: it's added here and the manager sees it. */
function AddSupplier({ onSubmit, onClose }: { onSubmit: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useBackToClose(onClose);
  const save = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await onSubmit(name.trim());
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  return (
    <div className="wk-sheet" role="dialog" aria-modal="true" aria-label="הוספת ספק">
      <div className="wk-sheet-inner">
        <StepHead title="הוספת ספק" onBack={onClose} />
        <div className="wk-sheet-form">
          <Input id="new-supplier" size="touch" label="שם הספק" aria-required placeholder="לדוגמה: מתכות המרכז" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          {failed ? <Hint tone="attention" title="לא נשמר. לבדוק אינטרנט וללחוץ שוב." /> : null}
          <div className="wk-sheet-actions">
            <Cta label="הוספת ספק" onClick={save} busy={busy ? "מוסיף את הספק" : null} blocked={name.trim() ? null : { reason: "חסר שם ספק", onTap: () => document.getElementById("new-supplier")?.focus() }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ReceivePage() {
  const router = useRouter();
  const { state, receive, createSupplier, createSupplierItem, resolveSupplierName, suggestSupplierNames, product } = useData();
  const { worker, ready } = useCurrentWorker();
  const { step, dir, go } = useSteps(ORDER, "start");
  const { scan, start: startScan, close: closeScan } = useDocumentScan();
  const receipt = useReceiptUpload("in");
  const { rows: shelfRows, usual } = useShelves();
  const floor = useFloorObjects();

  const [supplierId, setSupplierId] = useState("");
  const [pickSupplier, setPickSupplier] = useState(false);
  const [addSupplier, setAddSupplier] = useState(false);
  const [reference, setReference] = useState("");
  const [mode, setMode] = useState<"photo" | "manual" | null>(null);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  /** How many lines the last reading produced; null when nothing was read. */
  const [readCount, setReadCount] = useState<number | null>(null);
  /** Work lines on the note (delivery, cutting…): noted, never received into stock. */
  const [services, setServices] = useState<ScannedLine[]>([]);
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [pickProductFor, setPickProductFor] = useState<string | null>(null);
  /** The line the place sheet is open for: a new place, or the one at `part`. */
  const [pickPlaceFor, setPickPlaceFor] = useState<{ lineId: string; part: number; rack?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ received: SummaryLine[]; pending: SummaryLine[] } | null>(null);
  /** Lines already saved, so retrying after a failure never receives one twice. */
  const saved = useRef(new Map<string, SummaryLine>());
  const savedParts = useRef(new Set<string>());

  useEffect(() => {
    if (ready && !worker) router.replace("/worker");
  }, [ready, worker, router]);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  const supplier = state.suppliers.find((s) => s.id === supplierId);

  const supplierItems = useMemo<PickItem[]>(() => state.suppliers.map((s) => ({ id: s.id, title: s.name, sub: s.contact ?? undefined })), [state.suppliers]);
  const productItems = useMemo<PickItem[]>(() => state.products.map((p) => productPick(p)), [state.products]);

  const dictionary = useMemo(() => buildDictionary(state.products, state.supplierItems, state.itemRequests), [state.products, state.supplierItems, state.itemRequests]);
  const shelfModel = useMemo(() => buildMapModel(state.products, floor, shelfRows), [state.products, floor, shelfRows]);

  /* ── photo ── */
  const onPhoto = useCallback((file: File | undefined) => {
    if (!file) return;
    setMode("photo");
    setReadCount(null);
    setPhoto((prev) => { if (prev) URL.revokeObjectURL(prev.url); return { file, url: URL.createObjectURL(file) }; });
    void startScan(file, { dictionary, products: state.products, supplierId });
  }, [dictionary, startScan, state.products, supplierId]);

  const startUpload = () => { if (photo) receipt.start(photo.file); };

  /* ── lines ── */
  // Another product is another answer: where the last one went says nothing about this one.
  const patch = (id: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...p, ...("productId" in p && p.productId !== l.productId ? { stored: [] } : {}) } : l)));
  const removeLine = (id: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));
  const placesText = (l: Line) => (l.stored.length > 0 ? l.stored.map((part) => placeWords(part.place, floor)).join(", ") : undefined);

  /** For a typed name: auto-map from the dictionary unless the worker chose a product by hand. */
  const resolution = (l: Line) => resolveSupplierName(supplierId, l.externalName);
  const dictionaryMatch = (l: Line) => matchLine(dictionary, l.externalName, l.sku, supplierId);
  const effectiveProduct = (l: Line): Product | undefined => {
    if (l.productId) return product(l.productId);
    const r = resolution(l);
    if (r.product) return r.product;
    const m = dictionaryMatch(l);
    return m.status === "sure" ? product(m.productId) : undefined;
  };
  /** Products the line resembles, for the worker to confirm with one tap. */
  const candidatesFor = (l: Line): Candidate[] => {
    const m = dictionaryMatch(l);
    if (m.status === "near") return m.candidates;
    return l.suggestedId ? [{ productId: l.suggestedId, alias: null }] : [];
  };

  const validLines = lines.filter((l) => l.externalName.trim() && l.qty > 0);
  const toReceive = validLines.filter((l) => effectiveProduct(l));
  const toReview = validLines.filter((l) => !effectiveProduct(l));
  const openLines = validLines.filter((l) => !effectiveProduct(l) && !l.unknown);

  /* ── places ── */
  /** The first part takes what the others leave, so a line always adds up to its quantity. */
  const partsOf = (l: Line): Stored[] => {
    if (l.stored.length === 0) return [];
    const others = l.stored.slice(1).reduce((sum, part) => sum + part.qty, 0);
    return [{ place: l.stored[0].place, qty: l.qty - others }, ...l.stored.slice(1)];
  };
  // Without the shelves the step has nothing to offer, and the receipt must not stop for it.
  const placing = shelfRows !== null;
  const unplaced = placing ? toReceive.filter((l) => l.stored.length === 0) : [];
  const badSplit = placing ? toReceive.filter((l) => partsOf(l).some((part) => part.qty <= 0)) : [];
  const suggestionsFor = (p: Product) => suggestPlaces(p, shelfRows ?? [], usual, floor);
  /** The usual place of every line that has one and has no answer yet. */
  const usualLines = unplaced.flatMap((l) => {
    const best = suggestionsFor(effectiveProduct(l)!).find((suggestion) => !suggestion.rackOnly);
    return best ? [{ line: l, place: best.place }] : [];
  });
  const setPart = (lineId: string, part: number, place: string) =>
    setLines((ls) => ls.map((l) => {
      if (l.id !== lineId) return l;
      const stored = [...l.stored];
      if (part < stored.length) stored[part] = { ...stored[part], place };
      else stored.push({ place, qty: part === 0 ? l.qty : 1 });
      return { ...l, stored: stored.filter((row, i) => i === stored.findIndex((other) => other.place === row.place)) };
    }));
  const setPartQty = (lineId: string, part: number, qty: number) =>
    setLines((ls) => ls.map((l) => (l.id === lineId ? { ...l, stored: l.stored.map((row, i) => (i === part ? { ...row, qty } : row)) } : l)));
  const removePart = (lineId: string, part: number) =>
    setLines((ls) => ls.map((l) => (l.id === lineId ? { ...l, stored: l.stored.filter((_, i) => i !== part) } : l)));

  /** Reading finished and the worker agreed: the lines land on the lines step. */
  const takeReading = () => {
    if (scan.status !== "read") return;
    setServices(scan.services);
    setLines(scan.goods.length
      ? scan.goods.map((s) => newLine({ externalName: s.externalName, sku: s.externalSku, suggestedId: s.suggested, qty: Math.max(1, Math.round(s.qty)), scanned: true }))
      : [newLine()]);
    setReadCount(scan.goods.length + scan.services.length);
    closeScan();
    startUpload();
    go("lines");
  };
  const fillByHand = () => {
    setMode("manual");
    closeScan();
    startUpload();
    go("lines");
  };
  const identify = (l: ReadLine): Product | undefined => {
    const r = resolveSupplierName(supplierId, l.externalName);
    return r.product ?? (l.match.status === "sure" ? product(l.match.productId) : undefined);
  };

  /* ── submit ── */
  const submit = async () => {
    if (!worker || !supplier) return;
    setBusy(true);
    setError(null);
    const servicesNote = services.length ? `עבודות: ${services.map((sv) => `${sv.externalName}${sv.qty !== 1 ? ` ×${sv.qty}` : ""}`).join(", ")}` : "";
    const documentId = photo ? await receipt.save(photo.file, { supplierId, reference: reference.trim() || null, workerId: worker.id }) : null;
    const photoNote = documentId ? "תעודה צולמה" : photo ? "תעודה צולמה (ההעלאה נכשלה)" : "";
    const note = [photoNote, servicesNote].filter(Boolean).join(" · ") || null;
    setProgress(saved.current.size);
    try {
      for (const l of toReceive) {
        if (saved.current.has(l.id)) continue;
        const p = effectiveProduct(l)!;
        // A line split over two shelves is two receipts, each of a place. One that failed halfway doesn't repeat what landed.
        const parts = partsOf(l);
        const each: (Stored | null)[] = parts.length > 0 ? parts : [null];
        for (let i = 0; i < each.length; i++) {
          const part = each[i];
          const mark = `${l.id}#${i}`;
          if (savedParts.current.has(mark)) continue;
          await receive({ productId: p.id, qty: part?.qty ?? l.qty, supplierId, workerId: worker.id, reference: reference.trim() || null, note, externalName: l.externalName.trim(), documentId, place: part?.place ?? null });
          savedParts.current.add(mark);
        }
        saved.current.set(l.id, { key: l.id, title: p.name, sub: placesText(l) ?? (l.externalName.trim() !== p.name ? l.externalName.trim() : undefined), qty: l.qty, unit: p.unit, product: p });
        setProgress(saved.current.size);
      }
      for (const l of toReview) {
        if (saved.current.has(l.id)) continue;
        const name = l.externalName.trim();
        if (resolution(l).status === "unknown") {
          await createSupplierItem({ supplier_id: supplierId, external_name: name, product_id: null, status: "pending" }).catch(() => undefined);
        }
        saved.current.set(l.id, { key: l.id, title: name, sub: "אצל המנהל", qty: l.qty });
        setProgress(saved.current.size);
      }
      const pick = (ls: Line[]) => ls.map((l) => saved.current.get(l.id)).filter((x): x is SummaryLine => !!x);
      setResult({ received: pick(toReceive), pending: pick(toReview) });
      go("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!ready || !worker) return <Boot />;

  if (step === "done" && result) {
    return (
      <Done
        title={result.received.length ? "הסחורה נקלטה" : "הועבר למנהל"}
        sub={supplier ? `מהספק: ${supplier.name}` : undefined}
        lines={[...result.received, ...result.pending]}
      />
    );
  }

  const back = () => {
    if (step === "start") router.replace("/worker");
    else if (step === "lines") go("start");
    else if (step === "place" || !placing || toReceive.length === 0) go("lines");
    else go("place");
  };

  const overlay = (
    <>
      {pickSupplier ? (
        <Picker
          title="בחירת ספק"
          items={supplierItems}
          placeholder="חיפוש לפי שם ספק"
          onPick={(id) => { setSupplierId(id); setPickSupplier(false); }}
          onClose={() => setPickSupplier(false)}
          emptyTitle="לא נמצאו ספקים"
          extra={{ label: "הוספת ספק", onClick: () => { setPickSupplier(false); setAddSupplier(true); } }}
        />
      ) : null}
      {addSupplier ? (
        <AddSupplier
          onClose={() => setAddSupplier(false)}
          onSubmit={async (name) => {
            const row = await createSupplier({ name });
            setSupplierId(row.id);
            setAddSupplier(false);
          }}
        />
      ) : null}
      {pickProductFor ? (
        <Picker
          title="בחירת מוצר מהמחסן"
          context={lines.find((l) => l.id === pickProductFor)?.externalName.trim() || undefined}
          items={productItems}
          placeholder='חיפוש לפי שם, מק"ט או ברקוד'
          onPick={(id) => { patch(pickProductFor, { productId: id, unknown: false }); setPickProductFor(null); }}
          onClose={() => setPickProductFor(null)}
          extra={{ label: "העברה למנהל", icon: "user", onClick: () => { patch(pickProductFor, { productId: null, unknown: true }); setPickProductFor(null); } }}
          emptyTitle="לא נמצאו מוצרים"
        />
      ) : null}
      {pickPlaceFor ? (() => {
        const line = lines.find((l) => l.id === pickPlaceFor.lineId);
        const p = line && effectiveProduct(line);
        if (!line || !p) return null;
        return (
          <PlaceSheet
            product={p}
            objects={floor}
            model={shelfModel}
            value={line.stored[pickPlaceFor.part]?.place ?? ""}
            rack={pickPlaceFor.rack}
            onPick={(place) => { setPart(line.id, pickPlaceFor.part, place); setPickPlaceFor(null); }}
            onClose={() => setPickPlaceFor(null)}
          />
        );
      })() : null}
      <Scanner scan={scan} docName="התעודה" unit={{ one: "שורה", many: "שורות" }} identify={identify} onContinue={takeReading} onManual={fillByHand} onRetake={onPhoto} onCancel={() => { closeScan(); setPhoto(null); setMode(null); }} />
    </>
  );

  /* ── step 1: supplier + note ── */
  if (step === "start") {
    const blocked = !supplierId
      ? { reason: "חסר ספק", onTap: () => pointAt("supplier") }
      : mode === null ? { reason: "חסר צילום או הקלדה", onTap: () => pointAt("method") } : null;
    return (
      <Flow
        flow="קליטת סחורה מספק"
        steps={STEPS}
        current="start"
        dir={dir}
        onBack={back}
        title="ממי קיבלת את הסחורה?"
        overlay={overlay}
        foot={{ label: "המשך לשורות", onClick: () => { startUpload(); go("lines"); }, blocked }}
      >
        <Section id="supplier" title="הספק" need="required" done={!!supplier}>
          <Row title={supplier ? supplier.name : "בחירת ספק"} selected={!!supplier} end={<Icon name="chevron-left" size={20} />} onClick={() => setPickSupplier(true)} />
        </Section>
        <Section id="method" title="איך ממלאים את השורות?" need="required" done={mode !== null}>
          {!supplier ? (
            <button type="button" className="wk-photo is-locked" onClick={() => pointAt("supplier")}>קודם בוחרים ספק</button>
          ) : photo ? (
            <>
              <div className="wk-shot">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="תצלום תעודת המשלוח" />
                <p className="wk-shot-text">
                  התעודה צולמה
                  <span>{readCount === null ? "לא נקראו שורות" : readCount === 1 ? "נקראה שורה אחת" : `נקראו ${readCount} שורות`}</span>
                </p>
              </div>
              <CameraButton quiet label="צילום מחדש" onFile={onPhoto} />
            </>
          ) : (
            <CameraButton quiet={mode === "manual"} label="צילום תעודת המשלוח" onFile={onPhoto} />
          )}
          {supplier ? <Row title="הקלדה ידנית" selected={mode === "manual"} onClick={() => setMode("manual")} /> : null}
        </Section>
        <Section id="reference" title="מספר תעודה" need="optional">
          <Input size="touch" aria-label="מספר תעודה" mono inputMode="numeric" placeholder="123456" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Section>
      </Flow>
    );
  }

  /* ── step 2: lines ── */
  if (step === "lines") {
    const scanned = lines.some((l) => l.scanned);
    const open = openLines.length;
    const blocked = open
      ? { reason: open === 1 ? "שורה אחת בלי תשובה" : `${open} שורות בלי תשובה`, onTap: () => pointAt(`line-${openLines[0].id}`) }
      : validLines.length === 0 ? { reason: "חסר שם מוצר", onTap: () => pointAt(`line-${lines[0].id}`) } : null;
    const lead = scanned && !open ? "לבדוק מוצרים וכמויות" : undefined;
    return (
      <Flow
        flow={`קליטת סחורה מ${supplier?.name ?? "הספק"}`}
        steps={STEPS}
        current="lines"
        dir={dir}
        onBack={back}
        title="מה הגיע מהספק?"
        lead={lead}
        overlay={overlay}
        foot={{ label: placing && toReceive.length > 0 ? "המשך למיקום" : "המשך לאישור", onClick: () => go(placing && toReceive.length > 0 ? "place" : "summary"), blocked }}
      >
        <div className="wk-lines">
          {lines.map((l, i) => {
            const r = resolution(l);
            const prod = effectiveProduct(l);
            const name = l.externalName.trim();
            const candidates = name && !prod && !l.unknown ? candidatesFor(l) : [];
            const suggestions = name && !prod && !l.unknown && !candidates.length ? suggestSupplierNames(supplierId, name, 5).filter((s) => s.external_name !== name) : [];
            const isOpen = !!name && !prod && !l.unknown;
            return (
              <article key={l.id} id={`line-${l.id}`} className="wk-line">
                <div className="wk-line-head">
                  <span className="wk-line-n">שורה {i + 1}</span>
                  <span className="wk-line-state">
                    {isOpen ? <Badge tone="warning">צריך תשובה</Badge> : prod ? <Badge tone="success">מוכן</Badge> : l.unknown ? <Badge tone="neutral">אצל המנהל</Badge> : null}
                  </span>
                  {lines.length > 1 ? (
                    <button type="button" className="wk-line-remove" aria-label={`הסרת שורה ${i + 1}`} onClick={() => removeLine(l.id)}>הסרה</button>
                  ) : null}
                </div>
                <Input
                  size="touch"
                  label={l.scanned ? "נקרא מהתעודה" : "שם המוצר בתעודה"}
                  placeholder="לדוגמה: פרופיל אלומיניום 40×40"
                  value={l.externalName}
                  autoComplete="off"
                  onChange={(e) => patch(l.id, { externalName: e.target.value, sku: null, suggestedId: undefined, productId: null, unknown: false })}
                />
                {suggestions.length ? (
                  <div className="wk-suggest" role="listbox" aria-label="הצעות מהמילון">
                    {suggestions.map((s) => (
                      <button key={s.id} type="button" role="option" aria-selected={false} onClick={() => patch(l.id, { externalName: s.external_name, productId: null, unknown: false })}>
                        <ProductThumb product={product(s.product_id)} small />
                        <span className="wk-suggest-text">
                          <span className="sa-truncate">{s.external_name}</span>
                          <span className="wk-suggest-sub sa-truncate">{product(s.product_id)?.name ?? ""}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {!name ? null : prod ? (
                  <>
                    <div className="wk-status">
                      <ProductThumb product={prod} small />
                      <span>זוהה: {prod.name}</span>
                      {r.status === "pending" && !l.productId ? <Badge tone="warning">ממתין לאישור</Badge> : null}
                    </div>
                    <button type="button" className="wk-textlink is-start" onClick={() => setPickProductFor(l.id)}>{l.productId ? "החלפת מוצר" : "זה מוצר אחר?"}</button>
                  </>
                ) : l.unknown ? (
                  <div className="wk-routed">
                    <span className="wk-routed-text">אצל המנהל, לא נכנס למלאי</span>
                    <button type="button" className="wk-textlink" onClick={() => patch(l.id, { unknown: false })}>שינוי</button>
                  </div>
                ) : (
                  <div className="wk-choices">
                    <p className="wk-ask">{candidates.length ? "זה המוצר?" : "לא מזוהה. מה עושים?"}</p>
                    <div className="wk-group">
                      {candidates.map((c) => {
                        const match = product(c.productId);
                        return match ? <Row key={c.productId} product={match} title={match.name} sub={c.alias && c.alias !== match.name ? `במילון: ${c.alias}` : match.sku} onClick={() => patch(l.id, { productId: match.id, unknown: false })} /> : null;
                      })}
                      <Row title={candidates.length ? "זה מוצר אחר מהמחסן" : "יש כזה במחסן"} end={<Icon name="chevron-left" size={20} />} onClick={() => setPickProductFor(l.id)} />
                      <Row title="העברה למנהל" end={<Icon name="user" size={20} />} onClick={() => patch(l.id, { productId: null, unknown: true })} />
                    </div>
                  </div>
                )}

                <div className="wk-qty-row">
                  <span className="wk-qty-label">כמות{prod?.unit ? ` (${prod.unit})` : ""}</span>
                  <QuantityStepper value={l.qty} min={1} onChange={(n) => patch(l.id, { qty: n })} />
                </div>
              </article>
            );
          })}
          <Row quiet title="הוספת שורה" onClick={() => setLines((ls) => [...ls, newLine()])} />
        </div>
        {services.length ? (
          <section className="wk-section">
            <p className="wk-ask">עבודות, לא נכנס למלאי</p>
            <div className="wk-group">
              {services.map((sv, i) => (
                <Row key={`${sv.externalName}-${i}`} title={sv.externalName} sub={sv.qty !== 1 ? `כמות: ${sv.qty}` : undefined} end="זה מוצר?" onClick={() => { setServices((list) => list.filter((_, j) => j !== i)); setLines((ls) => [...ls.filter((x) => x.externalName.trim()), newLine({ externalName: sv.externalName, qty: Math.max(1, Math.round(sv.qty)), scanned: true })]); }} />
              ))}
            </div>
          </section>
        ) : null}
      </Flow>
    );
  }

  /* ── step 3: where each line was put ── */
  if (step === "place") {
    const blocked = unplaced.length
      ? { reason: unplaced.length === 1 ? "חסר מיקום" : `חסר מיקום ל-${unplaced.length} שורות`, onTap: () => pointAt(`place-${unplaced[0].id}`) }
      : badSplit.length ? { reason: "הכמויות לא מסתדרות", onTap: () => pointAt(`place-${badSplit[0].id}`) } : null;
    return (
      <Flow
        flow={`קליטת סחורה מ${supplier?.name ?? "הספק"}`}
        steps={STEPS}
        current="place"
        dir={dir}
        onBack={back}
        title="איפה שמת?"
        overlay={overlay}
        foot={{ label: "המשך לאישור", onClick: () => go("summary"), blocked }}
      >
        {usualLines.length > 1 ? <Row title="הכול למקום הרגיל" sub={`${usualLines.length} שורות`} onClick={() => { for (const { line, place } of usualLines) setPart(line.id, 0, place); }} /> : null}
        <div className="wk-lines">
          {toReceive.map((l) => {
            const p = effectiveProduct(l)!;
            const parts = partsOf(l);
            const quick = suggestionsFor(p);
            return (
              <article key={l.id} id={`place-${l.id}`} className="wk-line">
                <div className="wk-place-head">
                  <ProductThumb product={p} small />
                  <span className="wk-place-name">{fmtName(p.name)}</span>
                  <span className="wk-place-qty"><span className="sa-num">{fmtQty(l.qty)}</span> {p.unit}</span>
                </div>
                {parts.length === 0 ? (
                  <div className="wk-group">
                    {quick.map(({ place, why, rackOnly }) => (
                      <Row
                        key={place}
                        title={placeWords(place, floor)}
                        sub={WHY_WORD[why]}
                        end={rackOnly ? <Icon name="chevron-left" size={20} /> : undefined}
                        onClick={() => (rackOnly ? setPickPlaceFor({ lineId: l.id, part: 0, rack: resolvePlace(place, floor)?.objectId }) : setPart(l.id, 0, place))}
                      />
                    ))}
                    <Row quiet={quick.length > 0} title={quick.length > 0 ? "מקום אחר" : "בחירת מקום"} end={quick.length > 0 ? undefined : <Icon name="chevron-left" size={20} />} onClick={() => setPickPlaceFor({ lineId: l.id, part: 0 })} />
                  </div>
                ) : (
                  <>
                    <div className="wk-group">
                      {parts.map((part, i) => (
                        <div key={part.place} className="wk-place-part">
                          <Row title={placeWords(part.place, floor)} selected={parts.length === 1} sub={parts.length > 1 && i === 0 ? <>נשארו כאן <span className="sa-num">{fmtQty(part.qty)}</span></> : undefined} end={parts.length > 1 ? undefined : <Icon name="check" size={20} />} onClick={() => setPickPlaceFor({ lineId: l.id, part: i })} />
                          {i > 0 ? (
                            <div className="wk-qty-row">
                              <button type="button" className="wk-textlink" onClick={() => removePart(l.id, i)}>הסרה</button>
                              <QuantityStepper value={part.qty} min={1} onChange={(n) => setPartQty(l.id, i, n)} />
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    {l.qty > parts.length ? <button type="button" className="wk-textlink is-start" onClick={() => setPickPlaceFor({ lineId: l.id, part: l.stored.length })}>חלק הלך למקום נוסף</button> : null}
                  </>
                )}
              </article>
            );
          })}
        </div>
      </Flow>
    );
  }

  /* ── step 4: summary ── */
  const receivedLines: SummaryLine[] = toReceive.map((l) => { const p = effectiveProduct(l)!; return { key: l.id, title: p.name, sub: placesText(l) ?? (l.externalName.trim() !== p.name ? l.externalName.trim() : undefined), qty: l.qty, unit: p.unit, product: p }; });
  const reviewLines: SummaryLine[] = toReview.map((l) => ({ key: l.id, title: l.externalName.trim(), qty: l.qty }));
  const total = toReceive.length + toReview.length;
  return (
    <Flow
      flow={`קליטת סחורה מ${supplier?.name ?? "הספק"}`}
      steps={STEPS}
      current="summary"
      dir={dir}
      onBack={back}
      title="בדיקה ואישור"
      lead="עדיין לא נשמר כלום"
      overlay={overlay}
      foot={{ label: toReceive.length ? "אישור הקליטה" : "העברה למנהל", onClick: submit, busy: busy ? (total > 1 ? `שומר ${Math.min(progress + 1, total)} מתוך ${total}` : "שומר") : null }}
    >
      {error ? <Hint tone="attention" title="לא נשמר. לבדוק אינטרנט וללחוץ שוב." /> : null}
      <Summary
        heading="פרטי הקליטה"
        meta={[
          { k: "ספק", v: supplier?.name },
          ...(reference.trim() ? [{ k: "תעודה", v: <span className="sa-num">{reference.trim()}</span> }] : []),
          ...(photo ? [{ k: "תמונה", v: "צולמה" }] : []),
        ]}
        lines={[]}
      />
      <Summary heading="נכנס למלאי" lines={receivedLines} direction="in" />
      <Summary heading="יועבר למנהל" lines={reviewLines} />
    </Flow>
  );
}
