"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { logOut, loginErrorMessage } from "@/lib/login/auth";
import { ORDER_STATUS_LABEL } from "@/lib/format";
import { useData } from "@/lib/store";
import { NavItem } from "@/components/ui/NavItem";
import { Sidebar } from "@/components/ui/Sidebar";
import { TopBar } from "@/components/ui/TopBar";
import { ActionMenu, DEFAULT_ACTIONS, type ActionItem } from "@/components/ui/ActionMenu";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { Notice } from "@/components/ui/Notice";
import { PageHead } from "@/components/ui/PageHead";
import { ThemeSettingsButton } from "@/components/ui/ThemeSettings";
import { MillShell } from "@/components/mill/MillShell";
import { useMill } from "@/components/mill/use-mill";
import { MerhavShell } from "@/components/merhav/Shell";
import { useMerhav } from "@/components/merhav/use-merhav";
import { UiProvider, useUi, type ActionKind } from "./ui-state";
import { ActionDrawer } from "./ActionDrawer";
import { OrderPanel } from "./OrderPanel";
import { ProductPanel } from "./ProductPanel";
import "./app-shell.css";

const SHELL_ACTIONS: ActionItem[] = [
  ...DEFAULT_ACTIONS,
  { key: "new-product", label: "מוצר חדש", icon: "package" },
  { key: "new-supplier", label: "ספק חדש", icon: "truck" },
  { key: "new-worker", label: "עובד חדש", icon: "user-plus" },
  { key: "new-agent", label: "סוכן חדש", icon: "user-plus" },
];

const ACTION_KIND: Record<string, ActionKind> = {
  receive: "receive",
  issue: "issue",
  fault: "fault",
  "new-product": "new-product",
  "new-supplier": "new-supplier",
  "new-worker": "new-worker",
  "new-agent": "new-agent",
};

type SearchHit =
  | { kind: "product"; id: string; title: string; sub: string }
  | { kind: "order"; id: string; title: string; sub: string }
  | { kind: "supplier"; id: string; title: string; sub: string }
  | { kind: "supplier_item"; id: string; title: string; sub: string };

/* Reached from the settings dialog, not the sidebar. */
const SETTINGS_PAGES = [
  { key: "documentation", label: "תיעוד", href: "/documentation" },
  { key: "team", label: "צוות", href: "/team" },
];

const HIT_ICON: Record<SearchHit["kind"], IconName> = { product: "package", order: "inbox", supplier: "truck", supplier_item: "tag" };

const MAX_HITS = 8;

function activeKey(pathname: string): string {
  if (pathname.startsWith("/closing")) return "closing";
  if (pathname.startsWith("/inventory")) return "inventory";
  if (pathname.startsWith("/3d")) return "map";
  if (pathname.startsWith("/orders")) return "orders";
  if (pathname.startsWith("/movements")) return "movements";
  if (pathname.startsWith("/faults")) return "faults";
  if (pathname.startsWith("/documentation")) return "documentation";
  if (pathname.startsWith("/suppliers")) return "suppliers";
  if (pathname.startsWith("/team")) return "team";
  return "overview";
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <UiProvider>
      <ShellInner>{children}</ShellInner>
    </UiProvider>
  );
}

function ShellInner({ children }: { children: ReactNode }) {
  const { state, stats, reload } = useData();
  const ui = useUi();
  const pathname = usePathname();
  const router = useRouter();
  const mill = useMill();
  const merhav = useMerhav();

  /* ───────── sidebar ───────── */
  const items = useMemo(
    () => [
      { key: "overview", label: "סקירה", href: "/", icon: "grid" as const },
      { key: "closing", label: "סגירת יום", href: "/closing", icon: "calendar" as const },
      { key: "inventory", label: "מלאי", href: "/inventory", icon: "package" as const },
      { key: "map", label: "3D", href: "/3d", icon: "layers" as const },
      { key: "orders", label: "הזמנות", href: "/orders", icon: "inbox" as const, count: stats.openOrders > 0 ? stats.openOrders : undefined },
      { key: "movements", label: "תנועות", href: "/movements", icon: "activity" as const },
      { key: "faults", label: "תקלות", href: "/faults", icon: "tool" as const, count: stats.openFaults > 0 ? stats.openFaults : undefined },
      { key: "suppliers", label: "מיפוי קטלוג", href: "/suppliers", icon: "book-open" as const, count: stats.pendingMappings > 0 ? stats.pendingMappings : undefined },
    ],
    [stats.pendingMappings, stats.openFaults, stats.openOrders],
  );

  /* ───────── actions ───────── */
  const onAction = useCallback(
    (key: string) => {
      const kind = ACTION_KIND[key];
      if (kind) ui.openAction(kind);
    },
    [ui],
  );

  const onLogOut = useCallback(() => {
    logOut().catch((error: unknown) => ui.notify({ tone: "danger", title: loginErrorMessage(error) }));
  }, [ui]);

  /* ───────── global search ───────── */
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const hits = useMemo<SearchHit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: SearchHit[] = [];
    const productName = new Map(state.products.map((p) => [p.id, p.name]));
    for (const p of state.products) {
      if (out.length >= MAX_HITS) break;
      if (p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)) {
        out.push({ kind: "product", id: p.id, title: p.name, sub: p.sku });
      } else if (p.barcode && (p.barcode === q || p.barcode.startsWith(q))) {
        out.push({ kind: "product", id: p.id, title: p.name, sub: p.barcode });
      }
    }
    for (const o of state.orders) {
      if (out.length >= MAX_HITS) break;
      if (String(o.number).includes(q) || o.customer.toLowerCase().includes(q)) {
        out.push({ kind: "order", id: o.id, title: `הזמנה ${o.number}`, sub: `${o.customer} · ${ORDER_STATUS_LABEL[o.status]}` });
      }
    }
    for (const s of state.suppliers) {
      if (out.length >= MAX_HITS) break;
      if (s.name.toLowerCase().includes(q)) out.push({ kind: "supplier", id: s.id, title: s.name, sub: "ספק" });
    }
    const supplierName = new Map(state.suppliers.map((s) => [s.id, s.name]));
    for (const it of state.supplierItems) {
      if (out.length >= MAX_HITS) break;
      if (it.external_name.toLowerCase().includes(q) || (it.external_sku ?? "").toLowerCase().includes(q)) {
        const sName = supplierName.get(it.supplier_id);
        const pName = it.product_id ? productName.get(it.product_id) : undefined;
        const who = sName ? `שם ספק · ${sName}` : "שם ספק";
        out.push({
          kind: "supplier_item",
          id: it.id,
          title: it.external_name,
          sub: pName ? `${who} → ${pName}` : `${who} · ללא התאמה`,
        });
      }
    }
    return out;
  }, [query, state.products, state.orders, state.suppliers, state.supplierItems]);

  const onSearchChange = useCallback((q: string) => {
    setQuery(q);
    setHit(0);
    setSearchOpen(q.trim().length >= 1);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
    setHit(0);
  }, []);

  const pick = useCallback(
    (h: SearchHit | undefined) => {
      if (!h) return;
      if (h.kind === "product") ui.openProduct(h.id);
      else if (h.kind === "order") ui.openOrder(h.id);
      else router.push("/suppliers");
      closeSearch();
    },
    [ui, router, closeSearch],
  );

  const onSearchKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!searchOpen) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeSearch();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setHit((i) => (hits.length ? (i + 1) % hits.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHit((i) => (hits.length ? (i <= 0 ? hits.length - 1 : i - 1) : 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        pick(hits[hit]);
      }
    },
    [searchOpen, hits, hit, pick, closeSearch],
  );

  // click outside the search closes the popover
  useEffect(() => {
    if (!searchOpen) return;
    const onDown = (e: PointerEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [searchOpen]);

  /* ───────── panel host ───────── */
  const panel = ui.panel;
  const requestClose = ui.requestClose;
  useEffect(() => {
    if (!panel) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: globalThis.KeyboardEvent) => {
      // An open menu inside the drawer takes its own Escape, so a dropdown never throws the form away.
      if (e.key === "Escape" && !e.defaultPrevented) requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [panel, requestClose]);

  /* ───────── render ───────── */
  const active = activeKey(pathname);

  // A phone's tabs scroll sideways, so the page you are on is never left behind the edge.
  useEffect(() => {
    document.querySelector(".sa-sidebar .sa-nav-item.is-active")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);

  // A working connection needs no sign; only a lost one is worth a word.
  const liveNode = state.live ? null : (
    <span className="app-live" role="status" aria-live="polite">מתחבר</span>
  );

  const searchSlot =
    searchOpen && query.trim() ? (
      <div ref={searchRef} className="app-results" role="listbox" aria-label="תוצאות חיפוש">
        {hits.length === 0 ? (
          <div className="sa-menu-empty">לא נמצאו תוצאות</div>
        ) : (
          <div className="sa-menu-list">
            {hits.map((h, i) => (
              <button
                key={`${h.kind}:${h.id}`}
                type="button"
                role="option"
                aria-selected={i === hit}
                className={`sa-menu-item${i === hit ? " is-active" : ""}`}
                onMouseEnter={() => setHit(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(h)}
              >
                <Icon name={HIT_ICON[h.kind]} size={16} />
                <span className="min-w-0 flex-1">
                  <span className="app-resultTitle">{h.title}</span>
                  <span className="app-resultSub"><bdi>{h.sub}</bdi></span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    ) : null;

  let page: ReactNode;
  if (state.status === "loading") {
    page = (
      <div className="sa-page" aria-busy="true" aria-label="טוען נתונים">
        <PageHead title={[...items, ...SETTINGS_PAGES].find((i) => i.key === active)?.label ?? ""} />
        <span className="sa-skeleton app-skeletonTable" />
      </div>
    );
  } else if (state.status === "error") {
    page = (
      <Notice tone="danger" title="טעינת הנתונים נכשלה" action="ניסיון נוסף" onAction={() => void reload()}>
        {state.error ?? "שגיאה לא ידועה"}
      </Notice>
    );
  } else {
    page = children;
  }

  const foot = (
    <>
      <ThemeSettingsButton variant="nav" pages={SETTINGS_PAGES} active={SETTINGS_PAGES.some((p) => p.key === active)} />
      <NavItem icon="log-out" onClick={onLogOut}>יציאה</NavItem>
    </>
  );

  const overlays = (
    <>
      {panel ? (
        <>
          <div className={`sa-scrim app-scrim`} data-closing={ui.closing || undefined} onClick={requestClose} aria-hidden />
          <div className="app-panelHost" role="dialog" aria-modal="true" data-closing={ui.closing || undefined} onInput={ui.markDirty}>
            {panel.type === "action" ? <ActionDrawer /> : panel.type === "order" ? <OrderPanel /> : <ProductPanel />}
          </div>
          {ui.askingClose ? (
            <Modal title="לסגור בלי לשמור?" tone="danger" confirmLabel="סגירה" cancelLabel="המשך" onConfirm={ui.close} onClose={ui.keepOpen} />
          ) : null}
        </>
      ) : null}

      {ui.toasts.length > 0 ? (
        <div className="app-toasts" aria-live="polite">
          {ui.toasts.map((t) => (
            <Notice key={t.id} tone={t.tone} title={t.title} className="app-toast" onDismiss={() => ui.dismiss(t.id)}>
              {t.text}
            </Notice>
          ))}
        </div>
      ) : null}
    </>
  );

  if (merhav) {
    return (
      <MerhavShell
        items={items}
        active={active}
        foot={foot}
        morePages={SETTINGS_PAGES}
        actions={SHELL_ACTIONS}
        onAction={onAction}
        search={{ query, onQuery: onSearchChange, hits, pick }}
        offline={!state.live}
        page={page}
        overlays={overlays}
        panelOpen={panel !== null}
      />
    );
  }

  if (mill) {
    return (
      <MillShell
        items={items}
        active={active}
        foot={foot}
        morePages={SETTINGS_PAGES}
        actions={SHELL_ACTIONS}
        onAction={onAction}
        search={{ query, onQuery: onSearchChange, hits, pick }}
        offline={!state.live}
        page={page}
        overlays={overlays}
        panelOpen={panel !== null}
      />
    );
  }

  return (
    <div className="sa-shell">
      <Sidebar items={items} active={active} brand="ניהול מלאי" foot={foot} />
      <div className="app-main">
        <TopBar
          actions={<ActionMenu actions={SHELL_ACTIONS} onSelect={onAction} variant="secondary" icon="plus" />}
          searchValue={query}
          onSearchChange={onSearchChange}
          onSearch={() => pick(hits[hit])}
          onSearchKeyDown={onSearchKeyDown}
          searchSlot={searchSlot}
          end={liveNode}
        />
        <main className="app-content">{page}</main>
      </div>
      {overlays}
    </div>
  );
}
