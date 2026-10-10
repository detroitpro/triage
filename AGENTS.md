# triage — agent guide

Structured triage of incoming work items. TypeSafe **Jev** makes the typed
decisions (choice / score / noul); **OpenRouter** is used only where generated
text is needed. Code stays in control and routes on answers + confidence.

Plan and open decisions: [docs/PLAN.md](docs/PLAN.md).

## Stack

TypeScript on Node 24 (`.nvmrc`), ESM, run with `tsx` (no build step).
`@typesafe-ai/sdk` for Jev, plain `fetch` for OpenRouter. `vitest`, `biome`, `tsc --noEmit`.
No Python.

## Commands

```bash
make secrets-unlock   # .env from Infisical (skill: infisical-secrets)
make setup            # npm ci
make check            # lint + typecheck + test (what CI runs)
make smoke            # live call to OpenRouter and Jev
npm run triage -- classify item.json [--draft]
```

## Layout

| Path | Purpose |
|------|---------|
| `src/questions.ts` | **Every** Jev question and threshold. The review surface — edit wording and numbers here only |
| `src/jev.ts` | One batched `systemOne` call per item |
| `src/route.ts` | Answers → route (`queue` / `needs-info` / `human` / `close`) |
| `src/llm.ts` | OpenRouter chat; `OPENROUTER_MODEL` overrides the default `openrouter/auto` |
| `src/cli.ts` | `triage classify` |
| `scripts/smoke.ts` | Live round trip; `SKIP` means a key is missing |

## Rules

1. This repo is **public**. Never commit `.env`, keys, LAN addresses, or real customer data.
2. Tests must not touch the network: inject fakes (`JevClient`, `fetch` option).
3. Use the `typesafe-ai` skill before writing or changing Jev questions. Do not invent request or response fields — check `node_modules/@typesafe-ai/sdk/dist/index.d.mts`.
4. Run `make check` before committing.
