"use client";

/**
 * Product details + movement history in a SidePanel.
 * Opened via useUi().openProduct(id, tab?); reads ui.panel of type "product".
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useData, type Movement } from "@/lib/store";
import { useUi } from "./ui-state";
import { Badge, Button, Fields, Notice, SidePanel, Spinner, Stat, Timeline, type TimelineItem } from "@/components/ui";
import { fmtDate, fmtQty, fmtRelative, MOVEMENT_LABEL } from "@/lib/format";

type PanelTab = "details" | "history";

function sameMonth(iso: string, now: Date): boolean {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
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
  const { state, product, supplier, worker, fetchProductHistory, approveSupplierItem, resolveFault } = useData();
  const { close, notify, openAction } = useUi();
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

  const out = p.qty <= 0;
  const low = !out && p.min_qty > 0 && p.qty < p.min_qty;
  const tone = out ? "danger" : low ? "warning" : undefined;

  const subtitle = [p.category, p.location].filter(Boolean).join(" · ");

  const timelineItems: TimelineItem[] = (rows ?? []).map((m) => {
    const extra = m.note || m.reference;
    const head = extra ? `${MOVEMENT_LABEL[m.type]} · ${extra}` : MOVEMENT_LABEL[m.type];
    return {
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
    };
  });

  const tabs = [
    { value: "details", label: "פרטים" },
    { value: "history", label: "היסטוריה", count: rows ? rows.length : undefined },
  ];

  return (
    <SidePanel
      eyebrow={<span className="ltr">{p.sku}</span>}
      title={p.name}
      subtitle={subtitle || undefined}
      tabs={tabs}
      tab={tab}
      onTab={(v) => setTab(v === "history" ? "history" : "details")}
      onClose={close}
      headActions={
        <Button variant="ghost" size="sm" iconOnly icon="edit" aria-label="עריכה" title="עריכה" onClick={() => openAction("edit-product", { productId: p.id })} />
      }
      footer={
        <>
          <div>
            <Button variant="ghost" icon="refresh" onClick={() => openAction("adjust", { productId: p.id })}>תיקון ספירה</Button>
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
          <div className="grid grid-cols-2 gap-[var(--space-3)]">
            <Stat label="במלאי" value={fmtQty(p.qty)} unit={p.unit} note={`מינימום ${fmtQty(p.min_qty)}`} tone={tone} />
            <Stat label="תנועות החודש" value={fmtQty(monthCount)} icon="activity" />
          </div>

          {pendingItems.map((it) => {
            const s = supplier(it.supplier_id);
            return (
              <Notice
                key={it.id}
                tone="warning"
                title="התאמה לא מאושרת"
                action={busy === `map:${it.id}` ? "מאשר…" : "אשר"}
                onAction={() => void run(`map:${it.id}`, () => approveSupplierItem(it.id), "ההתאמה אושרה")}
              >
                {[it.external_name, it.external_sku, s?.name].filter(Boolean).join(" · ")}
              </Notice>
            );
          })}

          {openFaults.map((f) => {
            const w = worker(f.reported_by);
            return (
              <Notice
                key={f.id}
                tone="danger"
                title={f.description}
                action={busy === `fault:${f.id}` ? "מסמן…" : "סמן כטופל"}
                onAction={() => void run(`fault:${f.id}`, () => resolveFault(f.id), "התקלה סומנה כטופלה")}
              >
                {[fmtRelative(f.created_at), w ? `דווח ע"י ${w.name}` : null].filter(Boolean).join(" · ")}
              </Notice>
            );
          })}

          <Fields
            items={[
              {
                label: "ברקוד",
                value: p.barcode ? (
                  <span className="inline-flex items-center gap-[var(--space-1)]">
                    <span className="sa-mono ltr">{p.barcode}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      icon="copy"
                      aria-label="העתק ברקוד"
                      title="העתק ברקוד"
                      onClick={() => void copyBarcode(p.barcode as string)}
                    />
                  </span>
                ) : undefined,
              },
              { label: "ספק ראשי", value: supplier(p.primary_supplier_id)?.name },
              { label: "יחידה", value: p.unit },
              { label: "קטגוריה", value: p.category },
              { label: "מיקום", value: p.location },
              { label: "עודכן", value: fmtRelative(p.updated_at) },
              { label: "נוצר", value: fmtDate(p.created_at), num: true },
            ]}
          />
          {p.notes ? (
            <Fields columns={1} items={[{ label: "הערות", value: <span className="whitespace-pre-wrap">{p.notes}</span> }]} />
          ) : null}

          <section className="flex flex-col gap-[var(--space-2)]" aria-labelledby="supplier-names-title">
            <h3 id="supplier-names-title" className="sa-card-title m-0 text-[13px] font-medium text-ink-2">
              שמות אצל ספקים
              {supplierNames.length > 0 ? <span className="sa-num ms-[var(--space-2)] text-ink-3">{fmtQty(supplierNames.length)}</span> : null}
            </h3>
            {supplierNames.length === 0 ? (
              <p className="sa-muted m-0 text-[13px]">אין שמות ספק ממופים</p>
            ) : (
              <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
                {supplierNames.map((it) => {
                  const s = supplier(it.supplier_id);
                  const approving = busy === `map:${it.id}`;
                  return (
                    <li key={it.id} className="flex items-center gap-[var(--space-3)] py-[var(--space-2)]">
                      <span className="min-w-0 flex-1">
                        <span className="sa-truncate block text-[14px]">
                          {s ? <span className="text-ink-2">{s.name} · </span> : null}
                          <bdi>{it.external_name}</bdi>
                          {it.external_sku ? <span className="sa-mono ltr ms-[var(--space-2)] text-ink-3">{it.external_sku}</span> : null}
                        </span>
                        <span className="sa-muted text-[12px]">
                          נראה <span className="sa-num">{fmtQty(it.times_seen)}</span> פעמים
                        </span>
                      </span>
                      {it.status === "approved" ? (
                        <Badge tone="success" dot>מאושר</Badge>
                      ) : (
                        <span className="inline-flex items-center gap-[var(--space-1)]">
                          <Badge tone="warning" solid>לבדיקה</Badge>
                          <Button variant="link" size="sm" disabled={approving} onClick={() => void run(`map:${it.id}`, () => approveSupplierItem(it.id), "ההתאמה אושרה")}>
                            {approving ? "מאשר…" : "אשר"}
                          </Button>
                        </span>
                      )}
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
          ) : rows && rows.length === 0 ? (
            <p className="sa-muted py-[var(--space-6)] text-center">אין תנועות למוצר זה עדיין</p>
          ) : (
            <Timeline items={timelineItems} />
          )}
        </>
      )}
    </SidePanel>
  );
}
