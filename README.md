# triage

Structured triage of incoming work (messages, issues, tickets) using
[TypeSafe Jev](https://docs.typesafe.ai/introduction/coding-agents) for fast,
calibrated decisions (choice / score / noul) and an LLM via
[OpenRouter](https://openrouter.ai) where generated text is needed.

Jev is not a coding-agent model. It answers typed questions about a state; code
stays in control and routes on the answers and their confidence.

## The issue world

Open GitHub issues become a first-person world: a classification pipeline groups them
along several lenses, finds typed relationships, and lays them out as regions whose
look follows complexity and security. Each issue is an NPC you walk up to and talk to.
Charter and guideposts: [docs/CHARTER.md](docs/CHARTER.md). Commands and layout: [AGENTS.md](AGENTS.md).

```bash
make secrets-unlock && make setup && make check
# .env: TRIAGE_REPO=owner/repo  TRIAGE_REPO_PATH=/local/clone
npm run triage -- run          # data/issues.json → areas → classified → graph → world/*.world.json
npm run server                 # local API in practice mode (add -- --live to let confirmed actions reach GitHub)
npm run dev -w web             # walk it at http://localhost:5173
```

In the world: **E** talk, **I** satchel (labels as tokens), **G** give a token, **T** take a badge,
**R** rewind the last live action, **Tab** map, **H** help. Live actions need a held key to confirm;
practice mode shows them as ghosts.

Screenshots from the checked-in fixture world (`web/public/fixtures/sample.world.json`):

| Hub | Sunlit meadow (low complexity) | Village workshop |
|-----|-------------------------------|------------------|
| ![hub](docs/screenshots/hub.png) | ![meadow](docs/screenshots/meadow.png) | ![village](docs/screenshots/village.png) |

| Dungeon (high security) | Talking to an issue | Map screen |
|-------------------------|---------------------|------------|
| ![dungeon](docs/screenshots/dungeon.png) | ![dialogue](docs/screenshots/dialogue.png) | ![map](docs/screenshots/map.png) |

Typed questions go to Jev. With only `OPENROUTER_API_KEY`, Jev is reached through
OpenRouter's TypeSafe gateway (`~typesafe/jev-latest`); `TYPESAFE_API_KEY` calls it directly.

## Secrets

Never commit secrets. This repo is public.

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | LLM calls via OpenRouter, and Jev via OpenRouter's gateway |
| `TYPESAFE_API_KEY` | Optional: Jev System One API directly (`https://api.typesafe.ai/v1/systemone`) |
| `GITHUB_TOKEN` | Reads issues; in `--live` mode also comments, labels, closes (`repo` scope). Falls back to `gh auth token` |
| `TRIAGE_REPO`, `TRIAGE_REPO_PATH` | Target repository and its local clone |

Local values live in `.env` (gitignored), materialized from the `triage`
secrets project. Copy `.env.example` for the key list.
