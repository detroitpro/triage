# Plan: get triage dev-ready

**Dev-ready** means any agent on any fleet host can go from a fresh clone to a
green test run and a live smoke call in four commands:

```bash
make secrets-unlock   # writes .env from the triage secrets project
make setup
make test
make smoke            # one real Jev + OpenRouter round trip
```

## Status (2026-10-10)

Scaffold, secrets, CI, and fleet clones are done. `make check` is green and `make smoke` passes
OpenRouter. Remaining blockers: a `TYPESAFE_API_KEY`, and the Phase 0 decisions below.

## Phase 0 — Decide (Eric, before code)

| Question | Default if undecided |
|----------|----------------------|
| What gets triaged first? (GitHub issues, email, Discord, support tickets) | GitHub issues across registry repos |
| Where do decisions go? (labels, assignee, Discord post, report) | Dry-run report to stdout / JSON |
| Shape: CLI, webhook service, or scheduled job? | CLI first, service later |
| Language | **TypeScript** (decided — no Python). Node 24 LTS (fleet standard); TypeSafe JS SDK `@typesafe-ai/sdk` (needs Node ≥ 20) |
| Package manager / runtime target | npm; Node CLI first, Cloudflare Workers later if it becomes a service |
| Repo visibility | Make **private** before real data or prompts land |

## Phase 1 — Repo bootstrap

- [x] Toolchain: Node 24 (fleet standard, `~/.local/node`), TypeScript (strict), `tsx` for dev runs, `vitest`, `eslint` + `prettier` (or `biome`); `package.json` with `@typesafe-ai/sdk`; OpenRouter via plain `fetch` (no SDK); `biome` for lint + format
- [x] `.nvmrc` / `engines.node` pinned so every fleet host runs the same Node
- [x] `Makefile`: `setup`, `lint`, `test`, `smoke`, `secrets-status`, `secrets-unlock`
- [x] `AGENTS.md` / `CLAUDE.md`: purpose, commands, "never commit secrets", where questions live
- [x] TypeSafe agent skill, project-local: `npx skills add typesafe-ai/skills --skill typesafe-ai` (commit the skill dir so every host gets it)

## Phase 2 — Secrets

- [x] `triage` secrets project, `dev` env: `OPENROUTER_API_KEY` ✅, `TYPESAFE_API_KEY` ⏳
- [x] Machine identity with read-only access, installed on every fleet host
- [x] `scripts/infisical-env.sh` + `make secrets-unlock` → `.env` (mode 600); `make secrets-status` lists key names only
- [ ] Get a TypeSafe API key from the TypeSafe dashboard (not yet issued)

## Phase 3 — Walking skeleton

- [x] `src/questions.ts` — **every** Jev question and threshold in one file (TypeSafe guidance: questions and thresholds are the review surface)
- [x] `src/jev.ts` — thin wrapper over `TypeSafeClient.systemOne` (answer types inferred from the question builders `choice` / `score` / `noul`), batching all questions per item in one call
- [x] `src/llm.ts` — OpenRouter wrapper; model from `OPENROUTER_MODEL`
- [x] `src/route.ts` — confidence-gated routing: act / ask a human / fall back to LLM
- [x] CLI: `triage classify <file|->` → JSON decision
- [ ] Fixtures: 10–20 real-shaped items with expected routes (blocked on Phase 0: what gets triaged)
- [x] Tests (`vitest`) mock both APIs (no network, no secrets in CI); `make smoke` is the only live call

## Phase 4 — CI

- [x] GitHub Actions: lint + typecheck + `vitest` on PRs (no secrets needed)
- [ ] Branch protection on `main`

## Phase 5 — Fleet verification

- [x] Clone present on every T3 host; T3 project registered
- [x] `.env` materialized on every host (OpenRouter only until the TypeSafe key exists)
- [ ] `make setup && make test && make smoke` passes on each host

## Exit criteria

1. Fresh clone → `make secrets-unlock setup test smoke` green on workstation, ep-ai, quotient-preview
2. CI green on `main`
3. Questions and thresholds reviewed in one file
4. Phase 0 decisions written into `AGENTS.md`
