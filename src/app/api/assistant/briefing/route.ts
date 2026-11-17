/**
 * POST /api/assistant/briefing — words the day's briefing.
 *
 * Body: { ticket }. The facts were frozen by the scan in the database (assistant_scan); here the model only chooses
 * the three that matter most and words them. A sentence that carries a number the facts do not hold is dropped and
 * the scan's own sentence stands in its place. Called by the database at the briefing hour, with a ticket it issued
 * to itself, and by the manager's screen when it finds a briefing that was never worded.
 */

import type { NextRequest } from "next/server";
import { isTicket, rpc, TicketError, type Handshake } from "@/lib/assistant/server/db";
import { Known } from "@/lib/assistant/server/grounding";
import { complete, modelKey } from "@/lib/assistant/server/openai";
import { BRIEF_RULES, BRIEF_SCHEMA } from "@/lib/assistant/server/prompt";
import { REFUSAL_TEXT, type Briefing, type Narrative } from "@/lib/assistant/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_TEXT = 320;

interface Draft {
  opening?: unknown;
  items?: { alert_id?: unknown; text?: unknown }[];
  trend?: { text?: unknown; good?: unknown } | null;
  actions?: { alert_id?: unknown; text?: unknown }[];
}

const clean = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, MAX_TEXT) : "");

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { ticket?: unknown } | null;
  if (!isTicket(body?.ticket)) return Response.json({ code: "bad", error: "הבקשה לא תקינה" }, { status: 400 });
  const ticket = body.ticket;

  let hs: Handshake;
  let briefing: Briefing | null;
  try {
    hs = await rpc<Handshake>("assistant_handshake", { p_ticket: ticket, p_purpose: "briefing", p_question: null });
    briefing = await rpc<Briefing | null>("assistant_briefing", { p_ticket: ticket });
  } catch (e) {
    if (e instanceof TicketError) return Response.json({ code: "ticket", error: REFUSAL_TEXT.ticket }, { status: 401 });
    console.error("assistant: briefing read failed", e);
    return Response.json({ code: "db", error: "אין חיבור לנתונים כרגע" }, { status: 502 });
  }

  if (!briefing) return Response.json({ day: null, narrative: null });
  if (briefing.narrative) return Response.json({ day: briefing.day, narrative: briefing.narrative });

  const apiKey = modelKey();
  if (!apiKey) return Response.json({ day: briefing.day, narrative: null, code: "config" });
  if (!hs.allowed) return Response.json({ day: briefing.day, narrative: null, code: hs.refusal });

  const { facts } = briefing;
  const known = new Known();
  known.addJson(facts);
  const alerts = new Map(facts.top.map((a) => [a.id, a]));

  let draft: Draft;
  try {
    const reply = await complete(apiKey, {
      model: hs.model,
      messages: [
        { role: "system", content: BRIEF_RULES },
        { role: "user", content: JSON.stringify({ day: facts.day, as_of: facts.as_of, counts: facts.counts, snapshot: facts.snapshot, top: facts.top, purchase: facts.purchase }) },
      ],
      response_format: BRIEF_SCHEMA,
      // Wording, not analysis: the facts are already calculated.
      reasoning_effort: "low",
      max_completion_tokens: 2500,
    });
    await rpc("assistant_finish", { p_ticket: ticket, p_purpose: "briefing", p_model: hs.model, p_input: reply.usage.input, p_cached: reply.usage.cached, p_output: reply.usage.output, p_log: [] }).catch((e: unknown) =>
      console.error("assistant: usage not recorded", e),
    );
    draft = JSON.parse(reply.content) as Draft;
  } catch (e) {
    console.error("assistant: briefing wording failed", e);
    return Response.json({ day: briefing.day, narrative: null, code: "model" });
  }

  // A sentence stays only when every number in it is one the scan found.
  const grounded = (v: unknown): string | null => {
    const text = clean(v);
    return text && known.unverified(text).length === 0 ? text : null;
  };

  const seen = new Set<number>();
  const items: Narrative["items"] = [];
  for (const item of draft.items ?? []) {
    const alert = typeof item.alert_id === "number" ? alerts.get(item.alert_id) : undefined;
    if (!alert || seen.has(alert.id) || items.length >= 3) continue;
    seen.add(alert.id);
    items.push({ alert_id: alert.id, text: grounded(item.text) ?? alert.summary });
  }

  const actions: Narrative["actions"] = [];
  for (const action of draft.actions ?? []) {
    const text = grounded(action.text);
    if (!text || actions.length >= 3) continue;
    actions.push({ alert_id: typeof action.alert_id === "number" && alerts.has(action.alert_id) ? action.alert_id : null, text });
  }

  const trendText = grounded(draft.trend?.text);
  const narrative: Narrative = {
    opening: grounded(draft.opening),
    items,
    trend: trendText ? { text: trendText, good: draft.trend?.good === true } : null,
    actions,
    model: hs.model,
  };

  try {
    await rpc("assistant_narrate", { p_ticket: ticket, p_day: briefing.day, p_narrative: narrative });
  } catch (e) {
    console.error("assistant: briefing not saved", e);
  }
  return Response.json({ day: briefing.day, narrative });
}
