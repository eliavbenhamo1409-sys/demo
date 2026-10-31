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
import { useCurrentWorker, useRecentCustomers } from "@/lib/worker-store";
import { fmtQty } from "@/lib/format";
import { Done, Foot, Picker, Row, StepHead, Summary, type PickItem, type SummaryLine } from "@/components/worker";

type Step = "start" | "lines" | "summary" | "done";
type Line = { id: string; productId: string | null; qty: number };

const STEPS = [
  { key: "start", label: "לקוח" },
  { key: "lines", label: "פריטים" },
  { key: "summary", label: "אישור" },
];
const newLine = (): Line => ({ id: Math.random().toString(36).slice(2), productId: null, qty: 1 });

export default function DeliverPage() {
  const router = useRouter();
  const { state, issue, product } = useData();
  const { worker, ready } = useCurrentWorker();
  const { recent, remember } = useRecentCustomers();

  const [step, setStep] = useState<Step>("start");
  const [customer, setCustomer] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SummaryLine[] | null>(null);

  useEffect(() => {
    if (ready && !worker) router.replace("/worker");
  }, [ready, worker, router]);

  const productItems = useMemo<PickItem[]>(
    () => state.products.map((p) => ({ id: p.id, title: p.name, sub: `${p.sku}${p.barcode ? ` · ${p.barcode}` : ""}`, keywords: `${p.sku} ${p.barcode ?? ""}`, end: <span className="sa-num">{fmtQty(p.qty)}</span> })),
    [state.products],
  );

  const patch = (id: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const removeLine = (id: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));
  const valid = lines.filter((l) => l.productId && l.qty > 0);

  const submit = async () => {
    if (!worker) return;
    setBusy(true);
    setError(null);
    const name = customer.trim();
    const out: SummaryLine[] = [];
    try {
      for (const l of valid) {
        const p = product(l.productId)!;
        await issue({ productId: p.id, qty: l.qty, workerId: worker.id, reference: reference.trim() || null, note: `ללקוח: ${name}` });
        out.push({ key: l.id, title: p.name, sub: p.sku, qty: l.qty, unit: p.unit });
      }
      remember(name);
      setResult(out);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!ready || !worker) return null;
  if (step === "done" && result) return <Done title="נמסר" sub={`ללקוח: ${customer.trim()}`} tone="accent" lines={result} />;

  const back = () => {
    if (step === "start") router.push("/worker");
    else if (step === "lines") setStep("start");
    else setStep("lines");
  };

  if (step === "start") {
    return (
      <main className="wk-page">
        <StepHead title="מסרתי סחורה ללקוח" step={1} total={3} onBack={back} />
        <Stepper steps={STEPS} current="start" />
        <Input size="touch" label="שם הלקוח" required placeholder="לדוגמה: נגריית כהן" value={customer} onChange={(e) => setCustomer(e.target.value)} autoComplete="off" />
        {recent.length ? (
          <div className="wk-stack">
            <span className="sa-label">לקוחות אחרונים</span>
            {recent.map((c) => <Row key={c} title={c} selected={c === customer.trim()} onClick={() => setCustomer(c)} />)}
          </div>
        ) : null}
        <Input size="touch" label="מספר מסמך" optional mono inputMode="numeric" placeholder="123456" value={reference} onChange={(e) => setReference(e.target.value)} />
        <Foot>
          <Button variant="primary" size="touch" iconEnd="arrow-left" disabled={!customer.trim()} onClick={() => setStep("lines")}>המשך לפריטים</Button>
        </Foot>
      </main>
    );
  }

  if (step === "lines") {
    return (
      <main className="wk-page">
        <StepHead title={customer.trim()} step={2} total={3} onBack={back} />
        <Stepper steps={STEPS} current="lines" />
        {state.products.length === 0 ? <Notice tone="neutral" title="אין מוצרים במלאי">מנהל יוסיף מוצרים בלוח הניהול.</Notice> : null}
        <div className="wk-stack">
          {lines.map((l, i) => {
            const p = product(l.productId);
            const over = p ? l.qty > p.qty : false;
            return (
              <div key={l.id} className="wk-line">
                <div className="wk-line-head">
                  <span className="wk-line-n">#{i + 1}</span>
                  {lines.length > 1 ? <button type="button" className="wk-line-remove" aria-label="הסר שורה" onClick={() => removeLine(l.id)}><Icon name="trash" /></button> : null}
                </div>
                <Row
                  title={p ? p.name : "בחר מוצר"}
                  sub={p ? <span className="sa-num">{p.sku}</span> : "שם, מק״ט או ברקוד"}
                  selected={!!p}
                  end={<Icon name="chevron-left" size={18} />}
                  onClick={() => setPickFor(l.id)}
                />
                {p ? (
                  <div className={over ? "wk-status is-warning" : "wk-status is-muted"}>
                    <Icon name={over ? "alert-circle" : "package"} />
                    <span>במלאי: <span className="sa-num" style={{ fontSize: 14 }}>{fmtQty(p.qty)}</span> {p.unit}{over ? " — הכמות גדולה מהמלאי" : ""}</span>
                  </div>
                ) : null}
                <div className="wk-qty-row">
                  <span className="wk-qty-label">כמות{p?.unit ? ` (${p.unit})` : ""}</span>
                  <QuantityStepper value={l.qty} min={1} onChange={(n) => patch(l.id, { qty: n })} />
                </div>
              </div>
            );
          })}
          <Row quiet icon="plus" title="הוסף פריט" onClick={() => setLines((ls) => [...ls, newLine()])} />
        </div>
        <Foot>
          <Button variant="primary" size="touch" iconEnd="arrow-left" disabled={valid.length === 0} onClick={() => setStep("summary")}>לסיכום</Button>
        </Foot>
        {pickFor ? (
          <Picker title="בחר מוצר" items={productItems} placeholder="שם, מק״ט או ברקוד…" onPick={(id) => { patch(pickFor, { productId: id }); setPickFor(null); }} onClose={() => setPickFor(null)} emptyTitle="לא נמצא מוצר" />
        ) : null}
      </main>
    );
  }

  const summaryLines: SummaryLine[] = valid.map((l) => { const p = product(l.productId)!; return { key: l.id, title: p.name, sub: p.sku, qty: l.qty, unit: p.unit }; });
  const anyOver = valid.some((l) => { const p = product(l.productId); return p ? l.qty > p.qty : false; });
  return (
    <main className="wk-page">
      <StepHead title="אישור מסירה" step={3} total={3} onBack={back} />
      <Stepper steps={STEPS} current="summary" busy={busy} />
      {error ? <Notice tone="danger" title="השמירה נכשלה">{error}</Notice> : null}
      {anyOver ? <Notice tone="warning" title="כמות גדולה מהמלאי">המסירה תישמר בכל מקרה; המלאי ירד לאפס.</Notice> : null}
      <Summary
        meta={[
          { k: "לקוח", v: customer.trim() },
          { k: "עובד", v: worker.name },
          ...(reference.trim() ? [{ k: "מסמך", v: <span className="sa-num">{reference.trim()}</span> }] : []),
        ]}
        lines={summaryLines}
      />
      <Foot>
        <Button variant="primary" size="touch" icon="check" disabled={busy} onClick={submit}>אשר מסירה</Button>
      </Foot>
    </main>
  );
}
