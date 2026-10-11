import { describe, expect, it } from "vitest";
import { scatterProps } from "../src/pure/scatter.ts";

const base = {
  regionId: "auth",
  issues: [3, 7, 9],
  bounds: { x: 0, z: 0, w: 40, d: 30 },
  families: ["tree", "flower", "torch"],
  avoid: [[20, 0, 15] as [number, number, number]],
};

describe("scatterProps", () => {
  it("is deterministic for the same input regardless of issue order", () => {
    const a = scatterProps(base);
    const b = scatterProps({ ...base, issues: [9, 3, 7] });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("changes when the issue set changes", () => {
    const a = scatterProps(base);
    const b = scatterProps({ ...base, issues: [3, 7, 9, 11] });
    expect(a).not.toEqual(b);
  });

  it("keeps props inside bounds and out of the clearance circle", () => {
    for (const p of scatterProps({ ...base, clearance: 3 })) {
      expect(p.position[0]).toBeGreaterThanOrEqual(0);
      expect(p.position[0]).toBeLessThanOrEqual(40);
      expect(p.position[2]).toBeGreaterThanOrEqual(0);
      expect(p.position[2]).toBeLessThanOrEqual(30);
      expect(Math.hypot(p.position[0] - 20, p.position[2] - 15)).toBeGreaterThanOrEqual(3);
      expect(base.families).toContain(p.family);
    }
  });

  it("returns nothing when the biome lists no props", () => {
    expect(scatterProps({ ...base, families: [] })).toEqual([]);
  });
});
