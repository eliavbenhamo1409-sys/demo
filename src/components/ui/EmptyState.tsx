import type { ReactElement, ReactNode } from "react";
import { cx } from "./cx";

export interface EmptyStateProps {
  title: ReactNode;
  hint?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** Quiet empty state with up to two actions as children. */
export function EmptyState({ title, hint, className, children }: EmptyStateProps): ReactElement {
  return (
    <div className={cx("sa-empty", className)}>
      <p className="sa-empty-title">{title}</p>
      {hint ? <p className="sa-empty-hint">{hint}</p> : null}
      {children ? <div className="sa-empty-actions">{children}</div> : null}
    </div>
  );
}
