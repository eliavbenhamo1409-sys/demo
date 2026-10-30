"use client";

import type * as React from "react";
import Link from "next/link";
import type { IconName } from "./Icon";
import { Icon } from "./Icon";
import { Badge } from "./Badge";

export interface NavItemProps {
  href?: string;
  icon?: IconName;
  active?: boolean;
  count?: number;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  children?: React.ReactNode;
}

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** One row of the navigation. Renders a link when `href` is given, a button otherwise. */
export function NavItem({ href, icon, active, count, onClick, className, children }: NavItemProps) {
  const cls = cx("sa-nav-item", active && "is-active", className);
  const body = (
    <>
      {icon ? <Icon name={icon} /> : null}
      <span className="sa-truncate">{children}</span>
      {count != null ? (
        <Badge tone={active ? "accent" : "neutral"} count>
          {String(count)}
        </Badge>
      ) : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cls} aria-current={active ? "page" : undefined} onClick={onClick}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} aria-current={active ? "page" : undefined} onClick={onClick}>
      {body}
    </button>
  );
}
