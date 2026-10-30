import type { ReactElement } from "react";
import { initials } from "@/lib/format";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export interface AvatarProps {
  name?: string;
  size?: "sm" | "md" | "lg";
  inverse?: boolean;
  icon?: IconName;
  className?: string;
}

/** Initials of a worker; `inverse` for the current user. */
export function Avatar({ name, size = "md", inverse, icon, className }: AvatarProps): ReactElement {
  const text = name ? initials(name) : "";
  return (
    <span
      className={cx("sa-avatar", size === "sm" && "sa-avatar-sm", size === "lg" && "sa-avatar-lg", inverse && "is-inverse", className)}
      title={name}
      aria-label={name}
      role={name ? "img" : undefined}
    >
      {icon ? <Icon name={icon} size={size === "lg" ? 18 : 14} /> : text}
    </span>
  );
}
