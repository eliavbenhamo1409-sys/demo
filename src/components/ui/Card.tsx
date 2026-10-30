"use client";

import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { Badge } from "./Badge";

export interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  count?: number;
  actions?: ReactNode;
  footer?: ReactNode;
  flush?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** Surface block with optional header (title, count, actions) and footer. */
export function Card({ title, subtitle, icon, count, actions, footer, flush, className, style, children }: CardProps) {
  const hasHead = title != null || actions != null;
  return (
    <section className={cx("sa-card", className)} style={style}>
      {hasHead ? (
        <header className="sa-card-head">
          <div className="min-w-0">
            <h3 className="sa-card-title">
              {icon ? <Icon name={icon} className="sa-faint" /> : null}
              {title}
              {count != null ? <Badge count>{String(count)}</Badge> : null}
            </h3>
            {subtitle ? <p className="sa-card-sub">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-[var(--space-2)]">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cx("sa-card-body", flush && "is-flush")}>{children}</div>
      {footer ? <footer className="sa-card-foot">{footer}</footer> : null}
    </section>
  );
}
