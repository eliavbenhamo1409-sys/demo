"use client";

import type { ReactElement, ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./cx";
import type { IconName, Tone } from "./Icon";
import { Mark } from "./Mark";

export interface NoticeProps {
  tone?: Tone;
  title?: ReactNode;
  icon?: IconName;
  action?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  className?: string;
  children?: ReactNode;
}

const NOTICE_ICON: Record<Tone, IconName> = {
  neutral: "info",
  success: "check-circle",
  warning: "alert-circle",
  danger: "alert-triangle",
  accent: "info",
};

/** In-context message; `danger` is role=alert. */
export function Notice({ tone = "neutral", title, icon, action, onAction, onDismiss, className, children }: NoticeProps): ReactElement {
  return (
    <div className={cx("sa-notice", `sa-notice-${tone}`, className)} role={tone === "danger" ? "alert" : "status"}>
      <Mark tone={tone} icon={icon ?? NOTICE_ICON[tone]} />
      <div className="sa-notice-body">
        {title ? <p className="sa-notice-title">{title}</p> : null}
        {children ? <p className="sa-notice-text">{children}</p> : null}
      </div>
      {action ? <Button variant="link" onClick={onAction}>{action}</Button> : null}
      {onDismiss ? <Button variant="ghost" size="sm" iconOnly icon="x" aria-label="סגור" onClick={onDismiss} /> : null}
    </div>
  );
}
