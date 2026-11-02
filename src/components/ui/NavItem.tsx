"use client";

import type * as React from "react";
import Link from "next/link";
import { Badge } from "./Badge";
import { Icon, type IconName } from "./Icon";

export interface NavItemProps {
  href?: string;
  active?: boolean;
  count?: number;
  icon?: IconName;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  children?: React.ReactNode;
}

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** One row of the navigation. Renders a link when `href` is given, a button otherwise. */
export function NavItem({ href, active, count, icon, onClick, className, children }: NavItemProps) {
  const cls = cx("sa-nav-item", active && "is-active", className);
  const body = (
    <>
      {icon ? <Icon name={icon} size={16} /> : null}
      <span className="sa-truncate">{children}</span>
      {count != null ? (
        <Badge count>
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
