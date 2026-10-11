import { describe, expect, it } from "vitest";
import type { LabelMeta } from "../../src/world/types.ts";
import {
  contextLabel,
  glyphPath,
  labelColor,
  moveSelection,
  sortTokens,
  tokenDim,
  tokenShape,
} from "../src/pure/satchel.ts";

const set: LabelMeta[] = [
  { name: "bug", color: "d73a4a", description: "Something is broken", count: 4 },
  { name: "context:analysis", color: "0e8a16", description: "", count: 1 },
  { name: "app:web", color: "1d76db", description: "", count: 0 },
  { name: "later", color: "#ABCDEF", description: "", count: 0 },
  { name: "odd", color: "zzz", description: "", count: 0 },
];

describe("token shapes", () => {
  it("maps namespaces and reserved names to shapes", () => {
    expect(tokenShape("context:analysis")).toBe("crest");
    expect(tokenShape("app:web")).toBe("tool");
    expect(tokenShape("platform:linux")).toBe("gear");
    expect(tokenShape("feature:sessions")).toBe("scroll");
    expect(tokenShape("performance")).toBe("stopwatch");
    expect(tokenShape("needs-info")).toBe("lantern");
    expect(tokenShape("later")).toBe("hourglass");
    expect(tokenShape("infra")).toBe("wrench");
    expect(tokenShape("bug")).toBe("tag");
    expect(tokenShape("Context:Odd")).toBe("crest");
  });

  it("has a glyph for every shape", () => {
    for (const s of [
      "crest",
      "tool",
      "gear",
      "scroll",
      "stopwatch",
      "lantern",
      "hourglass",
      "wrench",
      "tag",
    ] as const)
      expect(glyphPath(s)).toMatch(/^M/);
  });
});

describe("colours and ordering", () => {
  it("normalises GitHub hex and falls back on junk", () => {
    expect(labelColor(set, "bug")).toBe("#d73a4a");
    expect(labelColor(set, "later")).toBe("#abcdef");
    expect(labelColor(set, "odd")).toBe("#8a97a8");
    expect(labelColor(set, "missing")).toBe("#8a97a8");
  });

  it("sorts namespaces first, then plain tags by name", () => {
    expect(sortTokens(set).map((l) => l.name)).toEqual([
      "context:analysis",
      "app:web",
      "later",
      "bug",
      "odd",
    ]);
  });

  it("picks the first context label for the tabard", () => {
    expect(contextLabel(["bug", "context:b", "context:a"])).toBe("context:b");
    expect(contextLabel(["bug"])).toBeNull();
  });

  it("dims unworn tokens until they are applied this session", () => {
    const applied = new Set<string>();
    expect(tokenDim(set[0] as LabelMeta, applied)).toBe(false);
    expect(tokenDim(set[2] as LabelMeta, applied)).toBe(true);
    applied.add("app:web");
    expect(tokenDim(set[2] as LabelMeta, applied)).toBe(false);
  });
});

describe("grid selection", () => {
  // 5 tokens, 3 columns: [0 1 2] [3 4]
  it("wraps within a row and clamps vertically", () => {
    expect(moveSelection(0, 5, 3, "left")).toBe(2);
    expect(moveSelection(2, 5, 3, "right")).toBe(0);
    expect(moveSelection(4, 5, 3, "right")).toBe(3);
    expect(moveSelection(1, 5, 3, "down")).toBe(4);
    expect(moveSelection(2, 5, 3, "down")).toBe(2);
    expect(moveSelection(4, 5, 3, "up")).toBe(1);
    expect(moveSelection(0, 5, 3, "up")).toBe(0);
  });

  it("handles empty and out-of-range input", () => {
    expect(moveSelection(0, 0, 3, "right")).toBe(-1);
    expect(moveSelection(99, 5, 3, "left")).toBe(3);
  });
});
