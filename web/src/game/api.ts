// Client for the local server (docs/api.md). The client never talks to GitHub or a model
// provider. Mutations are two-step: POST /api/action proposes (nothing changes) and the
// hold ring completing confirms. Any fetch error or 404 flips the client to offline dry
// run: proposals and confirms then come from `offlineResult` with `applied: false`, and
// dialogue returns null so callers fall back to the local templates.
import {
  type Action,
  type ActionResult,
  describeAction,
  type Intent,
  type Mode,
  offlineResult,
} from "../pure/actions.ts";

export interface StatusResponse {
  mode: Mode;
  repo: string;
}

export interface Proposal {
  proposalId: string;
  mode: Mode;
  description: string;
  expiresAt: string;
  /** The action it stands for (client side only). */
  action: Action;
}

export interface DialogueResponse {
  reply: string;
  intent?: Intent;
  /** Present when `text` was sent; required by comment and close actions. */
  grantId?: string;
}

export type DialogueQuery = { text: string } | { prompt: "what" | "need" | "help" | "connected" };

/** Every browser POST carries these; the server forces a preflight on X-Triage. */
export const POST_HEADERS = { "Content-Type": "application/json", "X-Triage": "1" } as const;

const OFFLINE_PREFIX = "offline-";

export class Api {
  offline = false;
  mode: Mode = "dry-run";
  repo = "";
  private seq = 0;
  private announced = false;
  private offlineProposals = new Map<string, Action>();
  /** Debug only: pretend the server applied everything (exercise the rewind path offline). */
  simulateLive = false;

  constructor(
    private fetchFn: typeof fetch = (...a) => fetch(...a),
    private onOffline: (reason: string) => void = () => {},
  ) {}

  private goOffline(reason: string): void {
    this.offline = true;
    this.mode = "dry-run";
    if (this.announced) return;
    this.announced = true;
    this.onOffline(reason);
  }

  /** Last non-network failure message (a 4xx/5xx with a body), for toasts. */
  lastError = "";

  /**
   * Null when the call produced nothing usable. Network failure, 404 and the dev proxy's
   * 502-504 flip the client offline; any other non-2xx is a server-side refusal (bad issue, expired proposal,
   * missing grant) and is reported through `lastError` without going offline.
   */
  private async call<T>(path: string, body?: unknown): Promise<T | null> {
    let res: Response;
    try {
      res =
        body === undefined
          ? await this.fetchFn(path)
          : await this.fetchFn(path, {
              method: "POST",
              headers: POST_HEADERS,
              body: JSON.stringify(body),
            });
    } catch (err) {
      this.goOffline(err instanceof Error ? err.message : String(err));
      return null;
    }
    // 404: no server behind the proxy. 502-504: the dev proxy could not reach it.
    if (res.status === 404 || (res.status >= 502 && res.status <= 504)) {
      this.goOffline(`${path}: ${res.status}`);
      return null;
    }
    if (!res.ok) {
      let msg = `${path}: ${res.status}`;
      try {
        const data = (await res.json()) as { error?: string; message?: string };
        msg = data.error ?? data.message ?? msg;
      } catch {
        // no body
      }
      this.lastError = msg;
      return null;
    }
    try {
      return (await res.json()) as T;
    } catch (err) {
      this.lastError = `${path}: bad json (${String(err)})`;
      return null;
    }
  }

  async status(): Promise<StatusResponse | null> {
    const s = await this.call<StatusResponse>("/api/status");
    if (s) {
      this.offline = false;
      this.mode = s.mode === "live" ? "live" : "dry-run";
      this.repo = s.repo ?? "";
    }
    return s;
  }

  private offlineProposal(a: Action): Proposal {
    this.seq += 1;
    const proposalId = `${OFFLINE_PREFIX}${this.seq}`;
    this.offlineProposals.set(proposalId, a);
    return {
      proposalId,
      mode: this.simulateLive ? "live" : "dry-run",
      description: describeAction(a),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      action: a,
    };
  }

  /** Step one: nothing changes. Start the hold ring with `description`. */
  async propose(a: Action, grantId?: string): Promise<Proposal> {
    if (this.offline || this.simulateLive) return this.offlineProposal(a);
    const body: Action & { grantId?: string } = grantId ? { ...a, grantId } : a;
    this.lastError = "";
    const r = await this.call<Partial<Proposal>>("/api/action", body);
    if (!r?.proposalId) {
      if (!this.offline && this.lastError) throw new Error(this.lastError);
      return this.offlineProposal(a);
    }
    return {
      proposalId: r.proposalId,
      mode: r.mode === "live" ? "live" : "dry-run",
      description: r.description ?? describeAction(a),
      expiresAt: r.expiresAt ?? "",
      action: a,
    };
  }

  /** Step two, when the ring completes. Cancelled holds simply drop the proposal. */
  async confirm(p: Proposal): Promise<ActionResult> {
    const local = this.offlineProposals.get(p.proposalId);
    if (local) {
      this.offlineProposals.delete(p.proposalId);
      const base = offlineResult(local, Number(p.proposalId.slice(OFFLINE_PREFIX.length)) || 0);
      return this.simulateLive
        ? { ...base, mode: "live", applied: true, message: "simulated" }
        : base;
    }
    this.lastError = "";
    const r = await this.call<Partial<ActionResult>>("/api/action/confirm", {
      proposalId: p.proposalId,
    });
    if (!r)
      return {
        ...offlineResult(p.action, 0),
        ok: false,
        message: this.lastError || "server unreachable",
      };
    return {
      ok: r.ok ?? true,
      mode: r.mode === "live" ? "live" : "dry-run",
      undoId: r.undoId ?? "",
      applied: Boolean(r.applied),
      message: r.message ?? "",
    };
  }

  async undo(undoId: string): Promise<{ ok: boolean; message: string }> {
    if (this.simulateLive) return { ok: true, message: "simulated undo" };
    const r = await this.call<{ ok?: boolean; message?: string }>("/api/undo", { undoId });
    if (!r) return { ok: false, message: "server unreachable" };
    return { ok: Boolean(r.ok), message: r.message ?? "" };
  }

  /** Null means offline: use the local templates. */
  async dialogue(issue: number, q: DialogueQuery): Promise<DialogueResponse | null> {
    if (this.offline) return null;
    const r = await this.call<Partial<DialogueResponse> & { text?: string }>("/api/dialogue", {
      issue,
      ...q,
    });
    if (!r) return null;
    const out: DialogueResponse = { reply: r.reply ?? r.text ?? "" };
    if (r.intent) out.intent = r.intent;
    if (r.grantId) out.grantId = r.grantId;
    return out;
  }
}
