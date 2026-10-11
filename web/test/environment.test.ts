import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { POST, postProblems } from "../../src/world/post.ts";
import { merged } from "../src/assets/WorldPropKit.ts";
import { clearOfEntrance, entranceClearance } from "../src/pure/scatter.ts";

describe("merged", () => {
  it("drops uvs when any part lacks them instead of failing", () => {
    const noUv = new THREE.IcosahedronGeometry(1, 1);
    noUv.deleteAttribute("uv");
    const out = merged([new THREE.BoxGeometry(1, 1, 1), noUv]);
    expect(out.attributes.uv).toBeUndefined();
    expect(out.attributes.position?.count).toBeGreaterThan(0);
  });

  it("keeps uvs when every part has them", () => {
    const out = merged([new THREE.BoxGeometry(1, 1, 1), new THREE.BoxGeometry(2, 1, 1)]);
    expect(out.attributes.uv).toBeDefined();
  });
});

describe("entrance clearance", () => {
  const bounds = { x: 0, z: 0, w: 60, d: 60 };
  const at = (x: number, z: number) => ({
    family: "tree",
    position: [x, 0, z] as [number, number, number],
    rotation: 0,
    scale: 1,
  });

  it("removes props near the entrance and keeps the rest", () => {
    const kept = clearOfEntrance([at(2, 2), at(30, 30)], [0, 0, 0], bounds);
    expect(kept.map((p) => p.position[0])).toEqual([30]);
  });

  it("shrinks in small rooms", () => {
    expect(entranceClearance({ x: 0, z: 0, w: 24, d: 24 })).toBeLessThan(5);
    expect(entranceClearance(bounds)).toBe(7);
  });
});

describe("biome wind and clouds", () => {
  it("are still indoors and valid everywhere", () => {
    expect(POST.industrial.wind).toBe(0);
    expect(POST.dungeon.clouds).toBe(0);
    for (const p of Object.values(POST)) expect(postProblems({ ...p })).toEqual([]);
  });
});

describe("buildMotes", () => {
  it("builds nothing at zero or missing density and is deterministic otherwise", async () => {
    const { buildMotes } = await import("../src/assets/Motes.ts");
    const { BIOMES } = await import("../../src/world/biome.ts");
    const none = { ...BIOMES.MEADOW, post: { ...POST.meadow, motes: 0 } };
    expect(buildMotes(none)).toBeNull();
    const old = { ...BIOMES.MEADOW, post: { ...POST.meadow, motes: undefined } };
    expect(buildMotes(old as unknown as typeof none)).toBeNull();
    const half = { ...BIOMES.MEADOW, post: { ...POST.meadow, motes: 0.5 } };
    const a = buildMotes(half);
    const b = buildMotes(half);
    expect(a?.geometry.attributes.seed?.count).toBe(300);
    expect(Array.from(a?.geometry.attributes.seed?.array ?? [])).toEqual(
      Array.from(b?.geometry.attributes.seed?.array ?? []),
    );
  });
});
