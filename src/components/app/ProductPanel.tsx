"use client";

/**
 * Product details + movement history in a SidePanel.
 * Opened via useUi().openProduct(id, tab?); reads ui.panel of type "product".
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { available, useData, type Fault, type Movement } from "@/lib/store";
import { useUi } from "./ui-state";
import { StockMeter } from "./Viz";
import { useFloorObjects } from "@/components/map3d/use-floor-objects";
import { Badge, Button, cx, Fields, Notice, SidePanel, Spinner, Timeline, type TimelineItem } from "@/components/ui";
import { fmtDate, fmtName, fmtPrice, fmtQty, fmtRelative, MOVEMENT_LABEL } from "@/lib/format";
import { faultPhotoUrl } from "@/lib/fault-photos";
import { placeWords, resolvePlace } from "@/lib/map3d/place";
import { useShelves } from "@/lib/map3d/shelves";
import { productPhotoUrl } from "@/lib/product-photos";

type PanelTab = "details" | "history";

function sameMonth(iso: string, now: Date): boolean {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

/** One of the product's three numbers: a word over a big figure and its unit. */
function Figure({ label, value, unit, tone }: { label: string; value: number; unit: string; tone?: "quiet" | "warning" | "danger" | "short" }) {
  return (
    <div className={cx("sa-figure", tone && `is-${tone}`)}>
      <dt>{label}</dt>
      <dd>
        <span className="ltr">{fmtQty(value)}</span>
        <span className="sa-figure-unit">{unit}</span>
      </dd>
    </div>
  );
}

export function ProductPanel() {
  const ui = useUi();
  const panel = ui.panel;
  const id = panel?.type === "product" ? panel.id : null;
  const initialTab: PanelTab = panel?.type === "product" ? (panel.tab ?? "details") : "details";
  if (!id) return null;
  return <ProductPanelInner key={id} id={id} initialTab={initialTab} />;
}

function ProductPanelInner({ id, initialTab }: { id: string; initialTab: PanelTab }) {
  const { state, product, supplier, worker, agent, linesOf, fetchProductHistory, approveSupplierItem, resolveFault } = useData();
  const { close, notify, openAction, openOrder } = useUi();
  const floor = useFloorObjects();
  const { rows: shelves } = useShelves();
  const p = product(id);

  const [tab, setTab] = useState<PanelTab>(initialTab);
  // History cache keyed by product id; `sig` records which live-store snapshot it matches.
  const [history, setHistory] = useState<Record<string, { sig: string; rows: Movement[] }>>({});
  const [failed, setFailed] = useState<{ sig: string; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Signature of this product's movements in the live store; refetch when it changes.
  const liveSig = useMemo(
    () => `${id}|${state.movements.filter((m) => m.product_id === id).map((m) => m.id).join(",")}`,
    [state.movements, id],
  );

  useEffect(() => {
    let cancelled = false;
    fetchProductHistory(id)
      .then((rows) => {
        if (cancelled) return;
        setHistory((h) => ({ ...h, [id]: { sig: liveSig, rows } }));
        setFailed(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setFailed({ sig: liveSig, message: e instanceof Error ? e.message : "טעינת ההיסטוריה נכשלה" });
      });
    return () => {
      cancelled = true;
    };
  }, [id, liveSig, fetchProductHistory]);

  const cached = history[id];
  const rows = cached?.rows;
  const error = failed?.sig === liveSig ? failed.message : null;
  const loading = cached?.sig !== liveSig && !error;

  // Every supplier wording mapped to this product; pending first, then most-used.
  const supplierNames = useMemo(
    () =>
      state.supplierItems
        .filter((i) => i.product_id === id)
        .sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || b.times_seen - a.times_seen),
    [state.supplierItems, id],
  );
  const pendingItems = useMemo(() => supplierNames.filter((i) => i.status === "pending"), [supplierNames]);
  const openFaults = useMemo(
    () => state.faults.filter((f) => f.product_id === id && f.status === "open"),
    [state.faults, id],
  );
  // Open orders holding this product, oldest first as on the overview. An order has one line per product.
  const holds = useMemo(
    () =>
      state.orders
        .filter((o) => o.status === "open")
        .flatMap((o) => linesOf(o.id).filter((l) => l.product_id === id).map((l) => ({ order: o, qty: l.qty })))
        .reverse(),
    [state.orders, linesOf, id],
  );

  const monthCount = useMemo(() => {
    const now = new Date();
    const src = rows ?? state.movements.filter((m) => m.product_id === id);
    return src.filter((m) => sameMonth(m.created_at, now)).length;
  }, [rows, state.movements, id]);

  const run = useCallback(
    async (key: string, fn: () => Promise<void>, success: string) => {
      setBusy(key);
      try {
        await fn();
        notify({ tone: "success", title: success });
      } catch (e: unknown) {
        notify({ tone: "danger", title: "הפעולה נכשלה", text: e instanceof Error ? e.message : undefined });
      } finally {
        setBusy(null);
      }
    },
    [notify],
  );

  const copyBarcode = useCallback(
    async (barcode: string) => {
      try {
        await navigator.clipboard.writeText(barcode);
        notify({ tone: "success", title: "הברקוד הועתק" });
      } catch {
        notify({ tone: "danger", title: "ההעתקה נכשלה" });
      }
    },
    [notify],
  );

  if (!p) return null;

  // The store's rules, in the inventory's words: short or out is urgent, under the minimum after what open orders hold is a warning.
  const free = available(p);
  const short = free < 0;
  const out = p.qty <= 0;
  const low = !short && !out && p.min_qty > 0 && free < p.min_qty;
  const stockWord = out ? "אזל" : short ? "חסר להזמנות" : low ? "מתחת למינימום" : null;
  const photo = productPhotoUrl(p.image_path);
  const place = resolvePlace(p.location, floor);
  const standing = (shelves ?? []).filter((row) => row.product_id === p.id);

  // The fault behind a history entry: photo, full note and status live on the fault, not the movement.
  const faultDetail = (f: Fault) => {
    const src = faultPhotoUrl(f.photo_path);
    const resolving = busy === `fault:${f.id}`;
    return (
      <div className="sa-timeline-detail">
        <p className="sa-timeline-note">{f.description}</p>
        {src ? (
          <a className="sa-fault-photo" href={src} target="_blank" rel="noreferrer" aria-label="פתיחת התמונה">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="תצלום התקלה" loading="lazy" />
          </a>
        ) : null}
        <div className="sa-timeline-status">
          {f.status === "open" ? (
            <>
              <Badge tone="danger" dot>פתוחה</Badge>
              <Button variant="link" size="sm" disabled={resolving} onClick={() => void run(`fault:${f.id}`, () => resolveFault(f.id), "התקלה סומנה כטופלה")}>
                {resolving ? "סימון…" : "סימון כטופל"}
              </Button>
            </>
          ) : (
            <Badge tone="success" dot>טופלה{f.resolved_at ? ` ${fmtRelative(f.resolved_at)}` : ""}</Badge>
          )}
        </div>
      </div>
    );
  };

  const productFaults = state.faults.filter((f) => f.product_id === id);
  const movementEntries = (rows ?? []).map((m) => {
    const fault = productFaults.find((f) => f.movement_id === m.id);
    const extra = fault ? null : m.note || m.reference;
    const head = extra ? `${MOVEMENT_LABEL[m.type]} · ${extra}` : MOVEMENT_LABEL[m.type];
    const item: TimelineItem = {
      id: m.id,
      type: m.type,
      title: m.external_name ? (
        <>
          {head}
          <span className="sa-cell-sub sa-truncate">בתעודה: &quot;<bdi>{m.external_name}</bdi>&quot;</span>
        </>
      ) : head,
      when: fmtRelative(m.created_at),
      by: worker(m.worker_id)?.name,
      qty: m.qty,
      detail: fault ? faultDetail(fault) : undefined,
    };
    return { at: m.created_at, item };
  });
  // Faults reported without a quantity have no movement, but still belong in the product's history.
  const faultEntries = rows
    ? productFaults
        .filter((f) => !f.movement_id)
        .map((f) => {
          const item: TimelineItem = {
            id: f.id,
            type: "fault",
            when: fmtRelative(f.created_at),
            by: worker(f.reported_by)?.name,
            detail: faultDetail(f),
          };
          return { at: f.created_at, item };
        })
    : [];
  const timelineItems = [...movementEntries, ...faultEntries]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((e) => e.item);

  const tabs = [
    { value: "details", label: "פרטים" },
    { value: "history", label: "היסטוריה", count: rows ? timelineItems.length : undefined },
  ];

  return (
    <SidePanel
      className="sa-sheet sa-product"
      media={
        photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="sa-product-photo" src={photo} alt={p.name} loading="lazy" />
        ) : null
      }
      eyebrow={<span className="sa-mono ltr">{p.sku}</span>}
      title={fmtName(p.name)}
      summary={
        <>
          <dl className="sa-figures">
            <Figure label="במלאי" value={p.qty} unit={p.unit} tone={out && !short ? "danger" : undefined} />
            <Figure label="משוריין" value={p.reserved} unit={p.unit} tone={p.reserved === 0 ? "quiet" : undefined} />
            <Figure label={short ? "חסר" : "זמין"} value={Math.abs(free)} unit={p.unit} tone={short ? "short" : low ? "warning" : undefined} />
          </dl>
          {p.min_qty > 0 || stockWord ? (
            <div className="sa-product-level">
              {p.min_qty > 0 ? <StockMeter value={free} min={p.min_qty} tone={out || short ? "out" : low ? "low" : "ok"} /> : null}
              <p className="sa-product-level-words">
                {p.min_qty > 0 ? <span>מינימום <span className="ltr">{fmtQty(p.min_qty)}</span></span> : null}
                {stockWord ? <span className={`sa-product-state is-${short ? "short" : out ? "danger" : "warning"}`}>{stockWord}</span> : null}
              </p>
            </div>
          ) : null}
        </>
      }
      tabs={tabs}
      tab={tab}
      onTab={(v) => setTab(v === "history" ? "history" : "details")}
      onClose={close}
      headActions={
        <Button variant="ghost" size="sm" icon="edit" onClick={() => openAction("edit-product", { productId: p.id })}>עריכה</Button>
      }
      footer={
        <>
          <div>
            <Button variant="ghost" icon="clipboard-check" onClick={() => openAction("adjust", { productId: p.id })}>תיקון ספירה</Button>
          </div>
          <div>
            <Button variant="secondary" icon="arrow-up-right" onClick={() => openAction("issue", { productId: p.id })}>הוצאה</Button>
            <Button variant="primary" icon="arrow-down-left" onClick={() => openAction("receive", { productId: p.id })}>קליטה</Button>
          </div>
        </>
      }
    >
      {tab === "details" ? (
        <>
          {pendingItems.map((it) => {
            const s = supplier(it.supplier_id);
            return (
              <Notice
                key={it.id}
                tone="warning"
                title="התאמה ממתינה"
                action={busy === `map:${it.id}` ? "אישור…" : "אישור"}
                onAction={() => void run(`map:${it.id}`, () => approveSupplierItem(it.id), "ההתאמה אושרה")}
              >
                {[it.external_name, it.external_sku, s?.name].filter(Boolean).join(" · ")}
              </Notice>
            );
          })}

          {openFaults.map((f) => {
            const w = worker(f.reported_by);
            const src = faultPhotoUrl(f.photo_path);
            return (
              <Notice
                key={f.id}
                tone="danger"
                title={f.description}
                action={busy === `fault:${f.id}` ? "סימון…" : "סימון כטופל"}
                onAction={() => void run(`fault:${f.id}`, () => resolveFault(f.id), "התקלה סומנה כטופלה")}
              >
                {[fmtRelative(f.created_at), w ? `דווח ע"י ${w.name}` : null].filter(Boolean).join(" · ")}
                {src ? (
                  <a className="sa-fault-photo" href={src} target="_blank" rel="noreferrer" aria-label="פתיחת התמונה">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="תצלום התקלה" loading="lazy" />
                  </a>
                ) : null}
              </Notice>
            );
          })}

          {holds.length > 0 ? (
            <section className="sa-group flex flex-col gap-[var(--space-2)]" aria-labelledby="product-orders-title">
              <h3 id="product-orders-title" className="sa-section-title">
                הזמנות פתוחות
                <span className="sa-mono sa-faint ms-[var(--space-2)] font-normal">{fmtQty(holds.length)}</span>
              </h3>
              <ul className="sa-rows flex list-none flex-col divide-y divide-line-subtle">
                {holds.map(({ order, qty }) => (
                  <li key={order.id} className="sa-order-line relative flex items-center gap-[var(--space-3)] py-[var(--space-2)]">
                    <button type="button" className="sa-attention-open min-w-0 flex-1" onClick={() => openOrder(order.id)}>
                      <span className="sa-truncate block">
                        <span className="text-ink-2">הזמנה <span className="sa-mono ltr">{order.number}</span> · </span>
                        <bdi>{order.customer}</bdi>
                      </span>
                      <span className="sa-cell-sub">{agent(order.agent_id)?.name}</span>
                    </button>
                    <span className="shrink-0"><span className="sa-num">{fmtQty(qty)}</span> {p.unit}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <Fields
            items={[
              ...(standing.length > 0
                ? standing.map((row) => ({
                    label: "מיקום",
                    value: (
                      <>
                        <Link className="sa-btn sa-btn-link" href={`/3d?at=${encodeURIComponent(row.place)}`} onClick={close}>{placeWords(row.place, floor)}</Link>
                        {standing.length > 1 ? <> · <span className="sa-num">{fmtQty(row.qty)}</span> {p.unit}</> : null}
                      </>
                    ),
                  }))
                : [{
                    label: "מיקום",
                    value: place ? <Link className="sa-btn sa-btn-link" href={`/3d?at=${encodeURIComponent(place.objectId)}`} onClick={close}>{p.location}</Link> : p.location,
                  }]),
              { label: "ספק ראשי", value: supplier(p.primary_supplier_id)?.name },
              {
                label: "ברקוד",
                value: p.barcode ? (
                  <span className="inline-flex items-baseline gap-[var(--space-2)]">
                    <span className="sa-mono ltr">{p.barcode}</span>
                    <Button variant="link" size="sm" aria-label="העתקת ברקוד" title="העתקת ברקוד" onClick={() => void copyBarcode(p.barcode as string)}>
                      העתקה
                    </Button>
                  </span>
                ) : undefined,
              },
            ]}
          />
          <Fields
            items={[
              { label: "קטגוריה", value: p.category },
              { label: "יחידה", value: p.unit },
              ...(p.price !== null ? [{ label: "מחיר", value: fmtPrice(p.price), num: true }] : []),
              { label: "קטלוג", value: p.in_catalog ? "מוצג" : "לא מוצג" },
            ]}
          />
          <Fields
            items={[
              { label: "תנועות החודש", value: fmtQty(monthCount), num: true },
              { label: "עודכן", value: fmtRelative(p.updated_at) },
              { label: "נוצר", value: fmtDate(p.created_at), num: true },
            ]}
          />
          {p.notes ? (
            <Fields columns={1} items={[{ label: "הערות", value: <span className="whitespace-pre-wrap">{p.notes}</span> }]} />
          ) : null}

          <section className="sa-group flex flex-col gap-[var(--space-2)]" aria-labelledby="supplier-names-title">
            <h3 id="supplier-names-title" className="sa-section-title">
              שמות אצל ספקים
              {supplierNames.length > 0 ? <span className="sa-mono sa-faint ms-[var(--space-2)] font-normal">{fmtQty(supplierNames.length)}</span> : null}
            </h3>
            {supplierNames.length === 0 ? (
              <p className="sa-hint">אין שמות ספק ממופים</p>
            ) : (
              <ul className="sa-rows flex list-none flex-col divide-y divide-line-subtle">
                {supplierNames.map((it) => {
                  const s = supplier(it.supplier_id);
                  const approving = busy === `map:${it.id}`;
                  return (
                    <li key={it.id} className="flex items-center gap-[var(--space-3)] py-[var(--space-2)]">
                      <span className="min-w-0 flex-1">
                        <span className="sa-truncate block">
                          {s ? <span className="text-ink-2">{s.name} · </span> : null}
                          <bdi>{it.external_name}</bdi>
                          {it.external_sku ? <> · <span className="sa-mono ltr text-ink-3">{it.external_sku}</span></> : null}
                        </span>
                        <span className="sa-cell-sub">
                          נראה <span className="sa-mono">{fmtQty(it.times_seen)}</span> פעמים
                        </span>
                      </span>
                      {it.status === "pending" ? (
                        <span className="inline-flex items-center gap-[var(--space-2)]">
                          <Badge tone="warning">ממתין</Badge>
                          <Button variant="link" size="sm" disabled={approving} onClick={() => void run(`map:${it.id}`, () => approveSupplierItem(it.id), "ההתאמה אושרה")}>
                            {approving ? "אישור…" : "אישור"}
                          </Button>
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      ) : (
        <>
          {error ? (
            <Notice tone="danger" title="טעינת ההיסטוריה נכשלה">{error}</Notice>
          ) : null}
          {loading && !rows ? (
            <div className="flex justify-center py-[var(--space-8)] text-ink-3">
              <Spinner size="md" track label="טוען היסטוריה" />
            </div>
          ) : rows && timelineItems.length === 0 ? (
            <p className="sa-muted py-[var(--space-6)] text-center">אין תנועות</p>
          ) : (
            <Timeline items={timelineItems} />
          )}
        </>
      )}
    </SidePanel>
  );
}
