import { describe, expect, it } from "vitest";
import { FAR, LABEL, lodFor, NEAR } from "../src/pure/lod.ts";

describe("lodFor", () => {
  it("draws close NPCs in full and distant ones from the instanced crowd", () => {
    expect(lodFor(NEAR - 1, undefined).detail).toBe("near");
    expect(lodFor(FAR + 1, undefined).detail).toBe("far");
  });

  it("does not flicker on the boundary", () => {
    const between = (NEAR + FAR) / 2;
    expect(lodFor(between, { detail: "near", label: true }).detail).toBe("near");
    expect(lodFor(between, { detail: "far", label: true }).detail).toBe("far");
  });

  it("keeps ghosted NPCs near so their per-mesh materials show", () => {
    expect(lodFor(100, undefined, true).detail).toBe("near");
  });

  it("hides labels past reading distance", () => {
    expect(lodFor(LABEL - 1, undefined).label).toBe(true);
    expect(lodFor(LABEL + 1, undefined).label).toBe(false);
  });
});

describe("label hysteresis", () => {
  it("does not flicker around the label distance", () => {
    let lod = lodFor(LABEL - 1, undefined);
    let flips = 0;
    for (let i = 0; i < 60; i++) {
      const next = lodFor(i % 2 ? LABEL - 0.3 : LABEL + 0.3, lod);
      if (next.label !== lod.label) flips++;
      lod = next;
    }
    expect(flips).toBeLessThanOrEqual(1);
  });
});
