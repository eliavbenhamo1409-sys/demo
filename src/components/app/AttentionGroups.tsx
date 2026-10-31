"use client";

/**
 * "דורש טיפול" as collapsible groups: one tile per kind of problem (faults,
 * stock, supplier dictionary). Only kinds with open items are shown; each tile
 * carries a red count badge and expands downward to list its items.
 */
import { useId, useState } from "react";
import { Attention, Icon, type AttentionItem, type IconName } from "@/components/ui";
import type { AttentionKind } from "@/lib/store";
import { fmtQty } from "@/lib/format";
import "./attention-groups.css";

export type GroupKey = "fault" | "stock" | "mapping";

export type GroupedItem = AttentionItem & { kind: AttentionKind };

type GroupDef = { key: GroupKey; title: string; hint: string; icon: IconName; kinds: AttentionKind[] };

const GROUPS: GroupDef[] = [
  { key: "fault", title: "תקלות", hint: "סחורה פגומה ודיווחים מהרצפה", icon: "alert-triangle", kinds: ["fault"] },
  { key: "stock", title: "מלאי", hint: "אזל או מתחת למינימום", icon: "package", kinds: ["out", "low"] },
  { key: "mapping", title: "מילון ספקים", hint: "שמות מתעודות שממתינים לאישור", icon: "book-open", kinds: ["mapping"] },
];

export function AttentionGroups({ items }: { items: GroupedItem[] }) {
  const [open, setOpen] = useState<GroupKey | null>(null);
  const baseId = useId();

  const groups = GROUPS.map((g) => ({ ...g, items: items.filter((it) => g.kinds.includes(it.kind)) })).filter((g) => g.items.length > 0);

  if (groups.length === 0) {
    return (
      <div className="ag-empty">
        <Icon name="check-circle" />
        <span>אין דברים לטיפול. נעדכן כאן ברגע שמשהו ידרוש תשומת לב.</span>
      </div>
    );
  }

  const active = groups.find((g) => g.key === open) ?? null;

  return (
    <div className="ag">
      <div className="ag-tiles" role="tablist" aria-label="דורש טיפול">
        {groups.map((g) => {
          const isOpen = g.key === open;
          return (
            <button
              key={g.key}
              type="button"
              role="tab"
              id={`${baseId}-tab-${g.key}`}
              aria-selected={isOpen}
              aria-controls={`${baseId}-panel-${g.key}`}
              aria-expanded={isOpen}
              className={isOpen ? "ag-tile is-open" : "ag-tile"}
              onClick={() => setOpen(isOpen ? null : g.key)}
            >
              <span className="ag-count" aria-label={`${fmtQty(g.items.length)} פריטים`}>{fmtQty(g.items.length)}</span>
              <span className="ag-icon"><Icon name={g.icon} /></span>
              <span className="ag-text">
                <span className="ag-title">{g.title}</span>
                <span className="ag-hint">{g.hint}</span>
              </span>
              <span className="ag-chev"><Icon name="chevron-down" /></span>
            </button>
          );
        })}
      </div>
      {active ? (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${active.key}`}
          aria-labelledby={`${baseId}-tab-${active.key}`}
          className="ag-panel"
        >
          <Attention items={active.items} />
        </div>
      ) : null}
    </div>
  );
}
