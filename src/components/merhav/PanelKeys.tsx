"use client";

import { useEffect, useRef, type ReactElement } from "react";
import { useUi } from "@/components/app/ui-state";

const HOST = ".mh-app > .app-panelHost";
const TITLE = "mh-panel-title";
const STOPS = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]';

/**
 * The shared drawer only says it is a dialog. Here it is one for the keyboard: it takes the focus when it opens, Tab goes
 * round its own controls, its title names it, and closing hands the focus back. Never inert: the rail and the model stay
 * under the mouse beside an open drawer.
 */
export function PanelKeys(): ReactElement {
  const { panel, toasts } = useUi();
  const opener = useRef<HTMLElement | null>(null);
  const open = panel !== null;

  // Noted all the time, because the search hands over to a drawer and a form takes the focus for itself.
  useEffect(() => {
    const note = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement && !e.target.closest(".app-panelHost, .mh-command, .sa-modal")) opener.current = e.target;
    };
    document.addEventListener("focusin", note);
    return () => document.removeEventListener("focusin", note);
  }, []);

  // On every new content: a drawer that turns into another one has just lost what held the focus.
  useEffect(() => {
    const host = document.querySelector<HTMLElement>(HOST);
    if (!host) return;
    const title = host.querySelector(".sa-panel-title");
    if (title) {
      title.id = TITLE;
      host.setAttribute("aria-labelledby", TITLE);
    }
    host.tabIndex = -1;
    if (!host.contains(document.activeElement)) host.focus({ preventScroll: true });
  }, [panel]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const host = document.querySelector<HTMLElement>(HOST);
      const at = document.activeElement;
      if (e.key !== "Tab" || e.defaultPrevented || !host?.contains(at)) return;
      const stops = [...host.querySelectorAll<HTMLElement>(STOPS)].filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0);
      const edge = e.shiftKey ? stops[0] : stops[stops.length - 1];
      if (at !== edge && !(e.shiftKey && at === host)) return;
      e.preventDefault();
      (e.shiftKey ? stops[stops.length - 1] : stops[0])?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (document.activeElement !== document.body) return;
      const back = opener.current;
      (back?.isConnected ? back : document.querySelector("main"))?.focus({ preventScroll: true });
    };
  }, [open]);

  // A toast arrives with its own region, which a screen reader may not catch. This one is always there. A failure says itself.
  const said = toasts.filter((t) => t.tone !== "danger").at(-1);
  return <p className="sa-sr" role="status">{said ? [said.title, said.text].filter(Boolean).join(". ") : ""}</p>;
}
