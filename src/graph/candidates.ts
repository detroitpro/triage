// Candidate pairs for pairwise Jev questions. Never all n(n-1)/2.
import type { ClassifiedIssue } from "../classify/index.ts";
import type { Edge } from "./types.ts";

const STOP = new Set(
  "a an the and or of to in on for with by from at as is are be this that it its one two per not no vs via into over under about like".split(
    " ",
  ),
);

export function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

export function overlapScore(
  a: ClassifiedIssue,
  b: ClassifiedIssue,
  ta: Set<string>,
  tb: Set<string>,
): number {
  let s = 0;
  if (a.functionalArea !== "unsorted" && a.functionalArea === b.functionalArea) s += 2;
  if (a.codeArea !== "unsorted" && a.codeArea === b.codeArea) s += 1.5;
  const sharedLabels = a.labels.filter((l) => b.labels.includes(l)).length;
  s += Math.min(sharedLabels, 3) * 0.75;
  const sharedPaths = a.codePaths.filter((p) =>
    b.codePaths.some((q) => q.startsWith(p) || p.startsWith(q)),
  ).length;
  s += Math.min(sharedPaths, 2) * 1.5;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  s += Math.min(shared, 6) * 0.4;
  return s;
}

export function candidatePairs(
  nodes: ClassifiedIssue[],
  explicit: Edge[],
  maxPerIssue = 12,
): [number, number][] {
  const toks = new Map(nodes.map((n) => [n.number, tokens(`${n.title} ${n.summary}`)]));
  const neighbors = new Set(
    explicit.map((e) => `${Math.min(e.source, e.target)}:${Math.max(e.source, e.target)}`),
  );
  const scored = new Map<number, { other: number; score: number }[]>();
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i] as ClassifiedIssue;
      const b = nodes[j] as ClassifiedIssue;
      let s = overlapScore(
        a,
        b,
        toks.get(a.number) as Set<string>,
        toks.get(b.number) as Set<string>,
      );
      if (neighbors.has(`${a.number}:${b.number}`)) s += 3;
      if (s < 1.5) continue;
      (scored.get(a.number) ?? scored.set(a.number, []).get(a.number))?.push({
        other: b.number,
        score: s,
      });
      (scored.get(b.number) ?? scored.set(b.number, []).get(b.number))?.push({
        other: a.number,
        score: s,
      });
    }
  }
  const pairs = new Set<string>();
  for (const [n, list] of scored) {
    list.sort((x, y) => y.score - x.score || x.other - y.other);
    for (const { other } of list.slice(0, maxPerIssue)) {
      pairs.add(`${Math.min(n, other)}:${Math.max(n, other)}`);
    }
  }
  return [...pairs]
    .map((p) => p.split(":").map(Number) as [number, number])
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}
