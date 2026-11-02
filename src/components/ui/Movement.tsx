"use client";

import type { ReactNode } from "react";
import { fmtSigned, MOVEMENT_LABEL } from "@/lib/format";
import { Icon, type IconName } from "./Icon";

export type MovementType = keyof typeof MOVEMENT_LABEL;

export interface MovementProps {
  type?: MovementType;
  label?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export const MOVEMENT_ICON: Record<MovementType, IconName> = {
  in: "arrow-down-left",
  out: "arrow-up-right",
  fault: "tool",
  adjust: "clipboard-check",
};

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** Inline movement type: a small icon and the Hebrew word. */
export function Movement({ type = "in", label, className, children }: MovementProps) {
  return (
    <span className={cx("sa-move", `is-${type}`, className)}>
      <Icon name={MOVEMENT_ICON[type]} size={14} />
      {children ?? label ?? MOVEMENT_LABEL[type]}
    </span>
  );
}

/** A movement's signed quantity: goods in read green, goods out red, the rest stays ink. */
export function MovementQty({ qty, type }: { qty: number; type: MovementType }) {
  return <span className={`sa-signed is-${type}`}>{fmtSigned(qty, type)}</span>;
}
