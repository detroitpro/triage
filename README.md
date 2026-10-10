# triage

Structured triage of incoming work (messages, issues, tickets) using
[TypeSafe Jev](https://docs.typesafe.ai/introduction/coding-agents) for fast,
calibrated decisions (choice / score / noul) and an LLM via
[OpenRouter](https://openrouter.ai) where generated text is needed.

Jev is not a coding-agent model. It answers typed questions about a state; code
stays in control and routes on the answers and their confidence.

## Status

Walking skeleton. See [docs/PLAN.md](docs/PLAN.md) for what's left before dev-ready,
and [AGENTS.md](AGENTS.md) for commands and layout.

```bash
make secrets-unlock && make setup && make check && make smoke
echo '{"title":"Login broken","body":"500 on /login since 9am"}' | npm run triage -- classify -
```

## Secrets

Never commit secrets. This repo is public.

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | LLM calls via OpenRouter |
| `TYPESAFE_API_KEY` | Jev System One API (`https://api.typesafe.ai/v1/systemone`) |

Local values live in `.env` (gitignored), materialized from the `triage`
secrets project. Copy `.env.example` for the key list.
