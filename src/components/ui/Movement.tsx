"use client";

import type { ReactNode } from "react";
import { Mark } from "./Mark";
import type { IconName } from "./Icon";
import { MOVEMENT_LABEL } from "@/lib/format";

export type MovementType = keyof typeof MOVEMENT_LABEL;

export const MOVEMENT_ICON: Record<MovementType, IconName> = {
  in: "arrow-down-left",
  out: "arrow-up-right",
  fault: "alert-triangle",
  adjust: "refresh",
};

export interface MovementProps {
  type?: MovementType;
  label?: ReactNode;
  className?: string;
  children?: ReactNode;
}

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** Inline movement type: icon tile + Hebrew word. */
export function Movement({ type = "in", label, className, children }: MovementProps) {
  return (
    <span className={cx("sa-move", `is-${type}`, className)}>
      <Mark type={type} icon={MOVEMENT_ICON[type]} />
      {children ?? label ?? MOVEMENT_LABEL[type]}
    </span>
  );
}
