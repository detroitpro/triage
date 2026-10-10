import { describe, expect, it } from "vitest";
import type { Door } from "../../src/world/types.ts";
import {
  cycleTile,
  HUB_TILE_ID,
  layoutMap,
  type MapSource,
  pickInDirection,
  worldExtent,
} from "../src/pure/mapLayout.ts";

const doors: Door[] = [
  {
    id: "auth->secrets",
    from: "auth",
    to: "secrets",
    kind: "door",
    position: [50, 0, 14],
    facing: 0,
    edgeType: "blocks",
    locked: { by: 9, title: "x" },
  },
  {
    id: "auth->billing",
    from: "auth",
    to: "billing",
    kind: "portal",
    position: [32, 0, 8],
    facing: 0,
    edgeType: "functional",
  },
  {
    id: "auth->nowhere",
    from: "auth",
    to: "missing",
    kind: "door",
    position: [32, 0, 8],
    facing: 0,
    edgeType: "functional",
  },
];

const src: MapSource = {
  hub: { bounds: { x: -12, z: -12, w: 24, d: 24 } },
  regions: [
    { id: "auth", label: "Sign-in", bounds: { x: 30, z: -16, w: 40, d: 32 } },
    { id: "billing", label: "Billing", bounds: { x: -70, z: -15, w: 36, d: 30 } },
    { id: "secrets", label: "Secrets", bounds: { x: -20, z: 30, w: 40, d: 30 } },
  ],
  doors,
};

describe("worldExtent", () => {
  it("unions every area rectangle", () => {
    expect(worldExtent(src)).toEqual({ x: -70, z: -16, w: 140, d: 76 });
  });
  it("never collapses to zero size", () => {
    const e = worldExtent({ hub: { bounds: { x: 0, z: 0, w: 0, d: 0 } }, regions: [], doors: [] });
    expect(e.w).toBeGreaterThan(0);
    expect(e.d).toBeGreaterThan(0);
  });
});

describe("layoutMap", () => {
  const layout = layoutMap(src, 800, 500, 20);

  it("keeps every tile inside the padded canvas", () => {
    for (const t of layout.tiles) {
      expect(t.x).toBeGreaterThanOrEqual(20 - 1e-6);
      expect(t.y).toBeGreaterThanOrEqual(20 - 1e-6);
      expect(t.x + t.w).toBeLessThanOrEqual(780 + 1e-6);
      expect(t.y + t.h).toBeLessThanOrEqual(480 + 1e-6);
    }
  });
  it("preserves relative world positions (billing left of hub, secrets below)", () => {
    const by = Object.fromEntries(layout.tiles.map((t) => [t.id, t]));
    expect(by[HUB_TILE_ID]?.label).toBe("Hub");
    expect(by.billing?.cx).toBeLessThan(by[HUB_TILE_ID]?.cx ?? 0);
    expect(by.auth?.cx).toBeGreaterThan(by[HUB_TILE_ID]?.cx ?? 0);
    expect(by.secrets?.cy).toBeGreaterThan(by[HUB_TILE_ID]?.cy ?? 0);
  });
  it("sizes tiles by world bounds with one uniform scale", () => {
    const by = Object.fromEntries(layout.tiles.map((t) => [t.id, t]));
    expect(by.auth?.w).toBeCloseTo(40 * layout.scale);
    expect(by.hub?.h).toBeCloseTo(24 * layout.scale);
  });
  it("links doors from their position to the target tile center and drops dangling ones", () => {
    expect(layout.links.map((l) => l.id)).toEqual(["auth->secrets", "auth->billing"]);
    const lock = layout.links.find((l) => l.id === "auth->secrets");
    const secrets = layout.tiles.find((t) => t.id === "secrets");
    expect(lock?.locked).toBe(true);
    expect(lock?.x2).toBeCloseTo(secrets?.cx ?? -1);
    expect(lock?.y2).toBeCloseTo(secrets?.cy ?? -1);
    expect(layout.links.find((l) => l.id === "auth->billing")?.kind).toBe("portal");
  });
});

describe("keyboard selection", () => {
  const { tiles } = layoutMap(src, 800, 500, 20);
  it("moves spatially with arrows", () => {
    expect(pickInDirection(tiles, HUB_TILE_ID, "right")).toBe("auth");
    expect(pickInDirection(tiles, HUB_TILE_ID, "left")).toBe("billing");
    expect(pickInDirection(tiles, HUB_TILE_ID, "down")).toBe("secrets");
    expect(pickInDirection(tiles, "auth", "right")).toBeNull();
  });
  it("starts at the first tile when nothing is selected", () => {
    expect(pickInDirection(tiles, null, "up")).toBe(HUB_TILE_ID);
  });
  it("cycles in list order and wraps", () => {
    expect(cycleTile(tiles, HUB_TILE_ID, 1)).toBe("auth");
    expect(cycleTile(tiles, "secrets", 1)).toBe(HUB_TILE_ID);
    expect(cycleTile(tiles, HUB_TILE_ID, -1)).toBe("secrets");
    expect(cycleTile([], null, 1)).toBeNull();
  });
});
