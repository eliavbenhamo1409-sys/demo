"use client";

/**
 * חוסרים: two different things that used to share one count. A product the shelf can't cover for orders already
 * promised is a customer waiting today; a product under its minimum is a purchase to plan. So they stand apart,
 * the first above the second, each row with what is missing, who is affected, and who supplies it.
 */
import { useMemo, useState, type ReactElement } from "react";
import { useUi } from "@/components/app/ui-state";
import { Button, EmptyState, Select, Table, Tabs, Toolbar, type SelectOption, type TableColumn } from "@/components/ui";
import { daysUntil, fmtPlainDay, fmtPromised, fmtQty } from "@/lib/format";
import { midnight, useMovementsInRange } from "@/lib/movements-range";
import { PACE_DAYS, runway } from "@/lib/snapshot";
import { normalizeName, useData } from "@/lib/store";
import { only, ProductCell, Qty, SupplierCell } from "../cells";
import { Block, Check, Page, Word } from "../parts";
import { useShortages } from "../use-work";
import { LEVEL_WORD, type Shortage } from "../work";

type Group = "all" | "short" | "low";

/** Who waits, in a line that stays a line: the first two and how many more. The drawer lists them all. */
function customersOf(s: Shortage): string {
  const names = [...new Set(s.orders.map((o) => o.customer))];
  return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} ועוד ${fmtQty(names.length - 2)}`;
}

const fmtDays = (n: number) => (n <= 0 ? "היום" : n === 1 ? "עוד יום" : n === 2 ? "עוד יומיים" : n >= 90 ? "מעל 3 חודשים" : `עוד ${fmtQty(n)} ימים`);

export function Shortages(): ReactElement {
  const { state, supplier } = useData();
  const { openAction, openProduct } = useUi();
  const all = useShortages();

  const [group, setGroup] = useState<Group>("all");
  const [query, setQuery] = useState("");
  const [supplierId, setSupplierId] = useState("");

  // How long what is left will last, at the pace goods went out lately. Only as good as the days the pace was read from.
  const since = useMemo(() => midnight(1 - PACE_DAYS), []);
  const { rows: month, isLoading: paceLoading } = useMovementsInRange(since, null);
  const daysLeft = useMemo(() => new Map(runway(state.products, month).map((r) => [r.product.id, r.days])), [state.products, month]);

  const suppliers = useMemo<SelectOption[]>(() => {
    const ids = new Set(all.map((s) => s.product.primary_supplier_id).filter((id): id is string => Boolean(id)));
    return state.suppliers.filter((s) => ids.has(s.id)).map((s) => ({ value: s.id, label: s.name }));
  }, [all, state.suppliers]);

  const q = normalizeName(query);
  const shown = useMemo(
    () =>
      all.filter((s) => {
        if (supplierId && s.product.primary_supplier_id !== supplierId) return false;
        if (!q) return true;
        return normalizeName([s.product.name, s.product.sku, s.product.barcode, supplier(s.product.primary_supplier_id)?.name, ...s.orders.map((o) => o.customer)].filter(Boolean).join(" ")).includes(q);
      }),
    [all, supplierId, q, supplier],
  );
  const short = shown.filter((s) => s.level === "short");
  const low = shown.filter((s) => s.level !== "short");
  const totals = { short: all.filter((s) => s.level === "short").length, low: all.filter((s) => s.level !== "short").length };

  const act: TableColumn<Shortage> = {
    key: "act",
    title: "פעולה",
    className: "mn2-cell-act",
    render: (s) => (
      <span className="mn2-acts">
        <Button variant="secondary" size="sm" onClick={only(() => openProduct(s.product.id))}>פרטי מוצר</Button>
      </span>
    ),
  };
  const source: TableColumn<Shortage> = { key: "supplier", title: "ספק", render: (s) => <SupplierCell supplier={supplier(s.product.primary_supplier_id)} /> };

  const shortColumns: TableColumn<Shortage>[] = [
    { key: "product", title: "מוצר", className: "mn2-cell-main", render: (s) => <ProductCell product={s.product} /> },
    { key: "qty", title: "על המדף", render: (s) => <Qty n={s.product.qty} unit={s.product.unit} /> },
    { key: "reserved", title: "הובטח להזמנות", render: (s) => <Qty n={s.product.reserved} unit={s.product.unit} /> },
    { key: "gap", title: "חסר", render: (s) => <Qty n={s.gap} unit={s.product.unit} tone="short" /> },
    {
      key: "orders",
      title: "הזמנות שמחכות",
      render: (s) =>
        s.orders.length === 0 ? (
          <span className="mn2-cell-unset">לא נמצאו</span>
        ) : (
          <>
            <span className="mn2-cell-text">{s.orders.length === 1 ? "הזמנה אחת" : `${fmtQty(s.orders.length)} הזמנות`}</span>
            <span className="mn2-cell-sub">{customersOf(s)}</span>
          </>
        ),
    },
    {
      key: "nearest",
      title: "המסירה הקרובה",
      render: (s) =>
        s.nearest === null ? (
          <span className="mn2-cell-unset">לא נקבע</span>
        ) : daysUntil(s.nearest) < 0 ? (
          <>
            <span className="mn2-cell-text ltr">{fmtPlainDay(s.nearest)}</span>
            <span className="mn2-cell-sub"><Word tone="warn">{fmtPromised(s.nearest)}</Word></span>
          </>
        ) : (
          <span className="mn2-cell-text">{fmtPromised(s.nearest)}</span>
        ),
    },
    source,
    act,
  ];

  const lowColumns: TableColumn<Shortage>[] = [
    { key: "product", title: "מוצר", className: "mn2-cell-main", render: (s) => <ProductCell product={s.product} /> },
    { key: "free", title: "זמין", render: (s) => <Qty n={Math.max(0, s.free)} unit={s.product.unit} tone={s.level === "out" ? "bad" : "warn"} /> },
    { key: "min", title: "המינימום", render: (s) => (s.product.min_qty > 0 ? <Qty n={s.product.min_qty} unit={s.product.unit} /> : <span className="mn2-cell-unset">לא נקבע</span>) },
    { key: "gap", title: "חסר למינימום", render: (s) => (s.gap > 0 ? <Qty n={s.gap} unit={s.product.unit} /> : <span className="mn2-cell-unset">—</span>) },
    {
      key: "state",
      title: "סטטוס",
      render: (s) => {
        const days = daysLeft.get(s.product.id);
        return (
          <>
            <Word tone={s.level === "out" ? "bad" : "warn"}>{LEVEL_WORD[s.level]}</Word>
            {s.level === "low" ? <span className="mn2-cell-sub">{s.free <= 0 ? "כל המלאי משוריין להזמנות" : paceLoading ? "מחשב קצב" : days === null || days === undefined ? "אין הוצאות לחשב לפיהן" : `ייגמר ${fmtDays(days)}`}</span> : null}
          </>
        );
      },
    },
    source,
    act,
  ];

  const hasFilters = Boolean(q || supplierId);
  const noMatch = (
    <EmptyState title="לא נמצאו מוצרים" hint={q ? <>עבור „<bdi>{query.trim()}</bdi>”</> : "אפשר להסיר את הסינון"}>
      <Button variant="secondary" onClick={() => { setQuery(""); setSupplierId(""); }}>ניקוי סינון</Button>
    </EmptyState>
  );
  const calm = (title: string, hint: string) => (
    <div className="mn2-clear">
      <Check size={32} />
      <p className="mn2-clear-title">{title}</p>
      <p className="mn2-clear-hint">{hint}</p>
    </div>
  );

  const total = all.length;
  const lead =
    total === 0 ? "המלאי מעל המינימום וכל ההזמנות מכוסות. אין מה להשלים."
    : totals.short === 0 ? `${totals.low === 1 ? "מוצר אחד" : `${fmtQty(totals.low)} מוצרים`} מתחת למינימום. אף הזמנה לא נפגעת, וכדאי להשלים לפני שייווצר חוסר.`
    : `${totals.short === 1 ? "מוצר אחד חסר" : `${fmtQty(totals.short)} מוצרים חסרים`} להזמנות שכבר הובטחו${totals.low > 0 ? `, ועוד ${fmtQty(totals.low)} מתחת למינימום` : ""}. מה שמעכב לקוח עומד ראשון.`;

  const tabs = [
    { value: "all", label: "הכל", count: total },
    { value: "short", label: "חסר להזמנות", count: totals.short },
    { value: "low", label: "מתחת למינימום", count: totals.low },
  ];

  return (
    <Page
      title="חוסרים במלאי"
      state={total === 0 ? { word: "הכל מכוסה", tone: "ok" } : totals.short > 0 ? { word: `${fmtQty(totals.short)} פוגעים בהזמנות`, tone: "short" } : { word: `${fmtQty(totals.low)} מתחת למינימום`, tone: "warn" }}
      lead={lead}
      action={<Button variant="primary" icon="arrow-down-left" onClick={() => openAction("receive")}>קליטת סחורה</Button>}
      toolbar={
        <Toolbar
          tabs={<Tabs tabs={tabs} value={group} onChange={(v) => setGroup(v === "short" || v === "low" ? v : "all")} />}
          filters={suppliers.length > 0 ? <Select options={suppliers} value={supplierId} onChange={setSupplierId} allLabel="כל הספקים" placeholder="ספק" /> : null}
          query={query}
          onQuery={setQuery}
          placeholder='חיפוש לפי מוצר, מק"ט, ספק או לקוח'
        />
      }
    >
      {group !== "low" ? (
        <Block
          className="mn2-lead-block"
          icon="package-x"
          tone={totals.short > 0 ? "short" : "none"}
          title="חסר להזמנות"
          sub="הכמות על המדף לא מספיקה למה שכבר הובטח ללקוחות · עדיפות גבוהה"
          actions={<span className={`mn2-block-n${totals.short > 0 ? " is-short" : " is-ok"}`}>{fmtQty(totals.short)}</span>}
        >
          {totals.short === 0 ? calm("אין מוצר שחסר להזמנות", "המדף מכסה את כל מה שהובטח ללקוחות.") : (
            <Table<Shortage> caption="מוצרים שחסרים להזמנות" className="mn2-table mn2-short-table" columns={shortColumns} data={short} empty={noMatch} onRowClick={(s) => openProduct(s.product.id)} />
          )}
        </Block>
      ) : null}

      {group !== "short" ? (
        <Block
          className="mn2-lead-block"
          icon="package-minus"
          title="מתחת למינימום"
          sub="אף הזמנה לא מחכה למוצרים האלה · השלמה מונעת את החוסר הבא"
          actions={<span className={`mn2-block-n${totals.low > 0 ? " is-warn" : " is-ok"}`}>{fmtQty(totals.low)}</span>}
        >
          {totals.low === 0 ? calm("אין מוצר מתחת למינימום", "כל המוצרים מעל הרף שנקבע להם.") : (
            <Table<Shortage> caption="מוצרים מתחת למינימום" className="mn2-table mn2-low-table" columns={lowColumns} data={low} empty={noMatch} onRowClick={(s) => openProduct(s.product.id)} />
          )}
        </Block>
      ) : null}

      {hasFilters && shown.length > 0 && shown.length < total ? <p className="mn2-foot-note">מוצגים {fmtQty(shown.length)} מתוך {fmtQty(total)} חוסרים.</p> : null}
    </Page>
  );
}
