import type { ReactElement, ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconName, type Tone } from "./Icon";

export interface BadgeProps {
  tone?: Tone | "inverse";
  /** Full-colour fill with the on-colour text; default is an outlined badge with a solid colour square. */
  solid?: boolean;
  dot?: boolean;
  icon?: IconName;
  count?: boolean;
  size?: "md" | "lg";
  className?: string;
  children?: ReactNode;
}

/** Status tag — one or two words, always with a word or icon, never colour alone. */
export function Badge({ tone = "neutral", solid, dot, icon, count, size = "md", className, children }: BadgeProps): ReactElement {
  const isSolid = !!solid || tone === "inverse";
  const showDot = dot !== undefined ? dot : !isSolid && !count && !icon && tone !== "neutral";
  return (
    <span className={cx("sa-badge", `sa-badge-${tone}`, isSolid && "is-solid", count && "sa-badge-count", size === "lg" && "sa-badge-lg", className)}>
      {showDot ? <span className="sa-badge-dot" aria-hidden="true" /> : null}
      {icon ? <Icon name={icon} size={12} strokeWidth={2.5} /> : null}
      {children}
    </span>
  );
}
