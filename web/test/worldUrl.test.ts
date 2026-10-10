import { describe, expect, it } from "vitest";
import type { World } from "../../src/world/types.ts";
import sample from "../public/fixtures/sample.world.json" with { type: "json" };
import { localAnswer, truncate } from "../src/pure/dialogueText.ts";
import { isReviewed, setReviewed } from "../src/pure/progress.ts";
import { DEFAULT_WORLD_URL, resolveWorldQuery } from "../src/pure/worldUrl.ts";

describe("resolveWorldQuery", () => {
  it("defaults to the feature lens", () => {
    expect(resolveWorldQuery("")).toEqual({ url: DEFAULT_WORLD_URL, region: null, lens: null });
  });
  it("prefers an explicit world url and reads region", () => {
    expect(resolveWorldQuery("?world=/x.json&region=auth")).toMatchObject({
      url: "/x.json",
      region: "auth",
    });
  });
  it("maps a lens to its world file", () => {
    expect(resolveWorldQuery("?lens=code").url).toBe("/data/world/code.world.json");
  });
});

describe("progress", () => {
  it("round-trips through an injected store keyed by repo and issue", () => {
    const store = new Map<string, string>();
    const kv = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(isReviewed(kv, "o/r", 3)).toBe(false);
    setReviewed(kv, "o/r", 3, true);
    expect(isReviewed(kv, "o/r", 3)).toBe(true);
    expect(isReviewed(kv, "o/other", 3)).toBe(false);
  });
});

describe("local dialogue", () => {
  const world = sample as unknown as World;
  const region = world.regions[0];
  const p = region?.placements[0];
  it("answers only from placement data", () => {
    if (!region || !p) throw new Error("fixture shape");
    const text = localAnswer("What are you?", p, region);
    expect(text).toContain(`#${p.issue}`);
    expect(text).toContain(p.title);
    expect(localAnswer("Who are you connected to?", p, region)).toContain("#7");
  });
  it("truncates with an ellipsis", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abc", 4)).toBe("abc");
  });
});
