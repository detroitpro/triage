// The one gate every GitHub mutation passes through. Dry run unless `live` is true.
// Charter "Write-back safety": dry-run default, audit before and after, undo by audit id,
// `[triage]` prefix on comments, idempotency per (issue, type, payload).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { hash32 } from "../io.ts";

export type ActionType = "label-add" | "label-remove" | "comment" | "close";
export type CloseReason = "completed" | "not_planned" | "duplicate";

export interface ActionRequest {
  type: ActionType;
  issue: number;
  payload: { label?: string; text?: string; reason?: CloseReason; duplicateOf?: number };
}

export interface Proposal {
  proposalId: string;
  mode: "dry-run" | "live";
  description: string;
  expiresAt: string;
}

export interface ActionResult {
  ok: boolean;
  mode: "dry-run" | "live";
  undoId: string;
  applied: boolean;
  message: string;
}

export interface AuditLine {
  id: string;
  at: string;
  mode: "dry-run" | "live";
  repo: string;
  issue: number;
  type: ActionType | "undo";
  payload: ActionRequest["payload"] & { undoOf?: string };
  outcome: "pending" | "applied" | "dry-run" | "failed" | "undone";
  /** What undo needs: comment id, previous state. */
  handle?: { commentId?: number; previousState?: "open" | "closed" } | undefined;
  error?: string;
}

export interface GateOptions {
  repo: string;
  token: string;
  live: boolean;
  auditPath: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

const API = "https://api.github.com";
export const COMMENT_PREFIX = "[triage]";

export class Gate {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  /** Idempotency: key -> undoId of the applied action. */
  private readonly applied = new Map<string, string>();
  /** Proposals awaiting confirmation (single use, short lived). */
  private readonly proposals = new Map<string, { req: ActionRequest; expires: number }>();
  static readonly PROPOSAL_TTL_MS = 60_000;

  constructor(private readonly opts: GateOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? (() => new Date());
    mkdirSync(dirname(opts.auditPath), { recursive: true });
    if (existsSync(opts.auditPath)) {
      for (const line of this.readAudit()) {
        if (line.outcome === "applied" && line.type !== "undo") {
          this.applied.set(idempotencyKey(line), line.id);
        }
        if (line.type === "undo" && line.payload.undoOf) {
          for (const [k, v] of this.applied) if (v === line.payload.undoOf) this.applied.delete(k);
        }
      }
    }
  }

  get mode(): "dry-run" | "live" {
    return this.opts.live ? "live" : "dry-run";
  }

  /** Phase one: validate and describe. Nothing changes until `confirm`. */
  propose(req: ActionRequest): Proposal {
    validate(req);
    const now = this.now().getTime();
    for (const [k, v] of this.proposals) if (v.expires < now) this.proposals.delete(k);
    const proposalId = `${now.toString(36)}-${hash32(`${JSON.stringify(req)}:${this.proposals.size}:${Math.random()}`).toString(36)}`;
    const expires = now + Gate.PROPOSAL_TTL_MS;
    this.proposals.set(proposalId, { req, expires });
    return {
      proposalId,
      mode: this.mode,
      description: describe(req),
      expiresAt: new Date(expires).toISOString(),
    };
  }

  /** Phase two: a proposal is consumed exactly once. */
  async confirm(proposalId: string): Promise<ActionResult> {
    const p = this.proposals.get(proposalId);
    if (!p) throw new Error("unknown or already used proposal");
    this.proposals.delete(proposalId);
    if (p.expires < this.now().getTime()) throw new Error("proposal expired; hold again");
    return this.act(p.req);
  }

  async act(req: ActionRequest): Promise<ActionResult> {
    validate(req);
    const key = idempotencyKey({ repo: this.opts.repo, ...req });
    const prior = this.applied.get(key);
    if (prior) {
      return {
        ok: true,
        mode: this.mode,
        undoId: prior,
        applied: true,
        message: "already applied",
      };
    }
    const line: AuditLine = {
      id: `${this.now().getTime().toString(36)}-${hash32(key).toString(36)}`,
      at: this.now().toISOString(),
      mode: this.mode,
      repo: this.opts.repo,
      issue: req.issue,
      type: req.type,
      payload: req.payload,
      outcome: "pending",
    };
    if (!this.opts.live) {
      this.append({ ...line, outcome: "dry-run" });
      return {
        ok: true,
        mode: "dry-run",
        undoId: line.id,
        applied: false,
        message: `practice: would ${describe(req)}`,
      };
    }
    this.append(line);
    try {
      const handle = await this.mutate(req);
      this.append({ ...line, outcome: "applied", handle, at: this.now().toISOString() });
      this.applied.set(key, line.id);
      return { ok: true, mode: "live", undoId: line.id, applied: true, message: describe(req) };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.append({ ...line, outcome: "failed", error, at: this.now().toISOString() });
      return { ok: false, mode: "live", undoId: line.id, applied: false, message: error };
    }
  }

  async undo(undoId: string): Promise<{ ok: boolean; message: string }> {
    if (!this.opts.live) return { ok: true, message: "practice: nothing to undo" };
    const line = this.readAudit().find((l) => l.id === undoId && l.outcome === "applied");
    if (!line) {
      const dry = this.readAudit().find((l) => l.id === undoId && l.outcome === "dry-run");
      if (dry) return { ok: true, message: "practice: nothing to undo" };
      return { ok: false, message: "no applied action with that id" };
    }
    if (this.readAudit().some((l) => l.type === "undo" && l.payload.undoOf === undoId)) {
      return { ok: true, message: "already undone" };
    }
    const undoLine: AuditLine = {
      id: `${this.now().getTime().toString(36)}-${hash32(undoId).toString(36)}-undo`,
      at: this.now().toISOString(),
      mode: this.mode,
      repo: this.opts.repo,
      issue: line.issue,
      type: "undo",
      payload: { undoOf: undoId },
      outcome: "pending",
    };
    this.append(undoLine);
    try {
      await this.reverse(line);
      this.append({ ...undoLine, outcome: "applied" });
      for (const [k, v] of this.applied) if (v === undoId) this.applied.delete(k);
      return { ok: true, message: `undid ${describe(line)}` };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.append({ ...undoLine, outcome: "failed", error });
      return { ok: false, message: error };
    }
  }

  private async mutate(req: ActionRequest): Promise<AuditLine["handle"]> {
    const { issue, payload } = req;
    switch (req.type) {
      case "label-add":
        await this.github("POST", `/issues/${issue}/labels`, { labels: [payload.label] });
        return {};
      case "label-remove":
        await this.github(
          "DELETE",
          `/issues/${issue}/labels/${encodeURIComponent(payload.label as string)}`,
        );
        return {};
      case "comment": {
        const res = (await this.github("POST", `/issues/${issue}/comments`, {
          body: `${COMMENT_PREFIX} ${payload.text}`,
        })) as { id: number };
        return { commentId: res.id };
      }
      case "close": {
        const before = (await this.github("GET", `/issues/${issue}`)) as {
          state: "open" | "closed";
        };
        const previousState = before.state;
        await this.github("PATCH", `/issues/${issue}`, {
          state: "closed",
          state_reason: payload.reason === "completed" ? "completed" : "not_planned",
        });
        const note =
          payload.reason === "duplicate" && payload.duplicateOf
            ? `Duplicate of #${payload.duplicateOf}.${payload.text ? ` ${payload.text}` : ""}`
            : payload.text;
        if (note) {
          const res = (await this.github("POST", `/issues/${issue}/comments`, {
            body: `${COMMENT_PREFIX} ${note}`,
          })) as { id: number };
          return { previousState, commentId: res.id };
        }
        return { previousState };
      }
    }
  }

  private async reverse(line: AuditLine): Promise<void> {
    switch (line.type) {
      case "label-add":
        await this.github(
          "DELETE",
          `/issues/${line.issue}/labels/${encodeURIComponent(line.payload.label as string)}`,
        );
        return;
      case "label-remove":
        await this.github("POST", `/issues/${line.issue}/labels`, { labels: [line.payload.label] });
        return;
      case "comment":
        if (!line.handle?.commentId) throw new Error("no comment id recorded");
        await this.github("DELETE", `/issues/comments/${line.handle.commentId}`);
        return;
      case "close":
        if (line.handle?.commentId) {
          await this.github("DELETE", `/issues/comments/${line.handle.commentId}`);
        }
        if (line.handle?.previousState !== "closed") {
          await this.github("PATCH", `/issues/${line.issue}`, { state: "open" });
        }
        return;
      default:
        throw new Error(`cannot undo ${line.type}`);
    }
  }

  private async github(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await this.fetchImpl(`${API}/repos/${this.opts.repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "triage",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok)
      throw new Error(
        `GitHub ${res.status} ${method} ${path}: ${(await res.text()).slice(0, 200)}`,
      );
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  private append(line: AuditLine): void {
    appendFileSync(this.opts.auditPath, `${JSON.stringify(line)}\n`);
  }

  readAudit(): AuditLine[] {
    if (!existsSync(this.opts.auditPath)) return [];
    return readFileSync(this.opts.auditPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as AuditLine];
        } catch {
          return [];
        }
      });
  }
}

export function validate(req: ActionRequest): void {
  if (!Number.isInteger(req.issue) || req.issue <= 0)
    throw new Error("issue must be a positive integer");
  const p = req.payload ?? {};
  switch (req.type) {
    case "label-add":
    case "label-remove":
      if (!p.label || typeof p.label !== "string" || p.label.length > 100)
        throw new Error("label required");
      return;
    case "comment":
      if (!p.text || typeof p.text !== "string" || p.text.trim().length === 0)
        throw new Error("text required");
      if (p.text.length > 4000) throw new Error("text too long");
      return;
    case "close":
      if (!["completed", "not_planned", "duplicate"].includes(p.reason as string))
        throw new Error("reason required");
      if (p.reason === "duplicate" && !p.duplicateOf) throw new Error("duplicateOf required");
      return;
    default:
      throw new Error(`unknown action type ${String((req as { type: unknown }).type)}`);
  }
}

function idempotencyKey(x: {
  repo: string;
  type: string;
  issue: number;
  payload: unknown;
}): string {
  return `${x.repo}:${x.type}:${x.issue}:${JSON.stringify(x.payload)}`;
}

export function describe(req: {
  type: string;
  issue: number;
  payload: ActionRequest["payload"];
}): string {
  switch (req.type) {
    case "label-add":
      return `give "${req.payload.label}" to #${req.issue}`;
    case "label-remove":
      return `take "${req.payload.label}" from #${req.issue}`;
    case "comment":
      return `say to #${req.issue}: ${(req.payload.text ?? "").slice(0, 60)}`;
    case "close":
      return `release #${req.issue} (${req.payload.reason})`;
    default:
      return req.type;
  }
}
