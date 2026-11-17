"use client";

/**
 * תקלות as a list to deal with, not a list of reports. The open ones stand together, those nobody holds first; the
 * closed ones wait behind one quiet line at the foot of the list, since a page of tasks is about what is open.
 * A row reads the way the question is asked: what broke, who said so, whose hands it is in, and the one thing to do
 * next. Every fact is said once: a fault with no one on it says so where the name would be, and its button is the
 * assignment.
 */
import { Suspense, useCallback, useMemo, useState, type ReactElement } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AssignFault } from "@/components/app/AssignFault";
import { useUi } from "@/components/app/ui-state";
import { Button, EmptyState, Icon, Showing, Table, SearchBar, type TableColumn } from "@/components/ui";
import { fmtAge, fmtDay, fmtElapsed, fmtFull, fmtName, fmtQty } from "@/lib/format";
import { DEFAULT_OBJECTS } from "@/lib/map3d/layout";
import { usePushWorkers } from "@/lib/push";
import { isTempId, normalizeName, useData, type Fault } from "@/lib/store";
import { only } from "../cells";
import { Check, JustHandled, Page, Word } from "../parts";

type Tab = "open" | "closed";

/** Older links named the open faults by whose hands they were in; both are the open list now. */
const toTab = (v: string | null): Tab => (v === "closed" || v === "resolved" ? "closed" : "open");

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
  const { openFault, notify } = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const reachable = usePushWorkers();

  const tab = toTab(params.get("tab"));
  const setTab = useCallback(
    (next: Tab) => {
      const sp = new URLSearchParams(params.toString());
      if (next === "open") sp.delete("tab");
      else sp.set("tab", next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const [query, setQuery] = useState("");
  const [assigning, setAssigning] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const whatOf = useCallback(
    (f: Fault): string => {
      const p = product(f.product_id);
      if (p) return fmtName(p.name);
      if (f.product_id) return "מוצר שנמחק";
      return DEFAULT_OBJECTS.find((o) => o.id === f.asset)?.name ?? f.asset ?? "ללא מוצר";
    },
    [product],
  );

  /* ───────── the list ───────── */
  const inTab = useMemo(() => state.faults.filter((f) => (f.status === "resolved") === (tab === "closed")), [state.faults, tab]);
  const closed = useMemo(() => state.faults.filter((f) => f.status === "resolved").length, [state.faults]);

  const q = normalizeName(query);
  const rows = useMemo(() => {
    const list = inTab.filter((f) => !q || normalizeName([f.description, whatOf(f), worker(f.reported_by)?.name, worker(f.assigned_to)?.name].filter(Boolean).join(" ")).includes(q));
    if (tab === "closed") return list.sort((a, b) => (b.resolved_at ?? "").localeCompare(a.resolved_at ?? ""));
    // The store keeps faults newest first. What nobody holds leads, and inside each the one that has waited longest.
    return list.reverse().sort((a, b) => Number(Boolean(a.assigned_to)) - Number(Boolean(b.assigned_to)));
  }, [inTab, tab, q, whatOf, worker]);

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
    const what: TableColumn<Fault> = {
      key: "what",
      title: "תקלה",
      className: "mn2-cell-main",
      render: (f) => (
        <>
          <span className="mn2-cell-title">{f.description}</span>
          <span className="mn2-cell-sub">{whatOf(f)}</span>
        </>
      ),
    };
    const reported: TableColumn<Fault> = {
      key: "reported",
      title: "דווחה",
      render: (f) => (
        <>
          <span className="mn2-cell-text mn2-nowrap">{f.status === "resolved" ? fmtDay(f.created_at) : fmtAge(f.created_at)}</span>
          <span className="mn2-cell-sub mn2-nowrap">{worker(f.reported_by)?.name ?? "לא ידוע"}</span>
        </>
      ),
    };
    const holder: TableColumn<Fault> = {
      key: "holder",
      title: "אחראי",
      render: (f) => {
        const who = worker(f.assigned_to);
        if (!who) return f.status === "resolved" ? <span className="mn2-cell-unset">לא שובץ</span> : <Word tone="warn">ללא אחראי</Word>;
        // Where the hand-over stands, only while it matters: closed, the row says how long it took instead.
        const reach =
          f.status === "resolved" ? null
          : f.acknowledged_at ? <span title={fmtFull(f.acknowledged_at)}><Word tone="ok">קיבל</Word></span>
          : f.notified_at ? <span title={fmtFull(f.notified_at)}>נשלחה התראה</span>
          : reachable && !reachable.has(who.id) ? "בלי התראה לטלפון"
          : null;
        return (
          <>
            <span className="mn2-cell-text mn2-nowrap">{who.name}</span>
            {reach ? <span className="mn2-cell-sub">{reach}</span> : null}
          </>
        );
      },
    };
    const act: TableColumn<Fault> = {
      key: "act",
      title: <span className="sr-only">פעולה</span>,
      className: "mn2-cell-act",
      // One blue button in the list: the fault at its head.
      render: (f, i) => {
        const lead = i === 0 ? "primary" : "secondary";
        return (
          <span className="mn2-acts">
            {f.status === "resolved" ? (
              <Button variant="ghost" size="sm" icon="refresh" isLoading={busyId === f.id} onClick={only(() => void reopen(f))}>פתיחה מחדש</Button>
            ) : f.assigned_to ? (
              <>
                <Button variant="ghost" size="sm" onClick={only(() => setAssigning(f.id))}>שיוך מחדש</Button>
                <Button variant={lead} size="sm" onClick={only(() => openFault(f.id))}>סגירה</Button>
              </>
            ) : (
              <Button variant={lead} size="sm" disabled={isTempId(f.id)} onClick={only(() => setAssigning(f.id))}>שיוך אחראי</Button>
            )}
          </span>
        );
      },
    };
    if (tab === "closed") {
      const took: TableColumn<Fault> = { key: "took", title: "נסגרה", render: (f) => <span className="mn2-cell-text mn2-nowrap">{duration(f) ?? "—"}</span> };
      return [what, reported, holder, took, act];
    }
    return [what, reported, holder, act];
  }, [tab, whatOf, worker, reachable, busyId, reopen, openFault]);

  const noMatch = (
    <EmptyState title="לא נמצאו תקלות" hint={<>עבור „<bdi>{query.trim()}</bdi>”</>}>
      <Button variant="secondary" onClick={() => setQuery("")}>ניקוי החיפוש</Button>
    </EmptyState>
  );

  const assignee = assigning ? state.faults.find((f) => f.id === assigning && f.status === "open") : undefined;

  return (
    <Page title="תקלות" tools={<SearchBar kbd={false} value={query} onChange={setQuery} placeholder="חיפוש תקלה, מוצר או עובד" />}>
      <div className="sa-card mn2-sheet">
        {tab === "closed" ? (
          <div className="mn2-sheet-head">
            <h2 className="mn2-sheet-title">תקלות שנסגרו</h2>
            <Button variant="ghost" size="sm" icon="chevron-right" onClick={() => setTab("open")}>לתקלות הפתוחות</Button>
          </div>
        ) : (
          <JustHandled kind="fault" />
        )}
        {inTab.length === 0 && tab === "open" ? (
          <div className="mn2-clear">
            <Check size={36} />
            <p className="mn2-clear-title">אין תקלות פתוחות</p>
          </div>
        ) : (
          <Table<Fault>
            caption="רשימת תקלות"
            className="mn2-table mn2-faults-table"
            columns={columns}
            data={rows}
            empty={q ? noMatch : <EmptyState title="אין תקלות שנסגרו" />}
            onRowClick={(f) => openFault(f.id)}
            footer={q && rows.length > 0 ? <Showing shown={rows.length} total={inTab.length} /> : undefined}
          />
        )}
        {tab === "open" && closed > 0 ? (
          <button type="button" className="mn2-sheet-more" onClick={() => setTab("closed")}>
            תקלות שנסגרו
            <span className="mn2-sheet-more-n">{fmtQty(closed)}</span>
            <Icon name="chevron-left" size={16} />
          </button>
        ) : null}
      </div>
      {assignee ? <AssignFault key={assignee.id} fault={assignee} reachable={reachable} onClose={() => setAssigning(null)} /> : null}
    </Page>
  );
}
