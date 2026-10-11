import { describe, expect, it } from "vitest";
import { Api, POST_HEADERS } from "../src/game/api.ts";

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function fakeFetch(handler: Handler): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(String(url), init))) as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("Api", () => {
  it("reads mode from /api/status", async () => {
    const api = new Api(fakeFetch(() => json({ mode: "live", repo: "o/r" })));
    expect(await api.status()).toEqual({ mode: "live", repo: "o/r" });
    expect(api.mode).toBe("live");
    expect(api.offline).toBe(false);
  });

  it("proposes, then confirms, with the required headers", async () => {
    const calls: { url: string; headers: unknown; body: unknown }[] = [];
    const api = new Api(
      fakeFetch((url, init) => {
        calls.push({ url, headers: init?.headers, body: JSON.parse(String(init?.body)) });
        if (url === "/api/action")
          return json({
            proposalId: "p1",
            mode: "dry-run",
            description: "Give bug to #3",
            expiresAt: "t",
          });
        return json({ ok: true, mode: "dry-run", undoId: "u1", applied: false, message: "m" });
      }),
    );
    const p = await api.propose({ type: "label-add", issue: 3, payload: { label: "bug" } });
    expect(p).toMatchObject({ proposalId: "p1", description: "Give bug to #3" });
    expect(calls[0]).toEqual({
      url: "/api/action",
      headers: POST_HEADERS,
      body: { type: "label-add", issue: 3, payload: { label: "bug" } },
    });
    const r = await api.confirm(p);
    expect(calls[1]).toMatchObject({ url: "/api/action/confirm", body: { proposalId: "p1" } });
    expect(r).toEqual({ ok: true, mode: "dry-run", undoId: "u1", applied: false, message: "m" });
  });

  it("passes the grantId for comment and close", async () => {
    const bodies: Record<string, unknown>[] = [];
    const api = new Api(
      fakeFetch((_u, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return json({ proposalId: "p", mode: "dry-run", description: "d", expiresAt: "" });
      }),
    );
    await api.propose({ type: "close", issue: 9, payload: { reason: "completed" } }, "g1");
    expect(bodies[0]?.grantId).toBe("g1");
    await api.propose({ type: "label-add", issue: 9, payload: { label: "x" } });
    expect(bodies[1]?.grantId).toBeUndefined();
  });

  it("goes offline on fetch errors, announces once, and still proposes/confirms locally", async () => {
    const reasons: string[] = [];
    const api = new Api(
      fakeFetch(() => {
        throw new Error("ECONNREFUSED");
      }),
      (r) => reasons.push(r),
    );
    expect(await api.status()).toBeNull();
    const p = await api.propose({ type: "close", issue: 9, payload: { reason: "completed" } });
    expect(p.proposalId).toMatch(/^offline-/);
    expect(p.description).toBe("Release #9");
    const r = await api.confirm(p);
    expect(r.applied).toBe(false);
    expect(r.mode).toBe("dry-run");
    expect(await api.dialogue(9, { text: "hi" })).toBeNull();
    expect(api.offline).toBe(true);
    expect(reasons).toHaveLength(1);
  });

  it("treats 404 and the dev proxy's 502 as offline too", async () => {
    const api = new Api(fakeFetch(() => new Response("nope", { status: 404 })));
    await api.status();
    expect(api.offline).toBe(true);
    const viaProxy = new Api(fakeFetch(() => new Response("Bad Gateway", { status: 502 })));
    await viaProxy.status();
    expect(viaProxy.offline).toBe(true);
  });

  it("passes canned prompts as `prompt`, free text as `text`, and keeps the grantId", async () => {
    const bodies: unknown[] = [];
    const api = new Api(
      fakeFetch((_u, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return json({
          reply: "ok",
          intent: { choice: "verify", confidence: 0.9, band: "act" },
          grantId: "g9",
        });
      }),
    );
    const r = await api.dialogue(3, { prompt: "what" });
    expect(bodies[0]).toEqual({ issue: 3, prompt: "what" });
    expect(r?.intent?.choice).toBe("verify");
    expect(r?.grantId).toBe("g9");
    await api.dialogue(3, { text: "close it" });
    expect(bodies[1]).toEqual({ issue: 3, text: "close it" });
  });

  it("undo reports failure when offline", async () => {
    const api = new Api(fakeFetch(() => new Response("", { status: 404 })));
    expect((await api.undo("u1")).ok).toBe(false);
  });
});

describe("Api refusals", () => {
  it("a 4xx with a body is a refusal, not offline", async () => {
    const api = new Api(fakeFetch(() => json({ error: "issue #7 is not in this world" }, 400)));
    await expect(
      api.propose({ type: "label-add", issue: 7, payload: { label: "bug" } }),
    ).rejects.toThrow(/not in this world/);
    expect(api.offline).toBe(false);
    expect(api.lastError).toMatch(/not in this world/);
    expect(await api.dialogue(7, { text: "x" })).toBeNull();
    expect(api.offline).toBe(false);
  });
});
