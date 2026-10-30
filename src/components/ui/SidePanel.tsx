"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";
import { Button } from "./Button";
import { Tabs, type TabItem } from "./Tabs";

export interface SidePanelProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  tabs?: TabItem[];
  tab?: string;
  defaultTab?: string;
  onTab?: (value: string) => void;
  headActions?: ReactNode;
  footer?: ReactNode;
  onClose?: () => void;
  card?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** Details drawer (440px). Rendered in flow here; the app fixes it to the viewport over the scrim. Escape calls onClose. */
export function SidePanel({ title, eyebrow, subtitle, tabs, tab, defaultTab, onTab, headActions, footer, onClose, card, className, style, children }: SidePanelProps) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); onClose(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className={cx("sa-panel", card && "is-card", className)} style={style} aria-label={typeof title === "string" ? title : undefined}>
      <div className="sa-panel-head">
        <div className="min-w-0">
          {eyebrow ? <p className="sa-panel-eyebrow">{eyebrow}</p> : null}
          <h2 className="sa-panel-title sa-truncate">{title}</h2>
          {subtitle ? <p className="sa-panel-sub">{subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 gap-[var(--space-1)]">
          {headActions}
          <Button variant="ghost" size="sm" iconOnly icon="x" aria-label="סגור" onClick={onClose} />
        </div>
      </div>
      {tabs && tabs.length > 0 ? (
        <div className="sa-panel-tabs">
          <Tabs variant="line" tabs={tabs} value={tab} defaultValue={defaultTab} onChange={onTab} />
        </div>
      ) : null}
      <div className="sa-panel-body">{children}</div>
      {footer ? <div className="sa-panel-foot">{footer}</div> : null}
    </aside>
  );
}
