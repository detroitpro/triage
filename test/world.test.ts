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
