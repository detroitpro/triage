import { describe, expect, it } from "vitest";
import { DynamicResolution, detectTier, resolveTier, TARGET_MS } from "../src/pure/quality.ts";

describe("detectTier", () => {
  it("puts integrated, mobile, and software GPUs on low", () => {
    expect(detectTier("ANGLE (Intel, Mesa Intel(R) Graphics (RKL GT1), OpenGL ES 3.2)")).toBe(
      "low",
    );
    expect(detectTier("Mali-G78")).toBe("low");
    expect(detectTier("Google SwiftShader")).toBe("low");
    expect(detectTier(null)).toBe("low");
  });

  it("puts discrete GPUs on high", () => {
    expect(detectTier("ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)")).toBe(
      "high",
    );
    expect(detectTier("ANGLE (AMD, AMD Radeon RX 7800 XT)")).toBe("high");
  });

  it("lets the player override auto", () => {
    expect(resolveTier("high", "Intel UHD")).toBe("high");
    expect(resolveTier("low", "NVIDIA")).toBe("low");
    expect(resolveTier("auto", "NVIDIA")).toBe("high");
  });
});

/** Run `seconds` of frames at a cost that depends on the current scale. */
function run(dr: DynamicResolution, seconds: number, cost: (scale: number) => number): void {
  let t = 0;
  while (t < seconds) {
    // vsync: a frame shows at 16.7 ms when it fits, else at the next multiple.
    const ms = Math.ceil(cost(dr.scale) / TARGET_MS) * TARGET_MS;
    dr.update(ms);
    t += ms / 1000;
  }
}

describe("DynamicResolution", () => {
  it("drops scale until frames fit the budget", () => {
    const dr = new DynamicResolution(0.6, 1);
    // Cost scales with pixel count: 22 ms at full scale, fits at about 0.85.
    run(dr, 10, (s) => 22 * s * s);
    expect(dr.scale).toBeLessThan(0.9);
    expect(22 * dr.scale * dr.scale).toBeLessThanOrEqual(TARGET_MS);
  });

  it("never goes below its minimum", () => {
    const dr = new DynamicResolution(0.6, 1);
    // Pixel-bound and still over budget at the floor.
    run(dr, 20, (sc) => 60 * sc * sc);
    expect(dr.scale).toBe(0.6);
  });

  it("goes back to full scale when lowering it does not help (CPU-bound)", () => {
    const dr = new DynamicResolution(0.6, 1);
    run(dr, 20, () => 25);
    expect(dr.scale).toBe(1);
  });

  it("stays at full scale when there is headroom", () => {
    const dr = new DynamicResolution(0.6, 1);
    run(dr, 20, () => 8);
    expect(dr.scale).toBe(1);
  });

  it("probes back up after load drops, and backs off from a probe that fails", () => {
    const dr = new DynamicResolution(0.6, 1);
    run(dr, 6, (sc) => 100 * sc * sc);
    expect(dr.scale).toBe(0.6);
    run(dr, 60, () => 8);
    expect(dr.scale).toBe(1);
    // At the edge: 0.8 fits, 0.85 does not. It must settle, not oscillate every few seconds.
    const changes: number[] = [];
    const dr2 = new DynamicResolution(0.6, 1);
    let last = dr2.scale;
    let t = 0;
    while (t < 120) {
      const ms = Math.ceil((dr2.scale <= 0.8 ? 14 : 20) / TARGET_MS) * TARGET_MS;
      dr2.update(ms);
      t += ms / 1000;
      if (dr2.scale !== last) changes.push(t);
      last = dr2.scale;
    }
    expect(dr2.scale).toBeLessThanOrEqual(0.85);
    const late = changes.filter((c) => c > 60).length;
    expect(late).toBeLessThanOrEqual(4);
  });

  it("ignores stalls", () => {
    const dr = new DynamicResolution(0.6, 1);
    for (let i = 0; i < 10; i++) dr.update(400);
    expect(dr.scale).toBe(1);
  });
});

describe("tier and refresh edge cases", () => {
  it("treats Intel Arc as discrete and Apple mobile GPUs as low", () => {
    expect(detectTier("ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11)")).toBe("high");
    expect(detectTier("Apple GPU")).toBe("low");
  });

  it("does not sit at the floor on a display capped at 30 fps", () => {
    const dr = new DynamicResolution(0.6, 1);
    for (let i = 0; i < 600; i++) dr.update(33.4);
    expect(dr.scale).toBe(1);
  });

  it("starts each area at full scale", () => {
    const dr = new DynamicResolution(0.6, 1);
    let ms = 40;
    for (let i = 0; i < 300; i++) {
      dr.update(ms);
      ms = 40 * dr.scale * dr.scale;
    }
    expect(dr.scale).toBeLessThan(1);
    dr.reset();
    expect(dr.scale).toBe(1);
  });
});
