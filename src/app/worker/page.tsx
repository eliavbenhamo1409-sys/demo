"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { ThemeSettingsButton } from "@/components/ui/ThemeSettings";
import { useData } from "@/lib/store";
import { usePush, usePushPrompt } from "@/lib/push";
import { useCurrentWorker } from "@/lib/worker-store";
import { BigAction, Boot, Cta, Hint, Row, SystemBar } from "@/components/worker";
import { PushPrompt } from "@/components/worker/PushPrompt";

export default function WorkerHome() {
  const router = useRouter();
  const { state, reload } = useData();
  const { worker, workers, ready, choose } = useCurrentWorker();
  const push = usePush(worker?.id ?? null);
  const prompt = usePushPrompt(worker?.id ?? null, push.status);
  const [retrying, setRetrying] = useState(false);
  const [howTo, setHowTo] = useState(false);

  if (!ready) return <Boot />;

  if (state.status === "error") {
    const retry = async () => {
      setRetrying(true);
      await reload().catch(() => undefined);
      setRetrying(false);
    };
    return (
      <main className="wk-home">
        <SystemBar live={false} />
        <h1 className="wk-greet">אין חיבור למערכת</h1>
        <p className="wk-sub">צריך לבדוק שיש אינטרנט.</p>
        <div className="wk-stack">
          <Cta label="ניסיון נוסף" busy={retrying ? "מתחבר למערכת" : null} onClick={retry} />
        </div>
      </main>
    );
  }

  if (workers.length === 0) {
    return (
      <main className="wk-home">
        <SystemBar live={state.live} />
        <EmptyState title="אין עובדים במערכת" hint="המנהל מוסיף עובדים בלוח הניהול." />
      </main>
    );
  }

  if (!worker) {
    return (
      <main className="wk-home">
        <SystemBar live={state.live} />
        <h1 className="wk-greet">מי משתמש בטלפון?</h1>
        <p className="wk-sub">בוחרים פעם אחת, והטלפון זוכר.</p>
        <div className="wk-stack">
          <div className="wk-group">
            {workers.map((w) => (
              <Row key={w.id} title={w.name} sub={w.role} end={null} onClick={() => choose(w.id)} />
            ))}
          </div>
        </div>
      </main>
    );
  }

  // Faults the manager handed to this worker, the one waiting longest first.
  const tasks = state.faults
    .filter((f) => f.status === "open" && f.assigned_to === worker.id)
    .sort((a, b) => (a.assigned_at ?? a.created_at).localeCompare(b.assigned_at ?? b.created_at));

  // Notifications: one word for where they stand, and the one press that moves them on.
  const pushEnd: ReactNode =
    push.status === "off" ? (
      <button type="button" className="wk-textlink" disabled={push.busy} onClick={() => void push.enable()}>{push.busy ? "מפעיל" : "הפעלה"}</button>
    ) : push.status === "install" ? (
      <button type="button" className="wk-textlink" aria-expanded={howTo} onClick={() => setHowTo((open) => !open)}>איך מפעילים</button>
    ) : push.status === "on" ? (
      <span className="wk-push-state is-on">פועלות</span>
    ) : push.status === "blocked" ? (
      <span className="wk-push-state">חסומות בטלפון</span>
    ) : push.status === "unsupported" ? (
      <span className="wk-push-state">לא בדפדפן הזה</span>
    ) : null;

  return (
    <main className="wk-home">
      <SystemBar live={state.live} />
      <h1 className="wk-greet">שלום, {worker.name}</h1>
      <p className="wk-sub">מה לרשום עכשיו?</p>
      {tasks.length > 0 ? (
        <section className="wk-tasks" aria-label="משימות מהמנהל">
          <h2 className="wk-tasks-head">{tasks.length === 1 ? "משימה מהמנהל" : `${tasks.length} משימות מהמנהל`}</h2>
          <div className="wk-group">
            {tasks.map((t) => (
              <Row key={t.id} title={t.instruction ?? t.description} sub={t.description} end={<Icon name="chevron-left" size={20} />} onClick={() => router.push(`/worker/task/${t.id}`)} />
            ))}
          </div>
        </section>
      ) : null}
      <nav className="wk-actions" aria-label="פעולות">
        <BigAction title="קיבלתי סחורה" sub="סחורה הגיעה מספק" icon="arrow-down" tone="in" href="/worker/receive" />
        <BigAction title="מסרתי סחורה ללקוח" sub="סחורה יצאה ללקוח" icon="arrow-up" tone="out" href="/worker/deliver" />
        <BigAction title="דיווח תקלה" sub="משהו נשבר, חסר או פגום" icon="alert-triangle" tone="fault" href="/worker/fault" />
      </nav>
      {state.products.length === 0 ? <Hint title="אין מוצרים במלאי" /> : null}
      <div className="wk-who">
        <div className="wk-who-row">
          <Icon name="user" className="wk-who-icon" />
          <span className="wk-who-name">{worker.name}</span>
          <button
            type="button"
            className="wk-textlink"
            onClick={() => {
              void push.release();
              choose(null);
            }}
          >
            החלפת עובד
          </button>
        </div>
        <div className="wk-who-row wk-push">
          <Icon name="bell" className="wk-who-icon" />
          <span className="wk-who-name">התראות</span>
          {pushEnd}
        </div>
        <div className="wk-who-row">
          <Icon name="settings" className="wk-who-icon" />
          <ThemeSettingsButton variant="text" />
          <Icon name="chevron-left" className="wk-who-chev" />
        </div>
      </div>
      {push.status === "install" && howTo ? <Hint title="מוסיפים למסך הבית">שיתוף ← הוספה למסך הבית, ופותחים את „מחסן” משם</Hint> : null}
      {push.error && !prompt.open ? <Hint tone="attention" title={push.error} /> : null}
      {prompt.open ? (
        <PushPrompt
          status={push.status}
          busy={push.busy}
          error={push.error}
          onEnable={async () => {
            // Whatever the phone answered, the card has done its part; only a failure keeps it open to try again.
            if (await push.enable()) prompt.dismiss();
          }}
          onClose={prompt.dismiss}
        />
      ) : null}
    </main>
  );
}
