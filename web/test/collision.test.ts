import { describe, expect, it } from "vitest";
import { clampToBounds, distanceXZ, EYE_HEIGHT, insideBounds } from "../src/pure/collision.ts";

const bounds = { x: 10, z: -5, w: 20, d: 10 };

describe("clampToBounds", () => {
  it("leaves an inside position alone", () => {
    expect(clampToBounds([15, EYE_HEIGHT, 0], bounds)).toEqual([15, EYE_HEIGHT, 0]);
  });
  it("pushes the player back inside the walls by the radius", () => {
    const [x, , z] = clampToBounds([100, EYE_HEIGHT, -100], bounds, 0.5);
    expect(x).toBe(29.5);
    expect(z).toBe(-4.5);
  });
  it("never lets the player fall through the floor", () => {
    expect(clampToBounds([15, -3, 0], bounds)[1]).toBe(EYE_HEIGHT);
  });
  it("is pure", () => {
    const pos: [number, number, number] = [0, 0, 0];
    clampToBounds(pos, bounds);
    expect(pos).toEqual([0, 0, 0]);
  });
});

describe("helpers", () => {
  it("insideBounds and distanceXZ ignore height", () => {
    expect(insideBounds([12, 99, -4], bounds)).toBe(true);
    expect(insideBounds([9, 0, 0], bounds)).toBe(false);
    expect(distanceXZ([0, 0, 0], [3, 50, 4])).toBe(5);
  });
});
