"use client";

/**
 * צוות as a duty roster: one line for each person, the seven days in columns, and the sum of every column standing over it
 * as the page's figure, so the team reads from the total down to who did it. Same data and the same forms as the shared
 * page; nobody is deleted, a form deactivates them.
 */

import { useCallback, useMemo, useState, type CSSProperties, type ReactElement, type SyntheticEvent } from "react";
import { useUi } from "@/components/app/ui-state";
import { Button, cx, EmptyState, SearchBar, Showing, Table, type TableColumn } from "@/components/ui";
import { fmtQty, fmtRelative } from "@/lib/format";
import { dayKey, normalizeName, useData, type Agent, type Worker } from "@/lib/store";
import { Figure } from "../Figure";

type Tab = "active" | "inactive" | "agents";

/** ISO timestamp of this month's first midnight, local time. */
function monthStartIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

const digitsOf = (text: string) => text.replace(/\D/g, "");

/** A search with letters in it looks for a name, even one with a number in it, so it never matches a phone. */
const phoneDigits = (q: string) => (/\p{L}/u.test(q) ? "" : digitsOf(q));

type Activity = { week: number; days: number[]; openFaults: number; last: string | null };
type AgentOrders = { open: number; month: number; last: string | null };

const NO_DAYS = [0, 0, 0, 0, 0, 0, 0];
const none = <span className="mh-tone-quiet">—</span>;

/** A figure in a row: quiet at zero, so the eye goes to who did something. */
const rowFigure = (n: number, tone?: string) => <span className={cx("mh-team-fig ltr", n === 0 ? "mh-tone-quiet" : tone)}>{fmtQty(n)}</span>;

function Edit({ onClick }: { onClick: () => void }): ReactElement {
  return (
    <span className="sa-row-actions" onClick={(e) => e.stopPropagation()}>
      <Button variant="ghost" size="sm" icon="edit" onClick={onClick}>עריכה</Button>
    </span>
  );
}

export function Team(): ReactElement {
  const { state, stats, weekly } = useData();
  const ui = useUi();

  const [tab, setTab] = useState<Tab>("active");
  const [query, setQuery] = useState("");
  const [spot, setSpot] = useState<Worker | null>(null);

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

  const team = useMemo(() => {
    const all = [...activity.values()];
    return {
      week: all.reduce((n, a) => n + a.week, 0),
      days: weekly.map((_, i) => all.reduce((n, a) => n + a.days[i], 0)),
      faults: all.reduce((n, a) => n + a.openFaults, 0),
      last: all.reduce<string | null>((latest, a) => (a.last && (!latest || a.last > latest) ? a.last : latest), null),
    };
  }, [activity, weekly]);

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

  // The row under the pointer or the keyboard fills its own share of the team's bars.
  const onRow = (e: SyntheticEvent<HTMLElement>) => {
    const row = e.target instanceof Element ? e.target.closest<HTMLTableRowElement>("tbody tr") : null;
    setSpot(row ? visible[row.sectionRowIndex] ?? null : null);
  };

  const columns = useMemo<TableColumn<Worker>[]>(
    () => [
      {
        key: "name",
        title: "עובד",
        render: (w) => (
          <span className="mh-row-main">
            <span className="mh-row-title" title={w.name}>{w.name}</span>
            <span className="mh-row-sub">{w.role}</span>
          </span>
        ),
      },
      {
        key: "days",
        title: (
          <span className="mh-team-days" dir="ltr">
            {weekly.map((d, i) => <span key={d.day} className={cx("mh-team-dayname", i === weekly.length - 1 && "is-today")}>{d.label}</span>)}
          </span>
        ),
        width: "var(--mh-team-c2)",
        render: (w) => {
          const a = activity.get(w.id);
          return (
            <span className="mh-team-days" dir="ltr" role="img" aria-label={`${fmtQty(a?.week ?? 0)} תנועות בשבעת הימים האחרונים`}>
              {(a?.days ?? NO_DAYS).map((n, i) => <span key={i} className={cx("mh-team-day", n === 0 && "is-none")}>{n === 0 ? "·" : fmtQty(n)}</span>)}
            </span>
          );
        },
      },
      { key: "week", title: "תנועות השבוע", width: "var(--mh-team-c3)", render: (w) => rowFigure(activity.get(w.id)?.week ?? 0) },
      {
        key: "faults",
        title: "תקלות פתוחות",
        width: "var(--mh-team-c4)",
        render: (w) => {
          const n = activity.get(w.id)?.openFaults ?? 0;
          return n > 0 ? rowFigure(n, "mh-tone-out") : none;
        },
      },
      {
        key: "last",
        title: "פעילות אחרונה",
        width: "var(--mh-team-c5)",
        className: "whitespace-nowrap",
        render: (w) => {
          const last = activity.get(w.id)?.last;
          return last ? fmtRelative(last) : none;
        },
      },
      { key: "actions", title: <span className="sa-sr">פעולות</span>, width: "var(--mh-team-c6)", render: (w) => <Edit onClick={() => edit(w)} /> },
    ],
    [activity, weekly, edit],
  );

  const lens: { key: Tab; word: string; count: number }[] = [
    { key: "active", word: "פעילים", count: activeWorkers.length },
    { key: "inactive", word: "לא פעילים", count: inactiveWorkers.length },
    { key: "agents", word: "סוכנים", count: state.agents.length },
  ];

  const empty =
    state.workers.length === 0 ? (
      <EmptyState title="אין עובדים" hint="עובד חדש יוכל להיכנס מהטלפון">
        <Button variant="secondary" onClick={() => ui.openAction("new-worker")}>עובד חדש</Button>
      </EmptyState>
    ) : q ? (
      <EmptyState title="לא נמצאו עובדים" hint={<>עבור „{query.trim()}”</>} />
    ) : tab === "inactive" ? (
      <EmptyState title="כל העובדים פעילים" hint="עובד שהושבת יופיע כאן" />
    ) : (
      <EmptyState title="אין עובדים פעילים" hint="אפשר להפעיל עובד מחדש או להוסיף חדש">
        <Button variant="secondary" onClick={() => ui.openAction("new-worker")}>עובד חדש</Button>
      </EmptyState>
    );

  const onAgents = tab === "agents";
  const top = Math.max(1, ...team.days);
  const share = spot ? activity.get(spot.id)?.days : undefined;

  return (
    <div className="mh-team">
      <header className="mh-team-title">
        <h1 className="sa-page-title">צוות</h1>
        {onAgents ? (
          <Button variant="primary" icon="plus" onClick={() => ui.openAction("new-agent")}>סוכן חדש</Button>
        ) : (
          <Button variant="primary" icon="plus" onClick={() => ui.openAction("new-worker")}>עובד חדש</Button>
        )}
      </header>

      <div className="mh-team-bar">
        <div className="mh-lens" role="tablist" aria-label="סינון הצוות">
          {lens.map((item) => (
            <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={cx("mh-lens-item", tab === item.key && "is-on")} onClick={() => setTab(item.key)}>
              <span className="mh-lens-n ltr">{fmtQty(item.count)}</span>
              <span className="mh-lens-word">{item.word}</span>
            </button>
          ))}
        </div>
        <SearchBar kbd={false} value={query} onChange={setQuery} placeholder={onAgents ? "חיפוש לפי שם או טלפון" : "חיפוש לפי שם או תפקיד"} />
      </div>

      {onAgents ? (
        <AgentsRoster query={query} openOrders={stats.openOrders} />
      ) : (
        <>
          <div className="mh-team-band">
            <span className="mh-team-who">{spot ? spot.name : null}</span>
            <span className="mh-team-bars" dir="ltr" aria-hidden="true">
              {team.days.map((n, i) => (
                <i key={weekly[i].day} style={{ "--h": n / top } as CSSProperties}>
                  <b style={{ "--share": share && n > 0 ? share[i] / n : 0 } as CSSProperties} />
                </i>
              ))}
            </span>
            <Figure className="mh-team-sum" text={fmtQty(team.week)} label={`${fmtQty(team.week)} תנועות השבוע`} />
            <Figure className={cx("mh-team-sum", team.faults > 0 && "mh-tone-out")} text={fmtQty(team.faults)} label={`${fmtQty(team.faults)} תקלות פתוחות`} />
            <span className="mh-team-sumword">{team.last ? fmtRelative(team.last) : "—"}</span>
          </div>
          <div onPointerOver={onRow} onPointerLeave={() => setSpot(null)} onFocus={onRow} onBlur={() => setSpot(null)}>
            <Table<Worker>
              caption="רשימת העובדים"
              className={cx("mh-team-table", tab === "inactive" && "is-off")}
              columns={columns}
              data={visible}
              selectedId={selectedId}
              empty={empty}
              onRowClick={edit}
              footer={q && visible.length > 0 ? <Showing shown={visible.length} total={tab === "active" ? activeWorkers.length : inactiveWorkers.length} /> : undefined}
            />
          </div>
        </>
      )}
    </div>
  );
}

/** Every agent, active first, with what they ordered. Inactive agents stay listed: their orders are still here. */
function AgentsRoster({ query, openOrders }: { query: string; openOrders: number }): ReactElement {
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

  const team = useMemo(() => {
    const all = [...orders.values()];
    return { month: all.reduce((n, a) => n + a.month, 0), last: all.reduce<string | null>((latest, a) => (a.last && (!latest || a.last > latest) ? a.last : latest), null) };
  }, [orders]);

  const q = normalizeName(query);
  const visible = useMemo(() => {
    const digits = phoneDigits(q);
    const list = q ? state.agents.filter((a) => normalizeName(a.name).includes(q) || (digits !== "" && digitsOf(a.phone ?? "").includes(digits))) : state.agents;
    return [...list].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "he"));
  }, [state.agents, q]);

  const edit = useCallback((a: Agent) => ui.openAction("edit-agent", { agentId: a.id }), [ui]);

  const selectedId = ui.panel?.type === "action" && ui.panel.kind === "edit-agent" ? ui.panel.ctx.agentId : undefined;

  const columns = useMemo<TableColumn<Agent>[]>(
    () => [
      {
        key: "name",
        title: "סוכן",
        render: (a) => (
          <span className="mh-row-main">
            <span className="mh-row-title" title={a.name}>{a.name}</span>
            {a.active ? null : <span className="mh-row-sub">לא פעיל</span>}
          </span>
        ),
      },
      {
        key: "phone",
        title: "טלפון",
        width: "var(--mh-team-c2)",
        render: (a) => (a.phone ? <a className="mh-team-phone" href={`tel:${digitsOf(a.phone)}`} onClick={(e) => e.stopPropagation()}><bdi>{a.phone}</bdi></a> : none),
      },
      { key: "open", title: "הזמנות פתוחות", width: "var(--mh-team-c3)", render: (a) => rowFigure(orders.get(a.id)?.open ?? 0) },
      { key: "month", title: "הזמנות החודש", width: "var(--mh-team-c4)", render: (a) => rowFigure(orders.get(a.id)?.month ?? 0) },
      {
        key: "last",
        title: "הזמנה אחרונה",
        width: "var(--mh-team-c5)",
        className: "whitespace-nowrap",
        render: (a) => {
          const last = orders.get(a.id)?.last;
          return last ? fmtRelative(last) : none;
        },
      },
      { key: "actions", title: <span className="sa-sr">פעולות</span>, width: "var(--mh-team-c6)", render: (a) => <Edit onClick={() => edit(a)} /> },
    ],
    [orders, edit],
  );

  const empty =
    state.agents.length === 0 ? (
      <EmptyState title="אין סוכנים" hint="סוכן חדש ייכנס לקטלוג מהטלפון">
        <Button variant="secondary" onClick={() => ui.openAction("new-agent")}>סוכן חדש</Button>
      </EmptyState>
    ) : (
      <EmptyState title="לא נמצאו סוכנים" hint={<>עבור „{query.trim()}”</>} />
    );

  return (
    <>
      <div className="mh-team-band is-agents">
        <span />
        <span />
        <Figure className="mh-team-sum" text={fmtQty(openOrders)} label={`${fmtQty(openOrders)} הזמנות פתוחות`} />
        <Figure className="mh-team-sum" text={fmtQty(team.month)} label={`${fmtQty(team.month)} הזמנות החודש`} />
        <span className="mh-team-sumword">{team.last ? fmtRelative(team.last) : "—"}</span>
      </div>
      <Table<Agent>
        caption="רשימת הסוכנים"
        className="mh-team-table is-agents"
        columns={columns}
        data={visible}
        selectedId={selectedId}
        empty={empty}
        onRowClick={edit}
        footer={visible.length > 0 && visible.length < state.agents.length ? <Showing shown={visible.length} total={state.agents.length} /> : undefined}
      />
    </>
  );
}
