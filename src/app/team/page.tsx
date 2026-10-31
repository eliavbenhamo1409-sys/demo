"use client";

/**
 * צוות — the workers who use the phone app. Who is active, what each one did
 * lately, and a way to rename, change role or deactivate without deleting
 * (movements keep pointing at the worker).
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { normalizeName, useData, type Worker } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { Avatar, Badge, Button, EmptyState, SearchBar, Table, Tabs, type TableColumn } from "@/components/ui";
import { fmtQty, fmtRelative } from "@/lib/format";

type Tab = "active" | "inactive";

/** ISO timestamp of seven days ago; rows are compared as ISO strings like the store does. */
function weekAgoIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString();
}

type Activity = { week: number; total: number; openFaults: number; last: string | null };

export default function TeamPage() {
  const { state } = useData();
  const ui = useUi();

  const [tab, setTab] = useState<Tab>("active");
  const [query, setQuery] = useState("");

  const loading = state.status === "loading";

  /* ───────── per-worker activity (from the recent movements the store holds) ───────── */
  const activity = useMemo(() => {
    const since = weekAgoIso();
    const map = new Map<string, Activity>();
    const get = (id: string) => {
      let a = map.get(id);
      if (!a) {
        a = { week: 0, total: 0, openFaults: 0, last: null };
        map.set(id, a);
      }
      return a;
    };
    for (const m of state.movements) {
      if (!m.worker_id) continue;
      const a = get(m.worker_id);
      a.total += 1;
      if (m.created_at >= since) a.week += 1;
      if (!a.last || m.created_at > a.last) a.last = m.created_at;
    }
    for (const f of state.faults) {
      if (!f.reported_by) continue;
      const a = get(f.reported_by);
      if (f.status === "open") a.openFaults += 1;
      if (!a.last || f.created_at > a.last) a.last = f.created_at;
    }
    return map;
  }, [state.movements, state.faults]);

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
        render: (w) => (
          <span className={w.active ? "sa-team-name" : "sa-team-name is-inactive"}>
            <Avatar name={w.name} size="sm" />
            <span className="sa-cell-primary sa-truncate">{w.name}</span>
          </span>
        ),
      },
      { key: "role", title: "תפקיד", muted: true, width: "140px", render: (w) => w.role },
      {
        key: "week",
        title: "תנועות השבוע",
        align: "num",
        width: "140px",
        render: (w) => {
          const n = activity.get(w.id)?.week ?? 0;
          return <span className={n === 0 ? "text-ink-3" : undefined}>{fmtQty(n)}</span>;
        },
      },
      {
        key: "faults",
        title: "תקלות פתוחות",
        align: "num",
        width: "140px",
        render: (w) => {
          const n = activity.get(w.id)?.openFaults ?? 0;
          return n > 0 ? <Badge tone="danger" count>{fmtQty(n)}</Badge> : <span className="text-ink-3">—</span>;
        },
      },
      {
        key: "last",
        title: "פעילות אחרונה",
        muted: true,
        width: "160px",
        render: (w) => {
          const last = activity.get(w.id)?.last;
          return last ? fmtRelative(last) : "—";
        },
      },
      {
        key: "active",
        title: "סטטוס",
        width: "120px",
        render: (w) => (w.active ? <Badge tone="success" dot>פעיל</Badge> : <Badge tone="neutral">לא פעיל</Badge>),
      },
      {
        key: "actions",
        title: <span className="sa-sr">פעולות</span>,
        width: "64px",
        render: (w) => (
          <span className="sa-row-actions" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" iconOnly icon="edit" aria-label="עריכה" title="עריכה" onClick={() => edit(w)} />
          </span>
        ),
      },
    ],
    [activity, edit],
  );

  /* ───────── header ───────── */
  const subline: ReactNode[] = [];
  if (activeWorkers.length > 0) subline.push(<><span className="sa-num">{fmtQty(activeWorkers.length)}</span> עובדים פעילים</>);
  if (inactiveWorkers.length > 0) subline.push(<><span className="sa-num">{fmtQty(inactiveWorkers.length)}</span> לא פעילים</>);

  const tabs = [
    { value: "active", label: "פעילים", count: activeWorkers.length },
    { value: "inactive", label: "לא פעילים", count: inactiveWorkers.length },
  ];

  const empty =
    state.workers.length === 0 ? (
      <EmptyState icon="user" title="אין עובדים עדיין" hint="עובד שתוסיף כאן יוכל להיכנס לאפליקציית הטלפון ולדווח קליטות, הוצאות ותקלות">
        <Button variant="primary" icon="plus" onClick={() => ui.openAction("new-worker")}>עובד חדש</Button>
      </EmptyState>
    ) : q ? (
      <EmptyState icon="search" title="לא נמצאו עובדים" hint={<>אין תוצאות עבור „{query.trim()}”</>} />
    ) : tab === "inactive" ? (
      <EmptyState icon="check-circle" title="כל העובדים פעילים" hint="עובד שתשבית יופיע כאן ולא יוכל להיכנס מהטלפון" />
    ) : (
      <EmptyState icon="user" title="אין עובדים פעילים" hint="הפעל מחדש עובד מהרשימה או הוסף חדש">
        <Button variant="primary" icon="plus" onClick={() => ui.openAction("new-worker")}>עובד חדש</Button>
      </EmptyState>
    );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-[1_1_320px]">
          <h1 className="sa-page-title" style={{ fontSize: 30, lineHeight: "36px", fontWeight: 600 }}>צוות</h1>
          <p className="sa-page-sub">
            מי נכנס לאפליקציית הטלפון ומה כל אחד עשה לאחרונה.
            {subline.map((c, i) => (
              <span key={i}> · {c}</span>
            ))}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="primary" icon="plus" onClick={() => ui.openAction("new-worker")}>עובד חדש</Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-[var(--space-3)]">
        <SearchBar kbd={false} value={query} onChange={setQuery} placeholder="חיפוש לפי שם או תפקיד…" className="min-w-[240px] max-w-[480px] flex-1" />
        <Tabs tabs={tabs} value={tab} onChange={(v) => setTab(v === "inactive" ? "inactive" : "active")} />
      </div>

      <Table<Worker>
        caption="רשימת העובדים"
        columns={columns}
        data={visible}
        isLoading={loading}
        skeletonRows={4}
        selectedId={selectedId}
        empty={empty}
        onRowClick={edit}
        footer={
          !loading && visible.length > 0 ? (
            <span>
              מציג <span className="sa-num">{fmtQty(visible.length)}</span> מתוך <span className="sa-num">{fmtQty(state.workers.length)}</span>
            </span>
          ) : undefined
        }
      />
    </div>
  );
}
