"use client";

/**
 * The grouped to-do list: everything that needs a manager's hand but is not
 * urgent — products below minimum and supplier names waiting for approval.
 * Urgent items (out of stock, open faults) live on the overview itself.
 */
import { useMemo } from "react";
import { Badge, Button, SidePanel, Square, type Tone } from "@/components/ui";
import { useData, type AttentionEntry, type AttentionKind } from "@/lib/store";
import { useUi } from "./ui-state";
import { fmtQty, fmtRelative } from "@/lib/format";

type Group = {
  kind: AttentionKind;
  title: string;
  hint: string;
  tone: Tone;
  action: string;
  items: AttentionEntry[];
};

const ORDER: AttentionKind[] = ["low", "mapping", "out", "fault"];

const META: Record<AttentionKind, { title: string; hint: string; tone: Tone; action: string }> = {
  low: { title: "מתחת למינימום", hint: "להזמין או לקלוט סחורה", tone: "warning", action: "קלוט" },
  mapping: { title: "התאמות לא מאושרות", hint: "שמות מתעודות משלוח שממתינים לאישור", tone: "warning", action: "מפה" },
  out: { title: "אזל מהמלאי", hint: "", tone: "danger", action: "קלוט" },
  fault: { title: "תקלות פתוחות", hint: "", tone: "danger", action: "פרטים" },
};

export function TasksPanel() {
  const { attention, state, product } = useData();
  const { panel, close, openAction, openProduct } = useUi();

  const groups = useMemo<Group[]>(() => {
    const byKind = new Map<AttentionKind, AttentionEntry[]>();
    for (const a of attention) {
      if (a.severity === "danger") continue; // urgent items stay on the overview
      const list = byKind.get(a.kind) ?? [];
      list.push(a);
      byKind.set(a.kind, list);
    }
    return ORDER.filter((k) => byKind.has(k)).map((kind) => ({ kind, ...META[kind], items: byKind.get(kind) ?? [] }));
  }, [attention]);

  if (panel?.type !== "tasks") return null;

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <SidePanel
      title="משימות"
      subtitle={total === 0 ? "אין משימות פתוחות" : `${fmtQty(total)} משימות פתוחות · ${groups.length} סוגים`}
      onClose={close}
    >
      {groups.length === 0 ? (
        <p className="sa-muted m-0 py-[var(--space-6)] text-center">הכול מסודר. משימות חדשות יופיעו כאן.</p>
      ) : (
        groups.map((g) => (
          <section key={g.kind} aria-labelledby={`tasks-${g.kind}`} className="flex flex-col">
            <header className="flex items-center gap-[var(--space-2)] pb-[var(--space-2)]">
              <Square tone={g.tone} />
              <h3 id={`tasks-${g.kind}`} className="sa-section-title">{g.title}</h3>
              <Badge count>{fmtQty(g.items.length)}</Badge>
              {g.hint ? <span className="sa-faint mr-auto text-[12px]">{g.hint}</span> : null}
            </header>
            <ul className="m-0 list-none overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-base)] bg-[var(--bg-surface)] p-0">
              {g.items.map((a) => {
                const p = a.productId ? product(a.productId) : undefined;
                const sub =
                  a.kind === "low" && p
                    ? `במלאי ${fmtQty(p.qty)} · מינימום ${fmtQty(p.min_qty)} · חסרים ${fmtQty(p.min_qty - p.qty)} ${p.unit}`
                    : a.meta.filter((m) => m && !/^[\x20-\x7E]+$/.test(m)).join(" · ");
                const code = a.kind === "low" ? p?.sku : a.meta.find((m) => /^[\x20-\x7E]+$/.test(m));
                const title = a.kind === "low" && p ? p.name : a.title;
                const onAction =
                  a.kind === "mapping"
                    ? () => openAction("map-supplier-item", { supplierItemId: a.supplierItemId })
                    : () => openAction("receive", { productId: a.productId });
                return (
                  <li key={a.id} className="flex items-center gap-[var(--space-3)] border-b border-[var(--border-subtle)] px-[var(--space-4)] py-[var(--space-3)] last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="m-0 truncate text-[14px] font-semibold leading-[21px]">
                        {a.productId ? (
                          <button type="button" className="sa-btn-link truncate text-start" onClick={() => openProduct(a.productId as string)}>
                            {title}
                          </button>
                        ) : (
                          title
                        )}
                      </p>
                      <p className="sa-faint m-0 flex flex-wrap gap-[var(--space-2)] text-[12px] leading-[16px]">
                        {sub ? <span>{sub}</span> : null}
                        {code ? <span className="sa-mono ltr">{code}</span> : null}
                        <span>{fmtRelative(a.at)}</span>
                      </p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={onAction}>{g.action}</Button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      {state.status === "ready" && groups.length > 0 ? (
        <p className="sa-faint m-0 text-[12px]">הדחופים (אזל, תקלות) מוצגים בסקירה תחת "דחוף".</p>
      ) : null}
    </SidePanel>
  );
}
