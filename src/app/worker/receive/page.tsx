"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { Stepper } from "@/components/ui/Stepper";
import { Badge } from "@/components/ui/Badge";
import { useData, type Product } from "@/lib/store";
import { useCurrentWorker, uploadDeliveryNote, DELIVERY_NOTES_BUCKET } from "@/lib/worker-store";
import { parseDeliveryNote } from "@/lib/worker/ocr";
import { Done, Foot, Picker, Row, StepHead, Summary, type PickItem, type SummaryLine } from "@/components/worker";

type Step = "start" | "lines" | "summary" | "done";

type Line = {
  id: string;
  externalName: string;
  productId: string | null;
  /** The worker chose "לא יודע": keep for the manager, don't receive. */
  unknown: boolean;
  qty: number;
  scanned: boolean;
};

const STEPS = [
  { key: "start", label: "ספק ותעודה" },
  { key: "lines", label: "שורות" },
  { key: "summary", label: "אישור" },
];

const newLine = (partial: Partial<Line> = {}): Line => ({
  id: Math.random().toString(36).slice(2), externalName: "", productId: null, unknown: false, qty: 1, scanned: false, ...partial,
});

export default function ReceivePage() {
  const router = useRouter();
  const { state, receive, createSupplierItem, resolveSupplierName, suggestSupplierNames, product } = useData();
  const { worker, ready } = useCurrentWorker();

  const [step, setStep] = useState<Step>("start");
  const [supplierId, setSupplierId] = useState("");
  const [pickSupplier, setPickSupplier] = useState(false);
  const [reference, setReference] = useState("");
  const [mode, setMode] = useState<"photo" | "manual" | null>(null);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [pickProductFor, setPickProductFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ received: SummaryLine[]; pending: SummaryLine[] } | null>(null);

  useEffect(() => {
    if (ready && !worker) router.replace("/worker");
  }, [ready, worker, router]);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  const supplier = state.suppliers.find((s) => s.id === supplierId);

  const supplierItems = useMemo<PickItem[]>(() => state.suppliers.map((s) => ({ id: s.id, title: s.name, sub: s.contact ?? undefined })), [state.suppliers]);
  const productItems = useMemo<PickItem[]>(
    () => state.products.map((p) => ({ id: p.id, title: p.name, sub: `${p.sku}${p.barcode ? ` · ${p.barcode}` : ""}`, keywords: `${p.sku} ${p.barcode ?? ""}`, end: <span className="sa-num">{p.qty}</span> })),
    [state.products],
  );

  /* ── photo ── */
  const onPhoto = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setMode("photo");
    setUploadError(null);
    setStoragePath(null);
    setPhoto((prev) => { if (prev) URL.revokeObjectURL(prev.url); return { file, url: URL.createObjectURL(file) }; });
    // The OCR hook: when a model reads the note, its lines land here for the worker to confirm.
    setScanning(true);
    try {
      const scanned = await parseDeliveryNote(file);
      if (scanned.length) setLines(scanned.map((s) => newLine({ externalName: s.externalName, qty: Math.max(1, Math.round(s.qty)), scanned: true })));
    } finally {
      setScanning(false);
    }
  }, []);

  const startUpload = useCallback(async () => {
    if (!photo || !supplierId || storagePath) return;
    try {
      setStoragePath(await uploadDeliveryNote(photo.file, supplierId));
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    }
  }, [photo, supplierId, storagePath]);

  /* ── lines ── */
  const patch = (id: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const removeLine = (id: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));

  /** For a typed name: auto-map from the dictionary unless the worker chose a product by hand. */
  const resolution = (l: Line) => resolveSupplierName(supplierId, l.externalName);
  const effectiveProduct = (l: Line): Product | undefined => {
    if (l.productId) return product(l.productId);
    const r = resolution(l);
    return r.product ?? undefined;
  };

  const validLines = lines.filter((l) => l.externalName.trim() && l.qty > 0);
  const toReceive = validLines.filter((l) => effectiveProduct(l));
  const toReview = validLines.filter((l) => !effectiveProduct(l));
  const canContinue = validLines.length > 0 && validLines.every((l) => effectiveProduct(l) || l.unknown);

  /* ── submit ── */
  const submit = async () => {
    if (!worker || !supplier) return;
    setBusy(true);
    setError(null);
    const note = storagePath ? `תעודה צולמה · ${DELIVERY_NOTES_BUCKET}/${storagePath}` : photo ? "תעודה צולמה (ההעלאה נכשלה)" : null;
    const received: SummaryLine[] = [];
    const pending: SummaryLine[] = [];
    try {
      for (const l of toReceive) {
        const p = effectiveProduct(l)!;
        await receive({ productId: p.id, qty: l.qty, supplierId, workerId: worker.id, reference: reference.trim() || null, note, externalName: l.externalName.trim() });
        received.push({ key: l.id, title: p.name, sub: l.externalName.trim() !== p.name ? l.externalName.trim() : undefined, qty: l.qty, unit: p.unit });
      }
      for (const l of toReview) {
        const name = l.externalName.trim();
        if (resolution(l).status === "unknown") {
          await createSupplierItem({ supplier_id: supplierId, external_name: name, product_id: null, status: "pending" }).catch(() => undefined);
        }
        pending.push({ key: l.id, title: name, sub: "לבדיקת מנהל", qty: l.qty });
      }
      setResult({ received, pending });
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!ready || !worker) return null;

  if (step === "done" && result) {
    return (
      <Done
        title="נקלט"
        sub={result.pending.length ? `${result.pending.length} שורות הועברו לבדיקת מנהל` : supplier?.name}
        lines={[...result.received, ...result.pending]}
      />
    );
  }

  const back = () => {
    if (step === "start") router.push("/worker");
    else if (step === "lines") setStep("start");
    else setStep("lines");
  };

  /* ── step 1: supplier + note ── */
  if (step === "start") {
    const canNext = !!supplierId && mode !== null;
    return (
      <main className="wk-page">
        <StepHead title="קיבלתי סחורה" step={1} total={3} onBack={back} />
        <Stepper steps={STEPS} current="start" />
        <section className="wk-stack">
          <span className="sa-label">ספק</span>
          {state.suppliers.length === 0 ? (
            <Notice tone="neutral" title="אין ספקים במערכת">מנהל יוסיף ספקים בלוח הניהול.</Notice>
          ) : (
            <Row title={supplier ? supplier.name : "בחר ספק"} sub={supplier ? undefined : "רשימה עם חיפוש"} selected={!!supplier} end={<Icon name="chevron-left" size={18} />} onClick={() => setPickSupplier(true)} />
          )}
        </section>
        <section className="wk-stack">
          <span className="sa-label">תעודת משלוח</span>
          <label className="wk-photo">
            <input type="file" accept="image/*" capture="environment" onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = ""; }} aria-label="צלם את התעודה" />
            <Icon name="camera" />
            {photo ? "צלם שוב" : "צלם את התעודה"}
          </label>
          {photo ? (
            <div className="wk-preview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="תצלום תעודת המשלוח" />
            </div>
          ) : null}
          {scanning ? <Notice tone="neutral" title="קורא את התעודה…" /> : null}
          <Row title="הקלדה ידנית" sub="אכתוב את השורות בעצמי" selected={mode === "manual"} icon="edit" onClick={() => setMode("manual")} />
          <Input size="touch" label="מספר תעודה" optional mono inputMode="numeric" placeholder="123456" value={reference} onChange={(e) => setReference(e.target.value)} />
        </section>
        <Foot>
          <Button variant="primary" size="touch" iconEnd="arrow-left" disabled={!canNext} onClick={() => { void startUpload(); setStep("lines"); }}>
            המשך לשורות
          </Button>
        </Foot>
        {pickSupplier ? (
          <Picker title="בחר ספק" items={supplierItems} placeholder="חיפוש ספק…" onPick={(id) => { setSupplierId(id); setPickSupplier(false); }} onClose={() => setPickSupplier(false)} emptyTitle="לא נמצא ספק" />
        ) : null}
      </main>
    );
  }

  /* ── step 2: lines ── */
  if (step === "lines") {
    return (
      <main className="wk-page">
        <StepHead title={supplier?.name ?? "שורות"} step={2} total={3} onBack={back} />
        <Stepper steps={STEPS} current="lines" />
        {uploadError ? (
          <Notice tone="warning" title="התמונה לא הועלתה" onDismiss={() => setUploadError(null)}>הקליטה תישמר בלי התמונה. {uploadError}</Notice>
        ) : null}
        {lines.some((l) => l.scanned) ? (
          <Notice tone="accent" title="השורות נקראו מהתעודה">בדוק כל שורה ואשר את הכמויות.</Notice>
        ) : null}
        <div className="wk-stack">
          {lines.map((l, i) => {
            const r = resolution(l);
            const prod = effectiveProduct(l);
            const name = l.externalName.trim();
            const suggestions = name && !prod && !l.unknown ? suggestSupplierNames(supplierId, name, 5).filter((s) => s.external_name !== name) : [];
            return (
              <div key={l.id} className="wk-line">
                <div className="wk-line-head">
                  <span className="wk-line-n">#{i + 1}{l.scanned ? <span style={{ marginInlineStart: 8 }}><Badge tone="accent">סרוק</Badge></span> : null}</span>
                  {lines.length > 1 ? (
                    <button type="button" className="wk-line-remove" aria-label="הסר שורה" onClick={() => removeLine(l.id)}><Icon name="trash" /></button>
                  ) : null}
                </div>
                <Input
                  size="touch"
                  label="שם המוצר כפי שכתוב בתעודה"
                  placeholder="לדוגמה: לוח אורן 2×4"
                  value={l.externalName}
                  autoComplete="off"
                  onChange={(e) => patch(l.id, { externalName: e.target.value, productId: null, unknown: false })}
                />
                {suggestions.length ? (
                  <div className="wk-suggest" role="listbox" aria-label="הצעות מהמילון">
                    {suggestions.map((s) => (
                      <button key={s.id} type="button" role="option" aria-selected={false} onClick={() => patch(l.id, { externalName: s.external_name, productId: null, unknown: false })}>
                        <span className="sa-truncate">{s.external_name}</span>
                        <span className="sa-faint sa-truncate" style={{ fontSize: 13 }}>{product(s.product_id)?.name ?? ""}</span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {!name ? null : prod ? (
                  <div className="wk-status is-success">
                    <Icon name="check-circle" />
                    <span>זוהה: {prod.name}</span>
                    {r.status === "pending" && !l.productId ? <Badge tone="warning">ממתין לאישור</Badge> : null}
                  </div>
                ) : l.unknown ? (
                  <div className="wk-status is-muted"><Icon name="info" /><span>יישמר לבדיקת מנהל, בלי קליטה למלאי</span></div>
                ) : (
                  <div className="wk-status is-warning"><Icon name="alert-circle" /><span>שם חדש — יישמר לבדיקה</span></div>
                )}

                {name ? (
                  <Row
                    title={prod ? (l.productId ? "שנה מוצר" : "זה מוצר אחר?") : l.unknown ? "בכל זאת לבחור מוצר" : "מה המוצר במפעל?"}
                    sub={prod ? undefined : "בחר מהרשימה, או ״לא יודע״"}
                    end={<Icon name="chevron-left" size={18} />}
                    onClick={() => setPickProductFor(l.id)}
                  />
                ) : null}

                <div className="wk-qty-row">
                  <span className="wk-qty-label">כמות{prod?.unit ? ` (${prod.unit})` : ""}</span>
                  <QuantityStepper value={l.qty} min={1} onChange={(n) => patch(l.id, { qty: n })} />
                </div>
              </div>
            );
          })}
          <Row quiet icon="plus" title="הוסף שורה" onClick={() => setLines((ls) => [...ls, newLine()])} />
        </div>
        <Foot>
          <Button variant="primary" size="touch" iconEnd="arrow-left" disabled={!canContinue} onClick={() => setStep("summary")}>
            לסיכום
          </Button>
        </Foot>
        {pickProductFor ? (
          <Picker
            title="מה המוצר במפעל?"
            items={productItems}
            placeholder="שם, מק״ט או ברקוד…"
            onPick={(id) => { patch(pickProductFor, { productId: id, unknown: false }); setPickProductFor(null); }}
            onClose={() => setPickProductFor(null)}
            extra={{ label: "לא יודע — שהמנהל יבדוק", onClick: () => { patch(pickProductFor, { productId: null, unknown: true }); setPickProductFor(null); } }}
            emptyTitle="לא נמצא מוצר"
          />
        ) : null}
      </main>
    );
  }

  /* ── step 3: summary ── */
  const summaryLines: SummaryLine[] = [
    ...toReceive.map((l) => { const p = effectiveProduct(l)!; return { key: l.id, title: p.name, sub: l.externalName.trim() !== p.name ? l.externalName.trim() : undefined, qty: l.qty, unit: p.unit }; }),
    ...toReview.map((l) => ({ key: l.id, title: l.externalName.trim(), sub: "לבדיקת מנהל — לא ייקלט עכשיו", qty: l.qty })),
  ];
  return (
    <main className="wk-page">
      <StepHead title="אישור קליטה" step={3} total={3} onBack={back} />
      <Stepper steps={STEPS} current="summary" busy={busy} />
      {error ? <Notice tone="danger" title="השמירה נכשלה">{error}</Notice> : null}
      <Summary
        meta={[
          { k: "ספק", v: supplier?.name },
          { k: "עובד", v: worker.name },
          ...(reference.trim() ? [{ k: "תעודה", v: <span className="sa-num">{reference.trim()}</span> }] : []),
          { k: "תמונה", v: photo ? (storagePath ? "צולמה והועלתה" : uploadError ? "צולמה, לא הועלתה" : "מעלה…") : "ללא" },
        ]}
        lines={summaryLines}
      />
      {toReview.length ? <Notice tone="warning" title={`${toReview.length} שורות לבדיקת מנהל`}>הן יישמרו במילון הספק ללא קליטה למלאי.</Notice> : null}
      <Foot>
        <Button variant="primary" size="touch" icon="check" disabled={busy} onClick={submit}>אשר קליטה</Button>
      </Foot>
    </main>
  );
}
