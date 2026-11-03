"use client";

/**
 * צוות — the workers who use the phone app and the agents who sell from the
 * catalogue site. Who is active, what each one did lately, and a way to edit or
 * deactivate without deleting (movements and orders keep pointing at them).
 */
import { useCallback, useMemo, useState } from "react";
import { dayKey, normalizeName, useData, type Agent, type Worker } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { SparkBars } from "@/components/app/Viz";
import { Button, Count, EmptyState, PageHead, Showing, Table, Tabs, Toolbar, type TableColumn } from "@/components/ui";
import { fmtAge, fmtQty } from "@/lib/format";

type Tab = "active" | "inactive" | "agents";

/** ISO timestamp of this month's first midnight, local time. */
function monthStartIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

/** The name gives way before a figure does, so a long name truncates and no column is ever cut. On phones it takes the row. */
const TEAM_NAME_CELL = "w-[38%] max-w-0 max-[600px]:w-full";

const digitsOf = (text: string) => text.replace(/\D/g, "");

/** A search with letters in it looks for a name, even one with a number in it, so it never matches a phone. */
const phoneDigits = (q: string) => (/\p{L}/u.test(q) ? "" : digitsOf(q));

type Activity = { week: number; days: number[]; openFaults: number; last: string | null };

const NO_DAYS = [0, 0, 0, 0, 0, 0, 0];

type AgentOrders = { open: number; month: number; last: string | null };

export default function TeamPage() {
  const { state, stats, weekly } = useData();
  const ui = useUi();

  const [tab, setTab] = useState<Tab>("active");
  const [query, setQuery] = useState("");

  const loading = state.status === "loading";

  /* ───────── per-worker activity (from the recent movements the store holds) ───────── */
  const activity = useMemo(() => {
    // The week is the overview's seven days, so a figure always equals its bars.
    const dayIndex = new Map(weekly.map((d, i) => [d.day, i]));
    const map = new Map<string, Activity>();
    const get = (id: string) => {
      let a = map.get(id);
      if (!a) {
        a = { week: 0, days: weekly.map(() => 0), openFaults: 0, last: null };
        map.set(id, a);
      }
      return a;
    };
    for (const m of state.movements) {
      if (!m.worker_id) continue;
      const a = get(m.worker_id);
      const day = dayIndex.get(dayKey(m.created_at));
      if (day !== undefined) {
        a.days[day] += 1;
        a.week += 1;
      }
      if (!a.last || m.created_at > a.last) a.last = m.created_at;
    }
    for (const f of state.faults) {
      if (!f.reported_by) continue;
      const a = get(f.reported_by);
      if (f.status === "open") a.openFaults += 1;
      if (!a.last || f.created_at > a.last) a.last = f.created_at;
    }
    return map;
  }, [state.movements, state.faults, weekly]);

  const weekMoves = useMemo(() => [...activity.values()].reduce((n, a) => n + a.week, 0), [activity]);
  const activeWorkers = useMemo(() => state.workers.filter((w) => w.active), [state.workers]);
  const inactiveWorkers = useMemo(() => state.workers.filter((w) => !w.active), [state.workers]);

  const q = normalizeName(query);
  const visible = useMemo(() => {
    const base = tab === "active" ? activeWorkers : inactiveWorkers;
    const list = q ? base.filter((w) => normalizeName(w.name).includes(q) || normalizeName(w.role).includes(q)) : base;
    // busiest this week first, then by name
    return [...list].sort((a, b) => {
      const wa = activity.get(a.id)?.week ?? 0;
      const wb = activity.get(b.id)?.week ?? 0;
      return wb - wa || a.name.localeCompare(b.name, "he");
    });
  }, [tab, activeWorkers, inactiveWorkers, q, activity]);

  const edit = useCallback((w: Worker) => ui.openAction("edit-worker", { workerId: w.id }), [ui]);

  const selectedId = ui.panel?.type === "action" && ui.panel.kind === "edit-worker" ? ui.panel.ctx.workerId : undefined;

  const columns = useMemo<TableColumn<Worker>[]>(
    () => [
      {
        key: "name",
        title: "עובד",
        className: TEAM_NAME_CELL,
        render: (w) => (
          <>
            <span className={w.active ? "sa-cell-primary sa-truncate block" : "sa-cell-primary sa-truncate block sa-team-inactive"} title={w.name}>{w.name}</span>
            <span className="sa-cell-sub sa-truncate">{w.role}</span>
          </>
        ),
      },
      {
        key: "week",
        title: "תנועות השבוע",
        width: "220px",
        render: (w) => {
          const a = activity.get(w.id);
          const n = a?.week ?? 0;
          return (
            <span className="sa-team-week">
              <span className={n === 0 ? "sa-row-figure text-ink-3" : "sa-row-figure"}>{fmtQty(n)}</span>
              <SparkBars values={a?.days ?? NO_DAYS} label={`${fmtQty(n)} תנועות בשבעת הימים האחרונים`} />
            </span>
          );
        },
      },
      {
        key: "faults",
        title: "תקלות פתוחות",
        width: "140px",
        render: (w) => {
          const n = activity.get(w.id)?.openFaults ?? 0;
          return n > 0 ? <span className="sa-row-figure text-danger-text">{fmtQty(n)}</span> : <span className="text-ink-3">—</span>;
        },
      },
      {
        key: "last",
        title: "פעילות אחרונה",
        width: "176px",
        className: "whitespace-nowrap",
        render: (w) => {
          const last = activity.get(w.id)?.last;
          return last ? fmtAge(last) : <span className="text-ink-3">—</span>;
        },
      },
    ],
    [activity],
  );

  const tabs = [
    { value: "active", label: "פעילים", count: activeWorkers.length },
    { value: "inactive", label: "לא פעילים", count: inactiveWorkers.length },
    { value: "agents", label: "סוכנים", count: state.agents.length },
  ];

  const empty =
    state.workers.length === 0 ? (
      <EmptyState title="אין עובדים" hint="עובד חדש יוכל להיכנס מהטלפון">
        <Button variant="secondary" onClick={() => ui.openAction("new-worker")}>עובד חדש</Button>
      </EmptyState>
    ) : q ? (
      <EmptyState title="לא נמצאו עובדים" hint={<>עבור „{query.trim()}”</>}>
        <Button variant="secondary" onClick={() => setQuery("")}>ניקוי סינון</Button>
      </EmptyState>
    ) : tab === "inactive" ? (
      <EmptyState title="כל העובדים פעילים" hint="עובד שהושבת יופיע כאן" />
    ) : (
      <EmptyState title="אין עובדים פעילים" hint="אפשר להפעיל עובד מחדש או להוסיף חדש">
        <Button variant="secondary" onClick={() => ui.openAction("new-worker")}>עובד חדש</Button>
      </EmptyState>
    );

  const onAgents = tab === "agents";

  return (
    <div className="sa-page">
      <PageHead
        title="צוות"
        sub={onAgents ? <Count n={stats.openOrders} one="הזמנה פתוחה" many="הזמנות פתוחות" /> : <Count n={weekMoves} one="תנועה השבוע" many="תנועות השבוע" />}
        actions={
          onAgents ? (
            <Button variant="primary" icon="plus" onClick={() => ui.openAction("new-agent")}>סוכן חדש</Button>
          ) : (
            <Button variant="primary" icon="plus" onClick={() => ui.openAction("new-worker")}>עובד חדש</Button>
          )
        }
      />

      <Toolbar
        tabs={<Tabs tabs={tabs} value={tab} onChange={(v) => setTab(v === "inactive" || v === "agents" ? v : "active")} />}
        query={query}
        onQuery={setQuery}
        placeholder={onAgents ? "חיפוש לפי שם או טלפון" : "חיפוש לפי שם או תפקיד"}
      />

      {onAgents ? (
        <AgentsTable query={query} onClear={() => setQuery("")} />
      ) : (
        <Table<Worker>
          caption="רשימת העובדים"
          className="sa-team-table"
          columns={columns}
          data={visible}
          isLoading={loading}
          skeletonRows={4}
          selectedId={selectedId}
          empty={empty}
          onRowClick={edit}
          footer={
            !loading && q && visible.length > 0 ? <Showing shown={visible.length} total={tab === "active" ? activeWorkers.length : inactiveWorkers.length} /> : undefined
          }
        />
      )}
    </div>
  );
}

/** Every agent, active first, with what they ordered. Inactive agents stay listed: their orders are still here. */
function AgentsTable({ query, onClear }: { query: string; onClear: () => void }) {
  const { state } = useData();
  const ui = useUi();

  const orders = useMemo(() => {
    const since = monthStartIso();
    const map = new Map<string, AgentOrders>();
    for (const o of state.orders) {
      let a = map.get(o.agent_id);
      if (!a) {
        a = { open: 0, month: 0, last: null };
        map.set(o.agent_id, a);
      }
      if (o.status === "open") a.open += 1;
      if (o.created_at >= since) a.month += 1;
      if (!a.last || o.created_at > a.last) a.last = o.created_at;
    }
    return map;
  }, [state.orders]);

  const q = normalizeName(query);
  const visible = useMemo(() => {
    const digits = phoneDigits(q);
    const list = q ? state.agents.filter((a) => normalizeName(a.name).includes(q) || (digits !== "" && digitsOf(a.phone ?? "").includes(digits))) : state.agents;
    return [...list].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "he"));
  }, [state.agents, q]);

  const edit = useCallback((a: Agent) => ui.openAction("edit-agent", { agentId: a.id }), [ui]);

  const selectedId = ui.panel?.type === "action" && ui.panel.kind === "edit-agent" ? ui.panel.ctx.agentId : undefined;

  const columns = useMemo<TableColumn<Agent>[]>(() => {
    const figure = (n: number) => <span className={n === 0 ? "sa-row-figure text-ink-3" : "sa-row-figure"}>{fmtQty(n)}</span>;
    return [
      {
        key: "name",
        title: "סוכן",
        className: TEAM_NAME_CELL,
        render: (a) => (
          <>
            <span className={a.active ? "sa-cell-primary sa-truncate block" : "sa-cell-primary sa-truncate block sa-team-inactive"} title={a.name}>{a.name}</span>
            <span className="sa-cell-sub sa-truncate">
              {a.active ? null : a.phone ? "לא פעיל · " : "לא פעיל"}
              {a.phone ? <bdi>{a.phone}</bdi> : null}
            </span>
          </>
        ),
      },
      { key: "open", title: "הזמנות פתוחות", width: "150px", render: (a) => figure(orders.get(a.id)?.open ?? 0) },
      { key: "month", title: "הזמנות החודש", width: "150px", render: (a) => figure(orders.get(a.id)?.month ?? 0) },
      {
        key: "last",
        title: "הזמנה אחרונה",
        width: "176px",
        className: "whitespace-nowrap",
        render: (a) => {
          const last = orders.get(a.id)?.last;
          return last ? fmtAge(last) : <span className="text-ink-3">—</span>;
        },
      },
    ];
  }, [orders]);

  const empty =
    state.agents.length === 0 ? (
      <EmptyState title="אין סוכנים" hint="סוכן חדש ייכנס לקטלוג מהטלפון">
        <Button variant="secondary" onClick={() => ui.openAction("new-agent")}>סוכן חדש</Button>
      </EmptyState>
    ) : (
      <EmptyState title="לא נמצאו סוכנים" hint={<>עבור „{query.trim()}”</>}>
        <Button variant="secondary" onClick={onClear}>ניקוי סינון</Button>
      </EmptyState>
    );

  return (
    <Table<Agent>
      caption="רשימת הסוכנים"
      className="sa-team-table"
      columns={columns}
      data={visible}
      isLoading={state.status === "loading"}
      skeletonRows={4}
      selectedId={selectedId}
      empty={empty}
      onRowClick={edit}
      footer={visible.length > 0 && visible.length < state.agents.length ? <Showing shown={visible.length} total={state.agents.length} /> : undefined}
    />
  );
}
