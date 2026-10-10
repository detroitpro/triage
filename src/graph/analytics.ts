// Pure graph analytics: label propagation, centrality, topological order, cycles, bridges.
import { rng } from "../io.ts";
import type { Edge, EdgeType } from "./types.ts";

export interface Adj {
  nodes: number[];
  /** undirected neighbor -> weight */
  und: Map<number, Map<number, number>>;
}

export function adjacency(nodes: number[], edges: Edge[]): Adj {
  const und = new Map<number, Map<number, number>>(nodes.map((n) => [n, new Map()]));
  for (const e of edges) {
    const a = und.get(e.source);
    const b = und.get(e.target);
    if (!a || !b) continue;
    a.set(e.target, Math.max(a.get(e.target) ?? 0, e.weight));
    b.set(e.source, Math.max(b.get(e.source) ?? 0, e.weight));
  }
  return { nodes: [...nodes].sort((x, y) => x - y), und };
}

/**
 * Seeded label propagation. `seed` gives each node an initial label (e.g. its functional area);
 * nodes seeded with the same label start together, "unsorted" nodes start alone.
 */
export function labelPropagation(
  adj: Adj,
  seed: Map<number, string>,
  iterations = 20,
): Map<number, string> {
  const label = new Map<number, string>();
  for (const n of adj.nodes) {
    const s = seed.get(n);
    label.set(n, s && s !== "unsorted" ? s : `solo-${n}`);
  }
  const random = rng(7);
  for (let it = 0; it < iterations; it++) {
    let changed = false;
    const order = [...adj.nodes].sort(() => random() - 0.5);
    for (const n of order) {
      const votes = new Map<string, number>();
      for (const [m, w] of adj.und.get(n) ?? []) {
        const l = label.get(m) as string;
        votes.set(l, (votes.get(l) ?? 0) + w);
      }
      const own = label.get(n) as string;
      // Seeded labels get a strong self-vote so areas stay coherent; solo nodes get a weak one.
      votes.set(own, (votes.get(own) ?? 0) + (own.startsWith("solo-") ? 0.4 : 1.5));
      let best = own;
      let bestW = -1;
      for (const [l, w] of [...votes].sort((x, y) => x[0].localeCompare(y[0]))) {
        if (w > bestW) {
          bestW = w;
          best = l;
        }
      }
      if (best !== own) {
        label.set(n, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return label;
}

/** Degree + betweenness (Brandes, unweighted), each normalized to [0,1], averaged. */
export function centrality(adj: Adj): Map<number, number> {
  const n = adj.nodes.length;
  const deg = new Map<number, number>();
  let maxDeg = 0;
  for (const v of adj.nodes) {
    const d = adj.und.get(v)?.size ?? 0;
    deg.set(v, d);
    maxDeg = Math.max(maxDeg, d);
  }
  const bc = new Map<number, number>(adj.nodes.map((v) => [v, 0]));
  for (const s of adj.nodes) {
    const stack: number[] = [];
    const pred = new Map<number, number[]>(adj.nodes.map((v) => [v, []]));
    const sigma = new Map<number, number>(adj.nodes.map((v) => [v, 0]));
    const dist = new Map<number, number>(adj.nodes.map((v) => [v, -1]));
    sigma.set(s, 1);
    dist.set(s, 0);
    const queue = [s];
    while (queue.length) {
      const v = queue.shift() as number;
      stack.push(v);
      for (const w of [...(adj.und.get(v)?.keys() ?? [])].sort((a, b) => a - b)) {
        if (dist.get(w) === -1) {
          dist.set(w, (dist.get(v) as number) + 1);
          queue.push(w);
        }
        if (dist.get(w) === (dist.get(v) as number) + 1) {
          sigma.set(w, (sigma.get(w) as number) + (sigma.get(v) as number));
          pred.get(w)?.push(v);
        }
      }
    }
    const delta = new Map<number, number>(adj.nodes.map((v) => [v, 0]));
    while (stack.length) {
      const w = stack.pop() as number;
      for (const v of pred.get(w) ?? []) {
        delta.set(
          v,
          (delta.get(v) as number) +
            ((sigma.get(v) as number) / (sigma.get(w) as number)) * (1 + (delta.get(w) as number)),
        );
      }
      if (w !== s) bc.set(w, (bc.get(w) as number) + (delta.get(w) as number));
    }
  }
  const maxBc = Math.max(1e-9, ...bc.values());
  const out = new Map<number, number>();
  for (const v of adj.nodes) {
    const d = maxDeg > 0 ? (deg.get(v) as number) / maxDeg : 0;
    const b = n > 2 ? (bc.get(v) as number) / maxBc : 0;
    out.set(v, Math.round(((d + b) / 2) * 100) / 100);
  }
  return out;
}

const ORDER_TYPES: EdgeType[] = ["blocks", "depends-on", "parent-of"];

/** Kahn's algorithm over blocks/depends-on/parent-of. Returns order (sources first) and cycles found. */
export function topoOrder(nodes: number[], edges: Edge[]): { order: number[]; cycles: number[][] } {
  const set = new Set(nodes);
  const out = new Map<number, number[]>(nodes.map((n) => [n, []]));
  const indeg = new Map<number, number>(nodes.map((n) => [n, 0]));
  for (const e of edges) {
    if (!ORDER_TYPES.includes(e.type) || !set.has(e.source) || !set.has(e.target)) continue;
    // depends-on: source depends on target, so target comes first.
    const [first, second] = e.type === "depends-on" ? [e.target, e.source] : [e.source, e.target];
    out.get(first)?.push(second);
    indeg.set(second, (indeg.get(second) ?? 0) + 1);
  }
  const order: number[] = [];
  const ready = nodes.filter((n) => indeg.get(n) === 0).sort((a, b) => a - b);
  const left = new Map(indeg);
  while (ready.length) {
    const n = ready.shift() as number;
    order.push(n);
    for (const m of (out.get(n) ?? []).sort((a, b) => a - b)) {
      left.set(m, (left.get(m) as number) - 1);
      if (left.get(m) === 0) ready.push(m);
    }
    ready.sort((a, b) => a - b);
  }
  const cycles: number[][] = [];
  const remaining = nodes.filter((n) => (left.get(n) as number) > 0);
  if (remaining.length) {
    // Report each strongly connected remainder as one cycle (simple DFS grouping).
    const seen = new Set<number>();
    for (const r of remaining) {
      if (seen.has(r)) continue;
      const group: number[] = [];
      const stack = [r];
      while (stack.length) {
        const v = stack.pop() as number;
        if (seen.has(v) || !remaining.includes(v)) continue;
        seen.add(v);
        group.push(v);
        stack.push(...(out.get(v) ?? []));
      }
      cycles.push(group.sort((a, b) => a - b));
    }
    order.push(...remaining.sort((a, b) => a - b));
  }
  return { order, cycles };
}

/** Edges whose endpoints sit in different regions, deduplicated by (regionA, regionB, type). */
export function bridges(edges: Edge[], region: Map<number, string>): Edge[] {
  const seen = new Set<string>();
  const out: Edge[] = [];
  for (const e of [...edges].sort((a, b) => b.weight - a.weight || a.source - b.source)) {
    const ra = region.get(e.source);
    const rb = region.get(e.target);
    if (!ra || !rb || ra === rb) continue;
    const k = `${[ra, rb].sort().join("|")}:${e.type}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}
