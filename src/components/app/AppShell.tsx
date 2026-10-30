"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { Sidebar } from "@/components/ui/Sidebar";
import { TopBar } from "@/components/ui/TopBar";
import { ActionMenu, DEFAULT_ACTIONS, type ActionItem } from "@/components/ui/ActionMenu";
import { Notice } from "@/components/ui/Notice";
import { Square } from "@/components/ui/Mark";
import { Icon } from "@/components/ui/Icon";
import { UiProvider, useUi, type ActionKind } from "./ui-state";
import { ActionDrawer } from "./ActionDrawer";
import { ProductPanel } from "./ProductPanel";
import styles from "./AppShell.module.css";

const SHELL_ACTIONS: ActionItem[] = [
  ...DEFAULT_ACTIONS,
  { key: "new-product", label: "מוצר חדש", sub: "הוספת פריט למלאי", icon: "plus", tone: "neutral" },
];

const ACTION_KIND: Record<string, ActionKind> = {
  receive: "receive",
  issue: "issue",
  fault: "fault",
  "new-product": "new-product",
};

type SearchHit =
  | { kind: "product"; id: string; title: string; sub: string }
  | { kind: "supplier"; id: string; title: string; sub: string }
  | { kind: "supplier_item"; id: string; title: string; sub: string };

const MAX_HITS = 8;

function activeKey(pathname: string): string {
  if (pathname.startsWith("/inventory")) return "inventory";
  if (pathname.startsWith("/suppliers")) return "suppliers";
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

  /* ───────── sidebar ───────── */
  const items = useMemo(
    () => [
      { key: "overview", label: "סקירה", icon: "grid" as const, href: "/" },
      { key: "inventory", label: "מלאי", icon: "package" as const, href: "/inventory" },
      {
        key: "suppliers",
        label: "מילון ספקים",
        icon: "book-open" as const,
        href: "/suppliers",
        count: stats.pendingMappings > 0 ? stats.pendingMappings : undefined,
      },
    ],
    [stats.pendingMappings],
  );

  /* ───────── actions ───────── */
  const onAction = useCallback(
    (key: string) => {
      const kind = ACTION_KIND[key];
      if (kind) ui.openAction(kind);
    },
    [ui],
  );

  /* ───────── global search ───────── */
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const hits = useMemo<SearchHit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: SearchHit[] = [];
    for (const p of state.products) {
      if (out.length >= MAX_HITS) break;
      if (p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)) {
        out.push({ kind: "product", id: p.id, title: p.name, sub: p.sku });
      }
    }
    for (const s of state.suppliers) {
      if (out.length >= MAX_HITS) break;
      if (s.name.toLowerCase().includes(q)) out.push({ kind: "supplier", id: s.id, title: s.name, sub: "ספק" });
    }
    const supplierName = new Map(state.suppliers.map((s) => [s.id, s.name]));
    for (const it of state.supplierItems) {
      if (out.length >= MAX_HITS) break;
      if (it.external_name.toLowerCase().includes(q)) {
        const sName = supplierName.get(it.supplier_id);
        out.push({
          kind: "supplier_item",
          id: it.id,
          title: it.external_name,
          sub: sName ? `שם חיצוני · ${sName}` : "שם חיצוני",
        });
      }
    }
    return out;
  }, [query, state.products, state.suppliers, state.supplierItems]);

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
  const close = ui.close;
  useEffect(() => {
    if (!panel) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [panel, close]);

  /* ───────── render ───────── */
  const liveNode = (
    <span className={styles.live} role="status" aria-live="polite">
      <Square tone={state.live ? "success" : "neutral"} />
      {state.live ? "מחובר" : "מסתנכרן"}
    </span>
  );

  const searchSlot =
    searchOpen && query.trim() ? (
      <div ref={searchRef} className={styles.results} role="listbox" aria-label="תוצאות חיפוש">
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
                <Icon
                  name={h.kind === "product" ? "package" : h.kind === "supplier" ? "truck" : "book-open"}
                  className="sa-menu-icon"
                />
                <span className="min-w-0 flex-1">
                  <span className={styles.resultTitle}>{h.title}</span>
                  <span className={h.kind === "product" ? `${styles.resultSub} sa-mono` : styles.resultSub} dir={h.kind === "product" ? "ltr" : undefined}>
                    {h.sub}
                  </span>
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
      <div className={styles.skeletonPage} aria-busy="true" aria-label="טוען נתונים">
        <span className="sa-skeleton" style={{ width: 220, height: 28 }} />
        <span className="sa-skeleton" style={{ width: 320 }} />
        <div className={styles.skeletonRow}>
          <span className={`sa-skeleton ${styles.skeletonCard}`} />
          <span className={`sa-skeleton ${styles.skeletonCard}`} />
          <span className={`sa-skeleton ${styles.skeletonCard}`} />
        </div>
        <span className={`sa-skeleton ${styles.skeletonTable}`} />
      </div>
    );
  } else if (state.status === "error") {
    page = (
      <Notice tone="danger" title="טעינת הנתונים נכשלה" action="נסה שוב" onAction={() => void reload()}>
        {state.error ?? "שגיאה לא ידועה"}
      </Notice>
    );
  } else {
    page = children;
  }

  return (
    <div className={`sa-shell ${styles.shell}`}>
      <Sidebar items={items} active={activeKey(pathname)} brand="Super Admin" brandSub="ניהול מלאי" mark="SA" />
      <div className={styles.main}>
        <TopBar
          actions={<ActionMenu actions={SHELL_ACTIONS} onSelect={onAction} />}
          searchValue={query}
          onSearchChange={onSearchChange}
          onSearch={() => pick(hits[hit])}
          onSearchKeyDown={onSearchKeyDown}
          searchSlot={searchSlot}
          end={liveNode}
        />
        <main className={styles.content}>{page}</main>
      </div>

      {panel ? (
        <>
          <div className={`sa-scrim ${styles.scrim}`} onClick={close} aria-hidden />
          <div className={styles.panelHost} role="dialog" aria-modal="true">
            {panel.type === "action" ? <ActionDrawer /> : <ProductPanel />}
          </div>
        </>
      ) : null}

      {ui.toasts.length > 0 ? (
        <div className={styles.toasts} aria-live="polite">
          {ui.toasts.map((t) => (
            <Notice key={t.id} tone={t.tone} title={t.title} className={styles.toast} onDismiss={() => ui.dismiss(t.id)}>
              {t.text}
            </Notice>
          ))}
        </div>
      ) : null}
    </div>
  );
}
