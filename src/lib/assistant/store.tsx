"use client";

/**
 * The assistant on the manager's side: what the database holds for it (the briefing, the alerts, the budget), the
 * conversation, and the panel that shows them. Every read goes through a ticket the database issues to the signed-in
 * manager; the same ticket is what the chat route shows the database on the manager's behalf.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { REFUSAL_TEXT, type Alert, type AlertEvent, type Briefing, type Budget, type ChatEvent, type ChatTurn, type Refusal, type Source } from "./types";

export type AssistantTab = "brief" | "alerts" | "chat";

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** What is being read right now, while the answer is on its way. */
  steps?: string[];
  sources?: Source[];
  unverified?: string[];
  pending?: boolean;
  failed?: boolean;
}

export interface AssistantData {
  name: string;
  briefing_hour: number;
  now: string;
  briefing: Briefing | null;
  alerts: Alert[];
  budget: Budget | null;
}

export type AlertAction = "take" | "assign" | "resolve" | "dismiss" | "note" | "reopen";

interface Assistant {
  /** loading: the first read is on its way. off: nobody is signed in, or the assistant is switched off. */
  status: "loading" | "ready" | "off";
  data: AssistantData | null;
  /** The briefing's wording is being written right now. */
  wording: boolean;
  open: boolean;
  tab: AssistantTab;
  /** The alert the panel was opened on. */
  focus: number | null;
  show: (tab?: AssistantTab, alertId?: number) => void;
  hide: () => void;
  setTab: (tab: AssistantTab) => void;
  messages: ChatMessage[];
  sending: boolean;
  ask: (question: string) => void;
  clearChat: () => void;
  act: (alertId: number, action: AlertAction, note?: string, workerId?: string) => Promise<string | null>;
  log: (alertId: number) => Promise<AlertEvent[]>;
  scanning: boolean;
  scan: () => Promise<string | null>;
  reload: () => Promise<void>;
}

const Ctx = createContext<Assistant | null>(null);

/** The generated database types end before the assistant's tables; its calls go through the plain client. */
const db = (): SupabaseClient => supabase() as unknown as SupabaseClient;

const RESYNC_MS = 90_000;
const HISTORY = 10;

let ticket: { value: string; expires: number } | null = null;

async function getTicket(fresh = false): Promise<string> {
  if (!fresh && ticket && ticket.expires - Date.now() > 60_000) return ticket.value;
  const { data, error } = await db().rpc("assistant_open");
  if (error || !data?.ticket) throw new Error(error?.message ?? "no ticket");
  ticket = { value: data.ticket as string, expires: Date.parse(data.expires_at as string) };
  return ticket.value;
}

/** A call that carries the ticket; an expired one is replaced once. */
async function withTicket<T>(call: (t: string) => PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>): Promise<T> {
  let res = await call(await getTicket());
  if (res.error?.code === "28000") res = await call(await getTicket(true));
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

const ERRORS: [RegExp, string][] = [
  [/a note is required/, "צריך לכתוב מה נעשה כדי לסגור"],
  [/sign in first/, "צריך להיכנס מחדש"],
  [/choose a worker/, "צריך לבחור עובד"],
  [/already covers/, "כבר יש התראה פתוחה על זה"],
];

const explain = (e: unknown): string => {
  const message = e instanceof Error ? e.message : String(e);
  return ERRORS.find(([re]) => re.test(message))?.[1] ?? "הפעולה לא נשמרה. אפשר לנסות שוב";
};

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Assistant["status"]>("loading");
  const [data, setData] = useState<AssistantData | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<AssistantTab>("brief");
  const [focus, setFocus] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [wording, setWording] = useState(false);
  const nextId = useRef(1);
  const worded = useRef<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const state = await withTicket<AssistantData>((t) => db().rpc("assistant_state", { p_ticket: t }));
      setData(state);
      setStatus("ready");
    } catch {
      setStatus((s) => (s === "ready" ? s : "off"));
    }
  }, []);

  // The first read, then again when the manager comes back to the tab and every minute and a half while it is in front.
  useEffect(() => {
    const first = setTimeout(() => void reload(), 0);
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, RESYNC_MS);
    const onShow = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [reload]);

  // A briefing the scan froze but nobody worded yet is worded once, on the first screen that meets it.
  const briefing = data?.briefing ?? null;
  useEffect(() => {
    if (!briefing || briefing.narrative) return;
    const key = `${briefing.day}|${briefing.created_at}`;
    if (worded.current === key) return;
    worded.current = key;
    void (async () => {
      setWording(true);
      try {
        const t = await getTicket();
        await fetch("/api/assistant/briefing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket: t }) });
        await reload();
      } catch {
        /* the scan's own sentences stand in until it is worded */
      } finally {
        setWording(false);
      }
    })();
  }, [briefing, reload]);

  const show = useCallback((next: AssistantTab = "brief", alertId?: number) => {
    setTab(next);
    setFocus(alertId ?? null);
    setOpen(true);
  }, []);
  const hide = useCallback(() => setOpen(false), []);

  const patch = useCallback((id: number, change: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>)) => {
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...(typeof change === "function" ? change(m) : change) } : m)));
  }, []);

  const ask = useCallback(
    (raw: string) => {
      const question = raw.trim();
      if (!question || sending) return;
      const userId = nextId.current++;
      const replyId = nextId.current++;
      const history: ChatTurn[] = [...messages.filter((m) => !m.pending && !m.failed && m.content).slice(-HISTORY).map((m) => ({ role: m.role, content: m.content })), { role: "user", content: question }];
      setMessages((list) => [...list, { id: userId, role: "user", content: question }, { id: replyId, role: "assistant", content: "", steps: [], pending: true }]);
      setTab("chat");
      setOpen(true);
      setSending(true);

      const fail = (text: string) => patch(replyId, { content: text, pending: false, failed: true });

      void (async () => {
        try {
          let res = await send(history, false);
          if (res.status === 401) res = await send(history, true);
          if (!res.ok || !res.body) {
            const body = (await res.json().catch(() => null)) as { code?: Refusal; error?: string } | null;
            fail(body?.error ?? (body?.code ? REFUSAL_TEXT[body.code] : "העוזר לא זמין כרגע"));
            return;
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let done = false;
          const take = (line: string) => {
            if (!line.trim()) return;
            const e = JSON.parse(line) as ChatEvent;
            if (e.t === "step") patch(replyId, (m) => ({ steps: [...(m.steps ?? []), e.text] }));
            else if (e.t === "done") {
              done = true;
              patch(replyId, { content: e.answer, sources: e.sources, unverified: e.unverified, pending: false });
              if (e.budget) setData((d) => (d ? { ...d, budget: e.budget } : d));
            } else fail(e.message);
          };
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            let cut = buffer.indexOf("\n");
            while (cut >= 0) {
              take(buffer.slice(0, cut));
              buffer = buffer.slice(cut + 1);
              cut = buffer.indexOf("\n");
            }
          }
          take(buffer);
          if (!done) patch(replyId, (m) => (m.pending ? { content: "התשובה נקטעה. אפשר לנסות שוב", pending: false, failed: true } : {}));
        } catch {
          fail("אין חיבור לעוזר כרגע. אפשר לנסות שוב");
        } finally {
          setSending(false);
        }
      })();
    },
    [messages, sending, patch],
  );

  const clearChat = useCallback(() => setMessages((list) => (list.some((m) => m.pending) ? list : [])), []);

  const act = useCallback(
    async (alertId: number, action: AlertAction, note?: string, workerId?: string): Promise<string | null> => {
      const { error } = await db().rpc("assistant_alert_act", { p_alert: alertId, p_action: action, p_note: note ?? null, p_worker: workerId ?? null });
      if (error) return explain(new Error(error.message));
      await reload();
      return null;
    },
    [reload],
  );

  const log = useCallback((alertId: number) => withTicket<AlertEvent[]>((t) => db().rpc("assistant_alert_log", { p_ticket: t, p_alert: alertId })), []);

  const scan = useCallback(async (): Promise<string | null> => {
    setScanning(true);
    try {
      const { error } = await db().rpc("assistant_scan_now", { p_briefing: true });
      if (error) return explain(new Error(error.message));
      await reload();
      return null;
    } finally {
      setScanning(false);
    }
  }, [reload]);

  const value = useMemo<Assistant>(
    () => ({ status, data, wording, open, tab, focus, show, hide, setTab, messages, sending, ask, clearChat, act, log, scanning, scan, reload }),
    [status, data, wording, open, tab, focus, show, hide, messages, sending, ask, clearChat, act, log, scanning, scan, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

async function send(history: ChatTurn[], fresh: boolean): Promise<Response> {
  const t = await getTicket(fresh);
  return fetch("/api/assistant/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket: t, messages: history }) });
}

export function useAssistant(): Assistant {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAssistant must be used inside <AssistantProvider>");
  return c;
}

/** For a part that may stand outside the admin shell: null there, and the part draws nothing. */
export function useAssistantMaybe(): Assistant | null {
  return useContext(Ctx);
}
