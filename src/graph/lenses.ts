// A lens is a partition of the same nodes plus the edge subset that counts for it.
import type { ClassifiedIssue } from "../classify/index.ts";
import type { AreasFile } from "../interrogate/index.ts";
import { THRESHOLDS } from "../questions.ts";
import { adjacency, bridges, centrality, labelPropagation, topoOrder } from "./analytics.ts";
import type { Edge, EdgeType, LensAnalysis } from "./types.ts";

export const LENSES = ["feature", "code", "security", "complexity", "journey"] as const;
export type LensName = (typeof LENSES)[number];

interface LensDef {
  seed: (n: ClassifiedIssue) => string;
  label: (key: string, areas: AreasFile) => string;
  edgeTypes: EdgeType[];
  /** Whether label propagation may move a node away from its seed. */
  propagate: boolean;
}

const sec = (n: ClassifiedIssue) =>
  n.security >= THRESHOLDS.highSecurity ? "high-security" : n.security >= 1 ? "sensitive" : "safe";
const cx = (n: ClassifiedIssue) =>
  n.complexity >= 2.5
    ? "architectural"
    : n.complexity >= THRESHOLDS.highComplexity
      ? "multi-module"
      : n.complexity >= 1
        ? "contained"
        : "trivial";

const LENS_DEFS: Record<LensName, LensDef> = {
  feature: {
    seed: (n) => n.functionalArea,
    label: (k, a) => a.functional.find((x) => x.key === k)?.label ?? k,
    edgeTypes: ["functional", "user-journey", "blocks", "depends-on", "parent-of"],
    propagate: true,
  },
  code: {
    seed: (n) => n.codeArea,
    label: (k, a) => a.code.find((x) => x.key === k)?.label ?? k,
    edgeTypes: ["same-code-path", "blocks", "depends-on"],
    propagate: true,
  },
  security: {
    seed: sec,
    label: (k) =>
      ({
        "high-security": "High security risk",
        sensitive: "Touches sensitive data",
        safe: "No security impact",
      })[k] ?? k,
    edgeTypes: ["security"],
    propagate: false,
  },
  complexity: {
    seed: cx,
    label: (k) =>
      ({
        architectural: "Architectural",
        "multi-module": "Multi-module",
        contained: "Contained",
        trivial: "Trivial",
      })[k] ?? k,
    edgeTypes: ["blocks", "depends-on"],
    propagate: false,
  },
  journey: {
    seed: (n) =>
      n.userFacing >= THRESHOLDS.noul.yes
        ? "user-facing"
        : n.userFacing <= THRESHOLDS.noul.no
          ? "internal"
          : "mixed",
    label: (k) =>
      ({ "user-facing": "User-facing", internal: "Internal", mixed: "Partly visible" })[k] ?? k,
    edgeTypes: ["user-journey", "functional"],
    propagate: true,
  },
};

export function analyzeLens(
  name: LensName,
  nodes: ClassifiedIssue[],
  edges: Edge[],
  areas: AreasFile,
): LensAnalysis {
  const def = LENS_DEFS[name];
  const ids = nodes.map((n) => n.number);
  const lensEdges = edges.filter((e) => def.edgeTypes.includes(e.type));
  const adj = adjacency(ids, lensEdges);
  const seed = new Map(nodes.map((n) => [n.number, def.seed(n)]));
  const labels = def.propagate ? labelPropagation(adj, seed) : new Map(seed);
  // Solo nodes (unsorted seeds that never joined a community) go to "unsorted".
  const regions: Record<string, string> = {};
  const regionLabels: Record<string, string> = {};
  const members = new Map<string, number[]>();
  for (const n of nodes) {
    let r = labels.get(n.number) as string;
    if (r.startsWith("solo-")) r = "unsorted";
    regions[String(n.number)] = r;
    regionLabels[r] = r === "unsorted" ? "Unsorted" : def.label(r, areas);
    (members.get(r) ?? members.set(r, []).get(r))?.push(n.number);
  }
  const cent = centrality(adjacency(ids, edges));
  const order: Record<string, number[]> = {};
  const cycles: number[][] = [];
  for (const [r, ms] of members) {
    const t = topoOrder(ms, edges);
    order[r] = t.order;
    cycles.push(...t.cycles);
  }
  const regionOf = new Map(nodes.map((n) => [n.number, regions[String(n.number)] as string]));
  return {
    regions,
    regionLabels,
    centrality: Object.fromEntries([...cent].map(([k, v]) => [String(k), v])),
    order,
    cycles,
    bridges: bridges(edges, regionOf).map((e) => ({
      source: e.source,
      target: e.target,
      type: e.type,
    })),
  };
}
