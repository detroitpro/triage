import type { Assessment } from "../src/jev.ts";

type Kind = Assessment["kind"]["choice"];

export function fakeAssessment(
  opts: { kind?: Kind; confidence?: number; urgency?: number; actionable?: number } = {},
): Assessment {
  const kind = opts.kind ?? "bug";
  const urgency = opts.urgency ?? 1;
  const probabilities = { bug: 0, feature: 0, question: 0, support: 0, noise: 0, [kind]: 1 };
  return {
    kind: {
      type: "choice",
      choice: kind,
      confidence: opts.confidence ?? 0.9,
      probabilities,
    },
    urgency: {
      type: "score",
      score: urgency,
      confidence: 0.9,
      legend: {
        "0": "Can wait weeks",
        "1": "Should be handled this week",
        "2": "Needs attention today",
        "3": "Drop everything: outage, data loss, or security",
      },
      probabilities: { "0": 0, "1": 0, "2": 0, "3": 0, [String(urgency)]: 1 },
    },
    actionable: { type: "noul", noul: opts.actionable ?? 0.9 },
  } as Assessment;
}
