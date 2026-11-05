"use client";

/**
 * תקלות as a calm work board: a title and one summary line, the two tabs with the search and the worker filter on one
 * rule, then one table ruled only between rows, each fault one row: the photo at an exact size, what happened, where,
 * when, who, the state as a word, and one small action. Same ?tab=, filters, order and writes as the shared page; a row
 * opens the fault's drawer and the shell shows its place on the model in the window over it.
 */

import { Suspense, useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactElement } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { useTwin } from "@/components/merhav/twin/Twin";
import { Button, cx, EmptyState, SearchBar, Select, Tabs, type SelectOption } from "@/components/ui";
import { faultPhotoUrl } from "@/lib/fault-photos";
import { fmtAge, fmtElapsed, fmtFull, fmtName, fmtQty } from "@/lib/format";
import { isTempId, normalizeName, useData, type Fault } from "@/lib/store";
import { Head, Summary, type SumItem } from "../parts";

type Tab = "open" | "resolved";

const MINUTE = 60_000;
const WEEK = 7 * 86_400_000;

function tabFromParams(params: URLSearchParams): Tab {
  return params.get("tab") === "resolved" ? "resolved" : "open";
}

/** "תוך 40 דקות" / "תוך 3 שעות" / "תוך יומיים": how long a fault stayed open, in the shared page's words. */
function fmtDuration(fromIso: string, toIso: string): string | null {
  const took = fmtElapsed(fromIso, toIso);
  if (!took) return null;
  const { n, unit } = took;
  if (n === 1) return `תוך ${unit}`;
  if (n === 2 && unit === "שעות") return "תוך שעתיים";
  if (n === 2 && unit === "ימים") return "תוך יומיים";
  return `תוך ${fmtQty(n)} ${unit}`;
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
  const { openAction, openFault, notify, panel } = useUi();
  const { objects, itemsOf, spotObjects, spotProduct } = useTwin();
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

  // A wait is a live figure: it keeps counting while the page stands open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(tick);
  }, []);
  const weekAgo = now - WEEK;

  /* ───────── counts ───────── */
  const open = useMemo(() => state.faults.filter((f) => f.status === "open"), [state.faults]);
  const resolved = useMemo(() => state.faults.filter((f) => f.status === "resolved"), [state.faults]);
  const thisWeek = useMemo(() => state.faults.filter((f) => Date.parse(f.created_at) >= weekAgo).length, [state.faults, weekAgo]);

  /* ───────── filters ───────── */
  const reporterOptions = useMemo<SelectOption[]>(() => {
    const ids = new Set(state.faults.map((f) => f.reported_by).filter((id): id is string => Boolean(id)));
    return state.workers.filter((w) => ids.has(w.id)).map((w) => ({ value: w.id, label: w.name }));
  }, [state.faults, state.workers]);

  const q = normalizeName(query);
  // The store's order, newest first, as the shared page keeps it.
  const rows = useMemo(() => {
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

  const filtered = Boolean(q || workerId);
  const total = tab === "open" ? open.length : resolved.length;
  const clearFilters = () => {
    setQuery("");
    setWorkerId("");
  };

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

  const onReopen = useCallback((f: Fault) => run(f, () => reopenFault(f.id), "התקלה נפתחה מחדש", "פתיחת התקלה נכשלה"), [run, reopenFault]);

  /* ───────── where a fault stands ───────── */
  /** The machine a fault is on, when it is an object on the floor. */
  const machineOf = useCallback((f: Fault) => (f.asset ? objects.find((o) => o.id === f.asset) : undefined), [objects]);

  // Pointing at a row lights its place: a fault on a machine lights the machine, one on a product its shelf.
  const point = useCallback(
    (f: Fault | null) => {
      if (!f) {
        spotObjects(null);
        return;
      }
      const machine = machineOf(f);
      if (machine) spotObjects([machine.id]);
      else spotProduct(f.product_id);
    },
    [machineOf, spotObjects, spotProduct],
  );
  // A list that ends under the pointer never sends its row's leave.
  useEffect(() => () => spotObjects(null), [spotObjects]);

  /* ───────── a row ───────── */
  const selected = panel?.type === "fault" ? panel.id : undefined;

  // The photo and the action in a row do their own thing; the rest of the row opens the fault.
  const onRowClick = (e: MouseEvent<HTMLTableRowElement>, f: Fault) => {
    if (e.target instanceof Element && e.target.closest("a, button")) return;
    openFault(f.id);
  };
  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, f: Fault) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openFault(f.id);
    }
  };

  const summary: SumItem[] = [
    { label: "פתוחות", value: open.length, tone: open.length > 0 ? "out" : undefined },
    { label: "נפתחו השבוע", value: thisWeek },
    { label: "טופלו", value: resolved.length },
  ];

  const tabs = [
    { value: "open", label: "פתוחות" },
    { value: "resolved", label: "טופלו" },
  ];

  return (
    <div className="at-fa">
      <Head title="תקלות" line={<Summary items={summary} />}>
        <Button variant="primary" icon="tool" onClick={() => openAction("fault")}>דיווח תקלה</Button>
      </Head>

      <div className="at-fa-bar">
        <Tabs variant="line" tabs={tabs} value={tab} onChange={(v) => setTab(v === "resolved" ? "resolved" : "open")} />
        <div className="at-fa-filters">
          <SearchBar kbd={false} value={query} onChange={setQuery} placeholder="חיפוש לפי תיאור, מוצר או עובד" />
          {reporterOptions.length > 0 ? <Select options={reporterOptions} value={workerId} onChange={setWorkerId} allLabel="כל העובדים" placeholder="עובד" /> : null}
        </div>
      </div>

      <div className="at-table-wrap">
        <table className="at-table at-fa-table" aria-label={tab === "open" ? "תקלות פתוחות" : "תקלות שטופלו"}>
          <thead>
            <tr>
              <th scope="col" className="is-photo">תמונה</th>
              <th scope="col" className="is-what">תיאור</th>
              <th scope="col" className="is-place">מיקום</th>
              <th scope="col" className="is-when">נפתחה</th>
              <th scope="col" className="is-who">דווח ע&quot;י</th>
              <th scope="col" className="is-state">מצב</th>
              <th scope="col" className="is-act">פעולה</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const p = product(f.product_id);
              const w = worker(f.reported_by);
              const src = faultPhotoUrl(f.photo_path);
              const done = f.status === "resolved";
              // Only what has waited over a week gets the louder word.
              const late = !done && Date.parse(f.created_at) < weekAgo;
              const took = done && f.resolved_at ? fmtDuration(f.created_at, f.resolved_at) : null;
              const machine = machineOf(f);
              const place = machine ? machine.id : p ? (itemsOf(p.id)[0]?.place ?? p.location) : f.asset;
              const busy = busyId === f.id;
              return (
                <tr
                  key={f.id}
                  tabIndex={0}
                  aria-current={f.id === selected ? "true" : undefined}
                  className={cx(f.id === selected && "is-selected")}
                  onClick={(e) => onRowClick(e, f)}
                  onKeyDown={(e) => onRowKey(e, f)}
                  onPointerEnter={() => point(f)}
                  onPointerLeave={() => point(null)}
                  onFocus={() => point(f)}
                  onBlur={() => point(null)}
                >
                  <td className="is-photo">
                    {src ? (
                      <a className="at-fa-photo" href={src} target="_blank" rel="noreferrer" aria-label="פתיחת התמונה">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt="" loading="lazy" />
                      </a>
                    ) : p?.image_path ? (
                      <span className="at-fa-photo">
                        <ProductThumb product={p} />
                      </span>
                    ) : (
                      <span className="at-fa-photo is-empty" aria-hidden="true" />
                    )}
                  </td>
                  <td className="is-what">
                    <span className="at-cell-text">
                      <span className="at-cell-title" title={f.description}>{f.description}</span>
                      {p ? <span className="at-cell-sub">{fmtName(p.name)}</span> : f.product_id ? <span className="at-cell-sub">מוצר שנמחק</span> : null}
                    </span>
                  </td>
                  <td className="is-place">
                    {place ? (
                      <span className="at-cell-text">
                        <span className="at-place">{place}</span>
                        {machine ? <span className="at-cell-sub" title={machine.name}>{machine.name}</span> : null}
                      </span>
                    ) : (
                      <span className="at-tone-quiet">—</span>
                    )}
                  </td>
                  <td className="is-when">
                    <span className="at-cell-text">
                      <span>{fmtAge(f.created_at, now)}</span>
                      <span className="at-cell-sub ltr">{fmtFull(f.created_at)}</span>
                    </span>
                  </td>
                  <td className="is-who">{w ? w.name : <span className="at-tone-quiet">—</span>}</td>
                  <td className="is-state">
                    <span className={cx("at-state at-fa-state", done ? "is-done" : late ? "is-late" : "is-open")}>
                      {done ? "טופלה" : "פתוחה"}
                      {done && took ? <span className="at-state-sub">{took}</span> : late ? <span className="at-state-sub">מעל שבוע</span> : null}
                    </span>
                  </td>
                  <td className="is-act">
                    {done ? (
                      <Button variant="ghost" size="sm" icon="refresh" aria-label={`פתיחה מחדש: ${f.description}`} isLoading={busy} onClick={() => void onReopen(f)}>פתיחה מחדש</Button>
                    ) : (
                      <Button variant="secondary" size="sm" icon="check" aria-label={`סגירה עם תיעוד: ${f.description}`} onClick={() => openFault(f.id)}>סגירה</Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          state.faults.length === 0 ? (
            <EmptyState title="אין תקלות" hint="דיווחים מהטלפון יופיעו כאן">
              <Button variant="secondary" onClick={() => openAction("fault")}>דיווח תקלה</Button>
            </EmptyState>
          ) : filtered ? (
            <EmptyState title="לא נמצאו תקלות" hint={q && !workerId ? <>עבור „<bdi>{query.trim()}</bdi>”</> : "אפשר להסיר את הסינון"}>
              <Button variant="secondary" onClick={clearFilters}>ניקוי סינון</Button>
            </EmptyState>
          ) : tab === "open" ? (
            <EmptyState title="אין תקלות פתוחות" hint="דיווח מהטלפון יופיע כאן">
              <Button variant="secondary" onClick={() => openAction("fault")}>דיווח תקלה</Button>
            </EmptyState>
          ) : (
            <EmptyState title="אין תקלות שטופלו" hint="תקלה שטופלה תישמר כאן" />
          )
        ) : filtered ? (
          <div className="at-table-foot">
            <span>{`${fmtQty(rows.length)} מתוך ${fmtQty(total)}`}</span>
            <button type="button" className="sa-btn sa-btn-link" onClick={clearFilters}>ניקוי סינון</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
