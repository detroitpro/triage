import type { TriageItem } from "./item.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openrouter/auto";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  fetch?: typeof fetch;
}

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set (run `make secrets-unlock`)");
  const res = await (opts.fetch ?? fetch)(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "triage",
    },
    body: JSON.stringify({
      model: opts.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
      messages,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    model?: string;
    choices?: { finish_reason?: string; message?: { content?: string | null } }[];
  };
  const first = data.choices?.[0];
  const content = first?.message?.content;
  if (typeof content !== "string") {
    // Reasoning models can spend the whole token budget thinking and return null content.
    throw new Error(
      `OpenRouter returned no content (model=${data.model}, finish_reason=${first?.finish_reason})`,
    );
  }
  return content;
}

/** Drafts follow-up questions for an item routed to `needs-info`. */
export function draftFollowUp(item: TriageItem, opts: ChatOptions = {}): Promise<string> {
  return chat(
    [
      {
        role: "system",
        content:
          "You help triage incoming work. Write at most three short, specific questions that would " +
          "let an engineer start on this item. Output only the questions as a bulleted list.",
      },
      { role: "user", content: `${item.title ? `Title: ${item.title}\n\n` : ""}${item.body}` },
    ],
    { maxTokens: 2000, ...opts },
  );
}
