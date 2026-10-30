import type { ReactElement, ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconName, type MovementType, type Tone } from "./Icon";

export interface MarkProps {
  tone?: Tone;
  type?: MovementType;
  icon?: IconName;
  size?: "sm" | "md" | "lg";
  strokeWidth?: number;
  className?: string;
  children?: ReactNode;
}

/** A solid colour square with a glyph in the on-colour — the one place an icon is coloured. */
export function Mark({ tone, type, icon, size = "sm", strokeWidth = 2.5, className, children }: MarkProps): ReactElement {
  return (
    <span
      className={cx("sa-mark", size === "md" && "sa-mark-md", size === "lg" && "sa-mark-lg", tone && `sa-mark-${tone}`, type && `is-${type}`, className)}
      aria-hidden="true"
    >
      {icon ? <Icon name={icon} strokeWidth={strokeWidth} /> : children}
    </span>
  );
}

export interface SquareProps {
  tone?: Tone;
  className?: string;
}

/** A bare 10px colour square, always beside a word. */
export function Square({ tone, className }: SquareProps): ReactElement {
  return <span className={cx("sa-square", tone && `sa-square-${tone}`, className)} aria-hidden="true" />;
}
