"use client";

/**
 * Global UI state: which drawer/panel is open. Pages and the top bar call
 * these; the AppShell renders the hosts (ActionDrawer, ProductPanel…).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Movement } from "@/lib/store";

export type ActionKind =
  | "receive"        // קליטת סחורה
  | "issue"          // הוצאת סחורה
  | "fault"          // דיווח תקלה
  | "adjust"         // תיקון ספירה
  | "place"          // שיבוץ או העברה בין מדפים
  | "new-product"
  | "edit-product"
  | "new-supplier"
  | "edit-supplier"
  | "new-worker"
  | "edit-worker"
  | "new-agent"
  | "edit-agent"
  | "new-supplier-item" // שם של ספק למוצר
  | "map-supplier-item" // למה שייך השם הזה
  | "review-item-request" // בקשה של עובד מהקבלה
  | "suppliers"; // רשימת הספקים

export type ActionContext = {
  productId?: string;
  supplierId?: string;
  supplierItemId?: string;
  workerId?: string;
  agentId?: string;
  faultId?: string;
  requestId?: string;
  asset?: string; // קוד של מכונה במפה
  place?: string; // מיקום, כמו A-1/2R
  from?: string; // המיקום שממנו מעבירים
};

export type OpenPanel =
  | { type: "action"; kind: ActionKind; ctx: ActionContext }
  | { type: "product"; id: string; tab?: "details" | "history" }
  | { type: "order"; id: string }
  | { type: "fault"; id: string }
  // The row itself: a movement older than the store's latest 400 has nowhere else to come from.
  | { type: "movement"; movement: Movement }
  | null;

export type Toast = { id: number; tone: "success" | "danger" | "neutral"; title: string; text?: string };

type Ui = {
  panel: OpenPanel;
  openAction: (kind: ActionKind, ctx?: ActionContext) => void;
  openProduct: (id: string, tab?: "details" | "history") => void;
  openOrder: (id: string) => void;
  openFault: (id: string) => void;
  openMovement: (movement: Movement) => void;
  close: () => void;
  /** The way out for the scrim, the X and Escape: a form or a fault's note with something typed asks first. */
  requestClose: () => void;
  /** The panel is on its way out; it unmounts when the exit ends. */
  closing: boolean;
  /** Something changed in the open panel since it opened. */
  markDirty: () => void;
  /** requestClose is waiting for an answer. */
  askingClose: boolean;
  keepOpen: () => void;
  toasts: Toast[];
  notify: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
};

const Ctx = createContext<Ui | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<OpenPanel>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [closing, setClosing] = useState(false);
  const [askingClose, setAskingClose] = useState(false);
  const dirty = useRef(false);
  const open = useCallback((next: OpenPanel) => {
    dirty.current = false;
    setClosing(false);
    setAskingClose(false);
    setPanel(next);
  }, []);
  const openAction = useCallback((kind: ActionKind, ctx: ActionContext = {}) => open({ type: "action", kind, ctx }), [open]);
  const openProduct = useCallback((id: string, tab?: "details" | "history") => open({ type: "product", id, tab }), [open]);
  const openOrder = useCallback((id: string) => open({ type: "order", id }), [open]);
  const openFault = useCallback((id: string) => open({ type: "fault", id }), [open]);
  const openMovement = useCallback((movement: Movement) => open({ type: "movement", movement }), [open]);
  const close = useCallback(() => {
    dirty.current = false;
    setAskingClose(false);
    setClosing(true);
  }, []);
  const requestClose = useCallback(() => {
    if ((panel?.type === "action" || panel?.type === "fault") && dirty.current) setAskingClose(true);
    else close();
  }, [panel, close]);
  const markDirty = useCallback(() => {
    dirty.current = true;
  }, []);
  const keepOpen = useCallback(() => setAskingClose(false), []);
  // A panel leaves the way it came. The wait matches --dur-2 in app-shell.css.
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => {
      setPanel(null);
      setClosing(false);
    }, 200);
    return () => clearTimeout(t);
  }, [closing]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { ...t, id }]);
    // A failure stays until it is read.
    if (t.tone !== "danger") setTimeout(() => dismiss(id), 4000);
  }, [dismiss]);
  const value = useMemo(
    () => ({ panel, openAction, openProduct, openOrder, openFault, openMovement, close, requestClose, closing, markDirty, askingClose, keepOpen, toasts, notify, dismiss }),
    [panel, openAction, openProduct, openOrder, openFault, openMovement, close, requestClose, closing, markDirty, askingClose, keepOpen, toasts, notify, dismiss],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUi(): Ui {
  const c = useContext(Ctx);
  if (!c) throw new Error("useUi must be used inside <UiProvider>");
  return c;
}
