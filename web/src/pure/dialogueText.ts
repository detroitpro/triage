import type { Placement, PlacementEdge, Region } from "../../../src/world/types.ts";

export const PROMPTS = [
  "What are you?",
  "What do you need from me?",
  "What happens if I help you?",
  "Who are you connected to?",
] as const;

export type Prompt = (typeof PROMPTS)[number];

const KIND_NOUN: Record<string, string> = {
  bug: "a bug",
  feature: "a feature request",
  question: "a question",
  support: "a support request",
  chore: "a chore",
  noise: "noise, probably",
};

const LEVEL = ["trivial", "modest", "substantial", "cross-cutting"] as const;
const RISK = ["no", "low", "real", "serious"] as const;

function level(n: number): string {
  return LEVEL[Math.max(0, Math.min(3, Math.round(n)))] ?? "unknown";
}
function risk(n: number): string {
  return RISK[Math.max(0, Math.min(3, Math.round(n)))] ?? "unknown";
}

/** First-person templated answers. Grounded only in the placement data, nothing invented. */
export function localAnswer(prompt: Prompt, p: Placement, region: Region): string {
  const d = p.dimensions;
  switch (prompt) {
    case "What are you?": {
      const kind = KIND_NOUN[d.kind] ?? `a ${d.kind}`;
      const labels = p.labels.length ? ` I am labeled ${p.labels.join(", ")}.` : "";
      const summary = p.summary.trim() ? ` In my own words: ${p.summary.trim()}` : "";
      return `I am #${p.issue}, "${p.title}". I am ${kind} living in ${region.label}, in the ${d.functionalArea} area of ${d.codeArea}.${labels}${summary}`;
    }
    case "What do you need from me?": {
      if (d.actionable >= 0.7)
        return `I have enough detail to start. I am ${level(d.complexity)} work with ${risk(d.security)} security risk. Pick me up, or tell me to wait.`;
      if (d.actionable >= 0.3)
        return `I am only partly specified. Ask me a question in the box below, or add a comment on GitHub, so someone can start on me.`;
      return `I do not yet say enough to be worked on. I need a clearer description before anyone should touch code for me.`;
    }
    case "What happens if I help you?": {
      const blocked = p.edges.filter((e) => e.type === "blocks" && e.direction === "out");
      const dup = p.edges.find((e) => e.type === "duplicate-of");
      const parts: string[] = [];
      if (d.userFacing >= 0.5) parts.push("users will see the change");
      else parts.push("users will not notice directly");
      if (blocked.length)
        parts.push(
          `${blocked.length} issue${blocked.length > 1 ? "s" : ""} I block will unlock: ${blocked.map((e) => `#${e.to}`).join(", ")}`,
        );
      if (dup) parts.push(`I am a duplicate of #${dup.to}, so closing me is cheap`);
      parts.push(`${region.label} gets one step closer to done`);
      return `If you resolve me, ${parts.join("; ")}.`;
    }
    case "Who are you connected to?": {
      if (p.edges.length === 0)
        return "I stand alone. No issue references me and I reference none.";
      return `I am connected to ${p.edges.length} issue${p.edges.length > 1 ? "s" : ""}: ${p.edges.map(describeEdge).join("; ")}.`;
    }
  }
}

export function describeEdge(e: PlacementEdge): string {
  const arrow = e.direction === "out" ? "→" : e.direction === "in" ? "←" : "↔";
  return `${arrow} #${e.to} (${e.type}, ${Math.round(e.weight * 100)}%)`;
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1)).trimEnd()}…`;
}
