// Actions the client can ask the local server to perform (docs/api.md), their physical
// names, the offline dry-run stand-in, rewind timing, and dialogue intent → offer mapping.
import type { Prompt } from "./dialogueText.ts";

export type ActionType = "label-add" | "label-remove" | "comment" | "close";
export type CloseReason = "completed" | "not_planned" | "duplicate";

export interface ActionPayload {
  label?: string;
  text?: string;
  reason?: CloseReason;
  duplicateOf?: number;
}

export interface Action {
  type: ActionType;
  issue: number;
  payload: ActionPayload;
}

export type Mode = "dry-run" | "live";

export interface ActionResult {
  ok: boolean;
  mode: Mode;
  undoId: string;
  applied: boolean;
  message: string;
}

/** The physical verb, as shown beside the hold ring and in banners. */
export function describeAction(a: Action): string {
  switch (a.type) {
    case "label-add":
      return `Give ${a.payload.label ?? "?"} to #${a.issue}`;
    case "label-remove":
      return `Take ${a.payload.label ?? "?"} from #${a.issue}`;
    case "comment":
      return `Say it to #${a.issue}`;
    case "close":
      switch (a.payload.reason) {
        case "not_planned":
          return `Send #${a.issue} through the hourglass`;
        case "duplicate":
          return `Lead #${a.issue} to #${a.payload.duplicateOf ?? "?"}`;
        default:
          return `Release #${a.issue}`;
      }
  }
}

/** What the server would say in dry run; used verbatim when it is unreachable. */
export function offlineResult(a: Action, seq: number): ActionResult {
  return {
    ok: true,
    mode: "dry-run",
    undoId: `offline-${seq}`,
    applied: false,
    message: `practice: ${describeAction(a)}`,
  };
}

export const REWIND_MS = 30_000;

/** Fraction of the rewind window left, 1 → 0. */
export function rewindRemaining(createdAt: number, now: number, windowMs = REWIND_MS): number {
  return Math.max(0, Math.min(1, 1 - (now - createdAt) / windowMs));
}

// ---- dialogue intent -------------------------------------------------------------

export type Choice = "verify" | "close" | "comment" | "defer" | "need_more" | "label" | "unclear";
export type Band = "act" | "confirm" | "ask";

export interface Intent {
  choice: Choice;
  confidence: number;
  band: Band;
  label?: string;
  /** For label intents: the player wants the label taken off, not given. */
  remove?: boolean;
  /** The issue text looked like an injection; the server will not act on it. */
  quarantined?: boolean;
}

export type Offer =
  | { kind: "give"; label: string }
  | { kind: "take"; label: string }
  | { kind: "release" }
  | { kind: "wheel" };

/**
 * Which physical verb to offer for a reply. Only act/confirm bands turn into a verb;
 * everything else gets the three-chip choice wheel (say it / just thinking / ask).
 */
export function offerFor(intent: Intent | undefined): Offer {
  if (!intent || intent.band === "ask") return { kind: "wheel" };
  if (intent.choice === "label" && intent.label)
    return { kind: intent.remove ? "take" : "give", label: intent.label };
  if (intent.choice === "verify" || intent.choice === "close") return { kind: "release" };
  return { kind: "wheel" };
}

export const PROMPT_KEYS: Record<Prompt, "what" | "need" | "help" | "connected"> = {
  "What are you?": "what",
  "What do you need from me?": "need",
  "What happens if I help you?": "help",
  "Who are you connected to?": "connected",
};

/**
 * Offline stand-in for Jev's intent read. Only the unmistakable verbs count; anything
 * else is a comment the wheel can decide on. Rules, not judgment: the real read lives
 * on the server.
 */
export function localIntent(text: string, known: readonly string[] = []): Intent {
  const t = text.trim().toLowerCase();
  const labelMatch = /^(?:add|give|label|tag)\s+(?:label\s+)?["'`]?([\w:-]+)["'`]?\s*$/.exec(t);
  if (labelMatch?.[1]) {
    const name = labelMatch[1];
    const hit = known.find((k) => k.toLowerCase() === name) ?? name;
    return { choice: "label", confidence: 0.6, band: "confirm", label: hit };
  }
  if (/^(?:close|release|verified?|done|fixed|resolved)\b/.test(t))
    return { choice: "verify", confidence: 0.6, band: "confirm" };
  if (/^(?:later|defer|not now|someday)\b/.test(t))
    return { choice: "defer", confidence: 0.5, band: "ask" };
  if (/\?\s*$/.test(t)) return { choice: "need_more", confidence: 0.4, band: "ask" };
  return { choice: "comment", confidence: 0.4, band: "ask" };
}
