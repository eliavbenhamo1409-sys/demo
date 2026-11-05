"use client";

import { createContext, useContext, useEffect, useMemo, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface SideApi {
  /** The node of zone C, once the shell has it. */
  node: HTMLElement | null;
  /** Says the page has put something on the side; returns the way to take it back. */
  claim: () => () => void;
}

const SideContext = createContext<SideApi | null>(null);

export function SideProvider({ node, claim, children }: SideApi & { children: ReactNode }): ReactElement {
  const value = useMemo<SideApi>(() => ({ node, claim }), [node, claim]);
  return <SideContext.Provider value={value}>{children}</SideContext.Provider>;
}

/**
 * Zone C from a page: what stands beside its work, such as what needs a hand on סקירה or the chosen shelf on מחסן.
 * One per page. A drawer, when open, stands over it in the same place, so the side is never two things at once.
 */
export function Side({ label, children }: { label: string; children: ReactNode }): ReactElement | null {
  const side = useContext(SideContext);
  const claim = side?.claim;
  useEffect(() => claim?.(), [claim]);
  if (!side?.node) return null;
  return createPortal(
    <section className="at-side-body" aria-label={label}>
      {children}
    </section>,
    side.node,
  );
}
