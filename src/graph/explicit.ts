// Explicit edges parsed from GitHub text and timeline. Pure code, confidence 1.
import type { Issue } from "../ingest/types.ts";
import type { Edge } from "./types.ts";

type Rule = { re: RegExp; type: Edge["type"]; dir: "out" | "in"; name: string };

// "out" means source = this issue, target = referenced; "in" is the reverse.
const RULES: Rule[] = [
  { re: /\bblocked\s+(?:by|on)\s+#(\d+)/gi, type: "blocks", dir: "in", name: "blocked-by" },
  { re: /\bblocks\s+#(\d+)/gi, type: "blocks", dir: "out", name: "blocks" },
  { re: /\bdepends\s+on\s+#(\d+)/gi, type: "depends-on", dir: "out", name: "depends-on" },
  {
    re: /\b(?:follow-?up\s+(?:to|of)|after)\s+#(\d+)/gi,
    type: "depends-on",
    dir: "out",
    name: "follow-up",
  },
  { re: /#(\d+)\s+follow-?up\b/gi, type: "depends-on", dir: "out", name: "follow-up" },
  { re: /\bduplicate\s+of\s+#(\d+)/gi, type: "duplicate-of", dir: "out", name: "duplicate-of" },
  {
    re: /\b(?:part\s+of|child\s+of|under)\s+#(\d+)/gi,
    type: "parent-of",
    dir: "in",
    name: "part-of",
  },
  {
    re: /^\s*[-*]\s+\[[ xX]\]\s+(?:[^\n]*?)#(\d+)/gm,
    type: "parent-of",
    dir: "out",
    name: "task-list",
  },
];

export function explicitEdges(issues: Issue[]): Edge[] {
  const ids = new Set(issues.map((i) => i.number));
  const edges = new Map<string, Edge>();
  const add = (e: Edge) => {
    if (e.source === e.target || !ids.has(e.source) || !ids.has(e.target)) return;
    const k = `${e.type}:${e.source}:${e.target}`;
    if (!edges.has(k)) edges.set(k, e);
  };
  for (const issue of issues) {
    const texts = [issue.title, issue.body, ...issue.comments.map((c) => c.body)];
    const strong = new Set<number>();
    for (const text of texts) {
      for (const rule of RULES) {
        for (const m of text.matchAll(rule.re)) {
          const other = Number(m[1]);
          const [source, target] =
            rule.dir === "out" ? [issue.number, other] : [other, issue.number];
          strong.add(other);
          add({
            type: rule.type,
            source,
            target,
            directed: true,
            weight: 1,
            confidence: 1,
            provenance: `explicit:${rule.name}`,
          });
        }
      }
    }
    // Bare references with no phrase: a weak depends-on from the mentioning issue.
    for (const ref of issue.references) {
      if (strong.has(ref.number)) continue;
      add({
        type: "depends-on",
        source: issue.number,
        target: ref.number,
        directed: true,
        weight: ref.source === "timeline" ? 0.3 : 0.5,
        confidence: 1,
        provenance: `explicit:mention-${ref.source}`,
      });
    }
  }
  return [...edges.values()].sort(
    (a, b) => a.source - b.source || a.target - b.target || a.type.localeCompare(b.type),
  );
}
