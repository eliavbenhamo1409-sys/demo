"use client";

/** Small pieces the assistant's card and panel share: its few drawings, the words for its data, and how an answer is set. */
import { Fragment, type ReactElement, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import type { AssistantData } from "@/lib/assistant/store";
import type { Alert, AlertKind, Narrative, TopAlert } from "@/lib/assistant/types";

/* ───────── drawings: thin, one weight, grey unless the word beside them carries a colour ───────── */

type Drawing = "chat" | "cart" | "up" | "down";

const PATHS: Record<Drawing, ReactNode> = {
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  cart: (
    <>
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </>
  ),
  up: (
    <>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </>
  ),
  down: (
    <>
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
      <polyline points="17 18 23 18 23 12" />
    </>
  ),
};

export function Draw({ name, size = 18, className }: { name: Drawing; size?: number; className?: string }): ReactElement {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export function KindIcon({ kind, size = 18 }: { kind: AlertKind; size?: number }): ReactElement {
  if (kind === "purchase") return <Draw name="cart" size={size} className="asst-kind is-purchase" />;
  return <Icon name={kind === "shortage" ? "package" : "eye"} size={size} className={`asst-kind is-${kind}`} />;
}

/* ───────── words ───────── */

export const KIND_LABEL: Record<AlertKind, string> = { shortage: "חוסרים דחופים", purchase: "המלצות רכש", event: "אירועים לבדיקה" };

export const STATUS_LABEL: Record<Alert["status"], string> = { new: "חדשה", in_progress: "בטיפול", resolved: "טופלה", dismissed: "נסגרה כלא רלוונטית" };

export const ACTION_LABEL: Record<string, string> = {
  created: "ההתראה נפתחה",
  worse: "המצב החמיר",
  better: "המצב השתפר",
  cleared: "נסגרה מעצמה",
  take: "לקח לטיפול",
  assign: "שויכה לעובד",
  resolve: "נסגרה כטופלה",
  dismiss: "נסגרה כלא רלוונטית",
  note: "הערה",
  reopen: "נפתחה מחדש",
};

const REASON_LABEL: Record<string, string> = { no_receipt: "בלי קבלה", count_gap: "פער בספירה", big_out: "גדולה מהרגיל", night: "מחוץ לשעות העבודה" };

const nf = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 2 });
export const num = (v: unknown): string => (typeof v === "number" ? nf.format(v) : String(v ?? ""));

/** 2026-11-17 → 17/11; with a clock, 17/11 11:49. */
export function fmtDay(iso: unknown): string {
  if (typeof iso !== "string" || iso.length < 10) return "";
  const [, m, d] = iso.slice(0, 10).split("-");
  const clock = iso.length >= 16 ? ` ${iso.slice(11, 16)}` : "";
  return `${Number(d)}/${Number(m)}${clock}`;
}

/** When the facts were read, beside the manager's own clock: היום ב-11:49, אתמול ב-08:00, or the date. */
export function fmtStamp(asOf: string, now: string): string {
  const clock = asOf.slice(11, 16);
  if (asOf.slice(0, 10) === now.slice(0, 10)) return `היום ב-${clock}`;
  const gap = (Date.parse(now.slice(0, 10)) - Date.parse(asOf.slice(0, 10))) / 86_400_000;
  return gap === 1 ? `אתמול ב-${clock}` : `${fmtDay(asOf.slice(0, 10))} ב-${clock}`;
}

/** An ISO moment as the manager's own date and clock. */
export function fmtMoment(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function greeting(now: string, name: string): string {
  const hour = Number(now.slice(11, 13));
  const hello = hour >= 5 && hour < 12 ? "בוקר טוב" : hour >= 12 && hour < 17 ? "צהריים טובים" : hour >= 17 && hour < 21 ? "ערב טוב" : "לילה טוב";
  return name ? `${hello} ${name}` : hello;
}

/* ───────── the briefing, as the screens show it ───────── */

export interface Brief {
  hello: string;
  stamp: string;
  opening: string;
  counts: { kind: AlertKind; n: number }[];
  items: { alert: TopAlert; text: string }[];
  trend: Narrative["trend"];
  actions: Narrative["actions"];
  /** True once the model worded it; until then the scan's own sentences stand. */
  worded: boolean;
}

export function briefOf(data: AssistantData): Brief | null {
  const b = data.briefing;
  if (!b) return null;
  const { facts, narrative } = b;
  const byId = new Map(facts.top.map((a) => [a.id, a]));
  const total = facts.counts.urgent + facts.counts.purchase + facts.counts.events;

  const worded = narrative?.items.flatMap((i) => {
    const alert = byId.get(i.alert_id);
    return alert ? [{ alert, text: i.text }] : [];
  });
  const items = worded && worded.length > 0 ? worded : facts.top.slice(0, 3).map((alert) => ({ alert, text: alert.summary }));

  // With no wording, the one trend the scan always holds: this week's exits against the week before.
  const pct = facts.snapshot.out_change_pct;
  const trend = narrative
    ? narrative.trend
    : typeof pct === "number" && pct !== 0
      ? { text: `היציאות ב-7 הימים האחרונים ${pct > 0 ? "גבוהות" : "נמוכות"} ב-${Math.abs(pct)}% מהשבוע שלפניהם.`, good: pct > 0 }
      : null;

  return {
    hello: greeting(data.now, data.name),
    stamp: fmtStamp(facts.as_of, data.now),
    opening: narrative?.opening ?? (total > 0 ? "אלו הנושאים שדורשים טיפול היום." : "אין נושאים פתוחים. המחסן תקין."),
    counts: [
      { kind: "shortage", n: facts.counts.urgent },
      { kind: "purchase", n: facts.counts.purchase },
      { kind: "event", n: facts.counts.events },
    ],
    items,
    trend,
    actions: narrative?.actions ?? [],
    worded: narrative !== null,
  };
}

/* ───────── evidence: the scan's figures, in the manager's words ───────── */

const withUnit = (v: unknown, unit: unknown) => `${num(v)}${typeof unit === "string" ? ` ${unit}` : ""}`;

export function evidenceRows(alert: Pick<Alert, "kind" | "evidence">): { label: string; value: string }[] {
  const e = alert.evidence;
  const rows: { label: string; value: string }[] = [];
  const add = (label: string, value: string | null) => {
    if (value) rows.push({ label, value });
  };
  const has = (k: string) => e[k] !== null && e[k] !== undefined;

  if (alert.kind === "event") {
    add("מתי", fmtDay(e.at));
    if (e.type === "adjust") {
      add("נספרו", withUnit(e.qty, e.unit));
      add("הפער מהרשום", `${typeof e.delta === "number" && e.delta > 0 ? "+" : ""}${withUnit(e.delta, e.unit)}`);
    } else add("כמות", withUnit(e.qty, e.unit));
    add("שווי במחירון", has("worth") ? `₪${num(e.worth)}` : null);
    if (has("usual_out") && Array.isArray(e.reasons) && e.reasons.includes("big_out")) add("יציאה רגילה של המוצר", withUnit(e.usual_out, e.unit));
    add("עובד", typeof e.worker === "string" ? e.worker : "לא נרשם");
    add("לקוח", typeof e.customer === "string" ? e.customer : null);
    add("הערה בתנועה", typeof e.note === "string" ? e.note : null);
    add("מה חריג", Array.isArray(e.reasons) ? e.reasons.map((r) => REASON_LABEL[String(r)] ?? String(r)).join(" · ") : null);
    return rows;
  }

  add("על המדף", withUnit(e.on_shelf, e.unit));
  add("משוריין להזמנות", withUnit(e.reserved, e.unit));
  add("זמין", withUnit(e.available, e.unit));
  add("מינימום", withUnit(e.minimum, e.unit));
  add("יוצא ביום, ממוצע 30 יום", has("daily_use") ? num(e.daily_use) : null);
  add("יספיק ל", has("days_left") ? `${num(e.days_left)} ימים` : null);
  add("כמות מומלצת להזמנה", `${withUnit(e.suggested_qty, e.unit)} · כיסוי ל-${num(e.cover_days)} יום`);
  add("ספק", typeof e.supplier === "string" ? e.supplier : null);
  add("קליטה אחרונה", has("last_in_day") ? `${fmtDay(e.last_in_day)} · ${withUnit(e.last_in_qty, e.unit)}` : null);
  if (Array.isArray(e.orders)) {
    for (const o of e.orders.slice(0, 4) as { number?: number; customer?: string; qty?: number; promised_on?: string | null }[]) {
      add(`הזמנה ${o.number ?? ""}`, [o.customer, withUnit(o.qty, e.unit), o.promised_on ? `עד ${fmtDay(o.promised_on)}` : null].filter(Boolean).join(" · "));
    }
  }
  return rows;
}

/** Where the figures came from and when, as one quiet line. */
export function evidenceSource(e: Record<string, unknown>): string {
  const what = e.source === "ai.events" ? "בדיקת התנועות במסד הנתונים" : "חישוב המלאי במסד הנתונים";
  return typeof e.as_of === "string" ? `מקור: ${what} · נכון ל-${fmtDay(e.as_of)}` : `מקור: ${what}`;
}

/* ───────── an answer: lines, short lists and the one or two words the model marked ───────── */

function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>));
}

export function Answer({ text }: { text: string }): ReactElement {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`l${blocks.length}`}>
        {list.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const bullet = /^[-•]\s+(.*)$/.exec(line);
    if (bullet) list.push(bullet[1]);
    else {
      flush();
      blocks.push(<p key={`p${blocks.length}`}>{inline(line)}</p>);
    }
  }
  flush();
  return <div className="asst-answer">{blocks}</div>;
}
