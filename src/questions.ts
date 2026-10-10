// Every Jev question and every threshold lives here. This file is the review surface:
// change wording or numbers here, not in routing code.
import { choice, noul, score } from "@typesafe-ai/sdk";

export const QUESTIONS = {
  kind: choice("What kind of work item is this?", {
    bug: "Something that used to work or should work is broken",
    feature: "A request for new behavior or a change to existing behavior",
    question: "Someone asking how something works or what to do",
    support: "A user or customer needs hands-on help with their account or setup",
    noise: "Spam, duplicates, automated notifications, or nothing to act on",
  }),
  urgency: score("How soon does this need attention?", [
    "Can wait weeks",
    "Should be handled this week",
    "Needs attention today",
    "Drop everything: outage, data loss, or security",
  ]),
  actionable: noul(
    "The item contains enough detail to start work without asking the author follow-up questions",
  ),
} as const;

export type TriageQuestions = typeof QUESTIONS;

export const THRESHOLDS = {
  /** Below this `kind` confidence a human decides. */
  minKindConfidence: 0.6,
  /** Below this `actionable` probability we ask the author for more detail. */
  minActionable: 0.5,
  /** Urgency score at or above this is flagged urgent. */
  urgentScore: 2,
} as const;
