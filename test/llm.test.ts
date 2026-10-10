import { describe, expect, it, vi } from "vitest";
import { chat } from "../src/llm.ts";

function fakeFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("chat", () => {
  it("posts to OpenRouter and returns the first message", async () => {
    const f = fakeFetch(200, { choices: [{ message: { content: "ok" } }] });
    const reply = await chat([{ role: "user", content: "hi" }], {
      apiKey: "test-key",
      model: "test/model",
      fetch: f,
    });

    expect(reply).toBe("ok");
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "test/model" });
  });

  it("throws on a non-2xx response", async () => {
    const f = fakeFetch(401, { error: "bad key" });
    await expect(chat([], { apiKey: "x", fetch: f })).rejects.toThrow(/OpenRouter 401/);
  });

  it("requires an API key", async () => {
    const saved = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      await expect(chat([])).rejects.toThrow(/OPENROUTER_API_KEY/);
    } finally {
      if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
    }
  });
});
