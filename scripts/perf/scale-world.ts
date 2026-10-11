// Scale data/graph.json up to N issues (copies of each node, issue numbers offset by
// 100000 per copy) and build every lens into data/world-<N>/. A stand-in for a big repo:
// regions and doors keep their count, regions get denser; cycles are dropped. The repo is
// replaced with a placeholder so a live server can never act on these made-up issue numbers.
// Usage: tsx scripts/perf/scale-world.ts 500
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ClassifiedIssue } from "../../src/classify/index.ts";
import { LENSES } from "../../src/graph/lenses.ts";
import type { Edge, GraphFile, LensAnalysis } from "../../src/graph/types.ts";
import { buildWorld, type LabelSource, validateWorld } from "../../src/world/build.ts";

const OFFSET = 100_000;
const PLACEHOLDER_REPO = "example/scaled-perf-world";
const root = resolve(import.meta.dirname, "..", "..", "data");
const target = Number(process.argv[2] ?? 500);
if (!Number.isInteger(target) || target < 1)
  throw new Error(`issue count must be a positive integer`);
const graph = JSON.parse(readFileSync(resolve(root, "graph.json"), "utf8")) as GraphFile;
const labelsPath = resolve(root, "labels.json");
const labels: LabelSource[] = existsSync(labelsPath)
  ? JSON.parse(readFileSync(labelsPath, "utf8"))
  : [];

const copies = Math.ceil(target / graph.nodes.length);
const shifts = Array.from({ length: copies }, (_, k) => k * OFFSET);
const nodes: ClassifiedIssue[] = [];
for (const [k, shift] of shifts.entries())
  for (const n of graph.nodes)
    if (nodes.length < target)
      nodes.push({ ...n, number: n.number + shift, title: k ? `${n.title} (${k})` : n.title });
const keep = new Set(nodes.map((n) => n.number));
const both = (s: number, t: number) => keep.has(s) && keep.has(t);

const edges: Edge[] = shifts.flatMap((d) =>
  graph.edges
    .map((e) => ({ ...e, source: e.source + d, target: e.target + d }))
    .filter((e) => both(e.source, e.target)),
);

function shiftRecord<V>(rec: Record<string, V>): Record<string, V> {
  const out: Record<string, V> = {};
  for (const d of shifts)
    for (const [id, v] of Object.entries(rec))
      if (keep.has(Number(id) + d)) out[Number(id) + d] = v;
  return out;
}

const lenses: Record<string, LensAnalysis> = {};
for (const [name, a] of Object.entries(graph.lenses)) {
  const order: Record<string, number[]> = {};
  for (const [r, ids] of Object.entries(a.order))
    order[r] = shifts.flatMap((d) => ids.map((i) => i + d)).filter((i) => keep.has(i));
  lenses[name] = {
    ...a,
    regions: shiftRecord(a.regions),
    centrality: shiftRecord(a.centrality),
    order,
    cycles: [],
    bridges: shifts.flatMap((d) =>
      a.bridges
        .map((b) => ({ ...b, source: b.source + d, target: b.target + d }))
        .filter((b) => both(b.source, b.target)),
    ),
  };
}

const big: GraphFile = { ...graph, repo: PLACEHOLDER_REPO, nodes, edges, lenses };
const out = resolve(root, `world-${target}`);
mkdirSync(out, { recursive: true });
for (const lens of LENSES) {
  const world = buildWorld(big, lens, [...LENSES], labels);
  const errors = validateWorld(world);
  writeFileSync(resolve(out, `${lens}.world.json`), JSON.stringify(world));
  const sizes = world.regions.map((r) => r.placements.length);
  console.log(
    `${lens}: ${world.regions.length} regions, ${world.doors.length} doors, largest region ${Math.max(...sizes)}`,
  );
  for (const e of errors) console.error(`  ${lens}: ${e}`);
  if (errors.length) process.exitCode = 1;
}
