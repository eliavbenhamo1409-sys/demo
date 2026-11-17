/**
 * POST /api/assistant/chat — one question to the assistant.
 *
 * Body: { ticket, messages: [{ role: "user" | "assistant", content }] }, the last one the question.
 * Answers as lines of JSON: { t: "step" } for each read as it starts, then { t: "done" } with the answer,
 * the reads behind it and any number no read returned.
 *
 * The model has one tool, a read of schema ai. It cannot change stock, orders or approvals: no such tool exists
 * here and the database would refuse the ticket anyway. Every question is logged and priced before and after.
 */

import type { NextRequest } from "next/server";
import { isTicket, rpc, TicketError, type Handshake, type SqlResult } from "@/lib/assistant/server/db";
import { Known } from "@/lib/assistant/server/grounding";
import { addUsage, complete, modelKey, noUsage, type Message } from "@/lib/assistant/server/openai";
import { chatSystem, correction, QUERY_TOOL } from "@/lib/assistant/server/prompt";
import { REFUSAL_TEXT, type Budget, type ChatEvent, type ChatTurn, type Source } from "@/lib/assistant/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Calls to the model for one question: reads, the answer, and one correction. */
const MAX_ROUNDS = 6;
/** Reads for one question. */
const MAX_READS = 8;
const MAX_HISTORY = 12;
const MAX_TURN_CHARS = 3000;
const MAX_RESULT_CHARS = 14000;

function readTurns(raw: unknown): ChatTurn[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const turns: ChatTurn[] = [];
  for (const m of raw.slice(-MAX_HISTORY)) {
    if (!m || typeof m !== "object") return null;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim()) return null;
    turns.push({ role, content: content.trim().slice(0, MAX_TURN_CHARS) });
  }
  return turns.at(-1)?.role === "user" ? turns : null;
}

/** A result that would flood the model is cut to the rows that fit, and says so. */
function forModel(result: SqlResult): string {
  let text = JSON.stringify(result);
  let rows = result.rows ?? [];
  while (text.length > MAX_RESULT_CHARS && rows.length > 1) {
    rows = rows.slice(0, Math.ceil(rows.length / 2));
    text = JSON.stringify({ ...result, rows, row_count: rows.length, truncated: true, note: "cut to fit; aggregate in SQL or narrow the query" });
  }
  return text.slice(0, MAX_RESULT_CHARS);
}

export async function POST(req: NextRequest) {
  const apiKey = modelKey();
  if (!apiKey) return Response.json({ code: "config", error: REFUSAL_TEXT.config }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { ticket?: unknown; messages?: unknown } | null;
  const turns = readTurns(body?.messages);
  if (!isTicket(body?.ticket) || !turns) return Response.json({ code: "bad", error: "הבקשה לא תקינה" }, { status: 400 });
  const ticket = body.ticket;
  const question = turns[turns.length - 1].content;

  let hs: Handshake;
  try {
    hs = await rpc<Handshake>("assistant_handshake", { p_ticket: ticket, p_purpose: "chat", p_question: question });
  } catch (e) {
    if (e instanceof TicketError) return Response.json({ code: "ticket", error: REFUSAL_TEXT.ticket }, { status: 401 });
    console.error("assistant: handshake failed", e);
    return Response.json({ code: "db", error: "אין חיבור לנתונים כרגע" }, { status: 502 });
  }
  if (!hs.allowed) {
    const why = hs.refusal ?? "off";
    return Response.json({ code: why, error: REFUSAL_TEXT[why], budget: hs.budget }, { status: 429 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ChatEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      try {
        send(await answer(apiKey, ticket, hs, turns, send));
      } catch (e) {
        console.error("assistant: chat failed", e);
        send({ t: "error", message: e instanceof TicketError ? REFUSAL_TEXT.ticket : "התשובה נכשלה. אפשר לנסות שוב" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}

async function answer(apiKey: string, ticket: string, hs: Handshake, turns: ChatTurn[], send: (e: ChatEvent) => void): Promise<ChatEvent> {
  const system = chatSystem(hs);
  const messages: Message[] = [{ role: "system", content: system.rules }, { role: "system", content: system.now }, ...turns.map((t): Message => ({ role: t.role, content: t.content }))];

  // What the manager typed and what earlier answers said was said already; the clock is known.
  const known = new Known();
  known.addText(hs.now);
  for (const t of turns) known.addText(t.content);

  const usage = noUsage();
  const sources: Source[] = [];
  const log: { purpose: string; sql: string; rows: number | null; ms: number | null; error: string | null }[] = [];
  let text = "";
  let missing: string[] = [];
  let corrected = false;
  let budget: Budget | null = null;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const last = round === MAX_ROUNDS - 1;
      const reply = await complete(apiKey, {
        model: hs.model,
        messages,
        tools: [QUERY_TOOL],
        tool_choice: last ? "none" : "auto",
        parallel_tool_calls: true,
        max_completion_tokens: 2500,
        // Answers in a second or two; what it reads is checked by the database and the numbers by grounding.ts.
        reasoning_effort: "none",
      });
      addUsage(usage, reply.usage);

      if (reply.toolCalls.length > 0 && !last) {
        messages.push({ role: "assistant", content: reply.content || null, tool_calls: reply.toolCalls });
        for (const call of reply.toolCalls) {
          let args: { purpose?: unknown; sql?: unknown } = {};
          try {
            args = JSON.parse(call.function.arguments) as typeof args;
          } catch {
            /* an unreadable call is answered as an error below */
          }
          const purpose = typeof args.purpose === "string" ? args.purpose.slice(0, 80) : "שליפה";
          const sql = typeof args.sql === "string" ? args.sql : "";
          let result: SqlResult;
          if (!sql) result = { error: "The call had no sql." };
          else if (log.length >= MAX_READS) result = { error: "Too many reads for one question. Answer from what you have." };
          else {
            send({ t: "step", text: purpose });
            result = await rpc<SqlResult>("assistant_sql", { p_ticket: ticket, p_sql: sql });
            log.push({ purpose, sql, rows: result.row_count ?? null, ms: result.ms ?? null, error: result.error ?? null });
            if (!result.error) {
              known.addJson(result.rows ?? []);
              known.add(result.row_count ?? 0);
              sources.push({ purpose, sql, rows: result.row_count ?? 0, as_of: result.as_of ?? hs.now });
            }
          }
          messages.push({ role: "tool", tool_call_id: call.id, content: forModel(result) });
        }
        continue;
      }

      text = reply.content.trim();
      missing = known.unverified(text);
      if (missing.length > 0 && !corrected && !last) {
        corrected = true;
        messages.push({ role: "assistant", content: text }, { role: "system", content: correction(missing, sources.length > 0) });
        continue;
      }
      break;
    }
  } finally {
    // Whatever happened, what was spent is recorded.
    if (usage.input + usage.output > 0) {
      await rpc<Budget>("assistant_finish", { p_ticket: ticket, p_purpose: "chat", p_model: hs.model, p_input: usage.input, p_cached: usage.cached, p_output: usage.output, p_log: log })
        .then((b) => {
          budget = b;
        })
        .catch((e: unknown) => console.error("assistant: usage not recorded", e));
    }
  }

  return { t: "done", answer: text || "לא הצלחתי לנסח תשובה. אפשר לנסות לשאול אחרת", sources, unverified: missing, budget };
}
