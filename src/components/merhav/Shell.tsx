"use client";

import { useCallback, useEffect, useState, type ComponentType, type ReactElement, type ReactNode } from "react";
import { usePathname } from "next/navigation";
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
import { Rail, type RailItem } from "./Rail";
import { BackHome } from "./twin/BackHome";
import { DoorHandle } from "./twin/DoorHandle";
import { Leader } from "./twin/Leader";
import { PanelFocus } from "./twin/PanelFocus";
import { Tags } from "./twin/Tags";
import { TwinProvider, type Door } from "./twin/Twin";
import "./fonts";
import "@/design/merhav/index.css";

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

export function MerhavShell({ items, active, foot, morePages, actions, onAction, search, offline, page, overlays }: MerhavShellProps): ReactElement {
  const { state } = useData();
  const pathname = usePathname();
  const [commandOpen, setCommandOpen] = useState(false);
  const door = DOOR[active] ?? "closed";

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

  // A new page starts at its top; the door and the model already moved.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [active]);

  const Own = OWN[active];
  const ready = state.status === "ready";
  const content = state.status === "loading" ? <div className="mh-calibrate" role="status" aria-label="טוען נתונים" /> : !ready || !Own ? page : <Own shared={page} />;

  const pages = [...items.map((item) => ({ label: item.label, href: item.href })), ...morePages];

  return (
    <TwinProvider door={door}>
      {(world) => (
        <div className="mh-app" data-door={door} data-route={active}>
          {world}
          <div className="mh-door" aria-hidden="true" />
          {door === "open" ? <Tags /> : null}
          {door === "open" || door === "dock" ? <PanelFocus /> : null}
          {door === "open" || door === "dock" ? <BackHome key={door} /> : null}
          {door === "dock" ? <DoorHandle /> : null}
          <Leader />
          <Rail
            items={items}
            active={active}
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
          <main className="mh-stage">
            <div key={pathname} className="mh-page">{content}</div>
          </main>
          {overlays}
          <Command open={commandOpen} onOpen={openCommand} onClose={closeCommand} search={search} actions={actions} onAction={onAction} pages={pages} />
        </div>
      )}
    </TwinProvider>
  );
}
