"use client";

/**
 * "הגדרות" — a button that opens a small dialog for switching the visual theme.
 * Choices apply live while the dialog is open; "ביטול" restores what was there.
 *
 *   <ThemeSettingsButton variant="nav" />    → sidebar row (admin)
 *   <ThemeSettingsButton variant="touch" />  → full-width phone button (worker)
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { THEMES, useTheme, type ThemeId } from "@/lib/theme";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { cx } from "./cx";

const SWATCH: Record<ThemeId, CSSProperties> = {
  classic: {
    "--sw-canvas": "#fafafa",
    "--sw-side": "#ffffff",
    "--sw-card": "#ffffff",
    "--sw-line": "#e5e5e5",
    "--sw-accent": "#171717",
    "--sw-radius": "4px",
    "--sw-dot-radius": "2px",
    "--sw-shadow": "none",
  } as CSSProperties,
  modern: {
    "--sw-canvas": "#f4f5f9",
    "--sw-side": "#ffffff",
    "--sw-card": "#ffffff",
    "--sw-line": "#eceef3",
    "--sw-accent": "#4f46e5",
    "--sw-radius": "8px",
    "--sw-dot-radius": "999px",
    "--sw-shadow": "0 4px 10px -6px rgba(15,23,42,.25)",
  } as CSSProperties,
  "modern-dark": {
    "--sw-canvas": "#0b0f1a",
    "--sw-side": "#121828",
    "--sw-card": "#121828",
    "--sw-line": "#232c44",
    "--sw-accent": "#6366f1",
    "--sw-radius": "8px",
    "--sw-dot-radius": "999px",
    "--sw-shadow": "0 4px 10px -6px rgba(0,0,0,.6)",
  } as CSSProperties,
};

const THEME_ICON: Record<ThemeId, IconName> = { classic: "layers", modern: "sun", "modern-dark": "moon" };

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ThemeSettingsButtonProps {
  variant?: "nav" | "touch" | "ghost";
  className?: string;
}

export function ThemeSettingsButton({ variant = "nav", className }: ThemeSettingsButtonProps): ReactElement {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    // Return focus to the opener on the next frame (the dialog unmounts first).
    requestAnimationFrame(() => btnRef.current?.focus());
  };

  let trigger: ReactElement;
  if (variant === "nav") {
    trigger = (
      <button ref={btnRef} type="button" className={cx("sa-nav-item", className)} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
        <Icon name="settings" />
        <span>הגדרות</span>
      </button>
    );
  } else {
    trigger = (
      <Button ref={btnRef} variant="ghost" size={variant === "touch" ? "touch" : "md"} icon="settings" className={className} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
        הגדרות
      </Button>
    );
  }

  return (
    <>
      {trigger}
      {open ? <ThemeDialog onClose={close} /> : null}
    </>
  );
}

function ThemeDialog({ onClose }: { onClose: () => void }): ReactElement {
  const { theme, setTheme } = useTheme();
  const initial = useRef(theme);
  const dialogRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const titleId = `sa-settings-${uid}-title`;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const active = dialogRef.current?.querySelector<HTMLElement>(".sa-theme-opt.is-active") ?? dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    active?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const cancel = () => {
    setTheme(initial.current);
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      cancel();
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // Radio-group keyboard: arrows move between themes and apply them.
  const onOptKey = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    const rtl = document.documentElement.dir === "rtl";
    const fwd = rtl ? "ArrowLeft" : "ArrowRight";
    const back = rtl ? "ArrowRight" : "ArrowLeft";
    let next: number | null = null;
    if (e.key === fwd || e.key === "ArrowDown") next = (idx + 1) % THEMES.length;
    else if (e.key === back || e.key === "ArrowUp") next = (idx - 1 + THEMES.length) % THEMES.length;
    if (next === null) return;
    e.preventDefault();
    setTheme(THEMES[next].id);
    const el = dialogRef.current?.querySelectorAll<HTMLButtonElement>(".sa-theme-opt")[next];
    el?.focus();
  };

  return createPortal(
    <div
      className="sa-scrim"
      style={{ position: "fixed", inset: 0, zIndex: 120, animation: "sa-settings-scrim 0.2s ease-out" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <style>{`@keyframes sa-settings-scrim{from{opacity:0}to{opacity:1}}@keyframes sa-settings-up{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}`}</style>
      <div
        ref={dialogRef}
        className="sa-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ animation: "sa-settings-up 0.28s cubic-bezier(0.16, 1, 0.3, 1)", outline: "none", maxWidth: 560 }}
        onKeyDown={onKeyDown}
      >
        <div className="sa-modal-head">
          <div>
            <h2 className="sa-modal-title" id={titleId}>הגדרות</h2>
            <p className="sa-page-sub" style={{ marginTop: 2 }}>עיצוב המערכת. הבחירה נשמרת במכשיר הזה.</p>
          </div>
          <Button variant="ghost" size="sm" iconOnly icon="x" aria-label="סגור" onClick={cancel} />
        </div>
        <div className="sa-modal-body" style={{ color: "var(--text-primary)" }}>
          <div className="sa-themes" role="radiogroup" aria-label="עיצוב">
            {THEMES.map((t, i) => {
              const active = t.id === theme;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  tabIndex={active ? 0 : -1}
                  className={cx("sa-theme-opt", active && "is-active")}
                  onClick={() => setTheme(t.id)}
                  onKeyDown={(e) => onOptKey(e, i)}
                >
                  <span className="sa-theme-swatch" style={SWATCH[t.id]} aria-hidden="true">
                    <i />
                    <b><span /><span /><span /><span /></b>
                  </span>
                  <span className="sa-theme-name">
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <Icon name={THEME_ICON[t.id]} size={15} />
                      {t.label}
                    </span>
                    {active ? <Icon name="check-circle" size={16} strokeWidth={2.5} /> : null}
                  </span>
                  <span className="sa-theme-desc">{t.description}</span>
                </button>
              );
            })}
          </div>
          <p className="sa-settings-hint">העיצוב מתחלף מיד. ביטול מחזיר את העיצוב הקודם.</p>
        </div>
        <div className="sa-modal-foot">
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button variant="secondary" onClick={cancel}>ביטול</Button>
            <Button variant="primary" onClick={onClose}>אישור</Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
