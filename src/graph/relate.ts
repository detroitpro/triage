import type { ClassifiedFile } from "../classify/index.ts";
import type { IssuesFile } from "../ingest/types.ts";
import type { AreasFile } from "../interrogate/index.ts";
import type { SystemOne } from "../systemone.ts";
import { candidatePairs } from "./candidates.ts";
import { explicitEdges } from "./explicit.ts";
import { codePathEdges, inferEdges } from "./infer.ts";
import { analyzeLens, LENSES } from "./lenses.ts";
import { type Edge, edgeKey, type GraphFile } from "./types.ts";

export interface RelateOptions {
  infer: boolean;
  client?: SystemOne | undefined;
  maxCandidates?: number;
  log?: (m: string) => void;
}

export async function relate(
  classified: ClassifiedFile,
  issues: IssuesFile,
  areas: AreasFile,
  opts: RelateOptions,
): Promise<GraphFile> {
  const log = opts.log ?? (() => {});
  const nodes = classified.issues;
  const explicit = explicitEdges(issues.issues);
  log(`explicit edges: ${explicit.length}`);
  const code = codePathEdges(nodes);
  const pairs = candidatePairs(nodes, explicit, opts.maxCandidates ?? 12);
  const possible = (nodes.length * (nodes.length - 1)) / 2;
  log(`candidate pairs: ${pairs.length} of ${possible}`);
  let inferred: Edge[] = [];
  if (opts.infer && opts.client) inferred = await inferEdges(opts.client, nodes, pairs, { log });
  // Explicit wins over inferred for the same (type, source, target).
  const merged = new Map<string, Edge>();
  for (const e of [...explicit, ...code, ...inferred]) {
    const k = edgeKey(e);
    if (!merged.has(k) && e.source !== e.target) merged.set(k, e);
  }
  const edges = [...merged.values()].sort(
    (a, b) => a.source - b.source || a.target - b.target || a.type.localeCompare(b.type),
  );
  const lenses: GraphFile["lenses"] = {};
  for (const lens of LENSES) lenses[lens] = analyzeLens(lens, nodes, edges, areas);
  return {
    version: 1,
    repo: classified.repo,
    nodes,
    edges,
    candidatePairs: pairs.length,
    possiblePairs: possible,
    lenses,
  };
}
