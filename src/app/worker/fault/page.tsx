"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { useData } from "@/lib/store";
import { useCurrentWorker, uploadFaultPhoto } from "@/lib/worker-store";
import { fmtQty } from "@/lib/format";
import { Boot, CameraButton, Done, Flow, Hint, Picker, Row, Section, Summary, pointAt, productPick, useSteps, type PickItem, type SummaryLine } from "@/components/worker";

type Step = "what" | "summary" | "done";

const ORDER: readonly Step[] = ["what", "summary", "done"];
const STEPS = [
  { key: "what", label: "מה קרה" },
  { key: "summary", label: "אישור" },
];

export default function FaultPage() {
  const router = useRouter();
  const { state, reportFault, product } = useData();
  const { worker, ready } = useCurrentWorker();
  const { step, dir, go } = useSteps(ORDER, "what");

  const [productId, setProductId] = useState<string | null>(null);
  const [pick, setPick] = useState(false);
  const [description, setDescription] = useState("");
  const [withQty, setWithQty] = useState(false);
  const [qty, setQty] = useState(1);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (ready && !worker) router.replace("/worker");
  }, [ready, worker, router]);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);
  useEffect(() => {
    if (!productId) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("write-off")?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" });
  }, [productId]);

  const onPhoto = (file: File | undefined) => {
    if (!file) return;
    setPhotoError(null);
    setPhoto((prev) => { if (prev) URL.revokeObjectURL(prev.url); return { file, url: URL.createObjectURL(file) }; });
  };

  const items = useMemo<PickItem[]>(() => state.products.map((p) => productPick(p, true)), [state.products]);
  const p = product(productId);
  const described = description.trim().length > 0;

  const submit = async () => {
    if (!worker) return;
    setBusy(true);
    setError(null);
    try {
      let photoPath: string | null = null;
      if (photo) {
        try {
          photoPath = await uploadFaultPhoto(photo.file, worker.id);
        } catch (e) {
          // The report still goes through; the manager just won't get the picture.
          setPhotoError(e instanceof Error ? e.message : String(e));
        }
      }
      await reportFault({ productId: p?.id ?? null, description: description.trim(), workerId: worker.id, qty: p && withQty ? qty : null, photoPath });
      setDone(true);
      go("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!ready || !worker) return <Boot />;

  const lines: SummaryLine[] = p && withQty ? [{ key: "q", title: p.name, qty, unit: p.unit }] : [];
  if (step === "done" && done) {
    return <Done title="הדיווח הועבר למנהל" sub={photoError ? "התמונה לא הועלתה, התקלה דווחה" : undefined} lines={lines.map((l) => ({ ...l, sub: "ייגרע מהמלאי כפגום" }))} />;
  }

  const back = () => (step === "what" ? router.replace("/worker") : go("what"));

  if (step === "what") {
    return (
      <Flow
        flow="דיווח תקלה"
        steps={STEPS}
        current="what"
        dir={dir}
        onBack={back}
        title="מה קרה?"
        foot={{
          label: "המשך לאישור",
          onClick: () => go("summary"),
          blocked: described ? null : { reason: "חסר תיאור התקלה", onTap: () => pointAt("what") },
        }}
        overlay={pick ? <Picker title="מוצר קשור" items={items} placeholder='חיפוש לפי שם, מק"ט או ברקוד' onPick={(id) => { setProductId(id); setPick(false); }} onClose={() => setPick(false)} emptyTitle="לא נמצאו מוצרים" /> : null}
      >
        <Section id="what" title="תיאור התקלה" need="required" done={described}>
          <Input size="touch" multiline aria-label="תיאור התקלה" placeholder="לדוגמה: לוחות הגיעו שרוטים" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Section>
        <Section title="תמונה" need="optional" done={!!photo}>
          {photo ? (
            <>
              <div className="wk-shot">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="תצלום התקלה" />
                <p className="wk-shot-text">התמונה צורפה</p>
                <button type="button" className="wk-textlink" onClick={() => setPhoto(null)}>הסרה</button>
              </div>
              <CameraButton quiet label="צילום מחדש" onFile={onPhoto} />
            </>
          ) : <CameraButton quiet label="צילום התקלה" onFile={onPhoto} />}
        </Section>
        <Section title="מוצר קשור" need="optional" done={!!p}>
          <Row title={p ? p.name : "בחירת מוצר"} sub={p ? <span className="sa-num">{p.sku}</span> : undefined} selected={!!p} end={<Icon name="chevron-left" size={20} />} onClick={() => setPick(true)} />
          {p ? (
            <>
              <button type="button" className="wk-textlink is-start" onClick={() => { setProductId(null); setWithQty(false); }}>הסרת המוצר</button>
              <div id="write-off" className="wk-choices">
                <p className="wk-ask">להוריד כמות פגומה מהמלאי?</p>
                <div className="wk-group">
                  <Row title="כן, להוריד" sub={`במלאי ${fmtQty(p.qty)} ${p.unit}`} selected={withQty} onClick={() => setWithQty(true)} />
                  <Row title="לא" selected={!withQty} onClick={() => setWithQty(false)} />
                </div>
              </div>
              {withQty ? (
                <div className="wk-qty-row">
                  <span className="wk-qty-label">כמות פגומה ({p.unit})</span>
                  <QuantityStepper value={qty} min={1} onChange={setQty} />
                </div>
              ) : null}
            </>
          ) : null}
        </Section>
      </Flow>
    );
  }

  return (
    <Flow
      flow="דיווח תקלה"
      steps={STEPS}
      current="summary"
      dir={dir}
      onBack={back}
      title="בדיקה ואישור"
      lead="עדיין לא נשלח כלום"
      foot={{ label: "העברה למנהל", onClick: submit, busy: busy ? "שולח את הדיווח" : null }}
    >
      {error ? <Hint tone="attention" title="לא נשלח. לבדוק אינטרנט וללחוץ שוב." /> : null}
      <Summary
        heading="פרטי הדיווח"
        meta={[
          { k: "תקלה", v: description.trim() },
          { k: "מוצר", v: p ? p.name : "ללא" },
          // eslint-disable-next-line @next/next/no-img-element
          ...(photo ? [{ k: "תמונה", v: <img src={photo.url} alt="תצלום התקלה" className="wk-sum-photo" /> }] : []),
        ]}
        lines={[]}
      />
      <Summary heading="יורד מהמלאי" lines={lines} direction="out" />
    </Flow>
  );
}
