"use client";

import type { ReactElement, ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./cx";
import { Dot } from "./Dot";
import type { Tone } from "./Icon";

export interface NoticeProps {
  tone?: Tone;
  title?: ReactNode;
  action?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  className?: string;
  children?: ReactNode;
}

/** In-context message; `danger` is role=alert. */
export function Notice({ tone = "neutral", title, action, onAction, onDismiss, className, children }: NoticeProps): ReactElement {
  return (
    <div className={cx("sa-notice", className)} role={tone === "danger" ? "alert" : "status"}>
      <Dot tone={tone} />
      <div className="sa-notice-body">
        {title ? <p className="sa-notice-title">{title}</p> : null}
        {children ? <p className="sa-notice-text">{children}</p> : null}
      </div>
      {action ? <Button variant="link" onClick={onAction}>{action}</Button> : null}
      {onDismiss ? <Button variant="ghost" size="sm" iconOnly icon="x" aria-label="סגירה" onClick={onDismiss} /> : null}
    </div>
  );
}
