"use client";

/**
 * The assistant's page, reached from the rail. On one side the morning's scan in words and every alert with its
 * evidence, owner and log; on the other the conversation, which stays in place while the rest is read.
 * Nothing here changes stock: an alert only says who handles it and how it ended.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import { useUi } from "@/components/app/ui-state";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { PageHead } from "@/components/ui/PageHead";
import { useAssistant, type AlertAction, type AssistantData, type ChatMessage } from "@/lib/assistant/store";
import type { Alert, AlertEvent, AlertKind } from "@/lib/assistant/types";
import { useData } from "@/lib/store";
import { ACTION_LABEL, Answer, briefOf, Draw, evidenceRows, evidenceSource, fmtDay, fmtMoment, KIND_LABEL, KindIcon, num, STATUS_LABEL } from "./parts";
import "./assistant.css";

const SUGGESTIONS = ["מה המצב במחסן עכשיו?", "מה צריך להזמין השבוע, ומאיזה ספק?", "יש משהו חריג בתנועות של הימים האחרונים?", "מי הלקוחות הגדולים בחודש האחרון?"];

const isOpen = (a: Alert) => a.status === "new" || a.status === "in_progress";

const ALERTS_ID = "asst-alerts";

export function AssistantPage(): ReactElement {
  const a = useAssistant();
  const waiting = a.data?.alerts.filter(isOpen).length ?? 0;
  return (
    <div className="sa-page asst-page">
      <PageHead title="עוזר AI" sub="קורא את נתוני המחסן ועונה מהם. לא משנה בהם דבר" />
      {a.status === "off" ? (
        <Notice title="העוזר לא זמין כרגע">כדי שיקרא את הנתונים צריך להיכנס למערכת מחדש</Notice>
      ) : a.status === "loading" || !a.data ? (
        <span className="sa-skeleton asst-skeleton" aria-busy="true" aria-label="העוזר נטען" />
      ) : (
        <div className="asst-grid">
          <div className="asst-col">
            <section className="sa-card asst-sheet" aria-label="תדרוך">
              <BriefView data={a.data} />
            </section>
            <section className="sa-card asst-sheet" id={ALERTS_ID} aria-label="התראות">
              <header className="asst-sheet-head">
                <h2 className="asst-sheet-title">התראות</h2>
                {waiting > 0 ? <span className="asst-sheet-n">{waiting} פתוחות</span> : null}
              </header>
              <AlertsView data={a.data} />
            </section>
          </div>
          <section className="sa-card asst-sheet asst-talk" aria-label="שיחה עם העוזר">
            <header className="asst-sheet-head">
              <h2 className="asst-sheet-title">שיחה</h2>
              {a.messages.length > 0 && !a.sending ? (
                <button type="button" className="asst-clear" onClick={a.clearChat}>
                  שיחה חדשה
                </button>
              ) : null}
            </header>
            <ChatView />
          </section>
        </div>
      )}
    </div>
  );
}

/** From the briefing to the alert it speaks of: the alert opens, and its sheet comes into view. */
function useToAlerts(): (alertId?: number) => void {
  const { show } = useAssistant();
  return (alertId) => {
    show("alerts", alertId);
    document.getElementById(ALERTS_ID)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
}

/* ───────────────────────── תדרוך ───────────────────────── */

function BriefView({ data }: { data: AssistantData }): ReactElement {
  const a = useAssistant();
  const toAlerts = useToAlerts();
  const ui = useUi();
  const brief = useMemo(() => briefOf(data), [data]);
  const [buying, setBuying] = useState(false);

  const scan = () => {
    void a.scan().then((error) => {
      if (error) ui.notify({ tone: "danger", title: error });
    });
  };

  if (!brief || !data.briefing) {
    return (
      <div className="asst-body">
        <p className="asst-empty">עוד לא נעשתה סריקה. היא רצה מעצמה כל יום ב-{String(data.briefing_hour).padStart(2, "0")}:00.</p>
        <button type="button" className="sa-btn sa-btn-secondary asst-scan" onClick={scan} disabled={a.scanning}>
          <Icon name="refresh" size={16} />
          {a.scanning ? "סורק" : "סריקה עכשיו"}
        </button>
      </div>
    );
  }

  const { purchase } = data.briefing.facts;
  const lines = purchase.reduce((sum, g) => sum + g.items, 0);

  return (
    <div className="asst-body">
      <section className="asst-brief">
        <p className="asst-eyebrow">תדרוך הנהלה · נסרק {brief.stamp}</p>
        <h3 className="asst-hello">{brief.hello}.</h3>
        <p className={`asst-opening${a.wording ? " is-wording" : ""}`}>{brief.opening}</p>

        <div className="asst-counts">
          {brief.counts.map((c) => (
            <button key={c.kind} type="button" className="asst-count" onClick={() => toAlerts()}>
              <span className={`asst-count-n is-${c.kind}${c.n === 0 ? " is-zero" : ""}`}>{c.n}</span>
              <span className="asst-count-label">{KIND_LABEL[c.kind]}</span>
            </button>
          ))}
        </div>
      </section>

      {brief.items.length > 0 ? (
        <section className="asst-section">
          <h4 className="asst-section-title">הנושאים של היום</h4>
          <ul className="asst-items">
            {brief.items.map(({ alert, text }) => (
              <li key={alert.id}>
                <button type="button" className="asst-item" onClick={() => toAlerts(alert.id)}>
                  <KindIcon kind={alert.kind} size={20} />
                  <span className="asst-item-text">
                    <span className="asst-item-title">{alert.title}</span>
                    <span className="asst-item-why">{text}</span>
                  </span>
                  <Icon name="chevron-left" size={16} className="asst-go" />
                </button>
              </li>
            ))}
          </ul>
          {brief.trend ? (
            <p className="asst-trend">
              <Draw name={brief.trend.good ? "up" : "down"} size={18} className={brief.trend.good ? "is-good" : "is-bad"} />
              {brief.trend.text}
            </p>
          ) : null}
        </section>
      ) : null}

      {brief.actions.length > 0 ? (
        <section className="asst-section asst-actions">
          <h4 className="asst-section-title">מומלץ להיום</h4>
          <ol>
            {brief.actions.map((action, i) => (
              <li key={i}>
                {action.alert_id !== null ? (
                  <button type="button" onClick={() => toAlerts(action.alert_id ?? undefined)}>
                    {action.text}
                  </button>
                ) : (
                  <span>{action.text}</span>
                )}
              </li>
            ))}
          </ol>
          <p className="asst-note">העוזר ממליץ בלבד. כל פעולה נעשית על ידך, במסכים הרגילים.</p>
        </section>
      ) : null}

      {lines > 0 ? (
        <section className="asst-section">
          <button type="button" className="asst-fold" aria-expanded={buying} onClick={() => setBuying((v) => !v)}>
            <span className="asst-section-title">מה להזמין, לפי ספק</span>
            <span className="asst-fold-n">{lines} מוצרים</span>
            <Icon name={buying ? "chevron-up" : "chevron-down"} size={16} />
          </button>
          {buying ? (
            <div className="asst-buy">
              {purchase.map((g) => (
                <div key={g.supplier} className="asst-buy-group">
                  <p className="asst-buy-supplier">{g.supplier}</p>
                  <ul>
                    {g.lines.map((l) => (
                      <li key={l.product}>
                        <span className="asst-buy-name">{l.product}</span>
                        <span className="asst-buy-qty">
                          {num(l.qty)} {l.unit}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="asst-note">הכמות מכסה את ההזמנות הפתוחות, את המינימום ושבועיים בקצב של החודש האחרון. חושבה במסד הנתונים.</p>
            </div>
          ) : null}
        </section>
      ) : null}

      <footer className="asst-foot">
        <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" onClick={scan} disabled={a.scanning}>
          <Icon name="refresh" size={14} />
          {a.scanning ? "סורק" : "סריקה עכשיו"}
        </button>
        {data.budget ? (
          <span className="asst-budget">
            נוצל היום ${num(Math.round(data.budget.spent_usd * 100) / 100)} מתוך ${num(data.budget.limit_usd)}
          </span>
        ) : null}
      </footer>
    </div>
  );
}

/* ───────────────────────── התראות ───────────────────────── */

const KINDS: AlertKind[] = ["shortage", "event", "purchase"];

function AlertsView({ data }: { data: AssistantData }): ReactElement {
  const a = useAssistant();
  const [opened, setOpened] = useState<number | null>(a.focus);
  const [seenFocus, setSeenFocus] = useState(a.focus);
  if (seenFocus !== a.focus) {
    setSeenFocus(a.focus);
    if (a.focus !== null) setOpened(a.focus);
  }

  // The alert the panel was opened on comes into view.
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (opened === null) return;
    body.current?.querySelector(`[data-alert="${opened}"]`)?.scrollIntoView({ block: "nearest" });
  }, [opened]);

  const open = data.alerts.filter(isOpen);
  const closed = data.alerts.filter((x) => !isOpen(x));

  if (data.alerts.length === 0) {
    return (
      <div className="asst-body">
        <p className="asst-empty">אין התראות. הסריקה לא מצאה חוסר או תנועה חריגה.</p>
      </div>
    );
  }

  return (
    <div className="asst-body" ref={body}>
      {KINDS.map((kind) => {
        const rows = open.filter((x) => x.kind === kind);
        if (rows.length === 0) return null;
        return (
          <section key={kind} className="asst-section">
            <h4 className="asst-section-title">
              <KindIcon kind={kind} size={18} />
              {KIND_LABEL[kind]}
              <span className="asst-section-n">{rows.length}</span>
            </h4>
            <ul className="asst-alerts">
              {rows.map((x) => (
                <AlertRow key={x.id} alert={x} open={opened === x.id} onToggle={() => setOpened((id) => (id === x.id ? null : x.id))} />
              ))}
            </ul>
          </section>
        );
      })}
      {open.length === 0 ? <p className="asst-empty">אין התראות פתוחות.</p> : null}
      {closed.length > 0 ? (
        <section className="asst-section">
          <h4 className="asst-section-title">
            נסגרו השבוע
            <span className="asst-section-n">{closed.length}</span>
          </h4>
          <ul className="asst-alerts">
            {closed.map((x) => (
              <AlertRow key={x.id} alert={x} open={opened === x.id} onToggle={() => setOpened((id) => (id === x.id ? null : x.id))} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function AlertRow({ alert, open, onToggle }: { alert: Alert; open: boolean; onToggle: () => void }): ReactElement {
  const state = alert.status === "in_progress" && alert.owner_label ? `בטיפול · ${alert.owner_label}` : STATUS_LABEL[alert.status];
  return (
    <li className={`asst-alert${open ? " is-open" : ""}`} data-alert={alert.id}>
      <button type="button" className="asst-alert-head" aria-expanded={open} onClick={onToggle}>
        <span className="asst-alert-text">
          <span className="asst-alert-title">{alert.title}</span>
          {open ? null : <span className="asst-alert-sum">{alert.summary}</span>}
        </span>
        <span className={`asst-state is-${alert.status}`}>{state}</span>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={16} className="asst-go" />
      </button>
      {open ? <AlertBody alert={alert} /> : null}
    </li>
  );
}

function AlertBody({ alert }: { alert: Alert }): ReactElement {
  const a = useAssistant();
  const ui = useUi();
  const { state } = useData();
  const [events, setEvents] = useState<AlertEvent[] | null>(null);
  const [closing, setClosing] = useState<"resolve" | "dismiss" | null>(null);
  const [note, setNote] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = isOpen(alert);

  const { log } = a;
  useEffect(() => {
    let on = true;
    log(alert.id)
      .then((rows) => on && setEvents(rows))
      .catch(() => on && setEvents([]));
    return () => {
      on = false;
    };
  }, [log, alert.id, alert.status, alert.owner_label, alert.last_seen_at]);

  const run = (action: AlertAction, text?: string, workerId?: string) => {
    setBusy(true);
    setError(null);
    void a.act(alert.id, action, text, workerId).then((failed) => {
      setBusy(false);
      if (failed) setError(failed);
      else {
        setClosing(null);
        setAssigning(false);
        setNote("");
      }
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (closing && note.trim()) run(closing, note);
  };

  const movement = alert.entity_type === "movement" ? state.movements.find((m) => m.id === alert.entity_id) : undefined;
  const productId = alert.entity_type === "product" ? alert.entity_id : typeof alert.evidence.product_id === "string" ? alert.evidence.product_id : null;
  const workers = state.workers.filter((w) => w.active);

  return (
    <div className="asst-alert-body">
      <p className="asst-alert-full">{alert.summary}</p>

      <dl className="asst-evidence">
        {evidenceRows(alert).map((row, i) => (
          <div key={i}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="asst-note">{evidenceSource(alert.evidence)}</p>

      <div className="asst-links">
        {productId ? (
          <button type="button" className="sa-btn sa-btn-link" onClick={() => ui.openProduct(productId)}>
            פתיחת המוצר
          </button>
        ) : null}
        {movement ? (
          <button type="button" className="sa-btn sa-btn-link" onClick={() => ui.openMovement(movement)}>
            פתיחת התנועה
          </button>
        ) : null}
        <button type="button" className="sa-btn sa-btn-link" onClick={() => a.ask(`ספר לי עוד על ההתראה: ${alert.title}`)}>
          לשאול את העוזר
        </button>
      </div>

      {events && events.length > 0 ? (
        <div className="asst-log">
          <p className="asst-log-title">יומן</p>
          <ol>
            {events.map((e) => (
              <li key={e.id}>
                <span className="asst-log-when">{fmtMoment(e.created_at)}</span>
                <span className="asst-log-what">
                  <b>{e.actor}</b> · {ACTION_LABEL[e.action] ?? e.action}
                  {e.action === "assign" && typeof e.data?.worker === "string" ? `: ${e.data.worker}` : ""}
                  {e.note && e.action !== "created" && e.action !== "worse" && e.action !== "better" ? <span className="asst-log-note">{e.note}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {error ? <p className="asst-error">{error}</p> : null}

      {!live ? (
        <div className="asst-acts">
          <span className="asst-closed">
            {alert.resolved_by} · {alert.resolved_at ? fmtDay(alert.resolved_at.slice(0, 10)) : ""}
            {alert.resolution ? ` · ${alert.resolution}` : ""}
          </span>
          <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" disabled={busy} onClick={() => run("reopen")}>
            פתיחה מחדש
          </button>
        </div>
      ) : closing ? (
        <form className="asst-close" onSubmit={submit}>
          <label htmlFor={`asst-note-${alert.id}`}>{closing === "resolve" ? "מה נעשה" : "למה זה לא רלוונטי"}</label>
          <textarea id={`asst-note-${alert.id}`} className="sa-input asst-textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          <div className="asst-acts">
            <button type="submit" className="sa-btn sa-btn-primary sa-btn-sm" disabled={busy || !note.trim()}>
              {closing === "resolve" ? "סגירה כטופלה" : "סגירה כלא רלוונטית"}
            </button>
            <button type="button" className="sa-btn sa-btn-ghost sa-btn-sm" onClick={() => setClosing(null)}>
              ביטול
            </button>
          </div>
        </form>
      ) : assigning ? (
        <div className="asst-close">
          <label htmlFor={`asst-worker-${alert.id}`}>מי מטפל</label>
          <select
            id={`asst-worker-${alert.id}`}
            className="sa-input"
            defaultValue=""
            disabled={busy}
            onChange={(e) => {
              if (e.target.value) run("assign", undefined, e.target.value);
            }}
          >
            <option value="" disabled>
              בחירת עובד
            </option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <div className="asst-acts">
            <button type="button" className="sa-btn sa-btn-ghost sa-btn-sm" onClick={() => setAssigning(false)}>
              ביטול
            </button>
          </div>
        </div>
      ) : (
        <div className="asst-acts">
          {alert.status === "new" ? (
            <button type="button" className="sa-btn sa-btn-primary sa-btn-sm" disabled={busy} onClick={() => run("take")}>
              אני מטפל
            </button>
          ) : null}
          <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" disabled={busy} onClick={() => setAssigning(true)}>
            {alert.owner_worker ? "שיוך מחדש" : "שיוך לעובד"}
          </button>
          <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" disabled={busy} onClick={() => setClosing("resolve")}>
            סגירה
          </button>
          <button type="button" className="sa-btn sa-btn-ghost sa-btn-sm" disabled={busy} onClick={() => setClosing("dismiss")}>
            לא רלוונטי
          </button>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── שיחה ───────────────────────── */

function ChatView(): ReactElement {
  const a = useAssistant();
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // The newest line stays in view as it grows.
  const last = a.messages[a.messages.length - 1];
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [a.messages.length, last?.content, last?.steps?.length]);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const submit = () => {
    if (!draft.trim() || a.sending) return;
    a.ask(draft);
    setDraft("");
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <>
      <div className="asst-body asst-chat">
        {a.messages.length === 0 ? (
          <div className="asst-start">
            <p className="asst-start-title">מה תרצה לדעת?</p>
            <p className="asst-start-sub">כל מספר בתשובה נשלף עכשיו מהנתונים, עם המקור ושעת העדכון. כשאין נתון, העוזר אומר שאין.</p>
            <ul>
              {SUGGESTIONS.map((q) => (
                <li key={q}>
                  <button type="button" onClick={() => a.ask(q)}>
                    {q}
                    <Icon name="chevron-left" size={16} className="asst-go" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          a.messages.map((m) => <Bubble key={m.id} message={m} />)
        )}
        <div ref={end} />
      </div>
      <form
        className="asst-compose"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea ref={input} className="sa-input asst-textarea" rows={1} value={draft} placeholder="שאלה על המלאי, ההזמנות, הספקים או התנועות" onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} aria-label="שאלה לעוזר" />
        <button type="submit" className="sa-btn sa-btn-primary sa-btn-icon" disabled={!draft.trim() || a.sending} aria-label="שליחה">
          <Icon name="arrow-up" size={16} />
        </button>
      </form>
    </>
  );
}

function Bubble({ message }: { message: ChatMessage }): ReactElement {
  const [showing, setShowing] = useState(false);
  if (message.role === "user") return <p className="asst-q">{message.content}</p>;

  if (message.pending) {
    const step = message.steps?.[message.steps.length - 1];
    return (
      <div className="asst-a is-pending" aria-live="polite">
        <span className="asst-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {step ? `בודק: ${step}` : "קורא את הנתונים"}
      </div>
    );
  }

  const sources = message.sources ?? [];
  const asOf = sources[sources.length - 1]?.as_of;
  return (
    <div className={`asst-a${message.failed ? " is-failed" : ""}`}>
      <Answer text={message.content} />
      {message.unverified && message.unverified.length > 0 ? <p className="asst-unverified">לא אומת מול הנתונים: {message.unverified.join(", ")}</p> : null}
      {sources.length > 0 ? (
        <div className="asst-sources">
          <button type="button" className="asst-sources-head" aria-expanded={showing} onClick={() => setShowing((v) => !v)}>
            <span>
              מקור: {sources.map((s) => s.purpose).join(" · ")}
              {asOf ? ` · נכון ל-${asOf.slice(11, 16)}` : ""}
            </span>
            <Icon name={showing ? "chevron-up" : "chevron-down"} size={14} />
          </button>
          {showing ? (
            <ul>
              {sources.map((s, i) => (
                <li key={i}>
                  <p>
                    {s.purpose} · {s.rows} שורות · {fmtDay(s.as_of)}
                  </p>
                  <pre dir="ltr">{s.sql}</pre>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : message.failed ? null : (
        <p className="asst-nosource">בלי שליפה מהנתונים</p>
      )}
    </div>
  );
}
