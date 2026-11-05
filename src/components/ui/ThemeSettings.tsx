"use client";

/**
 * "הגדרות" — a quiet link that opens a small dialog: the style (classic or minimal)
 * and the appearance (light or dark). The choice applies at once and is saved on this device.
 * Below them, `pages` links to pages that have no row in the sidebar.
 *
 *   <ThemeSettingsButton variant="nav" pages={…} />  → sidebar row (admin)
 *   <ThemeSettingsButton variant="text" />           → plain text link (worker)
 */
import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { loadAtlas } from "@/components/atlas/use-atlas";
import { loadMerhav } from "@/components/merhav/use-merhav";
import { joinTheme, splitTheme, THEME_MODES, THEME_STYLES, useTheme, type ThemeStyle } from "@/lib/theme";
import { Button } from "./Button";
import { cx } from "./cx";
import { Icon } from "./Icon";

export interface SettingsPage {
  label: string;
  href: string;
}

export interface ThemeSettingsButtonProps {
  variant?: "nav" | "text";
  pages?: SettingsPage[];
  /** The current page is one of `pages`, so the sidebar has nothing else to mark. */
  active?: boolean;
  className?: string;
}

export function ThemeSettingsButton({ variant = "nav", pages, active, className }: ThemeSettingsButtonProps): ReactElement {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    // Return focus to the opener on the next frame (the dialog unmounts first).
    requestAnimationFrame(() => btnRef.current?.focus());
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={cx(variant === "nav" ? "sa-nav-item" : "sa-settings-link", active && "is-active", className)}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-current={active ? "page" : undefined}
      >
        {variant === "nav" ? <Icon name="settings" size={16} /> : null}
        <span>הגדרות</span>
      </button>
      {open ? <SettingsDialog pages={pages} onClose={close} /> : null}
    </>
  );
}

function SettingsDialog({ pages, onClose }: { pages?: SettingsPage[]; onClose: () => void }): ReactElement {
  const { theme, setTheme } = useTheme();
  const { style, mode } = splitTheme(theme);
  const dialogRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const titleId = `sa-settings-${uid}-title`;

  // Merhav's code comes first (מרחב 2 stands on it), so the old style stands until the new one can take over, with nothing blank between.
  const chooseStyle = (next: ThemeStyle) => {
    if (next === "merhav" || next === "merhav2" || next === "merhav3" || next === "merhav5" || next === "merhav6") void loadMerhav().then(() => setTheme(joinTheme(next, mode)), () => undefined);
    else if (next === "atlas") void loadAtlas().then(() => setTheme(joinTheme(next, mode)), () => undefined);
    else setTheme(joinTheme(next, mode));
  };

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLElement>(".sa-appearance-opt.is-active")?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([tabindex="-1"])'));
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const current = document.activeElement;
    // A click on the dialog's own text focuses the dialog, so Shift+Tab has to catch that too.
    if (e.shiftKey && (current === first || current === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && current === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="sa-scrim"
      style={{ position: "fixed", inset: 0, zIndex: 120 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="sa-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ outline: "none", maxWidth: 400 }}
        onKeyDown={onKeyDown}
      >
        <div className="sa-modal-head">
          <h2 className="sa-modal-title" id={titleId}>הגדרות</h2>
          <Button variant="ghost" size="sm" iconOnly icon="x" aria-label="סגירה" onClick={onClose} />
        </div>
        <div className="sa-modal-body">
          <div className="sa-settings-group">
            {/* Merhav and its variants are the admin's alone, and only the admin passes pages. Anyone else sees them as the default style, so that is what is marked. */}
            <Choice label="סגנון" options={pages ? THEME_STYLES : THEME_STYLES.filter((s) => !s.id.startsWith("merhav") && s.id !== "atlas")} value={pages || (!style.startsWith("merhav") && style !== "atlas") ? style : "minimal"} onChange={chooseStyle} />
            <Choice label="מראה" options={THEME_MODES} value={mode} onChange={(m) => setTheme(joinTheme(style, m))} />
          </div>
          {pages?.length ? (
            <div className="sa-settings-group">
              {pages.map((p) => (
                <Link key={p.href} href={p.href} className="sa-appearance sa-appearance-link" onClick={onClose}>
                  <span className="sa-appearance-label">{p.label}</span>
                  <Icon name="chevron-left" size={16} />
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface ChoiceProps<T extends string> {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}

/** One row of the dialog: a word, then the options as a radio group. */
function Choice<T extends string>({ label, options, value, onChange }: ChoiceProps<T>): ReactElement {
  const groupRef = useRef<HTMLDivElement>(null);

  // Radio-group keyboard: arrows move between the options and apply them.
  const onOptKey = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const next = (idx + 1) % options.length;
    onChange(options[next].id);
    groupRef.current?.querySelectorAll<HTMLButtonElement>(".sa-appearance-opt")[next]?.focus();
  };

  return (
    <div className="sa-appearance">
      <span className="sa-appearance-label">{label}</span>
      <div ref={groupRef} className="sa-appearance-opts" role="radiogroup" aria-label={label}>
        {options.map((o, i) => {
          const active = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              className={cx("sa-appearance-opt", active && "is-active")}
              onClick={() => onChange(o.id)}
              onKeyDown={(e) => onOptKey(e, i)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
