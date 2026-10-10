import { describe, expect, it } from "vitest";
import {
  contrast,
  ensureLuminous,
  luminance,
  mix,
  parseHex,
  readableOn,
  themeVars,
  toHex,
} from "../src/pure/theme.ts";

describe("color math", () => {
  it("parses 6 and 3 digit hex, falls back to grey", () => {
    expect(parseHex("#ff5e3a")).toEqual([255, 94, 58]);
    expect(parseHex("abc")).toEqual([170, 187, 204]);
    expect(parseHex("nope")).toEqual([128, 128, 128]);
  });
  it("round-trips through toHex", () => {
    expect(toHex(parseHex("#8ecbff"))).toBe("#8ecbff");
  });
  it("mixes linearly and clamps t", () => {
    expect(mix([0, 0, 0], [100, 200, 50], 0.5)).toEqual([50, 100, 25]);
    expect(mix([0, 0, 0], [100, 200, 50], 2)).toEqual([100, 200, 50]);
  });
  it("luminance orders black < grey < white", () => {
    expect(luminance([0, 0, 0])).toBe(0);
    expect(luminance([255, 255, 255])).toBeCloseTo(1);
    expect(luminance([128, 128, 128])).toBeGreaterThan(0.1);
  });
  it("picks dark ink on a bright accent and light ink on a dark one", () => {
    expect(readableOn([242, 201, 76])).toEqual([13, 16, 22]);
    expect(readableOn([30, 20, 40])).toEqual([244, 246, 248]);
  });
  it("lifts dark colors until they read on the panel", () => {
    const lifted = ensureLuminous([75, 59, 92], 0.3);
    expect(luminance(lifted)).toBeGreaterThanOrEqual(0.3);
    expect(ensureLuminous([255, 255, 255], 0.3)).toEqual([255, 255, 255]);
  });
});

describe("themeVars", () => {
  const meadow = {
    sky: "#8ecbff",
    palette: { ground: "#6cbf4a", wall: "#9fd37a", accent: "#f2c94c" },
  };
  const dungeon = {
    sky: "#07060a",
    palette: { ground: "#2a2630", wall: "#1a1620", accent: "#ff5e3a" },
  };
  it("emits every variable the stylesheet relies on", () => {
    const v = themeVars(meadow);
    for (const k of ["--accent", "--accent-ink", "--panel", "--edge", "--sky", "--ground", "--fg"])
      expect(v[k]).toBeDefined();
  });
  it("tints the panel from the sky so biomes read differently", () => {
    expect(themeVars(meadow)["--panel-solid"]).not.toBe(themeVars(dungeon)["--panel-solid"]);
  });
  it("keeps the panel dark enough for light text in every biome", () => {
    for (const src of [meadow, dungeon]) {
      const panel = parseHex(themeVars(src)["--panel-solid"] ?? "#000");
      expect(contrast(panel, [244, 246, 248])).toBeGreaterThan(7);
    }
  });
  it("accent text reads on the panel", () => {
    const village = {
      sky: "#d9b98a",
      palette: { ground: "#a98a62", wall: "#c9a97c", accent: "#5b7fb5" },
    };
    const v = themeVars(village);
    const panel = parseHex(v["--panel-solid"] ?? "#000");
    const accent = parseHex(v["--accent"] ?? "#fff");
    expect(contrast(panel, accent)).toBeGreaterThan(3);
  });
});
