"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useCatalog } from "@/lib/catalog";
import { fmtQty } from "@/lib/catalog/format";
import { ArrowIcon, BagIcon } from "./Icons";
import { OrderDrawer } from "./OrderDrawer";

type Drawer = { open: boolean; show: () => void; hide: () => void };

const DrawerCtx = createContext<Drawer | null>(null);

export function useDrawer(): Drawer {
  const ctx = useContext(DrawerCtx);
  if (!ctx) throw new Error("useDrawer must be used inside <Shell>");
  return ctx;
}

function Gate() {
  const { agents, chooseAgent } = useCatalog();
  return (
    <main className="cg-gate">
      <h1 className="cg-gate__title">קטלוג</h1>
      {agents.length === 0 ? (
        <p className="cg-gate__sub">אין סוכנים. המנהל מוסיף סוכנים בלוח הניהול</p>
      ) : (
        <>
          <p className="cg-gate__sub">בחירת סוכן</p>
          <div className="cg-gate__list">
            {agents.map((a) => (
              <button key={a.id} type="button" className="cg-gate__item" onClick={() => chooseAgent(a.id)}>
                {a.name}
                <ArrowIcon />
              </button>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function Failure() {
  const { reload } = useCatalog();
  return (
    <main className="cg-gate">
      <h1 className="cg-gate__title">אין חיבור</h1>
      <p className="cg-gate__sub">צריך לבדוק שיש אינטרנט</p>
      <div className="cg-placed__actions">
        <button type="button" className="cg-btn" onClick={() => void reload()}>ניסיון נוסף</button>
      </div>
    </main>
  );
}

function Header() {
  const { lines } = useCatalog();
  const { show } = useDrawer();
  const pathname = usePathname();
  return (
    <header className="cg-header">
      <div className="cg-header__inner">
        <Link href="/catalog" className="cg-brand">קטלוג</Link>
        <nav className="cg-nav" aria-label="ניווט ראשי">
          <Link href="/catalog/orders" aria-current={pathname.startsWith("/catalog/orders") ? "page" : undefined}>הזמנות</Link>
        </nav>
        <button type="button" className="cg-bag" aria-label={`הזמנה חדשה, ${lines.length} שורות`} onClick={show}>
          <BagIcon />
          {lines.length > 0 ? <span className="cg-num">{fmtQty(lines.length)}</span> : null}
        </button>
      </div>
    </header>
  );
}

function Footer() {
  const { agent, chooseAgent } = useCatalog();
  return (
    <footer className="cg-footer">
      <div className="cg-footer__inner">
        <span>{agent?.name}</span>
        <button type="button" className="cg-link" onClick={() => chooseAgent(null)}>החלפת סוכן</button>
      </div>
    </footer>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { status, hydrated, agent } = useCatalog();
  const [open, setOpen] = useState(false);
  const drawer = useMemo<Drawer>(() => ({ open, show: () => setOpen(true), hide: () => setOpen(false) }), [open]);

  // Nothing to show until the database and the phone have answered; a white page is the quietest wait.
  if (!hydrated || status === "loading") return null;
  if (status === "error") return <Failure />;
  if (!agent) return <Gate />;

  return (
    <DrawerCtx.Provider value={drawer}>
      <div inert={open}>
        <Header />
        {children}
        <Footer />
      </div>
      <OrderDrawer />
    </DrawerCtx.Provider>
  );
}
