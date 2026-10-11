// Local server the web client talks to. Keys stay here. Dry run unless started with --live.
//   npm run server            practice mode
//   npm run server -- --live  mutations reach GitHub (confirmed in game, audited, undoable)
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadDotEnv } from "../env.ts";
import { dataPath, readData } from "../io.ts";
import { THRESHOLDS } from "../questions.ts";
import { pickSystemOne } from "../systemone.ts";
import type { World } from "../world/types.ts";
import { type ActionRequest, Gate } from "../writeback/gate.ts";
import { type CannedPrompt, type Intent, respond } from "./dialogue.ts";

/** A dialogue turn that may authorize a comment or close: single use, short lived. */
export interface Grant {
  issue: number;
  text: string;
  intent: Intent;
  expires: number;
}
const GRANT_TTL_MS = 10 * 60_000;
const ALLOWED_ORIGINS = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);

/** Browser requests must be JSON with our header (forces a CORS preflight) from the dev origin. */
export function allowed(req: IncomingMessage): string | undefined {
  if (req.method === "GET") return undefined;
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return `origin ${origin} not allowed`;
  if (!(req.headers["content-type"] ?? "").startsWith("application/json"))
    return "content-type must be application/json";
  if (origin && req.headers["x-triage"] !== "1") return "missing X-Triage header";
  return undefined;
}

/** Code decides: comment and close need a grant from a dialogue turn whose intent allows them. */
export function grantCheck(
  req: ActionRequest,
  grant: Grant | undefined,
  now: number,
): string | undefined {
  if (req.type !== "comment" && req.type !== "close") return undefined;
  if (!grant) return "this action needs a dialogue turn first";
  if (grant.expires < now) return "dialogue turn expired; say it again";
  if (grant.issue !== req.issue) return "grant is for another issue";
  if (grant.intent.quarantined) return "reply was quarantined";
  if (grant.intent.band === "ask" || grant.intent.confidence < THRESHOLDS.intentConfirm)
    return "intent unclear; rephrase";
  if (req.type === "close" && !["verify", "close"].includes(grant.intent.choice))
    return "reply did not ask to close";
  return undefined;
}

const PORT = Number(process.env.TRIAGE_SERVER_PORT ?? 8787);
const log = (m: string) => console.error(m);

function liveToken(): string {
  const t = process.env.GITHUB_TOKEN;
  if (!t) {
    throw new Error(
      "--live needs GITHUB_TOKEN in .env (a fine-grained token with Issues: read and write on TRIAGE_REPO only). The `gh` token is not used for writes.",
    );
  }
  return t;
}

function loadWorld(lens: string): World | undefined {
  const p = dataPath("world", `${lens}.world.json`);
  return existsSync(p) ? readData<World>(p) : undefined;
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

export function main(argv: string[]): void {
  loadDotEnv();
  const live = argv.includes("--live");
  const repo = process.env.TRIAGE_REPO;
  if (!repo) throw new Error("TRIAGE_REPO is not set");
  const gate = new Gate({
    repo,
    token: live ? liveToken() : "",
    live,
    auditPath: dataPath("audit.jsonl"),
  });
  const systemOne = pickSystemOne(log);
  const worlds = new Map<string, World>();
  const worldFor = (lens: string): World => {
    const cached = worlds.get(lens) ?? loadWorld(lens);
    if (!cached) throw new Error(`no world for lens ${lens}; run \`npm run triage -- build\``);
    worlds.set(lens, cached);
    return cached;
  };

  const grants = new Map<string, Grant>();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": req.headers.origin ?? "",
        "Access-Control-Allow-Headers": "content-type, x-triage",
        "Access-Control-Allow-Methods": "GET, POST",
      });
      return res.end();
    }
    const denied = allowed(req);
    if (denied) return send(res, 403, { error: denied });
    try {
      if (req.method === "GET" && url.pathname === "/api/status") {
        return send(res, 200, { mode: gate.mode, repo });
      }
      if (req.method === "POST" && url.pathname === "/api/action") {
        const b = (await body(req)) as ActionRequest & { grantId?: string };
        const grant = b.grantId ? grants.get(b.grantId) : undefined;
        const why = grantCheck(b, grant, Date.now());
        if (why) return send(res, 403, { error: why });
        const req2: ActionRequest = { type: b.type, issue: b.issue, payload: { ...b.payload } };
        // The posted words are the player's own words from the dialogue turn, never client-supplied prose.
        if (grant && (b.type === "comment" || (b.type === "close" && b.payload?.text))) {
          req2.payload.text = grant.text;
        }
        const proposal = gate.propose(req2);
        if (b.grantId) grants.delete(b.grantId);
        log(`proposed ${proposal.description}`);
        return send(res, 200, proposal);
      }
      if (req.method === "POST" && url.pathname === "/api/action/confirm") {
        const { proposalId } = (await body(req)) as { proposalId: string };
        const result = await gate.confirm(String(proposalId));
        log(`${result.mode} ${result.message}`);
        return send(res, result.ok ? 200 : 502, result);
      }
      if (req.method === "POST" && url.pathname === "/api/undo") {
        const { undoId } = (await body(req)) as { undoId: string };
        const result = await gate.undo(String(undoId));
        log(`undo ${undoId}: ${result.message}`);
        return send(res, result.ok ? 200 : 404, result);
      }
      if (req.method === "POST" && url.pathname === "/api/dialogue") {
        const b = (await body(req)) as {
          issue: number;
          text?: string;
          prompt?: CannedPrompt;
          lens?: string;
        };
        const world = worldFor(b.lens ?? "feature");
        const reply = await respond({ world, systemOne }, b);
        if (reply.intent && b.text) {
          for (const [k, v] of grants) if (v.expires < Date.now()) grants.delete(k);
          const grantId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
          grants.set(grantId, {
            issue: b.issue,
            text: b.text.slice(0, 4000),
            intent: reply.intent,
            expires: Date.now() + GRANT_TTL_MS,
          });
          return send(res, 200, { ...reply, grantId });
        }
        return send(res, 200, reply);
      }
      send(res, 404, { error: "not found" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`error ${req.method} ${url.pathname}: ${message}`);
      send(res, 400, { error: message });
    }
  });
  server.listen(PORT, "127.0.0.1", () => {
    log(`triage server on http://127.0.0.1:${PORT} mode=${gate.mode} repo=${repo}`);
    if (live) log("LIVE: confirmed actions will change GitHub. Audit: data/audit.jsonl");
  });
}

if (process.argv[1]?.endsWith("server/index.ts")) main(process.argv.slice(2));
