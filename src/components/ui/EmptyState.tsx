import type { ReactElement, ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export interface EmptyStateProps {
  icon?: IconName;
  title: ReactNode;
  hint?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** Quiet empty state with up to two actions as children. */
export function EmptyState({ icon = "inbox", title, hint, className, children }: EmptyStateProps): ReactElement {
  return (
    <div className={cx("sa-empty", className)}>
      <span className="sa-empty-icon"><Icon name={icon} size={20} strokeWidth={1.75} /></span>
      <p className="sa-empty-title">{title}</p>
      {hint ? <p className="sa-empty-hint">{hint}</p> : null}
      {children ? <div className="sa-empty-actions">{children}</div> : null}
    </div>
  );
}
