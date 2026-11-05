"use client";

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type ComponentType, type ReactElement, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useUi } from "@/components/app/ui-state";
import { Icon } from "@/components/ui";
import type { ActionItem } from "@/components/ui/ActionMenu";
import { useData } from "@/lib/store";
import { Command, type CommandSearch } from "./Command";
import { Catalog } from "./pages/Catalog";
import { Closing } from "./pages/Closing";
import { Documentation } from "./pages/Documentation";
import { Faults } from "./pages/Faults";
import { Inventory } from "./pages/Inventory";
import { Movements } from "./pages/Movements";
import { Orders } from "./pages/Orders";
import { Overview } from "./pages/Overview";
import { Team } from "./pages/Team";
import { Warehouse } from "./pages/Warehouse";
import { PanelKeys } from "./PanelKeys";
import { Rail, railOrder, WORDS, type RailItem } from "./Rail";
import { BackHome } from "./twin/BackHome";
import { DoorHandle } from "./twin/DoorHandle";
import { Leader } from "./twin/Leader";
import { PanelFocus } from "./twin/PanelFocus";
import { Tags } from "./twin/Tags";
import { TwinProvider, type Door } from "./twin/Twin";
import { useMerhavVariant, type MerhavVariant } from "./use-merhav";
import { AreaBar as AreaBar2, Rail as Rail2 } from "@/components/merhav2/Rail";
import { allPages as pages2, pageWord as word2 } from "@/components/merhav2/areas";
import { Catalog as Bay2 } from "@/components/merhav2/pages/Catalog";
import { AreaBar as AreaBar3, Rail as Rail3 } from "@/components/merhav3/Rail";
import { allPages as pages3, pageWord as word3 } from "@/components/merhav3/areas";
import { Catalog as Bay3 } from "@/components/merhav3/pages/Catalog";
import { Overview as MissionControl } from "@/components/merhav3/pages/Overview";
import { AreaBar as AreaBar5, Rail as Rail5 } from "@/components/merhav5/Rail";
import { allPages as pages5, pageWord as word5 } from "@/components/merhav5/areas";
import { Catalog as Bay5 } from "@/components/merhav5/pages/Catalog";
import { Overview as MissionControl5 } from "@/components/merhav5/pages/Overview";
import "@/design/merhav/index.css";
import "@/design/merhav2/index.css";
import "@/design/merhav3/index.css";
import "@/design/merhav5/index.css";

export interface MerhavShellProps {
  items: RailItem[];
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

/** Where the door stands on each page. */
const DOOR: Record<string, Door> = {
  overview: "open",
  inventory: "dock",
  map: "side",
  orders: "dock",
  movements: "dock",
  faults: "dock",
  suppliers: "closed",
  closing: "closed",
  documentation: "closed",
  team: "closed",
};

/** Pages this style composes itself. Each gets the shared page, for the parts it keeps as they are. */
const OWN: Record<string, ComponentType<{ shared: ReactNode }>> = {
  overview: Overview,
  inventory: Inventory,
  map: Warehouse,
  orders: Orders,
  movements: Movements,
  faults: Faults,
  suppliers: Catalog,
  closing: Closing,
  documentation: Documentation,
  team: Team,
};

/** What each variant brings of its own: its rail, the row of an area's pages on a phone, the pages it composes differently, and its words. */
interface Variant {
  Rail: typeof Rail | typeof Rail2;
  AreaBar: typeof AreaBar2 | null;
  own: Record<string, ComponentType<{ shared: ReactNode }>>;
  pages: (() => { label: string; href: string }[]) | null;
  word: ((active: string) => string | undefined) | null;
}

const VARIANTS: Record<MerhavVariant, Variant> = {
  merhav: { Rail, AreaBar: null, own: OWN, pages: null, word: null },
  merhav2: { Rail: Rail2, AreaBar: AreaBar2, own: { ...OWN, suppliers: Bay2 }, pages: pages2, word: word2 },
  merhav3: { Rail: Rail3, AreaBar: AreaBar3, own: { ...OWN, overview: MissionControl, suppliers: Bay3 }, pages: pages3, word: word3 },
  merhav5: { Rail: Rail5, AreaBar: AreaBar5, own: { ...OWN, overview: MissionControl5, suppliers: Bay5 }, pages: pages5, word: word5 },
};

export function MerhavShell({ items, active, foot, morePages, actions, onAction, search, offline, page, overlays }: MerhavShellProps): ReactElement {
  const { state } = useData();
  const pathname = usePathname();
  const variant = useMerhavVariant();
  const own = VARIANTS[variant];
  const [commandOpen, setCommandOpen] = useState(false);
  // An address with no page reaches here as "overview": it gets the shared 404 on a closed door, not סקירה under a wrong address.
  const known = pathname === "/" || active !== "overview";
  const door = known ? (DOOR[active] ?? "closed") : "closed";

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

  // What a page stands on arrives with the door: a page on the door shows only where the door has reached, and the
  // bare stage of סקירה only where the door has left. Without this the content is there before its surface is.
  const doorNode = useRef<HTMLDivElement>(null);
  const pageNode = useRef<HTMLDivElement>(null);
  const doorWas = useRef(door);
  useLayoutEffect(() => {
    const was = doorWas.current;
    doorWas.current = door;
    const plate = doorNode.current;
    const arriving = pageNode.current;
    if (was === door || !plate || !arriving || window.matchMedia("(max-width: 899px), (prefers-reduced-motion: reduce)").matches) return;
    const edge = plate.getBoundingClientRect().left - arriving.getBoundingClientRect().left;
    if (door === "open") arriving.style.setProperty("--reveal-end", `${arriving.offsetWidth - edge}px`);
    else if (edge > 0) arriving.style.setProperty("--reveal-start", `${edge}px`);
    else return;
    arriving.dataset.reveal = door === "open" ? "end" : "start";
  }, [door]);

  // A new page starts at its top; the door and the model already moved.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [active]);

  // The rail stays within reach beside a drawer, and a drawer belongs to the page it was opened on. A form with something
  // typed in still asks first.
  const { panel, requestClose } = useUi();
  const onArrive = useEffectEvent(() => {
    if (panel) requestClose();
  });
  useEffect(() => onArrive(), [pathname]);

  // It leaves with its page: on a door that moved it would fold away from a place it never stood. A form stays up to be asked about.
  const [opened, setOpened] = useState({ panel, on: pathname });
  if (opened.panel !== panel) setOpened({ panel, on: pathname });
  const drawerLeft = panel !== null && panel.type !== "action" && opened.on !== pathname;

  // A link on a page leaves with its page, and the keyboard goes on from the new page rather than the top of the document.
  const mainNode = useRef<HTMLElement>(null);
  const pageWas = useRef(pathname);
  useEffect(() => {
    if (pageWas.current !== pathname && document.activeElement === document.body) mainNode.current?.focus({ preventScroll: true });
    pageWas.current = pathname;
  }, [pathname]);

  const Own = known ? own.own[active] : undefined;
  const ready = state.status === "ready";
  const content = state.status === "loading" ? <div className="mh-calibrate" role="status" aria-label="טוען נתונים" /> : !ready || !Own ? page : <Own shared={page} />;

  // A variant lists its pages by area; מרחב by its rail's order.
  const { areas, rest } = railOrder(items);
  const pages = own.pages ? own.pages() : [...areas, ...rest].map((item) => ({ label: item.label, href: item.href })).concat(morePages);
  const TheRail = own.Rail;

  // Each page names its own browser tab, and a screen reader says that name as the page turns. Next writes the site's
  // one title back after every turn, so the name is held rather than set once.
  const pageName = own.word ? (known ? own.word(active) : undefined) : (WORDS[active] ?? pages.find((p) => p.href === pathname)?.label);
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

  return (
    <TwinProvider door={door}>
      {(world) => (
        <div className="mh-app" data-door={door} data-route={active} data-variant={variant} data-drawer-left={drawerLeft || undefined}>
          <a
            className="mh-skip"
            href="#mh-main"
            onClick={(e) => {
              e.preventDefault();
              mainNode.current?.focus();
            }}
          >
            דילוג לתוכן
          </a>
          {/* Each of these is placed by its own layer, so this order is the keyboard's alone: the rail, the model's controls, the page. */}
          {/* An address no page owns marks no row: the rail gets no key to find. */}
          <TheRail
            items={items}
            active={known ? active : ""}
            foot={foot}
            offline={offline}
            onSearch={() => openCommand()}
            action={
              <button type="button" className="mh-seek" onClick={() => openCommand()}>
                <Icon name="plus" size={16} />
                <span>פעולה חדשה</span>
              </button>
            }
          />
          {world}
          <div ref={doorNode} className="mh-door" aria-hidden="true" />
          {door === "open" ? <Tags /> : null}
          {door === "open" || door === "dock" ? <PanelFocus /> : null}
          {door === "open" || door === "dock" ? <BackHome key={door} /> : null}
          <Leader />
          <main ref={mainNode} id="mh-main" className="mh-stage" tabIndex={-1}>
            {door === "dock" ? <DoorHandle /> : null}
            <div ref={pageNode} key={pathname} className="mh-page">
              {own.AreaBar && known ? <own.AreaBar items={items} active={active} /> : null}
              {content}
            </div>
          </main>
          {overlays}
          <PanelKeys />
          <Command open={commandOpen} onOpen={openCommand} onClose={closeCommand} search={search} actions={actions} onAction={onAction} pages={pages} pageWords={own.pages ? {} : undefined} wide={variant === "merhav3" || variant === "merhav5"} />
        </div>
      )}
    </TwinProvider>
  );
}
