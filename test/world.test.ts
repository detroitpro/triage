import { describe, expect, it } from "vitest";
import { explicitEdges } from "../src/graph/explicit.ts";
import { analyzeLens, LENSES } from "../src/graph/lenses.ts";
import type { GraphFile } from "../src/graph/types.ts";
import { stableJson } from "../src/io.ts";
import { biomeFor } from "../src/world/biome.ts";
import { buildWorld, validateWorld } from "../src/world/build.ts";
import { AREAS, classified, ISSUES } from "./fixtures/issues.ts";

function graph(): GraphFile {
  const nodes = [
    classified(1),
    classified(2),
    classified(3),
    classified(4, { functionalArea: "access", security: 2 }),
    classified(5, { functionalArea: "access", security: 3, complexity: 2 }),
  ];
  const edges = explicitEdges(ISSUES);
  const lenses: GraphFile["lenses"] = {};
  for (const l of LENSES) lenses[l] = analyzeLens(l, nodes, edges, AREAS);
  return { version: 1, repo: "x", nodes, edges, candidatePairs: 0, possiblePairs: 10, lenses };
}

describe("biomeFor", () => {
  it("follows the charter table", () => {
    expect(biomeFor(0, 0, "bug").name).toBe("sunlit meadow");
    expect(biomeFor(1.2, 0, "bug").name).toBe("village workshop");
    expect(biomeFor(2.1, 0.5, "feature").name).toBe("industrial complex");
    expect(biomeFor(0.5, 2.5, "bug").name).toBe("dungeon");
  });
});

describe("buildWorld", () => {
  it("is deterministic and valid for every lens", () => {
    const g = graph();
    for (const lens of LENSES) {
      const a = buildWorld(g, lens, [...LENSES]);
      const b = buildWorld(g, lens, [...LENSES]);
      expect(stableJson(a)).toBe(stableJson(b));
      expect(validateWorld(a)).toEqual([]);
    }
  });

  it("gives the high-security region a dungeon and locks doors on blocks edges", () => {
    const w = buildWorld(graph(), "feature", [...LENSES]);
    const access = w.regions.find((r) => r.id === "access");
    expect(access?.biome.enclosure).toBe("dungeon");
    const locked = w.doors.filter((d) => d.locked);
    // #4 (access) blocks #2 (documents): the door into documents from unsorted is locked by #4.
    expect(locked.some((d) => d.locked?.by === 4 && d.to === "documents")).toBe(true);
  });

  it("builds at most one door each way per region pair", () => {
    const w = buildWorld(graph(), "feature", [...LENSES]);
    const seen = new Map<string, number>();
    for (const d of w.doors) {
      if (d.kind !== "door") continue;
      const k = `${d.from}->${d.to}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    for (const n of seen.values()) expect(n).toBe(1);
  });

  it("closing one issue moves nothing else", () => {
    const g = graph();
    const before = buildWorld(g, "feature", [...LENSES]);
    g.nodes = g.nodes.filter((n) => n.number !== 3);
    g.edges = g.edges.filter((e) => e.source !== 3 && e.target !== 3);
    for (const l of LENSES) g.lenses[l] = analyzeLens(l, g.nodes, g.edges, AREAS);
    const after = buildWorld(g, "feature", [...LENSES]);
    const pos = (w: typeof before, n: number) =>
      w.regions.flatMap((r) => r.placements).find((p) => p.issue === n)?.position;
    for (const n of [1, 2, 4, 5]) expect(pos(after, n)).toEqual(pos(before, n));
  });
});

describe("biome post", () => {
  it("gives every biome a finishing pass, darker biomes more vignette and bloom", () => {
    const meadow = biomeFor(0, 0, "bug").post;
    const dungeon = biomeFor(0.5, 2.5, "bug").post;
    expect(meadow && dungeon).toBeTruthy();
    expect(dungeon?.vignette ?? 0).toBeGreaterThan(meadow?.vignette ?? 1);
    expect(dungeon?.bloom ?? 0).toBeGreaterThan(meadow?.bloom ?? 1);
  });
});

describe("post validation", () => {
  it("flags out-of-range post values", async () => {
    const { postProblems, POST } = await import("../src/world/post.ts");
    expect(postProblems({ ...POST.meadow })).toEqual([]);
    expect(postProblems({ ...POST.meadow, environment: 2, warmth: Number.NaN }).length).toBe(2);
  });
});

describe("post validation, missing and out-of-range keys", () => {
  it("flags a missing motes value and an out-of-range one", async () => {
    const { postProblems, POST } = await import("../src/world/post.ts");
    const { motes: _drop, ...old } = POST.meadow;
    expect(postProblems(old as typeof POST.meadow).join()).toMatch(/motes is missing/);
    expect(postProblems({ ...POST.meadow, motes: 1.5 })).toHaveLength(1);
  });
});
