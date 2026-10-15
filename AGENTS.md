# triage — agent guide

Structured triage of incoming work items. TypeSafe **Jev** makes the typed
decisions (choice / score / noul); **OpenRouter** is used only where generated
text is needed. Code stays in control and routes on answers + confidence.

Plan and open decisions: [docs/PLAN.md](docs/PLAN.md).
Product charter (the issue world: classification → graph → first-person client): [docs/CHARTER.md](docs/CHARTER.md).
Review agents in `.claude/agents/`: `charter-check`, `qa-reviewer`, `graph-auditor`, `playtester`, `writeback-safety`.

## Stack

TypeScript on Node 24 (`.nvmrc`), ESM, run with `tsx` (no build step).
`@typesafe-ai/sdk` for Jev, plain `fetch` for OpenRouter. `vitest`, `biome`, `tsc --noEmit`.
No Python.

## Commands

```bash
make secrets-unlock   # .env from Heka Vault (skill: heka-vault-secrets)
make setup            # npm ci
make check            # lint + typecheck + test (what CI runs)
make smoke            # live call to OpenRouter and Jev
npm run triage -- run              # ingest → interrogate → classify → relate → build (data/)
npm run triage -- <stage>          # one stage; `validate` checks graph + world invariants
npm run dev -w web                 # three.js client on http://localhost:5173 (serves data/world/*)
npm run server                     # local API for the client: practice mode (nothing reaches GitHub)
npm run server -- --live           # confirmed in-game actions reach GitHub; audited in data/audit.jsonl
```

## Layout

| Path | Purpose |
|------|---------|
| `src/questions.ts` | **Every** Jev question and threshold (issue, pair, intent). The review surface |
| `src/systemone.ts` | `SystemOne` interface: Jev direct (`TYPESAFE_API_KEY`) or Jev via OpenRouter's gateway (`OPENROUTER_API_KEY`) |
| `src/ingest/` | GitHub issues → `data/issues.json` |
| `src/interrogate/` | Local clone → candidate functional and code areas (`data/areas.json`) |
| `src/classify/` | One batched call per issue → `data/classified.json` |
| `src/graph/` | Explicit + inferred edges, candidate pruning, analytics, lenses → `data/graph.json` |
| `src/world/` | `biome.ts` (second review surface), `build.ts` (layout), `types.ts` (world.json contract) |
| `src/cli.ts` | `triage ingest | interrogate | classify | relate | build | validate | run` |
| `src/writeback/gate.ts` | The one gate for GitHub mutations: dry-run default, audit, undo, idempotency |
| `src/server/` | Local HTTP API (`docs/api.md`): status, action, undo, dialogue; keys never reach the browser |
| `web/` | Vite + three.js first-person client (npm workspace); proxies `/api` to the server |
| `scripts/smoke.ts` | Live round trip; `SKIP` means a key is missing |
| `scripts/perf/` | Frame-time harness and scaled test worlds; numbers in `docs/perf.md` |
| `scripts/assets/` | Meshy character pipeline (`characters.ts` prompts are the review surface) and `pack.ts` |

## Rules

1. This repo is **public**. Never commit `.env`, keys, LAN addresses, or real customer data.
2. Tests must not touch the network: inject fakes (`JevClient`, `fetch` option).
3. Use the `typesafe-ai` and `building-with-typesafe-jev` skills before writing or changing Jev questions; the charter section "How we ask Jev" is the house summary. Do not invent request or response fields — check `node_modules/@typesafe-ai/sdk/dist/index.d.mts`.
4. Run `make check` before committing.
5. Pipeline outputs live under `data/` (gitignored). Never commit them.
6. Before a PR: run `charter-check` and `qa-reviewer`; `graph-auditor` for data-model changes, `playtester` for `web/`, `writeback-safety` for anything that can mutate GitHub.
7. Any work under `web/` goes through the `threejs-*` skills (`.agents/skills/`): `threejs-game-director` to scope, `threejs-gameplay-systems` for controls/camera/feel, `threejs-aaa-graphics-builder` for visuals (score with its 10-category scorecard), `threejs-game-ui-designer` for HUD and menus, `threejs-debug-profiler` for bugs and budgets, `threejs-qa-release` for evidence (`scripts/inspect-threejs-canvas.mjs`). The look bar, asset rules, and frame budget are in the charter ("Look"); measure with `scripts/perf/` (`docs/perf.md`). Characters are generated with Meshy (`MESHY_API_KEY`): `npx tsx scripts/assets/character.ts <form> [--stop-after concept|model|rig|animate]` (resumable; raw output in `asset-work/`), then `npx tsx scripts/assets/pack.ts <form>` into `web/public/assets` + manifest. Inspect the concept before spending on 3D. Generated assets are checked in so playing never needs a key.
