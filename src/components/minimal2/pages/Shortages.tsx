"use client";

/**
 * חוסרים: two different things that used to share one count. A product the shelf can't cover for orders already
 * promised is a customer waiting today; a product under its minimum is a purchase to plan. So they stand apart,
 * the first above the second, and a row says only what the name of its block doesn't: how much is missing, who
 * waits for it and until when, and who to call. The rest is in the product's drawer, one press away.
 */
import { useMemo, useState, type ReactElement } from "react";
import { useUi } from "@/components/app/ui-state";
import { Button, EmptyState, Table, SearchBar, type TableColumn } from "@/components/ui";
import { daysUntil, fmtPromised, fmtQty } from "@/lib/format";
import { midnight, useMovementsInRange } from "@/lib/movements-range";
import { PACE_DAYS, runway } from "@/lib/snapshot";
import { normalizeName, useData } from "@/lib/store";
import { goColumn, ProductCell, Qty, SupplierCell } from "../cells";
import { Block, Check, Page, Word } from "../parts";
import { useShortages } from "../use-work";
import type { Shortage } from "../work";

/** Who waits, in a line that stays a line: the first two and how many more. The drawer lists them all. */
function customersOf(s: Shortage): string {
  const names = [...new Set(s.orders.map((o) => o.customer))];
  return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} ועוד ${fmtQty(names.length - 2)}`;
}

const fmtDays = (n: number) => (n <= 0 ? "נגמר היום" : n === 1 ? "עוד יום" : n === 2 ? "עוד יומיים" : n >= 90 ? "מעל 3 חודשים" : `עוד ${fmtQty(n)} ימים`);

export function Shortages(): ReactElement {
  const { state, supplier } = useData();
  const { openProduct } = useUi();
  const all = useShortages();

  const [query, setQuery] = useState("");

  // How long what is left will last, at the pace goods went out lately. Only as good as the days the pace was read from.
  const since = useMemo(() => midnight(1 - PACE_DAYS), []);
  const { rows: month, isLoading: paceLoading } = useMovementsInRange(since, null);
  const daysLeft = useMemo(() => new Map(runway(state.products, month).map((r) => [r.product.id, r.days])), [state.products, month]);

  const q = normalizeName(query);
  const shown = useMemo(
    () => (q ? all.filter((s) => normalizeName([s.product.name, s.product.sku, s.product.barcode, supplier(s.product.primary_supplier_id)?.name, ...s.orders.map((o) => o.customer)].filter(Boolean).join(" ")).includes(q)) : all),
    [all, q, supplier],
  );
  const short = shown.filter((s) => s.level === "short");
  const low = shown.filter((s) => s.level !== "short");
  const totals = { short: all.filter((s) => s.level === "short").length, low: all.filter((s) => s.level !== "short").length };

  const product: TableColumn<Shortage> = { key: "product", title: "מוצר", className: "mn2-cell-main", render: (s) => <ProductCell product={s.product} /> };
  const source: TableColumn<Shortage> = { key: "supplier", title: "ספק", render: (s) => <SupplierCell supplier={supplier(s.product.primary_supplier_id)} /> };

  const shortColumns: TableColumn<Shortage>[] = [
    product,
    { key: "gap", title: "חסר", render: (s) => <Qty n={s.gap} unit={s.product.unit} tone="short" /> },
    {
      key: "orders",
      title: "מחכים לו",
      render: (s) =>
        s.orders.length === 0 ? (
          <span className="mn2-cell-unset">—</span>
        ) : (
          <>
            <span className="mn2-cell-text">{s.orders.length === 1 ? "הזמנה אחת" : `${fmtQty(s.orders.length)} הזמנות`}</span>
            <span className="mn2-cell-sub">{customersOf(s)}</span>
          </>
        ),
    },
    {
      key: "nearest",
      title: "מסירה קרובה",
      render: (s) =>
        s.nearest === null ? <span className="mn2-cell-unset">לא נקבע</span> : daysUntil(s.nearest) < 0 ? <Word tone="warn">{fmtPromised(s.nearest)}</Word> : <span className="mn2-cell-text">{fmtPromised(s.nearest)}</span>,
    },
    source,
    goColumn(),
  ];

  const lowColumns: TableColumn<Shortage>[] = [
    product,
    { key: "free", title: "זמין", render: (s) => <Qty n={Math.max(0, s.free)} unit={s.product.unit} tone={s.level === "out" ? "bad" : "warn"} /> },
    { key: "min", title: "מינימום", render: (s) => (s.product.min_qty > 0 ? <Qty n={s.product.min_qty} unit={s.product.unit} /> : <span className="mn2-cell-unset">לא נקבע</span>) },
    {
      key: "left",
      title: "יספיק",
      // The block's name already says it is under the minimum; this says the one thing it doesn't: for how long.
      render: (s) => {
        if (s.level === "out") return <Word tone="bad">אזל</Word>;
        if (s.free <= 0) return <span className="mn2-cell-text">הכל משוריין</span>;
        const days = daysLeft.get(s.product.id);
        return paceLoading || days === null || days === undefined ? <span className="mn2-cell-unset">—</span> : <span className="mn2-cell-text">{fmtDays(days)}</span>;
      },
    },
    source,
    goColumn(),
  ];

  const noMatch = (
    <EmptyState title="לא נמצאו מוצרים" hint={<>עבור „<bdi>{query.trim()}</bdi>”</>}>
      <Button variant="secondary" onClick={() => setQuery("")}>ניקוי החיפוש</Button>
    </EmptyState>
  );
  const calm = (title: string) => (
    <div className="mn2-clear">
      <Check size={32} />
      <p className="mn2-clear-title">{title}</p>
    </div>
  );

  return (
    <Page title="חוסרים" tools={<SearchBar kbd={false} value={query} onChange={setQuery} placeholder='חיפוש מוצר, מק"ט, ספק או לקוח' />}>
      <Block
        icon="package-x"
        tone={totals.short > 0 ? "short" : "none"}
        title="חסר להזמנות"
        actions={<span className={`mn2-block-n${totals.short > 0 ? " is-short" : " is-ok"}`}>{fmtQty(totals.short)}</span>}
      >
        {totals.short === 0 ? calm("כל ההזמנות מכוסות") : (
          <Table<Shortage> caption="מוצרים שחסרים להזמנות" className="mn2-table mn2-short-table" columns={shortColumns} data={short} empty={noMatch} onRowClick={(s) => openProduct(s.product.id)} />
        )}
      </Block>

      <Block icon="package-minus" tone={totals.low > 0 ? "warn" : "none"} title="מתחת למינימום" actions={<span className={`mn2-block-n${totals.low > 0 ? " is-warn" : " is-ok"}`}>{fmtQty(totals.low)}</span>}>
        {totals.low === 0 ? calm("הכל מעל המינימום") : (
          <Table<Shortage> caption="מוצרים מתחת למינימום" className="mn2-table mn2-low-table" columns={lowColumns} data={low} empty={noMatch} onRowClick={(s) => openProduct(s.product.id)} />
        )}
      </Block>
    </Page>
  );
}
