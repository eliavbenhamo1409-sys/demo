"use client";

/**
 * Global UI state: which drawer/panel is open. Pages and the top bar call
 * these; the AppShell renders the hosts (ActionDrawer, ProductPanel…).
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type ActionKind =
  | "receive"        // קליטת סחורה
  | "issue"          // הוצאת סחורה
  | "fault"          // דיווח תקלה
  | "adjust"         // תיקון ספירה
  | "new-product"
  | "edit-product"
  | "new-supplier"
  | "edit-supplier"
  | "new-worker"
  | "new-supplier-item" // שם חיצוני חדש במילון
  | "map-supplier-item"; // תיקון/אישור התאמה

export type ActionContext = {
  productId?: string;
  supplierId?: string;
  supplierItemId?: string;
  workerId?: string;
  faultId?: string;
};

export type OpenPanel =
  | { type: "action"; kind: ActionKind; ctx: ActionContext }
  | { type: "product"; id: string; tab?: "details" | "history" }
  | null;

export type Toast = { id: number; tone: "success" | "danger" | "neutral"; title: string; text?: string };

type Ui = {
  panel: OpenPanel;
  openAction: (kind: ActionKind, ctx?: ActionContext) => void;
  openProduct: (id: string, tab?: "details" | "history") => void;
  close: () => void;
  toasts: Toast[];
  notify: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
};

const Ctx = createContext<Ui | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<OpenPanel>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const openAction = useCallback((kind: ActionKind, ctx: ActionContext = {}) => setPanel({ type: "action", kind, ctx }), []);
  const openProduct = useCallback((id: string, tab?: "details" | "history") => setPanel({ type: "product", id, tab }), []);
  const close = useCallback(() => setPanel(null), []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { ...t, id }]);
    setTimeout(() => dismiss(id), 4000);
  }, [dismiss]);
  const value = useMemo(() => ({ panel, openAction, openProduct, close, toasts, notify, dismiss }), [panel, openAction, openProduct, close, toasts, notify, dismiss]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUi(): Ui {
  const c = useContext(Ctx);
  if (!c) throw new Error("useUi must be used inside <UiProvider>");
  return c;
}
