"use client";

import { useEffect, useId, useRef, useSyncExternalStore, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { cx } from "./cx";

export interface ModalProps {
  title: ReactNode;
  tone?: "danger" | "warning";
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onClose?: () => void;
  busy?: boolean;
  footerStart?: ReactNode;
  className?: string;
  children?: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const subscribeNoop = () => () => {};

/**
 * Confirmation dialog for irreversible actions.
 * Portals to document.body over a scrim, traps focus, closes on Escape and
 * returns focus to the element that opened it.
 */
export function Modal({ title, tone, confirmLabel = "אישור", cancelLabel = "ביטול", onConfirm, onClose, busy, footerStart, className, children }: ModalProps): ReactElement | null {
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const uid = useId();
  const titleId = `sa-modal-${uid}-title`;
  const bodyId = `sa-modal-${uid}-body`;

  // Remember the opener, move focus in, lock scroll; restore on unmount.
  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = dialog?.querySelector<HTMLElement>('[data-autofocus="true"]') ?? dialog?.querySelector<HTMLElement>(FOCUSABLE) ?? dialog;
    first?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      openerRef.current?.focus();
    };
  }, [mounted]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (!busy) onClose?.();
      return;
    }
    if (e.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const nodes = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null || n === document.activeElement);
    if (nodes.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    const firstEl = nodes[0];
    const lastEl = nodes[nodes.length - 1];
    const activeEl = document.activeElement;
    if (e.shiftKey && (activeEl === firstEl || activeEl === dialog)) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && activeEl === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="sa-scrim"
      style={{ position: "fixed", inset: 0, zIndex: 100, animation: "sa-fade 0.1s linear" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        className={cx("sa-modal", className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={children ? bodyId : undefined}
        tabIndex={-1}
        style={{ outline: "none" }}
        onKeyDown={onKeyDown}
      >
        <div className="sa-modal-head">
          <h2 className="sa-modal-title" id={titleId}>{title}</h2>
          <Button variant="ghost" size="sm" iconOnly icon="x" aria-label="סגירה" onClick={onClose} disabled={busy} />
        </div>
        <div className="sa-modal-body" id={bodyId}>{children}</div>
        <div className={cx("sa-modal-foot", footerStart ? "is-split" : undefined)}>
          {footerStart ?? null}
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            {/* On a destructive choice the keyboard starts on cancel, so a stray Enter deletes nothing. */}
            <Button variant="secondary" onClick={onClose} disabled={busy} data-autofocus={tone === "danger" ? "true" : undefined}>{cancelLabel}</Button>
            <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} isLoading={busy} data-autofocus={tone === "danger" ? undefined : "true"}>{confirmLabel}</Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
