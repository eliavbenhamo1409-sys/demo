"use client";

/**
 * The fields an owner seldom needs, folded under one quiet word at the foot of a form.
 * The word is a plain button, never a submit, and it fires no input event, so opening it
 * is not a change to the drawer's guard. The fields exist only while open; their values
 * live in the form, so closing loses nothing.
 */
import { useId, useState, type ReactNode } from "react";
import { cx, Icon } from "@/components/ui";

export function MoreFields({ children, defaultOpen = false, label = "עוד פרטים" }: { children: ReactNode; defaultOpen?: boolean; label?: string }) {
  const bodyId = `sa-more-${useId()}`;
  const [open, setOpen] = useState(defaultOpen);
  // A field inside can come to matter after mount, an error on it: a defaultOpen that turns true opens the fold, and never closes it.
  const [asked, setAsked] = useState(defaultOpen);
  if (defaultOpen !== asked) {
    setAsked(defaultOpen);
    if (defaultOpen) setOpen(true);
  }
  return (
    <div className={cx("sa-form-more", open && "is-open")}>
      <button
        type="button"
        className="sa-form-more-toggle"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{open ? "פחות" : label}</span>
        <Icon name="chevron-down" size={14} className="sa-form-more-chevron" />
      </button>
      {open ? <div id={bodyId} className="sa-form-more-body">{children}</div> : null}
    </div>
  );
}
