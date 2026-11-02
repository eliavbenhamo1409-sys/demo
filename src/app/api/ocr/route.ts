/**
 * POST /api/ocr — reads a photographed delivery note with Gemini and returns
 * its lines as JSON: { lines: [{ externalName, externalSku, qty }] }.
 *
 * The API key stays on the server (GEMINI_API_KEY). The model defaults to the
 * cheapest, fastest vision model and can be overridden with GEMINI_MODEL.
 */

import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const MAX_BYTES = 8 * 1024 * 1024;

const PROMPT = `זו תמונה של תעודת משלוח (חשבונית/תעודת ספק) של מחסן בישראל.
חלץ את שורות הפריטים בלבד. לכל שורה החזר:
- externalName: שם הפריט בדיוק כפי שכתוב בתעודה (בעברית או באנגלית, בלי לתרגם או לתקן)
- externalSku: מק"ט הספק אם מופיע בשורה, אחרת null
- qty: הכמות כמספר (לא מחיר, לא סה"כ)
- kind: "product" אם זו סחורה פיזית מכל סוג שהוא, או "service" אם זו עבודה/שירות ולא פריט פיזי (חיתוך, קידוח, הרכבה, הובלה, משלוח, התקנה, שעות עבודה, פחת, דמי טיפול).
התעלם מכותרות, מחירים, מע"מ וסיכומים. אם אין שורות ברורות החזר רשימה ריקה.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          externalName: { type: "STRING" },
          externalSku: { type: "STRING", nullable: true },
          qty: { type: "NUMBER" },
          kind: { type: "STRING", enum: ["product", "service"] },
        },
        required: ["externalName", "qty", "kind"],
      },
    },
  },
  required: ["lines"],
} as const;

type RawLine = { externalName?: unknown; externalSku?: unknown; qty?: unknown; kind?: unknown };

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: "OCR לא מוגדר (חסר GEMINI_API_KEY)" }, { status: 503 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "חסר קובץ" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "התמונה גדולה מדי" }, { status: 413 });

  const mimeType = file.type || "image/jpeg";
  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inlineData: { mimeType, data } }, { text: PROMPT }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA },
    }),
  }).catch((e: unknown) => ({ ok: false, status: 502, text: async () => String(e) } as const));

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("Gemini OCR failed", res.status, detail.slice(0, 500));
    return Response.json({ error: "קריאת התעודה נכשלה" }, { status: 502 });
  }

  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  let parsed: { lines?: RawLine[] } = {};
  try {
    parsed = JSON.parse(text) as { lines?: RawLine[] };
  } catch {
    return Response.json({ error: "תשובה לא תקינה מהמודל" }, { status: 502 });
  }

  const lines = (parsed.lines ?? [])
    .map((l) => ({
      externalName: typeof l.externalName === "string" ? l.externalName.trim() : "",
      externalSku: typeof l.externalSku === "string" && l.externalSku.trim() ? l.externalSku.trim() : null,
      qty: typeof l.qty === "number" && Number.isFinite(l.qty) ? l.qty : Number(l.qty),
      kind: l.kind === "service" ? ("service" as const) : ("product" as const),
    }))
    .filter((l) => l.externalName && Number.isFinite(l.qty) && l.qty > 0);

  return Response.json({ lines, model });
}
