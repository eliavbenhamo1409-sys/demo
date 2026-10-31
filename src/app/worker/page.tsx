"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { ThemeSettingsButton } from "@/components/ui/ThemeSettings";
import { useData } from "@/lib/store";
import { useCurrentWorker } from "@/lib/worker-store";
import { BigAction, Row } from "@/components/worker";

export default function WorkerHome() {
  const router = useRouter();
  const { state } = useData();
  const { worker, workers, ready, choose } = useCurrentWorker();

  if (!ready) {
    return (
      <main className="wk-page" style={{ alignItems: "center", justifyContent: "center" }}>
        <Spinner />
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="wk-page">
        <Notice tone="danger" title="אין חיבור לנתונים">{state.error}</Notice>
      </main>
    );
  }

  if (workers.length === 0) {
    return (
      <main className="wk-page">
        <EmptyState icon="user" title="עדיין אין עובדים במערכת" hint="מנהל יוסיף עובדים בלוח הניהול ואז תוכלו לבחור שם כאן." />
      </main>
    );
  }

  if (!worker) {
    return (
      <main className="wk-page">
        <h1 className="wk-greet">מי אתה?</h1>
        <p className="wk-sub">בחר את השם שלך פעם אחת. הטלפון יזכור.</p>
        <div className="wk-stack">
          {workers.map((w) => (
            <Row key={w.id} title={w.name} sub={w.role} onClick={() => choose(w.id)} />
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="wk-page">
      <h1 className="wk-greet">שלום, {worker.name}</h1>
      <p className="wk-sub">
        מה עשית?{" "}
        <button type="button" onClick={() => choose(null)} style={{ marginInlineStart: 8 }}>לא אני</button>
      </p>
      <div className="wk-stack">
        <BigAction title="קיבלתי סחורה" sub="תעודת משלוח מספק" icon="arrow-down-left" tone="success" onClick={() => router.push("/worker/receive")} />
        <BigAction title="מסרתי סחורה ללקוח" sub="הוצאה מהמלאי" icon="arrow-up-right" tone="accent" onClick={() => router.push("/worker/deliver")} />
        <BigAction title="דיווח על תקלה" sub="משהו נשבר, חסר או פגום" icon="alert-triangle" tone="danger" onClick={() => router.push("/worker/fault")} />
      </div>
      {state.products.length === 0 ? (
        <Notice tone="neutral" title="אין עדיין מוצרים במלאי">מנהל יוסיף מוצרים בלוח הניהול.</Notice>
      ) : null}
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <Button variant="ghost" size="touch" onClick={() => router.push("/")}>מעבר ללוח הניהול</Button>
        <ThemeSettingsButton variant="touch" />
      </div>
    </main>
  );
}
