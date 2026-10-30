"use client";

import { useEffect, useId, useRef, useSyncExternalStore, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { cx } from "./cx";
import { Mark } from "./Mark";

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

const KEYFRAMES = `
@keyframes sa-modal-up { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
@keyframes sa-scrim-in { from { opacity: 0; } to { opacity: 1; } }
`;

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
      style={{ position: "fixed", inset: 0, zIndex: 100, animation: "sa-scrim-in 0.2s ease-out" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose?.();
      }}
    >
      <style>{KEYFRAMES}</style>
      <div
        ref={dialogRef}
        className={cx("sa-modal", className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={children ? bodyId : undefined}
        tabIndex={-1}
        style={{ animation: "sa-modal-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)", outline: "none" }}
        onKeyDown={onKeyDown}
      >
        <div className="sa-modal-head">
          <div>
            {tone ? <Mark tone={tone} icon={tone === "danger" ? "alert-triangle" : "alert-circle"} size="md" /> : null}
            <h2 className="sa-modal-title" id={titleId}>{title}</h2>
          </div>
          <Button variant="ghost" size="sm" iconOnly icon="x" aria-label="סגור" onClick={onClose} disabled={busy} />
        </div>
        <div className="sa-modal-body" id={bodyId}>{children}</div>
        <div className={cx("sa-modal-foot", footerStart ? "is-split" : undefined)}>
          {footerStart ?? null}
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button variant="secondary" onClick={onClose} disabled={busy}>{cancelLabel}</Button>
            <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} isLoading={busy} data-autofocus="true">{confirmLabel}</Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
