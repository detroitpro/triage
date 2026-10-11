import { describe, expect, it } from "vitest";
import type { Door } from "../../src/world/types.ts";
import { bearingTo, compassMarks, relativeBearing, wrapAngle } from "../src/pure/compass.ts";

const door = (id: string, position: Door["position"], extra: Partial<Door> = {}): Door => ({
  id,
  from: "a",
  to: id,
  kind: "door",
  position,
  facing: 0,
  edgeType: "depends-on",
  ...extra,
});

describe("bearings", () => {
  it("wraps into [-π, π]", () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
    expect(wrapAngle(0.3)).toBeCloseTo(0.3);
  });
  it("yaw 0 faces -Z; +X is to the right (negative yaw)", () => {
    expect(bearingTo([0, 0, 0], [0, 0, -5])).toBeCloseTo(0);
    expect(bearingTo([0, 0, 0], [5, 0, 0])).toBeCloseTo(-Math.PI / 2);
  });
  it("relative bearing is positive to the right of the view", () => {
    expect(relativeBearing(0, [0, 0, 0], [5, 0, 0])).toBeCloseTo(Math.PI / 2);
    expect(relativeBearing(0, [0, 0, 0], [-5, 0, 0])).toBeCloseTo(-Math.PI / 2);
    expect(relativeBearing(Math.PI / 2, [0, 0, 0], [-5, 0, 0])).toBeCloseTo(0);
  });
});

describe("compassMarks", () => {
  it("puts north at the center when facing -Z and east on the right edge", () => {
    const marks = compassMarks({ yaw: 0, player: [0, 0, 0], doors: [], width: 400 });
    const n = marks.find((m) => m.label === "N");
    const e = marks.find((m) => m.label === "E");
    const w = marks.find((m) => m.label === "W");
    expect(n?.x).toBeCloseTo(200);
    expect(e?.x).toBeCloseTo(400);
    expect(w?.x).toBeCloseTo(0);
    expect(marks.find((m) => m.label === "S")).toBeUndefined();
  });
  it("places a door ahead-right between center and the edge, and pins ones behind", () => {
    const ahead = door("ahead", [2, 0, -10]);
    const behind = door("behind", [0, 0, 10], { locked: { by: 1, title: "x" } });
    const marks = compassMarks({ yaw: 0, player: [0, 0, 0], doors: [ahead, behind], width: 400 });
    const a = marks.find((m) => m.id === "ahead");
    const b = marks.find((m) => m.id === "behind");
    expect(a?.x).toBeGreaterThan(200);
    expect(a?.x).toBeLessThan(260);
    expect(a?.clamped).toBe(false);
    expect(b?.clamped).toBe(true);
    expect(b?.locked).toBe(true);
    expect(a?.distance).toBeCloseTo(Math.hypot(2, 10));
  });
  it("labels doors through labelFor and sorts far doors first so near ones draw on top", () => {
    const near = door("near", [0, 0, -2]);
    const far = door("far", [0, 0, -20]);
    const marks = compassMarks({
      yaw: 0,
      player: [0, 0, 0],
      doors: [near, far],
      width: 400,
      labelFor: (d) => d.id.toUpperCase(),
    }).filter((m) => m.kind !== "cardinal");
    expect(marks.map((m) => m.label)).toEqual(["FAR", "NEAR"]);
  });
});
