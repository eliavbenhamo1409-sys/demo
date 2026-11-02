"use client";

import { useId, useLayoutEffect, useRef, type ReactNode } from "react";

type Action = { label: string; onClick: () => void };

type Props = {
  title: string;
  children?: ReactNode;
  /** The way on. It takes the focus, so Enter does the expected thing. */
  primary: Action;
  secondary?: Action;
  /** Escape or a tap outside: nothing was chosen. */
  onClose: () => void;
};

/** A short stop above everything: what happened and the way on. <dialog> silences the page behind by itself and hands the focus back. */
export function Notice({ title, children, primary, secondary, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="cg-notice"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // A browser may close it past onCancel, on a second Escape. Open again means React's dev remount, not the agent.
      onClose={(e) => {
        if (!e.currentTarget.open) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cg-notice__box">
        <h2 id={titleId} className="cg-notice__title">{title}</h2>
        {children}
        <div className="cg-notice__actions">
          <button type="button" className="cg-btn" onClick={primary.onClick}>{primary.label}</button>
          {secondary ? <button type="button" className="cg-btn cg-btn--ghost" onClick={secondary.onClick}>{secondary.label}</button> : null}
        </div>
      </div>
    </dialog>
  );
}

/** Two figures an agent compares, on the site's ruled lines. */
export function NoticeRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="cg-notice__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
