"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { Stepper } from "@/components/ui/Stepper";
import { useData } from "@/lib/store";
import { useCurrentWorker } from "@/lib/worker-store";
import { fmtQty } from "@/lib/format";
import { Done, Foot, Picker, Row, StepHead, Summary, type PickItem, type SummaryLine } from "@/components/worker";

type Step = "what" | "summary" | "done";

const STEPS = [
  { key: "what", label: "מה קרה" },
  { key: "summary", label: "אישור" },
];

export default function FaultPage() {
  const router = useRouter();
  const { state, reportFault, product } = useData();
  const { worker, ready } = useCurrentWorker();

  const [step, setStep] = useState<Step>("what");
  const [productId, setProductId] = useState<string | null>(null);
  const [pick, setPick] = useState(false);
  const [description, setDescription] = useState("");
  const [withQty, setWithQty] = useState(false);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (ready && !worker) router.replace("/worker");
  }, [ready, worker, router]);

  const items = useMemo<PickItem[]>(
    () => state.products.map((p) => ({ id: p.id, title: p.name, sub: `${p.sku}${p.barcode ? ` · ${p.barcode}` : ""}`, keywords: `${p.sku} ${p.barcode ?? ""}`, end: <span className="sa-num">{fmtQty(p.qty)}</span> })),
    [state.products],
  );
  const p = product(productId);
  const canContinue = description.trim().length > 0;

  const submit = async () => {
    if (!worker) return;
    setBusy(true);
    setError(null);
    try {
      await reportFault({ productId: p?.id ?? null, description: description.trim(), workerId: worker.id, qty: p && withQty ? qty : null });
      setDone(true);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!ready || !worker) return null;

  const lines: SummaryLine[] = p && withQty ? [{ key: "q", title: p.name, sub: "ייגרע מהמלאי כפגום", qty, unit: p.unit }] : [];
  if (step === "done" && done) return <Done title="דווח" sub="המנהל יראה את התקלה בסקירה" tone="danger" icon="alert-triangle" lines={lines} />;

  const back = () => (step === "what" ? router.push("/worker") : setStep("what"));

  if (step === "what") {
    return (
      <main className="wk-page">
        <StepHead title="דיווח על תקלה" step={1} total={2} onBack={back} />
        <Stepper steps={STEPS} current="what" />
        <Input size="touch" multiline label="מה קרה?" required placeholder="לדוגמה: לוחות הגיעו רטובים / נשבר בזמן העמסה" value={description} onChange={(e) => setDescription(e.target.value)} style={{ minHeight: 112, paddingTop: 12, paddingBottom: 12 }} />
        <section className="wk-stack">
          <span className="sa-label">מוצר קשור <span className="sa-faint" style={{ fontWeight: 400 }}>אופציונלי</span></span>
          <Row title={p ? p.name : "בחר מוצר"} sub={p ? <span className="sa-num">{p.sku}</span> : "אם התקלה קשורה לפריט במלאי"} selected={!!p} end={<Icon name="chevron-left" size={18} />} onClick={() => setPick(true)} />
          {p ? <Row quiet title="הסר מוצר" onClick={() => { setProductId(null); setWithQty(false); }} /> : null}
        </section>
        {p ? (
          <section className="wk-stack">
            <Row title="יש כמות פגומה לגרוע מהמלאי?" sub={`במלאי: ${fmtQty(p.qty)} ${p.unit}`} selected={withQty} icon="package" onClick={() => setWithQty((v) => !v)} />
            {withQty ? (
              <div className="wk-qty-row" style={{ paddingInline: 4 }}>
                <span className="wk-qty-label">כמות פגומה ({p.unit})</span>
                <QuantityStepper value={qty} min={1} onChange={setQty} />
              </div>
            ) : null}
          </section>
        ) : null}
        <Foot>
          <Button variant="primary" size="touch" iconEnd="arrow-left" disabled={!canContinue} onClick={() => setStep("summary")}>לסיכום</Button>
        </Foot>
        {pick ? <Picker title="מוצר קשור" items={items} placeholder="שם, מק״ט או ברקוד…" onPick={(id) => { setProductId(id); setPick(false); }} onClose={() => setPick(false)} emptyTitle="לא נמצא מוצר" /> : null}
      </main>
    );
  }

  return (
    <main className="wk-page">
      <StepHead title="אישור דיווח" step={2} total={2} onBack={back} />
      <Stepper steps={STEPS} current="summary" busy={busy} />
      {error ? <Notice tone="danger" title="השמירה נכשלה">{error}</Notice> : null}
      <Summary
        meta={[
          { k: "תקלה", v: <span style={{ whiteSpace: "normal" }}>{description.trim()}</span> },
          { k: "מוצר", v: p ? p.name : "ללא" },
          { k: "עובד", v: worker.name },
        ]}
        lines={lines}
      />
      <Foot>
        <Button variant="danger" size="touch" icon="alert-triangle" disabled={busy} onClick={submit}>שלח דיווח</Button>
      </Foot>
    </main>
  );
}
