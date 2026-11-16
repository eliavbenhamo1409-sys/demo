"use client";

/**
 * A fault the manager handed to this worker: what to do and where. The first press says "קיבלתי", so the
 * manager sees it reached someone; then the one field that closes it. A notification opens this page.
 */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { useData } from "@/lib/store";
import { DEFAULT_OBJECTS } from "@/lib/map3d/layout";
import { acknowledgeFault } from "@/lib/push";
import { faultPhotoUrl, useCurrentWorker } from "@/lib/worker-store";
import { fmtName } from "@/lib/format";
import { Boot, Cta, Done, Flow, Hint, Section, SystemBar, pointAt, useSteps } from "@/components/worker";

type Step = "do" | "done";

const ORDER: readonly Step[] = ["do", "done"];
const STEPS = [{ key: "do", label: "ביצוע" }];

export default function TaskPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { state, product, resolveFault } = useData();
  const { worker, ready } = useCurrentWorker();
  const { step, dir, go } = useSteps(ORDER, "do");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [closed, setClosed] = useState(false);
  // Pressed here, ahead of the row's own update arriving.
  const [acked, setAcked] = useState(false);

  useEffect(() => {
    if (ready && !worker) router.replace("/worker");
  }, [ready, worker, router]);

  if (!ready || !worker) return <Boot />;
  if (step === "done" && closed) return <Done title="התקלה נסגרה" sub="נרשם אצל המנהל" lines={[]} />;

  const f = state.faults.find((row) => row.id === id);
  // Closed, or handed to someone else, since the list was opened. While saving, the closed row is this worker's own.
  if (!busy && (!f || f.status !== "open" || f.assigned_to !== worker.id)) {
    // Opened from a notification on what the phone kept from its last visit: the fresh read decides whether it's gone.
    if (state.cached) return <Boot />;
    return (
      <main className="wk-home">
        <SystemBar live={state.live} />
        <h1 className="wk-greet">{!f ? "המשימה לא נמצאה" : f.status !== "open" ? "התקלה כבר נסגרה" : "המשימה הועברה לעובד אחר"}</h1>
        <div className="wk-stack">
          <Cta label="חזרה למסך הראשי" onClick={() => router.replace("/worker")} />
        </div>
      </main>
    );
  }
  if (!f) return <Boot />;

  const p = product(f.product_id);
  const where = p ? fmtName(p.name) : f.asset ? DEFAULT_OBJECTS.find((o) => o.id === f.asset)?.name ?? f.asset : null;
  const photo = faultPhotoUrl(f.photo_path);
  const written = note.trim().length > 0;
  const received = acked || Boolean(f.acknowledged_at);

  // Answered at once; the press goes out behind it, and only a failure brings the button back.
  const receive = () => {
    setAcked(true);
    setFailed(false);
    acknowledgeFault(f.id).catch(() => {
      setAcked(false);
      setFailed(true);
    });
  };

  const submit = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await resolveFault(f.id, note.trim());
      setClosed(true);
      go("done");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flow
      flow="משימה מהמנהל"
      steps={STEPS}
      current="do"
      dir={dir}
      onBack={() => router.replace("/worker")}
      title={f.instruction ?? f.description}
      lead={[f.description, where].filter(Boolean).join(" · ")}
      foot={
        received
          ? {
              label: "סגירת התקלה",
              onClick: submit,
              blocked: written ? null : { reason: "חסר מה נעשה", onTap: () => pointAt("done-note") },
              busy: busy ? "שומר" : null,
            }
          : { label: "קיבלתי", onClick: receive, blocked: null }
      }
    >
      {failed ? <Hint tone="attention" title="לא נשמר. לבדוק אינטרנט וללחוץ שוב." /> : null}
      {acked && !failed ? <Hint tone="success" title="המנהל רואה שקיבלת" /> : null}
      {photo ? (
        <div className="wk-shot">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="תצלום התקלה" />
        </div>
      ) : null}
      {received ? (
        <Section id="done-note" title="מה נעשה" need="required" done={written}>
          <Input size="touch" multiline aria-label="מה נעשה" placeholder="לדוגמה: הוחלף חלק והאזור נוקה" value={note} onChange={(e) => setNote(e.target.value)} />
        </Section>
      ) : null}
    </Flow>
  );
}
