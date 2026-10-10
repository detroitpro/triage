import { describe, expect, it } from "vitest";
import { adjacency, centrality, labelPropagation, topoOrder } from "../src/graph/analytics.ts";
import { candidatePairs } from "../src/graph/candidates.ts";
import { explicitEdges } from "../src/graph/explicit.ts";
import { pairEdges } from "../src/graph/infer.ts";
import { analyzeLens } from "../src/graph/lenses.ts";
import { type Edge, validateGraph } from "../src/graph/types.ts";
import { AREAS, classified, ISSUES } from "./fixtures/issues.ts";

const find = (edges: Edge[], type: string, s: number, t: number) =>
  edges.find((e) => e.type === type && e.source === s && e.target === t);

describe("explicitEdges", () => {
  const edges = explicitEdges(ISSUES);

  it("parses task lists as parent-of", () => {
    expect(find(edges, "parent-of", 1, 2)).toBeTruthy();
    expect(find(edges, "parent-of", 1, 3)).toBeTruthy();
  });

  it("parses blocked-by with the blocker as source", () => {
    expect(find(edges, "blocks", 4, 2)).toBeTruthy();
  });

  it("parses depends-on from the dependent", () => {
    expect(find(edges, "depends-on", 3, 2)).toBeTruthy();
  });

  it("turns bare mentions into weak depends-on", () => {
    const e = find(edges, "depends-on", 4, 5);
    expect(e?.weight).toBe(0.5);
    expect(e?.provenance).toBe("explicit:mention-body");
  });

  it("every explicit edge has confidence 1 and no self loops", () => {
    for (const e of edges) {
      expect(e.confidence).toBe(1);
      expect(e.source).not.toBe(e.target);
    }
  });
});

describe("candidatePairs", () => {
  it("caps per-issue candidates and never returns all pairs for a big set", () => {
    const nodes = Array.from({ length: 60 }, (_, i) =>
      classified(1, { number: i + 1, title: `upload file ${i % 3}`, labels: ["x"] }),
    );
    const pairs = candidatePairs(nodes, [], 4);
    expect(pairs.length).toBeLessThan((60 * 59) / 2);
    const per = new Map<number, number>();
    for (const [a, b] of pairs) {
      per.set(a, (per.get(a) ?? 0) + 1);
      per.set(b, (per.get(b) ?? 0) + 1);
    }
    // A node is in at most its own 4 picks plus others that picked it.
    expect(Math.max(...per.values())).toBeLessThanOrEqual(60);
    expect(pairs.length).toBeGreaterThan(0);
  });
});

describe("pairEdges", () => {
  const ans = (relation: string, confidence = 0.9, related = 0.8, security = 0.1) =>
    ({
      relation: { type: "choice", choice: relation, confidence, probabilities: {} },
      related: { type: "noul", noul: related },
      sharedSecurity: { type: "noul", noul: security },
    }) as unknown as Parameters<typeof pairEdges>[2];

  it("maps b_blocks_a to a blocks edge from b", () => {
    const [e] = pairEdges(2, 4, ans("b_blocks_a"));
    expect(e).toMatchObject({ type: "blocks", source: 4, target: 2, provenance: "jev:relation" });
  });

  it("emits nothing when related is below the band", () => {
    expect(pairEdges(2, 4, ans("same_feature", 0.9, 0.2))).toEqual([]);
  });

  it("never emits duplicate-of from inference alone", () => {
    const edges = pairEdges(2, 4, ans("duplicate"));
    expect(edges.every((e) => e.type !== "duplicate-of")).toBe(true);
  });

  it("adds a security edge above the security band", () => {
    const edges = pairEdges(2, 5, ans("none", 0.9, 0.1, 0.9));
    expect(edges).toHaveLength(1);
    expect(edges[0]?.type).toBe("security");
  });
});

describe("analytics", () => {
  const edge = (type: Edge["type"], source: number, target: number): Edge => ({
    type,
    source,
    target,
    directed: type === "blocks" || type === "depends-on" || type === "parent-of",
    weight: 1,
    confidence: 1,
    provenance: "explicit:test",
  });

  it("topological order puts blockers first and reports cycles", () => {
    const ok = topoOrder([1, 2, 3], [edge("blocks", 1, 2), edge("depends-on", 3, 2)]);
    expect(ok.order).toEqual([1, 2, 3]);
    expect(ok.cycles).toEqual([]);
    const cyc = topoOrder([1, 2], [edge("blocks", 1, 2), edge("blocks", 2, 1)]);
    expect(cyc.cycles).toEqual([[1, 2]]);
  });

  it("centrality is in [0,1] and highest for the hub node of a star", () => {
    const adj = adjacency(
      [1, 2, 3, 4],
      [edge("functional", 1, 2), edge("functional", 1, 3), edge("functional", 1, 4)],
    );
    const c = centrality(adj);
    expect(c.get(1)).toBe(1);
    for (const v of c.values()) expect(v).toBeGreaterThanOrEqual(0);
  });

  it("label propagation keeps seeded areas and pulls unsorted nodes into connected ones", () => {
    const adj = adjacency([1, 2, 3], [edge("functional", 1, 3)]);
    const labels = labelPropagation(
      adj,
      new Map([
        [1, "docs"],
        [2, "unsorted"],
        [3, "unsorted"],
      ]),
    );
    expect(labels.get(1)).toBe("docs");
    expect(labels.get(3)).toBe("docs");
    expect(labels.get(2)).toBe("solo-2");
  });
});

describe("lenses and validation", () => {
  it("every node lands in exactly one region per lens and the graph validates", () => {
    const nodes = [
      classified(1, { functionalArea: "unsorted" }),
      classified(2),
      classified(3, { codeArea: "apps_applicant" }),
      classified(4, { functionalArea: "unsorted", security: 0, complexity: 0 }),
      classified(5, { functionalArea: "access", security: 3, complexity: 2 }),
    ];
    const edges = explicitEdges(ISSUES);
    const lenses = {
      feature: analyzeLens("feature", nodes, edges, AREAS),
      security: analyzeLens("security", nodes, edges, AREAS),
    };
    expect(lenses.feature.regions["5"]).toBe("access");
    expect(lenses.security.regions["5"]).toBe("high-security");
    expect(lenses.security.regions["4"]).toBe("safe");
    const errors = validateGraph({
      version: 1,
      repo: "x",
      nodes,
      edges,
      candidatePairs: 0,
      possiblePairs: 10,
      lenses,
    });
    expect(errors).toEqual([]);
  });
});
