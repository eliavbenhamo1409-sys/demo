import type { ReactElement, ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconName, type Tone } from "./Icon";

export interface BadgeProps {
  tone?: Tone | "inverse";
  dot?: boolean;
  icon?: IconName;
  count?: boolean;
  size?: "md" | "lg";
  className?: string;
  children?: ReactNode;
}

/** Status tag — one or two words, always with a word or icon, never colour alone. */
export function Badge({ tone = "neutral", dot, icon, count, size = "md", className, children }: BadgeProps): ReactElement {
  const showDot = dot !== undefined ? dot : tone !== "inverse" && !count && !icon;
  return (
    <span className={cx("sa-badge", `sa-badge-${tone}`, count && "sa-badge-count", size === "lg" && "sa-badge-lg", className)}>
      {showDot ? <span className="sa-badge-dot" aria-hidden="true" /> : null}
      {icon ? <Icon name={icon} size={12} strokeWidth={2.5} /> : null}
      {children}
    </span>
  );
}
