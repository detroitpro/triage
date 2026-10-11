import { describe, expect, it } from "vitest";
import { SHADOW_HALF, SHADOW_STEP, shadowCenter } from "../src/assets/LightingRig.ts";

describe("shadowCenter", () => {
  it("fixes the map on the centre of an area that fits, wherever the player stands", () => {
    const small = { x: -20, z: 10, w: 41, d: 41 };
    expect(shadowCenter(small, -18, 12)).toEqual([0.5, 30.5]);
    expect(shadowCenter(small, 19, 49)).toEqual([0.5, 30.5]);
  });

  it("snaps to a grid in large areas so the map only moves between cells", () => {
    const big = { x: 0, z: 0, w: 144, d: 144 };
    expect(shadowCenter(big, 10, 10)).toEqual(shadowCenter(big, 11.9, 11.9));
    expect(shadowCenter(big, 10, 10)).not.toEqual(shadowCenter(big, 13, 10));
  });

  it("keeps the player well inside the map in large areas", () => {
    const big = { x: 0, z: 0, w: 144, d: 144 };
    for (let x = 0; x <= 144; x += 1.3) {
      const [cx, cz] = shadowCenter(big, x, 144 - x);
      expect(Math.abs(cx - x)).toBeLessThanOrEqual(SHADOW_STEP / 2);
      expect(Math.abs(cz - (144 - x))).toBeLessThanOrEqual(SHADOW_STEP / 2);
      expect(SHADOW_HALF - SHADOW_STEP / 2).toBeGreaterThan(20);
    }
  });
});
