import type { ReactElement } from "react";
import { cx } from "./cx";

export interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  track?: boolean;
  label?: string;
  className?: string;
}

/** Loading ring that inherits the text colour. */
export function Spinner({ size = "md", track, label = "טוען", className }: SpinnerProps): ReactElement {
  return (
    <span
      className={cx("sa-spinner", size === "sm" && "sa-spinner-sm", size === "lg" && "sa-spinner-lg", track && "sa-spinner-track", className)}
      role="status"
      aria-label={label}
    />
  );
}
