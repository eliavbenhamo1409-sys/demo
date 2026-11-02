/**
 * POST /api/match — receipt lines nothing in the dictionary resembled go to
 * Gemini, which can tell that two different wordings mean one product. Its answer
 * is only a suggestion: the worker confirms it before anything touches stock.
 *
 * Body: { lines: string[], catalog: [{ id, name, aliases }] }.
 * Returns { productIds }, aligned with lines; null means no good match.
 */

import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const MAX_LINES = 50;
const MAX_CATALOG = 2000;

const PROMPT = `אתה עוזר במחסן בישראל. קיבלת שורות שנקראו מקבלה, ואת רשימת המוצרים של המחסן: לכל מוצר מספר, שם ושמות נוספים שלו.
לכל שורה קבע איזה מוצר היא מתארת, גם אם הניסוח שונה, יש טעות כתיב, קיצור או כתיב אחר של אותה מילה.
החזר את מספר המוצר רק אם זה אותו פריט ואותה מידה. מידה אחרת (18 מול 28) או פריט אחר הם מוצר אחר. אם אתה לא בטוח החזר null.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    matches: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { line: { type: "INTEGER" }, product: { type: "INTEGER", nullable: true } },
        required: ["line"],
      },
    },
  },
  required: ["matches"],
} as const;

type CatalogItem = { id: string; name: string; aliases?: string[] };

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: "חסר GEMINI_API_KEY" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { lines?: unknown; catalog?: unknown } | null;
  const lines = Array.isArray(body?.lines) ? body.lines.filter((l): l is string => typeof l === "string") : [];
  const catalog = (Array.isArray(body?.catalog) ? body.catalog : []) as CatalogItem[];
  if (!lines.length || !catalog.length) return Response.json({ error: "חסרים נתונים" }, { status: 400 });
  if (lines.length > MAX_LINES || catalog.length > MAX_CATALOG) return Response.json({ error: "יותר מדי נתונים" }, { status: 413 });

  const text = [
    PROMPT,
    "מוצרים:",
    ...catalog.map((p, i) => `${i}: ${[p.name, ...(p.aliases ?? [])].join(" | ")}`),
    "שורות:",
    ...lines.map((l, i) => `${i}: ${l}`),
  ].join("\n");
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA },
    }),
  }).catch((e: unknown) => ({ ok: false, status: 502, text: async () => String(e) } as const));

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("Gemini match failed", res.status, detail.slice(0, 500));
    return Response.json({ error: "ההתאמה נכשלה" }, { status: 502 });
  }

  const reply = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const answer = reply.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  let parsed: { matches?: { line?: number; product?: number | null }[] } = {};
  try {
    parsed = JSON.parse(answer) as typeof parsed;
  } catch {
    return Response.json({ error: "תשובה לא תקינה מהמודל" }, { status: 502 });
  }

  const productIds = lines.map((_, i) => {
    const hit = parsed.matches?.find((m) => m.line === i);
    return typeof hit?.product === "number" ? catalog[hit.product]?.id ?? null : null;
  });
  return Response.json({ productIds, model });
}
