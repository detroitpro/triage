# Plan: get triage dev-ready

**Dev-ready** means any agent on any fleet host can go from a fresh clone to a
green test run and a live smoke call in four commands:

```bash
make secrets-unlock   # writes .env from the triage secrets project
make setup
make test
make smoke            # one real Jev + OpenRouter round trip
```

## Phase 0 — Decide (Eric, before code)

| Question | Default if undecided |
|----------|----------------------|
| What gets triaged first? (GitHub issues, email, Discord, support tickets) | GitHub issues across registry repos |
| Where do decisions go? (labels, assignee, Discord post, report) | Dry-run report to stdout / JSON |
| Shape: CLI, webhook service, or scheduled job? | CLI first, service later |
| Language | Python 3.12 + `uv` (TypeSafe's primary SDK is `typesafe-sdk`; JS SDK exists if we want Workers) |
| Repo visibility | Make **private** before real data or prompts land |

## Phase 1 — Repo bootstrap

- [ ] Toolchain: `uv`, Python 3.12, `ruff`, `pytest`; `pyproject.toml` with `typesafe-sdk` and an OpenRouter client (`openai` SDK pointed at `https://openrouter.ai/api/v1`, or `httpx`)
- [ ] `Makefile`: `setup`, `lint`, `test`, `smoke`, `secrets-status`, `secrets-unlock`
- [ ] `AGENTS.md` / `CLAUDE.md`: purpose, commands, "never commit secrets", where questions live
- [ ] TypeSafe agent skill, project-local: `npx skills add typesafe-ai/skills --skill typesafe-ai` (commit the skill dir so every host gets it)

## Phase 2 — Secrets

- [ ] `triage` secrets project, `dev` env: `OPENROUTER_API_KEY`, `TYPESAFE_API_KEY`
- [ ] Machine identity with read-only access, installed on every fleet host
- [ ] `scripts/secrets-env.sh` + `make secrets-unlock` → `.env` (mode 600); `make secrets-status` lists key names only
- [ ] Get a TypeSafe API key from the TypeSafe dashboard (not yet issued)

## Phase 3 — Walking skeleton

- [ ] `triage/questions.py` — **every** Jev question and threshold in one file (TypeSafe guidance: questions and thresholds are the review surface)
- [ ] `triage/jev.py` — thin wrapper over `TypeSafeClient.system_one`, batching all questions per item in one call
- [ ] `triage/llm.py` — OpenRouter wrapper; model from `OPENROUTER_MODEL`
- [ ] `triage/route.py` — confidence-gated routing: act / ask a human / fall back to LLM
- [ ] CLI: `triage classify <file|->` → JSON decision
- [ ] Fixtures: 10–20 real-shaped items with expected routes
- [ ] Tests mock both APIs (no network, no secrets in CI); `make smoke` is the only live call

## Phase 4 — CI

- [ ] GitHub Actions: `ruff` + `pytest` on PRs (no secrets needed)
- [ ] Branch protection on `main`

## Phase 5 — Fleet verification

- [ ] Clone present on every T3 host; T3 project registered
- [ ] `.env` materialized on every host
- [ ] `make setup && make test && make smoke` passes on each host

## Exit criteria

1. Fresh clone → `make secrets-unlock setup test smoke` green on workstation, ep-ai, quotient-preview
2. CI green on `main`
3. Questions and thresholds reviewed in one file
4. Phase 0 decisions written into `AGENTS.md`
