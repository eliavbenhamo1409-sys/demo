/** What the assistant's screens and its two server routes pass between them. */

export type AlertKind = "shortage" | "purchase" | "event";
export type AlertStatus = "new" | "in_progress" | "resolved" | "dismissed";

export interface Alert {
  id: number;
  kind: AlertKind;
  rule: string;
  severity: number;
  title: string;
  summary: string;
  /** The figures and rows the rule found, as the database calculated them, with their source and time. */
  evidence: Record<string, unknown>;
  worth: number | null;
  entity_type: "product" | "movement" | null;
  entity_id: string | null;
  status: AlertStatus;
  owner_worker: string | null;
  owner_label: string | null;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: string | null;
}

export interface AlertEvent {
  id: number;
  alert_id: number;
  created_at: string;
  actor: string;
  action: string;
  note: string | null;
  data: Record<string, unknown> | null;
}

export interface TopAlert {
  id: number;
  kind: AlertKind;
  rule: string;
  severity: number;
  title: string;
  summary: string;
  worth: number | null;
  evidence: Record<string, unknown>;
}

export interface PurchaseGroup {
  supplier: string;
  items: number;
  lines: { product: string; qty: number; unit: string; reason: string }[];
}

/** The morning's facts, frozen by the scan. Every figure here was calculated in SQL. */
export interface BriefFacts {
  day: string;
  as_of: string;
  counts: { urgent: number; purchase: number; events: number };
  snapshot: Record<string, number | string | null>;
  top: TopAlert[];
  purchase: PurchaseGroup[];
}

/** The model's wording of those facts. Any sentence whose numbers are not in the facts never reaches here. */
export interface Narrative {
  opening: string | null;
  items: { alert_id: number; text: string }[];
  trend: { text: string; good: boolean } | null;
  actions: { alert_id: number | null; text: string }[];
  model: string;
}

export interface Briefing {
  day: string;
  facts: BriefFacts;
  narrative: Narrative | null;
  created_at: string;
}

export interface Budget {
  limit_usd: number;
  spent_usd: number;
  left_usd: number;
  questions_today: number;
}

/** One read behind an answer: what was looked for, how, how much came back and when. */
export interface Source {
  purpose: string;
  sql: string;
  rows: number;
  as_of: string;
}

export type ChatRole = "user" | "assistant";

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

/** The chat route answers as lines of JSON, one event a line. */
export type ChatEvent =
  | { t: "step"; text: string }
  | { t: "done"; answer: string; sources: Source[]; unverified: string[]; budget: Budget | null }
  | { t: "error"; message: string };

/** Why the assistant will not answer right now. */
export type Refusal = "off" | "budget" | "rate" | "config" | "ticket";

export const REFUSAL_TEXT: Record<Refusal, string> = {
  off: "העוזר כבוי כרגע",
  budget: "התקציב היומי של העוזר נוצל. הוא מתחדש בחצות",
  rate: "נשאלו הרבה שאלות בשעה האחרונה. אפשר להמשיך בעוד כמה דקות",
  config: "העוזר עוד לא מחובר למודל (חסר מפתח בשרת)",
  ticket: "צריך להיכנס מחדש כדי לדבר עם העוזר",
};
