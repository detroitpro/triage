import type { Assessment } from "./jev.ts";
import { THRESHOLDS } from "./questions.ts";

export type Route = "close" | "human" | "needs-info" | "queue";

export interface Decision {
  route: Route;
  kind: Assessment["kind"]["choice"];
  kindConfidence: number;
  urgency: number;
  urgent: boolean;
  actionable: number;
  reasons: string[];
}

export function decide(a: Assessment): Decision {
  const base = {
    kind: a.kind.choice,
    kindConfidence: a.kind.confidence,
    urgency: a.urgency.score,
    urgent: a.urgency.score >= THRESHOLDS.urgentScore,
    actionable: a.actionable.noul,
  };

  if (a.kind.confidence < THRESHOLDS.minKindConfidence) {
    return {
      ...base,
      route: "human",
      reasons: [`kind confidence ${a.kind.confidence} < ${THRESHOLDS.minKindConfidence}`],
    };
  }
  if (a.kind.choice === "noise") {
    return { ...base, route: "close", reasons: ["classified as noise"] };
  }
  if (a.actionable.noul < THRESHOLDS.minActionable) {
    return {
      ...base,
      route: "needs-info",
      reasons: [`actionable ${a.actionable.noul} < ${THRESHOLDS.minActionable}`],
    };
  }
  return { ...base, route: "queue", reasons: [] };
}
