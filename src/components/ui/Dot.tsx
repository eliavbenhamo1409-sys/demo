import type { ReactElement } from "react";
import { cx } from "./cx";
import type { Tone } from "./Icon";

export interface DotProps {
  tone?: Tone;
  className?: string;
}

/** A small round colour mark, always beside a word. The only colour mark in the system. */
export function Dot({ tone, className }: DotProps): ReactElement {
  return <span className={cx("sa-dot", tone && `sa-dot-${tone}`, className)} aria-hidden="true" />;
}
