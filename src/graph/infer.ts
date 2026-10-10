// Inferred edges: one SystemOne request per candidate pair, every pair question in it.
import type { SystemOneResult } from "@typesafe-ai/sdk";
import type { ClassifiedIssue } from "../classify/index.ts";
import { PAIR_QUESTIONS, type PairQuestions, THRESHOLDS } from "../questions.ts";
import type { SystemOne } from "../systemone.ts";
import type { Edge } from "./types.ts";

type PairAnswers = SystemOneResult<PairQuestions>["answers"];

export function pairState(a: ClassifiedIssue, b: ClassifiedIssue) {
  const one = (i: ClassifiedIssue) => ({
    number: i.number,
    title: i.title,
    labels: i.labels,
    functionalArea: i.functionalArea,
    codeArea: i.codeArea,
    untrusted: { summary: i.summary },
  });
  return { issue_a: one(a), issue_b: one(b) };
}

/** Maps pair answers to zero or more edges. Pure; exported for tests. */
export function pairEdges(a: number, b: number, ans: PairAnswers): Edge[] {
  const out: Edge[] = [];
  const related = ans.related.noul;
  if (related >= THRESHOLDS.pairRelated && ans.relation.confidence >= THRESHOLDS.choiceAbstain) {
    const r = ans.relation.choice;
    const mk = (type: Edge["type"], source: number, target: number, directed: boolean): Edge => ({
      type,
      source,
      target,
      directed,
      weight: Math.round(related * 100) / 100,
      confidence: ans.relation.confidence,
      provenance: "jev:relation",
    });
    if (r === "a_blocks_b") out.push(mk("blocks", a, b, true));
    else if (r === "b_blocks_a") out.push(mk("blocks", b, a, true));
    else if (r === "a_depends_on_b") out.push(mk("depends-on", a, b, true));
    else if (r === "b_depends_on_a") out.push(mk("depends-on", b, a, true));
    else if (r === "same_feature") out.push(mk("functional", a, b, false));
    else if (r === "same_user_journey") out.push(mk("user-journey", a, b, false));
    // "duplicate" from inference alone is a suggestion, never an edge (charter rule 10):
    else if (r === "duplicate") out.push(mk("functional", a, b, false));
  }
  if (ans.sharedSecurity.noul >= THRESHOLDS.pairSecurity) {
    out.push({
      type: "security",
      source: a,
      target: b,
      directed: false,
      weight: Math.round(ans.sharedSecurity.noul * 100) / 100,
      confidence: ans.sharedSecurity.noul,
      provenance: "jev:sharedSecurity",
    });
  }
  return out;
}

export async function inferEdges(
  client: SystemOne,
  nodes: ClassifiedIssue[],
  pairs: [number, number][],
  opts: { concurrency?: number; log?: (m: string) => void } = {},
): Promise<Edge[]> {
  const byId = new Map(nodes.map((n) => [n.number, n]));
  const log = opts.log ?? (() => {});
  const out: Edge[] = [];
  const queue = [...pairs];
  let done = 0;
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const a = byId.get(p[0]);
      const b = byId.get(p[1]);
      if (!a || !b) continue;
      const res = await client.systemOne({ state: pairState(a, b), questions: PAIR_QUESTIONS });
      const edges = pairEdges(a.number, b.number, res.answers);
      out.push(...edges);
      done++;
      if (done % 10 === 0 || edges.length) {
        log(
          `pair ${done}/${pairs.length} #${a.number}-#${b.number}: ${edges.map((e) => e.type).join(",") || "none"}`,
        );
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 6, 8) }, worker));
  return out;
}

/** Undirected same-code-path edges from shared mentioned paths or the same code area. */
export function codePathEdges(nodes: ClassifiedIssue[]): Edge[] {
  const out: Edge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i] as ClassifiedIssue;
      const b = nodes[j] as ClassifiedIssue;
      const shared = a.codePaths.filter((p) =>
        b.codePaths.some((q) => q.startsWith(p) || p.startsWith(q)),
      );
      if (shared.length === 0) continue;
      out.push({
        type: "same-code-path",
        source: a.number,
        target: b.number,
        directed: false,
        weight: Math.min(1, 0.5 + shared.length * 0.25),
        confidence: 1,
        provenance: "code:shared-path",
      });
    }
  }
  return out;
}
