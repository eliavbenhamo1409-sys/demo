"use client";

/**
 * אישורים: everything that waits for the manager's yes or no, in one list. Two kinds of thing end up here: a line a worker
 * could not match while handing goods to a customer, and a name a supplier wrote that the warehouse doesn't know yet.
 * Each row says what the system would do with it, so most decisions are one press.
 */
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useUi } from "@/components/app/ui-state";
import { Button, EmptyState, Showing, Table, Tabs, Toolbar, type TableColumn } from "@/components/ui";
import { fmtAge, fmtName, fmtQty } from "@/lib/format";
import { isTempId, normalizeName, useData, type ItemRequest, type Product, type SupplierItem } from "@/lib/store";
import { only } from "../cells";
import { Line } from "../icons";
import { Check, JustHandled, Page, Word, type Metric } from "../parts";
import { handledToday, listWords, pendingNames, pendingRequests } from "../work";

type Kind = "all" | "line" | "name";

type Row = {
  id: string;
  kind: "line" | "name";
  title: string;
  /** What kind of decision this is, in words. */
  word: string;
  who: string | null;
  at: string;
  guess: Product | undefined;
  request?: ItemRequest;
  item?: SupplierItem;
};

export function Approvals(): ReactElement {
  const { state, product, supplier, worker, approveSupplierItem } = useData();
  const { openAction, notify } = useUi();
  const [kind, setKind] = useState<Kind>("all");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const all = useMemo<Row[]>(() => {
    const lines = pendingRequests(state.itemRequests).map<Row>((r) => ({
      id: r.id,
      kind: "line",
      title: `${fmtName(r.proposed_name?.trim() || r.external_name)} × ${fmtQty(r.qty)}`,
      word: r.kind === "new_product" ? "מוצר חדש שעובד ביקש לפתוח" : "שורה שעובד לא זיהה בקבלה",
      who: [worker(r.worker_id)?.name, r.customer ? `ללקוח ${r.customer}` : null].filter(Boolean).join(" · ") || null,
      at: r.created_at,
      guess: undefined,
      request: r,
    }));
    const names = pendingNames(state.supplierItems, product).map<Row>((i) => ({
      id: i.id,
      kind: "name",
      title: i.external_name,
      word: "שם של ספק מתעודת משלוח",
      who: supplier(i.supplier_id)?.name ?? null,
      at: i.created_at,
      guess: product(i.product_id),
      item: i,
    }));
    // The longest waiting first: a line holds a customer's goods, a name only the next delivery.
    return [...lines, ...names].sort((a, b) => a.at.localeCompare(b.at));
  }, [state.itemRequests, state.supplierItems, product, supplier, worker]);

  const counts = useMemo(() => ({ line: all.filter((r) => r.kind === "line").length, name: all.filter((r) => r.kind === "name").length }), [all]);
  const decided = useMemo(() => handledToday(state.faults, state.itemRequests, state.supplierItems).approvals, [state.faults, state.itemRequests, state.supplierItems]);

  const q = normalizeName(query);
  const rows = useMemo(
    () => all.filter((r) => (kind === "all" || r.kind === kind) && (!q || normalizeName([r.title, r.who, r.guess?.name].filter(Boolean).join(" ")).includes(q))),
    [all, kind, q],
  );

  const open = useCallback(
    (r: Row) => (r.kind === "line" ? openAction("review-item-request", { requestId: r.id }) : openAction("map-supplier-item", { supplierItemId: r.id })),
    [openAction],
  );

  const approve = useCallback(
    async (r: Row) => {
      if (!r.item || !r.guess) return;
      setBusyId(r.id);
      try {
        await approveSupplierItem(r.item.id);
        notify({ tone: "success", title: `"${r.item.external_name}" אושר כ-${r.guess.name}` });
      } catch (e) {
        notify({ tone: "danger", title: "האישור נכשל", text: e instanceof Error ? e.message : undefined });
      } finally {
        setBusyId(null);
      }
    },
    [approveSupplierItem, notify],
  );

  const columns = useMemo<TableColumn<Row>[]>(() => {
    return [
      {
        key: "what",
        title: "מה ממתין",
        className: "mn2-cell-main",
        render: (r) => (
          <span className="mn2-cell-lead">
            <Line name={r.kind === "line" ? "stamp" : "link-2"} size={22} />
            <span>
              <span className="mn2-cell-title"><bdi>{r.title}</bdi></span>
              <span className="mn2-cell-sub">{r.word}</span>
            </span>
          </span>
        ),
      },
      {
        key: "who",
        title: "ממי ומתי",
        render: (r) => (
          <>
            <span className="mn2-cell-text">{r.who ? <bdi>{r.who}</bdi> : "לא ידוע"}</span>
            <span className="mn2-cell-sub">{fmtAge(r.at)}</span>
          </>
        ),
      },
      {
        key: "guess",
        title: "הצעת המערכת",
        render: (r) =>
          r.guess ? (
            <>
              <span className="mn2-cell-text">{fmtName(r.guess.name)}</span>
              <span className="mn2-cell-sub"><span className="sa-mono ltr">{r.guess.sku}</span></span>
            </>
          ) : (
            <span className="mn2-cell-unset">{r.kind === "line" ? "נבחרת בבדיקה" : "לא נמצאה התאמה"}</span>
          ),
      },
      {
        key: "act",
        title: "פעולה",
        className: "mn2-cell-act",
        // One blue button in the list: the row at its head, which has waited longest.
        render: (r, i) => {
          const lead = i === 0 ? "primary" : "secondary";
          return (
            <span className="mn2-acts">
              {r.kind === "line" ? (
                <Button variant={lead} size="sm" disabled={isTempId(r.id)} onClick={only(() => open(r))}>בדיקת השורה</Button>
              ) : r.guess && r.item?.status === "pending" ? (
                <>
                  <Button variant={lead} size="sm" icon="check" isLoading={busyId === r.id} disabled={isTempId(r.id)} onClick={only(() => void approve(r))}>אישור ההתאמה</Button>
                  <Button variant="ghost" size="sm" onClick={only(() => open(r))}>שיוך אחר</Button>
                </>
              ) : (
                <Button variant={lead} size="sm" disabled={isTempId(r.id)} onClick={only(() => open(r))}>שיוך מוצר</Button>
              )}
            </span>
          );
        },
      },
    ];
  }, [open, approve, busyId]);

  const total = all.length;
  const parts = [
    counts.line > 0 ? (counts.line === 1 ? "שורה אחת שעובד לא זיהה" : `${fmtQty(counts.line)} שורות שעובדים לא זיהו`) : "",
    counts.name > 0 ? (counts.name === 1 ? "שם אחד של ספק" : `${fmtQty(counts.name)} שמות של ספקים`) : "",
  ].filter(Boolean);
  const lead = total === 0
    ? "אין מה לאשר. שורה שעובד לא זיהה או שם חדש של ספק יופיעו כאן."
    : `${listWords(parts)} ${total === 1 ? "מחכה" : "מחכים"} להחלטה. כשהמערכת מזהה את המוצר היא מציעה אותו, ונשאר רק לאשר.`;

  const metrics: Metric[] = [
    { key: "line", label: "שורות מעובדים", icon: "stamp", value: counts.line, tone: counts.line > 0 ? "warn" : "ok", note: counts.line > 0 ? "סחורה שיצאה ועוד לא נרשמה" : <span className="is-ok">אין שורות ממתינות</span> },
    { key: "name", label: "שמות של ספקים", icon: "link-2", value: counts.name, tone: counts.name > 0 ? "warn" : "ok", note: counts.name > 0 ? "עד לאישור, קליטה בשם הזה תישאל שוב" : <span className="is-ok">כל השמות משויכים</span> },
    { key: "done", label: "הוחלטו היום", icon: "circle-check", value: decided, tone: decided > 0 ? "ok" : "none", note: decided > 0 ? "אישורים ודחיות מהיום" : all[0] ? `הוותיק ביותר מחכה ${fmtAge(all[0].at)}` : "עוד לא התקבלה החלטה היום" },
  ];

  const tabs = [
    { value: "all", label: "הכל", count: total },
    { value: "line", label: "שורות מעובדים", count: counts.line },
    { value: "name", label: "שמות של ספקים", count: counts.name },
  ];

  return (
    <Page
      title="אישורים"
      state={total > 0 ? { word: `${fmtQty(total)} ממתינים`, tone: "warn" } : { word: "אין מה לאשר", tone: "ok" }}
      lead={lead}
      metrics={metrics}
      toolbar={
        <Toolbar
          tabs={<Tabs tabs={tabs} value={kind} onChange={(v) => setKind(v === "line" || v === "name" ? v : "all")} />}
          query={query}
          onQuery={setQuery}
          placeholder="חיפוש לפי שם, ספק או עובד"
        />
      }
    >
      <div className="sa-card mn2-sheet">
        <JustHandled kind="approval" />
        {total === 0 ? (
          <div className="mn2-clear">
            <Check size={36} />
            <p className="mn2-clear-title">אין מה לאשר</p>
            <p className="mn2-clear-hint">כל ההחלטות התקבלו.</p>
          </div>
        ) : (
          <Table<Row>
            caption="ממתינים לאישור"
            className="mn2-table mn2-approvals-table"
            columns={columns}
            data={rows}
            empty={
              <EmptyState title="לא נמצאו ממתינים" hint={q ? <>עבור „<bdi>{query.trim()}</bdi>”</> : "אין ממתינים מהסוג הזה"}>
                <Button variant="secondary" onClick={() => { setQuery(""); setKind("all"); }}>כל הממתינים</Button>
              </EmptyState>
            }
            onRowClick={open}
            footer={rows.length > 0 && rows.length < total ? <Showing shown={rows.length} total={total} /> : undefined}
          />
        )}
      </div>
      {total > 0 ? <p className="mn2-foot-note"><Word>מה קורה אחרי אישור:</Word> שורה שאושרה מורידה את הכמות מהמלאי; שם שאושר יזוהה מעצמו בקליטה הבאה.</p> : null}
    </Page>
  );
}
