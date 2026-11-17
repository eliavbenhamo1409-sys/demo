"use client";

/**
 * מינימל 2: the aluminium's sheets, blue and silver desk, ordered by what a manager decides instead of by what the
 * data holds. Three layers and no more: סקירה to understand, a work list to deal with, a drawer to go deeper without
 * losing the place in the list. The rail is six areas, a word each; an area's pages stand in one rectangle at the head
 * of the page; every page stands in one frame (`Page` in parts.tsx).
 * Pages this style composes itself are in OWN; the rest keep the shared page inside this shell.
 */
import { Suspense, useContext, useState, type ComponentType, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { LiveStatus } from "@/components/app/LiveStatus";
import { ActionMenu, type ActionItem } from "@/components/ui/ActionMenu";
import { TopBar } from "@/components/ui/TopBar";
import { useData } from "@/lib/store";
import { areaOf, pageAt, pageDef, TASKS, VIEW_PARAM, type PageId } from "./areas";
import { AreaTools, DoneToday, UnderAreaHead, WinsProvider } from "./parts";
import { AreaHead, Rail } from "./Rail";
import { useWaiting } from "./use-work";
import { Approvals } from "./pages/Approvals";
import { Closing } from "./pages/Closing";
import { Customers } from "./pages/Customers";
import { Faults } from "./pages/Faults";
import { Movements } from "./pages/Movements";
import { Orders } from "./pages/Orders";
import { Overview } from "./pages/Overview";
import { Shortages } from "./pages/Shortages";
import { Stock } from "./pages/Stock";
import { Suppliers } from "./pages/Suppliers";
import "@/design/minimal2/index.css";

export interface Minimal2Search {
  value: string;
  onChange: (q: string) => void;
  onSubmit: () => void;
  onFocus: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  /** The results under the box, drawn by the shared shell. */
  slot: ReactNode;
}

export interface Minimal2ShellProps {
  foot: ReactNode;
  actions: ActionItem[];
  onAction: (key: string) => void;
  search: Minimal2Search;
  /** The shared page for this address, or the shared shell's own word that the data failed. */
  page: ReactNode;
  overlays: ReactNode;
}

/** Pages this style composes itself. The map, the archive and the team keep the shared page. */
const OWN: Partial<Record<PageId, ComponentType>> = {
  overview: Overview,
  faults: Faults,
  approvals: Approvals,
  shortages: Shortages,
  orders: Orders,
  customers: Customers,
  stock: Stock,
  movements: Movements,
  suppliers: Suppliers,
  closing: Closing,
};

function Loading({ title }: { title: string }): ReactElement {
  const named = useContext(UnderAreaHead);
  return (
    <div className="sa-page mn2-page" aria-busy="true" aria-label="טוען נתונים">
      {named ? null : (
        <header className="mn2-head">
          <div className="mn2-head-text">
            <div className="mn2-head-title"><h1 className="sa-page-title">{title}</h1></div>
          </div>
        </header>
      )}
      <span className="sa-skeleton app-skeletonTable" />
    </div>
  );
}

function Inner({ foot, actions, onAction, search, page, overlays }: Minimal2ShellProps): ReactElement {
  const { state } = useData();
  const pathname = usePathname();
  const here = pageAt(pathname, useSearchParams().get(VIEW_PARAM));
  const waiting = useWaiting();
  const ready = state.status === "ready";

  const Own = here ? OWN[here] : undefined;
  // Each view is its own page: a key, so nothing typed or opened on one follows to the next.
  const content = state.status === "loading" && here ? <Loading title={pageDef(here).label} /> : ready && Own ? <Own key={here} /> : page;

  // An area of several pages carries its own head: the name, and the rectangle that moves between its pages.
  const area = here ? areaOf(here) : null;
  const headed = here !== null && area !== null && area.pages.length > 1;
  const [tools, setTools] = useState<HTMLElement | null>(null);

  return (
    <div className="sa-shell mn2-shell" data-page={here ?? undefined}>
      <Rail here={here} waiting={waiting} ready={ready} foot={foot} />
      <div className="app-main">
        <TopBar
          actions={<ActionMenu actions={actions} onSelect={onAction} variant="secondary" icon="plus" />}
          searchValue={search.value}
          onSearchChange={search.onChange}
          onSearch={search.onSubmit}
          onSearchFocus={search.onFocus}
          onSearchKeyDown={search.onKeyDown}
          searchSlot={search.slot}
          end={<LiveStatus />}
        />
        <main className="app-content">
          {/* Keyed by the area, so the thumb slides between an area's pages and never across two areas. */}
          {headed ? <AreaHead key={area.id} area={area} here={here} waiting={waiting} ready={ready} aside={area.id === TASKS ? <DoneToday /> : undefined} toolsRef={setTools} /> : null}
          <UnderAreaHead.Provider value={headed}>
            <AreaTools.Provider value={headed ? tools : null}>{content}</AreaTools.Provider>
          </UnderAreaHead.Provider>
        </main>
      </div>
      {overlays}
    </div>
  );
}

export function Minimal2Shell(props: Minimal2ShellProps): ReactElement {
  return (
    <WinsProvider>
      {/* The address's ?view= is read on the client only; nothing of this shell is drawn on the server. */}
      <Suspense fallback={null}>
        <Inner {...props} />
      </Suspense>
    </WinsProvider>
  );
}
