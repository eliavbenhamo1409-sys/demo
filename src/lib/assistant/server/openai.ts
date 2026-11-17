/** One call to the model, and what it cost. The key stays on the server. */

/**
 * The key by its usual name, or by whatever name it was given by hand in the host's settings: a secret key under a
 * name that says "open" (openai, open_api_key), or one in OpenAI's own project form under any name.
 */
export function modelKey(): string | undefined {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  for (const [name, value] of Object.entries(process.env)) {
    if (!value?.startsWith("sk-")) continue;
    if (/open/i.test(name) || value.startsWith("sk-proj-")) return value;
  }
  return undefined;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface Usage {
  input: number;
  cached: number;
  output: number;
}

export const noUsage = (): Usage => ({ input: 0, cached: 0, output: 0 });

export function addUsage(total: Usage, more: Usage): void {
  total.input += more.input;
  total.cached += more.cached;
  total.output += more.output;
}

interface Completion {
  choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  error?: { message?: string };
}

export async function complete(apiKey: string, body: Record<string, unknown>): Promise<{ content: string; toolCalls: ToolCall[]; usage: Usage }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const data = (await res.json().catch(() => null)) as Completion | null;
  if (!res.ok || !data) {
    // The provider's own words go to the server log only; they may name the account.
    console.error("assistant: model call failed", res.status, data?.error?.message?.slice(0, 300));
    throw new Error("model");
  }
  const message = data.choices?.[0]?.message;
  return {
    content: message?.content ?? "",
    toolCalls: message?.tool_calls ?? [],
    usage: {
      input: data.usage?.prompt_tokens ?? 0,
      cached: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      output: data.usage?.completion_tokens ?? 0,
    },
  };
}
