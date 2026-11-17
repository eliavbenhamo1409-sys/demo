"use client";

/**
 * תקלות as a list to deal with, not a list of reports. Three tabs by whose hands a fault is in: nobody's yet (דורש טיפול),
 * a worker's (בטיפול), closed (נסגר). A row reads right to left the way the question is asked: what broke, who said so,
 * who is on it, where it stands, and the one thing to do next, beside the fault and not at the far edge of the screen.
 */
import { Suspense, useCallback, useMemo, useState, type ReactElement } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AssignFault } from "@/components/app/AssignFault";
import { useUi } from "@/components/app/ui-state";
import { Button, EmptyState, Select, Showing, Table, Tabs, Toolbar, type SelectOption, type TableColumn } from "@/components/ui";
import { fmtAge, fmtDay, fmtElapsed, fmtFull, fmtName, fmtQty } from "@/lib/format";
import { DEFAULT_OBJECTS } from "@/lib/map3d/layout";
import { usePushWorkers } from "@/lib/push";
import { isTempId, normalizeName, useData, type Fault } from "@/lib/store";
import { only } from "../cells";
import { JustHandled, Page, Word, type Metric, type Tone } from "../parts";
import { daysBack } from "../work";

type Tab = "waiting" | "held" | "closed";

const toTab = (v: string | null): Tab => (v === "held" ? "held" : v === "closed" || v === "resolved" ? "closed" : "waiting");

const inTab = (f: Fault, tab: Tab) => (tab === "closed" ? f.status === "resolved" : f.status === "open" && (tab === "held") === Boolean(f.assigned_to));

/** How long faults usually stay open: the middle one of those closed lately. Null with nothing closed to judge by. */
function typicalTime(closed: Fault[]): string | null {
  const spans = closed.flatMap((f) => (f.resolved_at ? [Date.parse(f.resolved_at) - Date.parse(f.created_at)] : [])).filter((ms) => ms >= 0).sort((a, b) => a - b);
  if (spans.length === 0) return null;
  const took = fmtElapsed(new Date(0).toISOString(), new Date(spans[Math.floor(spans.length / 2)]).toISOString());
  return took ? `${fmtQty(took.n)} ${took.unit}` : "פחות מדקה";
}

function duration(f: Fault): string | null {
  if (!f.resolved_at) return null;
  const t = fmtElapsed(f.created_at, f.resolved_at);
  return t ? `תוך ${t.n === 1 ? t.unit : `${fmtQty(t.n)} ${t.unit}`}` : null;
}

export function Faults(): ReactElement {
  return (
    <Suspense fallback={null}>
      <FaultsInner />
    </Suspense>
  );
}

function FaultsInner(): ReactElement {
  const { state, product, worker, reopenFault } = useData();
  const { openAction, openFault, notify } = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const reachable = usePushWorkers();

  const tab = toTab(params.get("tab"));
  const setTab = useCallback(
    (next: Tab) => {
      const sp = new URLSearchParams(params.toString());
      if (next === "waiting") sp.delete("tab");
      else sp.set("tab", next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const [query, setQuery] = useState("");
  const [reporterId, setReporterId] = useState("");
  const [assigning, setAssigning] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /* ───────── counts ───────── */
  const counts = useMemo(() => {
    const c = { waiting: 0, held: 0, closed: 0 };
    for (const f of state.faults) c[f.status === "resolved" ? "closed" : f.assigned_to ? "held" : "waiting"] += 1;
    return c;
  }, [state.faults]);
  const open = counts.waiting + counts.held;

  const closedLately = useMemo(() => {
    const week = daysBack(7), month = daysBack(30);
    const closed = state.faults.filter((f) => f.status === "resolved" && f.resolved_at);
    return {
      week: closed.filter((f) => Date.parse(f.resolved_at ?? "") >= week).length,
      typical: typicalTime(closed.filter((f) => Date.parse(f.resolved_at ?? "") >= month)),
    };
  }, [state.faults]);

  // The store keeps faults newest first, so the last open one has waited longest.
  const oldest = useMemo(() => state.faults.filter((f) => f.status === "open").at(-1), [state.faults]);

  /* ───────── the list ───────── */
  const reporters = useMemo<SelectOption[]>(() => {
    const ids = new Set(state.faults.map((f) => f.reported_by).filter((id): id is string => Boolean(id)));
    return state.workers.filter((w) => ids.has(w.id)).map((w) => ({ value: w.id, label: w.name }));
  }, [state.faults, state.workers]);

  const whatOf = useCallback(
    (f: Fault): string => {
      const p = product(f.product_id);
      if (p) return fmtName(p.name);
      if (f.product_id) return "מוצר שנמחק";
      return DEFAULT_OBJECTS.find((o) => o.id === f.asset)?.name ?? f.asset ?? "ללא מוצר";
    },
    [product],
  );

  const q = normalizeName(query);
  const rows = useMemo(() => {
    const list = state.faults.filter((f) => {
      if (!inTab(f, tab)) return false;
      if (reporterId && f.reported_by !== reporterId) return false;
      if (!q) return true;
      return normalizeName([f.description, whatOf(f), worker(f.reported_by)?.name, worker(f.assigned_to)?.name].filter(Boolean).join(" ")).includes(q);
    });
    // What has waited longest leads; closed faults read back from the last to close.
    return tab === "closed" ? list.sort((a, b) => (b.resolved_at ?? "").localeCompare(a.resolved_at ?? "")) : list.reverse();
  }, [state.faults, tab, reporterId, q, whatOf, worker]);

  const reopen = useCallback(
    async (f: Fault) => {
      setBusyId(f.id);
      try {
        await reopenFault(f.id);
        notify({ tone: "success", title: "התקלה נפתחה מחדש", text: f.description });
      } catch (e) {
        notify({ tone: "danger", title: "פתיחת התקלה נכשלה", text: e instanceof Error ? e.message : undefined });
      } finally {
        setBusyId(null);
      }
    },
    [reopenFault, notify],
  );

  const columns = useMemo<TableColumn<Fault>[]>(() => {
    const stateOf = (f: Fault): { word: string; tone: Tone; title?: string } => {
      if (f.status === "resolved") return { word: "טופלה", tone: "ok" };
      if (!f.assigned_to) return { word: "ממתינה לשיוך", tone: "warn" };
      if (f.acknowledged_at) return { word: "התקבלה אצל העובד", tone: "ok", title: fmtFull(f.acknowledged_at) };
      if (f.notified_at) return { word: "נשלחה התראה", tone: "none", title: fmtFull(f.notified_at) };
      return { word: reachable && !reachable.has(f.assigned_to) ? "שובצה, בלי התראה" : "שובצה", tone: "none" };
    };
    return [
      {
        key: "what",
        title: "תקלה",
        className: "mn2-cell-main",
        render: (f) => (
          <>
            <span className="mn2-cell-title">{f.description}</span>
            <span className="mn2-cell-sub">{whatOf(f)}</span>
          </>
        ),
      },
      {
        key: "reported",
        title: "דווח על ידי",
        render: (f) => (
          <>
            <span className="mn2-cell-text mn2-nowrap">{worker(f.reported_by)?.name ?? "לא ידוע"}</span>
            <span className="mn2-cell-sub">{f.status === "resolved" ? fmtDay(f.created_at) : fmtAge(f.created_at)}</span>
          </>
        ),
      },
      {
        key: "holder",
        title: "אחראי לטיפול",
        render: (f) => {
          const holder = worker(f.assigned_to);
          return holder ? (
            <>
              <span className="mn2-cell-text mn2-nowrap">{holder.name}</span>
              {f.instruction ? <span className="mn2-cell-sub">{f.instruction}</span> : null}
            </>
          ) : (
            <span className="mn2-cell-unset">{f.status === "resolved" ? "לא שובץ" : "טרם שובץ"}</span>
          );
        },
      },
      {
        key: "state",
        title: "סטטוס",
        render: (f) => {
          const s = stateOf(f);
          const span = duration(f);
          return (
            <>
              <span title={s.title}><Word tone={s.tone}>{s.word}</Word></span>
              {span ? <span className="mn2-cell-sub">{span}</span> : null}
            </>
          );
        },
      },
      {
        key: "act",
        title: "פעולה",
        className: "mn2-cell-act",
        // One blue button in the list: the fault at its head, which has waited longest.
        render: (f, i) => {
          const lead = i === 0 ? "primary" : "secondary";
          return (
            <span className="mn2-acts">
              {f.status === "resolved" ? (
                <Button variant="ghost" size="sm" icon="refresh" isLoading={busyId === f.id} onClick={only(() => void reopen(f))}>פתיחה מחדש</Button>
              ) : f.assigned_to ? (
                <>
                  <Button variant={lead} size="sm" onClick={only(() => openFault(f.id))}>סגירה עם תיעוד</Button>
                  <Button variant="ghost" size="sm" onClick={only(() => setAssigning(f.id))}>שיוך מחדש</Button>
                </>
              ) : (
                <>
                  <Button variant={lead} size="sm" disabled={isTempId(f.id)} onClick={only(() => setAssigning(f.id))}>שיוך אחראי</Button>
                  <Button variant="ghost" size="sm" onClick={only(() => openFault(f.id))}>סגירה עם תיעוד</Button>
                </>
              )}
            </span>
          );
        },
      },
    ];
  }, [whatOf, worker, reachable, busyId, reopen, openFault]);

  /* ───────── the head ───────── */
  const lead =
    open === 0 ? "אין תקלות פתוחות. דיווח מהטלפון של עובד יופיע כאן."
    : counts.waiting === 0 ? `${counts.held === 1 ? "תקלה אחת פתוחה, והיא כבר אצל עובד" : `${fmtQty(counts.held)} תקלות פתוחות, וכולן כבר אצל עובדים`}. נשאר לעקוב ולסגור עם תיעוד.`
    : `${counts.waiting === 1 ? "תקלה אחת מחכה" : `${fmtQty(counts.waiting)} תקלות מחכות`} לשיוך אחראי${counts.held > 0 ? (counts.held === 1 ? ", ואחת כבר אצל עובד" : `, ו-${fmtQty(counts.held)} כבר אצל עובדים`) : ""}. שיוך שולח את התקלה לטלפון של העובד.`;

  const metrics: Metric[] = [
    { key: "open", label: "תקלות פתוחות", icon: "wrench", value: open, tone: open > 0 ? "bad" : "ok", note: open === 0 ? <span className="is-ok">הכל טופל</span> : `${fmtQty(counts.waiting)} בלי אחראי · ${fmtQty(counts.held)} אצל עובד` },
    { key: "oldest", label: "הוותיקה ביותר", icon: "clock", value: oldest ? fmtAge(oldest.created_at) : "אין", note: oldest ? <span className="mn2-clip">{oldest.description}</span> : "אין תקלה פתוחה" },
    { key: "week", label: "נסגרו השבוע", icon: "circle-check", value: closedLately.week, tone: closedLately.week > 0 ? "ok" : "none", note: "בשבעת הימים האחרונים" },
    { key: "typical", label: "זמן טיפול רגיל", icon: "hourglass", value: closedLately.typical ?? "לא זמין", note: closedLately.typical ? "החציון של 30 הימים האחרונים" : "עוד לא נסגרו תקלות החודש" },
  ];

  const tabs = [
    { value: "waiting", label: "דורש טיפול", count: counts.waiting },
    { value: "held", label: "בטיפול", count: counts.held },
    { value: "closed", label: "נסגר", count: counts.closed },
  ];

  const hasFilters = Boolean(q || reporterId);
  const empty = hasFilters ? (
    <EmptyState title="לא נמצאו תקלות" hint={q && !reporterId ? <>עבור „<bdi>{query.trim()}</bdi>”</> : "אפשר להסיר את הסינון"}>
      <Button variant="secondary" onClick={() => { setQuery(""); setReporterId(""); }}>ניקוי סינון</Button>
    </EmptyState>
  ) : tab === "waiting" ? (
    <EmptyState title="אין תקלות שמחכות לשיוך" hint={counts.held > 0 ? "כל התקלות הפתוחות כבר אצל עובד" : "דיווח מהטלפון יופיע כאן"}>
      {counts.held > 0 ? <Button variant="secondary" onClick={() => setTab("held")}>תקלות בטיפול</Button> : <Button variant="secondary" onClick={() => openAction("fault")}>דיווח תקלה</Button>}
    </EmptyState>
  ) : tab === "held" ? (
    <EmptyState title="אין תקלות אצל עובדים" hint="תקלה ששויכה לעובד תופיע כאן עד שתיסגר" />
  ) : (
    <EmptyState title="אין תקלות שנסגרו" hint="תקלה שנסגרה עם תיעוד נשמרת כאן" />
  );

  const assignee = assigning ? state.faults.find((f) => f.id === assigning && f.status === "open") : undefined;

  return (
    <Page
      title="תקלות"
      state={open > 0 ? { word: `${fmtQty(open)} פתוחות`, tone: "bad" } : { word: "הכל טופל", tone: "ok" }}
      lead={lead}
      action={<Button variant="primary" icon="tool" onClick={() => openAction("fault")}>דיווח תקלה</Button>}
      metrics={metrics}
      toolbar={
        <Toolbar
          tabs={<Tabs tabs={tabs} value={tab} onChange={(v) => setTab(toTab(v))} />}
          filters={reporters.length > 0 ? <Select options={reporters} value={reporterId} onChange={setReporterId} allLabel="כל המדווחים" placeholder="דווח על ידי" /> : null}
          query={query}
          onQuery={setQuery}
          placeholder="חיפוש לפי תיאור, מוצר או עובד"
        />
      }
    >
      <div className="sa-card mn2-sheet">
        {tab === "closed" ? null : <JustHandled kind="fault" />}
        <Table<Fault>
          caption="רשימת תקלות"
          className="mn2-table mn2-faults-table"
          columns={columns}
          data={rows}
          empty={empty}
          onRowClick={(f) => openFault(f.id)}
          footer={hasFilters && rows.length > 0 ? <Showing shown={rows.length} total={counts[tab]} /> : undefined}
        />
      </div>
      {assignee ? <AssignFault key={assignee.id} fault={assignee} reachable={reachable} onClose={() => setAssigning(null)} /> : null}
    </Page>
  );
}
