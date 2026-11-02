"use client";

/**
 * "דורש טיפול": danger items sit in a plain always-open list on top; the rest
 * fall into collapsible groups, one row per kind of problem (stock, supplier
 * dictionary). Only kinds with open items are shown; each row shows a quiet
 * count and opens in place to list its items.
 */
import { useId, useState } from "react";
import { Attention, Icon, type AttentionItem, type IconName } from "@/components/ui";
import type { AttentionKind } from "@/lib/store";
import { fmtQty } from "@/lib/format";
import "./overview.css";

export type GroupKey = "request" | "stock" | "mapping";

export type GroupedItem = AttentionItem & { kind: AttentionKind };

type GroupDef = { key: GroupKey; title: string; hint: string; icon: IconName; kinds: AttentionKind[] };

const GROUPS: GroupDef[] = [
  { key: "request", title: "בקשות", hint: "ממתינים לאישור", icon: "book-open", kinds: ["request"] },
  { key: "stock", title: "מלאי", hint: "מתחת למינימום", icon: "package", kinds: ["low"] },
  { key: "mapping", title: "מילון ספקים", hint: "ממתינים לאישור", icon: "truck", kinds: ["mapping"] },
];

export function AttentionGroups({ items }: { items: GroupedItem[] }) {
  const [open, setOpen] = useState<GroupKey | null>(null);
  const baseId = useId();

  const urgent = items.filter((it) => it.severity === "danger");
  const rest = items.filter((it) => it.severity !== "danger");
  const groups = GROUPS.map((g) => ({ ...g, items: rest.filter((it) => g.kinds.includes(it.kind)) })).filter((g) => g.items.length > 0);

  if (urgent.length === 0 && groups.length === 0) {
    return (
      <p className="ag-empty">אין פריטים לטיפול</p>
    );
  }

  return (
    <div className="ag">
      {urgent.length > 0 ? (
        <section className="ag-urgent" aria-label="לטיפול ראשון">
          <Attention items={urgent} />
        </section>
      ) : null}
      {groups.map((g) => {
        const isOpen = g.key === open;
        const panelId = `${baseId}-panel-${g.key}`;
        return (
          <div key={g.key} className="ag-group">
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              className={isOpen ? "ag-head is-open" : "ag-head"}
              onClick={() => setOpen(isOpen ? null : g.key)}
            >
              <span className="ag-text">
                <span className="ag-title">{g.title}</span>
                <span className="ag-hint">{g.hint}</span>
              </span>
              <span className="ag-count" aria-label={`${fmtQty(g.items.length)} פריטים`}>
                <Icon name={g.icon} size={14} />
                {fmtQty(g.items.length)}
              </span>
              <span className="ag-chev"><Icon name="chevron-down" /></span>
            </button>
            {isOpen ? (
              <div id={panelId} className="ag-panel">
                <Attention items={g.items} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
