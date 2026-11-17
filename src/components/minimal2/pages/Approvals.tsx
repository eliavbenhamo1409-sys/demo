"use client";

/**
 * אישורים: everything that waits for the manager's yes or no, in one list. Two kinds of thing end up here: a line a worker
 * could not match while handing goods to a customer, and a name a supplier wrote that the warehouse doesn't know yet.
 * Each kind has its own drawing at the head of its rows, and each row says what the system would do with it, so most
 * decisions are one press. This is the one place a supplier's name is decided; the suppliers page only keeps the map
 * of what was decided.
 */
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useUi } from "@/components/app/ui-state";
import { Button, EmptyState, Showing, Table, SearchBar, type TableColumn } from "@/components/ui";
import { fmtAge, fmtName, fmtQty } from "@/lib/format";
import { isTempId, normalizeName, useData, type ItemRequest, type Product, type SupplierItem } from "@/lib/store";
import { only } from "../cells";
import { Line } from "../icons";
import { Check, JustHandled, Page } from "../parts";
import { pendingNames, pendingRequests } from "../work";

type Row = {
  id: string;
  kind: "line" | "name";
  title: string;
  /** What kind of decision this is, in two words. */
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
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const all = useMemo<Row[]>(() => {
    const lines = pendingRequests(state.itemRequests).map<Row>((r) => ({
      id: r.id,
      kind: "line",
      title: `${fmtName(r.proposed_name?.trim() || r.external_name)} × ${fmtQty(r.qty)}`,
      word: r.kind === "new_product" ? "עובד ביקש מוצר חדש" : "עובד לא זיהה בקבלה",
      who: [worker(r.worker_id)?.name, r.customer ? `ללקוח ${r.customer}` : null].filter(Boolean).join(" · ") || null,
      at: r.created_at,
      guess: undefined,
      request: r,
    }));
    const names = pendingNames(state.supplierItems, product).map<Row>((i) => ({
      id: i.id,
      kind: "name",
      title: i.external_name,
      word: "שם חדש של ספק",
      who: supplier(i.supplier_id)?.name ?? null,
      at: i.created_at,
      guess: product(i.product_id),
      item: i,
    }));
    // The longest waiting first: a line holds a customer's goods, a name only the next delivery.
    return [...lines, ...names].sort((a, b) => a.at.localeCompare(b.at));
  }, [state.itemRequests, state.supplierItems, product, supplier, worker]);

  const q = normalizeName(query);
  const rows = useMemo(() => (q ? all.filter((r) => normalizeName([r.title, r.who, r.guess?.name].filter(Boolean).join(" ")).includes(q)) : all), [all, q]);

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
            <Line name={r.kind === "line" ? "stamp" : "link-2"} size={22} tone={r.kind === "line" ? "warn" : "accent"} />
            <span>
              <span className="mn2-cell-title"><bdi>{r.title}</bdi></span>
              <span className="mn2-cell-sub">{r.word}</span>
            </span>
          </span>
        ),
      },
      {
        key: "who",
        title: "ממי",
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
            <span className="mn2-cell-unset">—</span>
          ),
      },
      {
        key: "act",
        title: <span className="sr-only">פעולה</span>,
        className: "mn2-cell-act",
        // One blue button in the list: the row at its head, which has waited longest.
        render: (r, i) => {
          const lead = i === 0 ? "primary" : "secondary";
          return (
            <span className="mn2-acts">
              {r.kind === "line" ? (
                <Button variant={lead} size="sm" disabled={isTempId(r.id)} onClick={only(() => open(r))}>בדיקה</Button>
              ) : r.guess && r.item?.status === "pending" ? (
                <>
                  <Button variant="ghost" size="sm" onClick={only(() => open(r))}>מוצר אחר</Button>
                  <Button variant={lead} size="sm" icon="check" isLoading={busyId === r.id} disabled={isTempId(r.id)} onClick={only(() => void approve(r))}>אישור</Button>
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

  return (
    <Page title="אישורים" tools={<SearchBar kbd={false} value={query} onChange={setQuery} placeholder="חיפוש שם, ספק או עובד" />}>
      <div className="sa-card mn2-sheet">
        <JustHandled kind="approval" />
        {all.length === 0 ? (
          <div className="mn2-clear">
            <Check size={36} />
            <p className="mn2-clear-title">אין מה לאשר</p>
          </div>
        ) : (
          <Table<Row>
            caption="ממתינים לאישור"
            className="mn2-table mn2-approvals-table"
            columns={columns}
            data={rows}
            empty={
              <EmptyState title="לא נמצאו ממתינים" hint={<>עבור „<bdi>{query.trim()}</bdi>”</>}>
                <Button variant="secondary" onClick={() => setQuery("")}>ניקוי החיפוש</Button>
              </EmptyState>
            }
            onRowClick={open}
            footer={q && rows.length > 0 ? <Showing shown={rows.length} total={all.length} /> : undefined}
          />
        )}
      </div>
    </Page>
  );
}
