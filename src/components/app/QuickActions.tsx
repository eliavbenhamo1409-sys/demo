"use client";

import { Button, Card, Mark, type IconName, type Tone } from "@/components/ui";
import { useUi, type ActionKind } from "./ui-state";

type QuickAction = {
  kind: ActionKind;
  title: string;
  sub: string;
  button: string;
  icon: IconName;
  tone: Tone;
};

const ACTIONS: QuickAction[] = [
  { kind: "receive", title: "קליטת סחורה", sub: "סחורה שהגיעה מספק", button: "קלוט", icon: "arrow-down-left", tone: "success" },
  { kind: "issue", title: "הוצאת סחורה", sub: "הוצאה לייצור או ללקוח", button: "הוצא", icon: "arrow-up-right", tone: "accent" },
  { kind: "fault", title: "דיווח תקלה", sub: "פריט פגום או חסר", button: "דווח", icon: "alert-triangle", tone: "danger" },
  { kind: "new-product", title: "מוצר חדש", sub: "הוספת פריט למלאי", button: "הוסף", icon: "plus", tone: "neutral" },
];

export interface QuickActionsProps {
  className?: string;
}

/** Compact list of the four everyday actions; each row opens the matching drawer. */
export function QuickActions({ className }: QuickActionsProps) {
  const { openAction } = useUi();
  return (
    <Card title="פעולות" flush className={className}>
      <ul className="m-0 list-none p-0">
        {ACTIONS.map((a, i) => (
          <li
            key={a.kind}
            className="flex items-center gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-3)]"
            style={i > 0 ? { borderTop: "1px solid var(--border-subtle)" } : undefined}
          >
            <Mark tone={a.tone} icon={a.icon} size="md" strokeWidth={2.25} />
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-[14px] font-semibold leading-[21px] text-ink">{a.title}</p>
              <p className="m-0 truncate text-[12px] leading-[16px] text-ink-3">{a.sub}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => openAction(a.kind)} aria-label={`${a.button} — ${a.title}`}>
              {a.button}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
