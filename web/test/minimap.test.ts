import { describe, expect, it } from "vitest";
import { fitProjection, headingTriangle, project } from "../src/pure/minimap.ts";

describe("minimap projection", () => {
  const bounds = { x: 30, z: -16, w: 40, d: 32 };
  const proj = fitProjection(bounds, 220, 170, 10);

  it("fits the region inside the canvas with padding", () => {
    const [x0, y0] = project(proj, [bounds.x, bounds.z]);
    const [x1, y1] = project(proj, [bounds.x + bounds.w, bounds.z + bounds.d]);
    expect(x0).toBeGreaterThanOrEqual(10);
    expect(y0).toBeGreaterThanOrEqual(10);
    expect(x1).toBeLessThanOrEqual(210);
    expect(y1).toBeLessThanOrEqual(160);
  });

  it("preserves aspect ratio and centers", () => {
    expect(proj.scale).toBeCloseTo(Math.min(200 / 40, 150 / 32));
    const [cx, cy] = project(proj, [bounds.x + bounds.w / 2, 0, bounds.z + bounds.d / 2]);
    expect(cx).toBeCloseTo(110);
    expect(cy).toBeCloseTo(85);
  });

  it("heading triangle tip points up for yaw 0 (looking down -Z)", () => {
    const [tip] = headingTriangle([50, 50], 0, 10);
    expect(tip[0]).toBeCloseTo(50);
    expect(tip[1]).toBeCloseTo(40);
  });

  it("heading triangle tip points left for yaw +90deg", () => {
    const [tip] = headingTriangle([50, 50], Math.PI / 2, 10);
    expect(tip[0]).toBeCloseTo(40);
    expect(tip[1]).toBeCloseTo(50);
  });
});
