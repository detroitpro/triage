# Local server API (web client ↔ `src/server/`)

The client never talks to GitHub or any model provider. Vite proxies `/api` to the local
server on port 8787. If the server is down, the client behaves as offline dry run.

| Method, path | Body | Response |
|--------------|------|----------|
| `GET /api/status` | — | `{ mode: "dry-run" \| "live", repo }` |
| `POST /api/action` | `{ type, issue, payload, grantId? }` where `type` is `label-add`, `label-remove`, `comment`, `close`; `payload` is `{ label }`, `{ text }`, or `{ reason: "completed" \| "not_planned" \| "duplicate", duplicateOf?, text? }`. `comment` and `close` require a `grantId` from a dialogue turn whose intent allows them; the posted text is the grant's text | `{ proposalId, mode, description, expiresAt }`. **Nothing has changed yet.** Start the hold ring with `description`. |
| `POST /api/action/confirm` | `{ proposalId }` when the hold ring completes | `{ ok, mode, undoId, applied, message }` (`applied` is false in dry run). A proposal is single use and expires after 60 s |
| `POST /api/undo` | `{ undoId }` | `{ ok, message }` (practice mode: always a no-op success) |
| `POST /api/dialogue` | `{ issue, text?, prompt?, lens? }` with `prompt` one of `what`, `need`, `help`, `connected` | `{ reply, intent?, grantId? }` where `intent` is `{ choice, confidence, band: "act" \| "confirm" \| "ask", label?, remove?, quarantined? }` and `choice` is one of `verify`, `close`, `comment`, `defer`, `need_more`, `label`, `unclear`. `grantId` is present when `text` was sent; pass it to `/api/action` for `comment` or `close` |

Every browser POST must send `Content-Type: application/json` and `X-Triage: 1` (forces a CORS
preflight; only the dev origins are allowed). Live mode requires `GITHUB_TOKEN` in `.env`: use a
fine-grained token with Issues read and write on the target repository only. Live actions post as that
token's user and will comment on and close other people's issues in that repository.

Rules: dry run unless the server was started with `--live`; every mutation is audited to
`data/audit.jsonl` before and after; `[triage]` prefix on comments; undo uses ids from the audit.
