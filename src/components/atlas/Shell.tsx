"use client";

/**
 * ATLAS 2028: three zones on one grid, and the one live model under them. The spine stands on the right, the workspace takes
 * the room, and the contextual panel stands on the left only when something is chosen or the page has a side. A page that
 * shows the model cuts one frame for it (ModelFrame) and Twin fits the model into that box; a list page shows the chosen
 * thing's place in a window over the panel. Pages this style composes itself are listed in OWN; the rest keep the shared
 * page, dressed by the tokens.
 */

import { useCallback, useEffect, useEffectEvent, useRef, useState, type ComponentType, type ReactElement, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useUi } from "@/components/app/ui-state";
import type { ActionItem } from "@/components/ui/ActionMenu";
import { Command, type CommandSearch } from "@/components/merhav/Command";
import { BackHome } from "@/components/merhav/twin/BackHome";
import { Leader } from "@/components/merhav/twin/Leader";
import { PanelFocus } from "@/components/merhav/twin/PanelFocus";
import { Tags } from "@/components/merhav/twin/Tags";
import { TwinProvider, type Door } from "@/components/merhav/twin/Twin";
import { useData } from "@/lib/store";
import { allPages, pageWord } from "./areas";
import { AsideFocus } from "./Focus";
import { ModelFrame } from "./Frame";
import { PanelKeys } from "./PanelKeys";
import { SideProvider } from "./side";
import { AreaBar, Spine, type SpineItem } from "./Spine";
import { Faults } from "./pages/Faults";
import { Inventory } from "./pages/Inventory";
import { Movements } from "./pages/Movements";
import { Orders } from "./pages/Orders";
import { Overview } from "./pages/Overview";
import { Suppliers } from "./pages/Suppliers";
import { Warehouse } from "./pages/Warehouse";
import "@/design/atlas/index.css";

export interface AtlasShellProps {
  items: SpineItem[];
  active: string;
  foot: ReactNode;
  morePages: { label: string; href: string }[];
  actions: ActionItem[];
  onAction: (key: string) => void;
  search: CommandSearch;
  offline: boolean;
  page: ReactNode;
  overlays: ReactNode;
  panelOpen: boolean;
}

/** How a page stands on the model. hero: the page cuts a large frame for it. full: the model is the page. aside: it shows in
 *  the window over the panel, for the chosen thing. none: no model. */
type Stage = "hero" | "full" | "aside" | "none";

const STAGE: Record<string, Stage> = {
  overview: "hero",
  map: "full",
  inventory: "aside",
  orders: "aside",
  movements: "aside",
  faults: "aside",
  suppliers: "none",
  closing: "none",
  documentation: "none",
  team: "none",
};

/** Pages this style composes itself. Each gets the shared page, for the parts it keeps as they are. */
const OWN: Record<string, ComponentType<{ shared: ReactNode }>> = {
  overview: Overview,
  inventory: Inventory,
  map: Warehouse,
  orders: Orders,
  movements: Movements,
  faults: Faults,
  suppliers: Suppliers,
};

export function AtlasShell({ items, active, foot, actions, onAction, search, offline, page, overlays, panelOpen }: AtlasShellProps): ReactElement {
  const { state } = useData();
  const pathname = usePathname();
  const { panel, closing, requestClose } = useUi();
  const [commandOpen, setCommandOpen] = useState(false);

  // An address with no page reaches here as "overview": it gets the shared 404 on a plain workspace, not סקירה under a wrong address.
  const known = pathname === "/" || active !== "overview";
  const stage: Stage = known ? (STAGE[active] ?? "none") : "none";
  const placed = panel !== null && !closing && panel.type !== "action";
  const mapInPanel = stage === "aside" && placed;
  const door: Door = stage === "hero" || stage === "full" || mapInPanel ? "frame" : "closed";

  const openCommand = useCallback(
    (seed?: string) => {
      if (seed) search.onQuery(seed);
      setCommandOpen(true);
    },
    [search],
  );
  const closeCommand = useCallback(() => {
    setCommandOpen(false);
    search.onQuery("");
  }, [search]);

  // A panel belongs to the page it was opened on. A form with something typed in still asks first.
  const onArrive = useEffectEvent(() => {
    if (panel) requestClose();
  });
  useEffect(() => onArrive(), [pathname]);

  // A new page starts at its top; the workspace is what scrolls here.
  const work = useRef<HTMLElement>(null);
  useEffect(() => {
    work.current?.scrollTo({ top: 0 });
  }, [active]);

  // A link on a page leaves with its page, and the keyboard goes on from the new page rather than the top of the document.
  const pageWas = useRef(pathname);
  useEffect(() => {
    if (pageWas.current !== pathname && document.activeElement === document.body) work.current?.focus({ preventScroll: true });
    pageWas.current = pathname;
  }, [pathname]);

  // Each page names its own browser tab. Next writes the site's one title back after every turn, so the name is held rather than set once.
  const pageName = known ? pageWord(active) : undefined;
  useEffect(() => {
    if (!pageName) return;
    const name = `${pageName} · ניהול מלאי`;
    const hold = () => {
      if (document.title !== name) document.title = name;
    };
    hold();
    const watcher = new MutationObserver(hold);
    watcher.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => watcher.disconnect();
  }, [pageName]);

  /* ───────── zone C: a page's side, or the drawer over it ───────── */
  const [sideNode, setSideNode] = useState<HTMLElement | null>(null);
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => {
    setClaims((n) => n + 1);
    return () => setClaims((n) => n - 1);
  }, []);
  const hasSide = claims > 0 || panelOpen;

  const Own = known ? OWN[active] : undefined;
  const ready = state.status === "ready";
  const content = state.status === "loading" ? <div className="at-wait" role="status" aria-label="טוען נתונים" /> : !ready || !Own ? page : <Own shared={page} />;

  return (
    <TwinProvider door={door}>
      {(world) => (
        <SideProvider node={sideNode} claim={claim}>
          <div className="at-app" data-stage={stage} data-door={door} data-route={active} data-side={hasSide || undefined} data-map={mapInPanel || undefined}>
            <a
              className="at-skip"
              href="#at-main"
              onClick={(e) => {
                e.preventDefault();
                work.current?.focus();
              }}
            >
              דילוג לתוכן
            </a>
            <Spine items={items} active={known ? active : ""} foot={foot} offline={offline} onSearch={() => openCommand()} onNew={() => openCommand()} />
            {world}
            {stage === "hero" ? <Tags /> : null}
            {stage === "hero" || stage === "aside" ? <PanelFocus /> : null}
            {stage === "hero" || stage === "aside" ? <AsideFocus /> : null}
            {stage === "aside" ? <BackHome /> : null}
            <Leader />
            {mapInPanel ? <ModelFrame className="at-context-map" /> : null}
            <main ref={work} id="at-main" className="at-work" tabIndex={-1}>
              <div key={pathname} className="at-page">
                {known ? <AreaBar items={items} active={active} /> : null}
                {content}
              </div>
            </main>
            <aside ref={setSideNode} className="at-side" />
            {overlays}
            <PanelKeys />
            <Command open={commandOpen} onOpen={openCommand} onClose={closeCommand} search={search} actions={actions} onAction={onAction} pages={allPages()} pageWords={{}} />
          </div>
        </SideProvider>
      )}
    </TwinProvider>
  );
}
