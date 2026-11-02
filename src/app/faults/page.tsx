"use client";

/**
 * תקלות — every fault reported from the floor, open ones first. A fault stays
 * open until someone marks it handled; resolved ones remain here as a record
 * and can be reopened.
 */
import { Suspense, useCallback, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { isTempId, normalizeName, useData, type Fault } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { Button, Card, Count, EmptyState, PageHead, Select, Showing, Tabs, Toolbar, type SelectOption } from "@/components/ui";
import { fmtAge, fmtDay, fmtName, fmtQty } from "@/lib/format";
import { faultPhotoUrl } from "@/lib/fault-photos";
import { DEFAULT_OBJECTS } from "@/lib/map3d/layout";

type Tab = "open" | "resolved";

const SKELETON_ROWS = [0, 1, 2, 3];
/** ISO timestamp of seven days ago; rows are compared as ISO strings like the store does. */
function weekAgoIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString();
}

function tabFromParams(params: URLSearchParams): Tab {
  return params.get("tab") === "resolved" ? "resolved" : "open";
}

/** "תוך 40 דקות" / "תוך 3 שעות" / "תוך יומיים" — how long a fault stayed open. */
function fmtDuration(fromIso: string, toIso: string): string | null {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.round(ms / 60000);
  if (min < 1) return null; // same minute: nothing worth saying
  if (min < 60) return `תוך ${fmtQty(min)} דקות`;
  const h = Math.round(min / 60);
  if (h === 1) return "תוך שעה";
  if (h === 2) return "תוך שעתיים";
  if (h < 24) return `תוך ${fmtQty(h)} שעות`;
  const d = Math.round(h / 24);
  if (d === 1) return "תוך יום";
  if (d === 2) return "תוך יומיים";
  return `תוך ${fmtQty(d)} ימים`;
}

export default function FaultsPage() {
  return (
    <Suspense fallback={null}>
      <FaultsInner />
    </Suspense>
  );
}

function FaultsInner() {
  const { state, product, worker, resolveFault, reopenFault } = useData();
  const { openAction, openProduct, notify } = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const tab = tabFromParams(params);
  const setTab = useCallback(
    (next: Tab) => {
      const sp = new URLSearchParams(params.toString());
      if (next === "resolved") sp.set("tab", "resolved");
      else sp.delete("tab");
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const [query, setQuery] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const loading = state.status === "loading";

  /* ───────── counts ───────── */
  const open = useMemo(() => state.faults.filter((f) => f.status === "open"), [state.faults]);
  const resolved = useMemo(() => state.faults.filter((f) => f.status === "resolved"), [state.faults]);
  const resolvedThisWeek = useMemo(() => {
    const since = weekAgoIso();
    return resolved.filter((f) => f.resolved_at && f.resolved_at >= since).length;
  }, [resolved]);

  /* ───────── filters ───────── */
  const reporterOptions = useMemo<SelectOption[]>(() => {
    const ids = new Set(state.faults.map((f) => f.reported_by).filter((id): id is string => Boolean(id)));
    return state.workers.filter((w) => ids.has(w.id)).map((w) => ({ value: w.id, label: w.name }));
  }, [state.faults, state.workers]);

  const q = normalizeName(query);
  const visible = useMemo(() => {
    const base = tab === "open" ? open : resolved;
    return base.filter((f) => {
      if (workerId && f.reported_by !== workerId) return false;
      if (!q) return true;
      const p = product(f.product_id);
      const w = worker(f.reported_by);
      const hay = normalizeName([f.description, p?.name, p?.sku, p?.barcode, w?.name].filter(Boolean).join(" "));
      return hay.includes(q);
    });
  }, [tab, open, resolved, workerId, q, product, worker]);

  /* ───────── writes ───────── */
  const run = useCallback(
    async (f: Fault, fn: () => Promise<void>, success: string, failure: string) => {
      if (isTempId(f.id)) {
        notify({ tone: "neutral", title: "התקלה עדיין נשמרת", text: "אפשר לנסות שוב בעוד רגע" });
        return;
      }
      setBusyId(f.id);
      try {
        await fn();
        notify({ tone: "success", title: success, text: f.description });
      } catch (e) {
        notify({ tone: "danger", title: failure, text: e instanceof Error ? e.message : undefined });
      } finally {
        setBusyId(null);
      }
    },
    [notify],
  );

  const onResolve = useCallback((f: Fault) => run(f, () => resolveFault(f.id), "התקלה סומנה כטופלה", "סימון התקלה נכשל"), [run, resolveFault]);
  const onReopen = useCallback((f: Fault) => run(f, () => reopenFault(f.id), "התקלה נפתחה מחדש", "פתיחת התקלה נכשלה"), [run, reopenFault]);

  const tabs = [
    { value: "open", label: "פתוחות", count: open.length },
    { value: "resolved", label: "טופלו", count: resolved.length },
  ];

  const hasFilters = Boolean(q || workerId);

  /* ───────── body ───────── */
  let body: ReactNode;
  if (loading) {
    body = (
      <div className="sa-faults" aria-busy="true" aria-label="טוען">
        {SKELETON_ROWS.map((i) => (
          <div key={i} className="sa-fault-row">
            <span className="sa-skeleton sa-fault-thumb" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="sa-skeleton" style={{ width: 240, height: 14 }} />
              <span className="sa-skeleton" style={{ width: 160 }} />
            </div>
          </div>
        ))}
      </div>
    );
  } else if (visible.length === 0) {
    body =
      state.faults.length === 0 ? (
        <EmptyState title="אין תקלות" hint="דיווחים מהטלפון יופיעו כאן">
          <Button variant="secondary" onClick={() => openAction("fault")}>דיווח תקלה</Button>
        </EmptyState>
      ) : hasFilters ? (
        <EmptyState title="לא נמצאו תקלות" hint="אפשר להסיר את הסינון" />
      ) : tab === "open" ? (
        <EmptyState title="אין תקלות פתוחות" />
      ) : (
        <EmptyState title="אין תקלות שטופלו" hint="תקלה שטופלה תישמר כאן" />
      );
  } else {
    // A fault with no photo of its own shows its product's, and a row with neither keeps the frame's place, so the titles share one edge.
    const anyPhoto = visible.some((f) => faultPhotoUrl(f.photo_path) || product(f.product_id)?.image_path);
    body = (
      <ul className={anyPhoto ? "sa-faults has-photos" : "sa-faults"} aria-label={tab === "open" ? "תקלות פתוחות" : "תקלות שטופלו"}>
        {visible.map((f) => {
          const p = product(f.product_id);
          const w = worker(f.reported_by);
          const src = faultPhotoUrl(f.photo_path);
          const busy = busyId === f.id;
          const done = f.status === "resolved";
          const took = done && f.resolved_at ? fmtDuration(f.created_at, f.resolved_at) : null;
          const meta: ReactNode[] = [];
          if (w) meta.push(<>דווח ע&quot;י {w.name}</>);
          // An open fault counts how long it has waited; a closed one is a record, so it keeps its date.
          meta.push(<>{done ? fmtDay(f.created_at) : fmtAge(f.created_at)}</>);
          if (took) meta.push(<span className="sa-fault-took">טופל {took}</span>);
          return (
            <li key={f.id} className={done ? "sa-fault-row is-done" : "sa-fault-row"}>
              {src ? (
                <a className="sa-fault-thumb" href={src} target="_blank" rel="noreferrer" aria-label="פתיחת התמונה">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" loading="lazy" />
                </a>
              ) : p?.image_path ? (
                <span className="sa-fault-thumb">
                  <ProductThumb product={p} />
                </span>
              ) : anyPhoto ? (
                <span className="sa-fault-thumb is-empty" aria-hidden="true" />
              ) : null}
              <div className="sa-fault-main">
                <p className="sa-fault-title">{f.description}</p>
                {p ? (
                  <button type="button" className="sa-fault-product" onClick={() => openProduct(p.id)}>
                    <span className="sa-truncate">{fmtName(p.name)}</span>
                    <span className="sa-mono ltr">{p.sku}</span>
                  </button>
                ) : f.product_id ? (
                  <span className="sa-fault-meta">מוצר שנמחק</span>
                ) : (
                  <span className="sa-fault-meta">{DEFAULT_OBJECTS.find((o) => o.id === f.asset)?.name ?? f.asset ?? "ללא מוצר"}</span>
                )}
                <span className="sa-fault-meta">
                  {meta.map((m, i) => (
                    <span key={i}>
                      {i > 0 ? " · " : null}
                      {m}
                    </span>
                  ))}
                </span>
              </div>
              <div className="sa-fault-actions">
                {done ? (
                  <Button variant="ghost" icon="refresh" isLoading={busy} onClick={() => void onReopen(f)}>פתיחה מחדש</Button>
                ) : (
                  <Button variant="secondary" icon="check" isLoading={busy} onClick={() => void onResolve(f)}>סימון כטופל</Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="sa-page">
      <PageHead
        title="תקלות"
        sub={<Count n={resolvedThisWeek} one="טופלה השבוע" many="טופלו השבוע" />}
        actions={<Button variant="primary" icon="tool" onClick={() => openAction("fault")}>דיווח תקלה</Button>}
      />

      <Toolbar
        tabs={<Tabs tabs={tabs} value={tab} onChange={(v) => setTab(v === "resolved" ? "resolved" : "open")} />}
        filters={reporterOptions.length > 0 ? <Select options={reporterOptions} value={workerId} onChange={setWorkerId} allLabel="כל העובדים" placeholder="עובד" /> : null}
        query={query}
        onQuery={setQuery}
        placeholder="חיפוש לפי תיאור, מוצר או עובד"
      />

      <Card
        flush
        footer={
          !loading && hasFilters && visible.length > 0 ? <Showing shown={visible.length} total={tab === "open" ? open.length : resolved.length} /> : undefined
        }
      >
        {body}
      </Card>
    </div>
  );
}
