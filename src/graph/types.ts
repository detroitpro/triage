import type { ClassifiedIssue } from "../classify/index.ts";
import type { EdgeType } from "../world/types.ts";

export type { EdgeType };

export const EDGE_TYPES: readonly EdgeType[] = [
  "blocks",
  "depends-on",
  "parent-of",
  "duplicate-of",
  "same-code-path",
  "functional",
  "user-journey",
  "security",
];

export const DIRECTED: Record<EdgeType, boolean> = {
  blocks: true,
  "depends-on": true,
  "parent-of": true,
  "duplicate-of": true,
  "same-code-path": false,
  functional: false,
  "user-journey": false,
  security: false,
};

export interface Edge {
  type: EdgeType;
  source: number;
  target: number;
  directed: boolean;
  weight: number;
  confidence: number;
  provenance: string;
}

export interface LensAnalysis {
  /** issue number -> region id */
  regions: Record<string, string>;
  regionLabels: Record<string, string>;
  centrality: Record<string, number>;
  /** Topological order over blocks + depends-on, per region. */
  order: Record<string, number[]>;
  cycles: number[][];
  bridges: { source: number; target: number; type: EdgeType }[];
}

export interface GraphFile {
  version: 1;
  repo: string;
  nodes: ClassifiedIssue[];
  edges: Edge[];
  candidatePairs: number;
  possiblePairs: number;
  lenses: Record<string, LensAnalysis>;
}

export function edgeKey(e: Pick<Edge, "type" | "source" | "target">): string {
  const [a, b] = DIRECTED[e.type]
    ? [e.source, e.target]
    : [e.source, e.target].sort((x, y) => x - y);
  return `${e.type}:${a}:${b}`;
}

export function validateGraph(g: GraphFile): string[] {
  const errors: string[] = [];
  const ids = new Set(g.nodes.map((n) => n.number));
  const seen = new Set<string>();
  for (const e of g.edges) {
    if (!EDGE_TYPES.includes(e.type)) errors.push(`unknown edge type ${e.type}`);
    if (e.source === e.target) errors.push(`self loop ${e.type} ${e.source}`);
    if (!ids.has(e.source) || !ids.has(e.target)) errors.push(`dangling edge ${edgeKey(e)}`);
    if (e.directed !== DIRECTED[e.type]) errors.push(`direction mismatch ${edgeKey(e)}`);
    if (!(e.weight >= 0 && e.weight <= 1)) errors.push(`weight out of range ${edgeKey(e)}`);
    if (!(e.confidence >= 0 && e.confidence <= 1))
      errors.push(`confidence out of range ${edgeKey(e)}`);
    if (e.provenance.startsWith("explicit:") && e.confidence !== 1)
      errors.push(`explicit edge without confidence 1 ${edgeKey(e)}`);
    if (!/^(explicit|jev|code):/.test(e.provenance)) errors.push(`bad provenance ${e.provenance}`);
    const k = edgeKey(e);
    if (seen.has(k)) errors.push(`duplicate edge ${k}`);
    seen.add(k);
  }
  for (const [lens, a] of Object.entries(g.lenses)) {
    for (const n of g.nodes) {
      if (!(String(n.number) in a.regions)) errors.push(`${lens}: #${n.number} has no region`);
      const c = a.centrality[String(n.number)];
      if (c === undefined || c < 0 || c > 1)
        errors.push(`${lens}: #${n.number} centrality out of range`);
    }
  }
  return errors;
}
