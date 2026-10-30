"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactElement } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";
import { Spinner } from "./Spinner";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "accent" | "danger" | "link";
  size?: "sm" | "md" | "lg" | "touch";
  icon?: IconName;
  iconEnd?: IconName;
  iconOnly?: boolean;
  isLoading?: boolean;
  /** Keyboard hint rendered as a kbd chip. */
  kbd?: string;
}

/** One button, six roles. `primary` is the near-black action — once per area. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", icon, iconEnd, iconOnly, isLoading, kbd, className, children, disabled, type = "button", title, ...rest },
  ref,
): ReactElement {
  const ariaLabel = rest["aria-label"] ?? (iconOnly ? title : undefined);
  const iconSize = size === "sm" ? 14 : 16;
  // While loading, the spinner replaces the leading icon (or sits where it would be), so the width stays stable.
  const lead = isLoading
    ? <Spinner size={size === "sm" ? "sm" : "md"} />
    : icon
      ? <Icon name={icon} size={iconSize} />
      : null;
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      title={title}
      aria-label={ariaLabel}
      aria-busy={isLoading || undefined}
      disabled={disabled || isLoading}
      className={cx(
        "sa-btn",
        `sa-btn-${variant}`,
        size === "sm" && "sa-btn-sm",
        size === "lg" && "sa-btn-lg",
        size === "touch" && "sa-btn-touch",
        iconOnly && "sa-btn-icon",
        className,
      )}
    >
      {lead}
      {iconOnly ? null : children}
      {iconEnd && !iconOnly ? <Icon name={iconEnd} size={iconSize} /> : null}
      {kbd && !iconOnly ? <kbd className="sa-kbd" aria-hidden="true">{kbd}</kbd> : null}
    </button>
  );
});
