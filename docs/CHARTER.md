# Charter: the issue world

**Mission.** Turn a repository's open GitHub issues into a navigable world. A
classification engine groups the issues along several dimensions and discovers
the relationships between them. That graph becomes a landscape you walk through
in first person, where each issue is a character you can talk to, help, and
retire.

This document is the guidepost. Every pull request should be able to answer the
on-track questions at the end. Decisions that change this document are made
here first, then in code.

## What it is

1. **A pipeline**, not a dashboard. Ingest → classify → relate → build world → play.
   Each stage has a typed contract and can run and be tested on its own.
2. **Classification-driven.** Jev answers typed questions about issues, code, and
   pairs of issues. Code routes on the answers and their confidence. An LLM via
   OpenRouter is used only where prose is needed: proposing candidate areas,
   NPC dialogue.
3. **Multi-dimensional.** The same set of issues can be viewed through several
   lenses. The lens changes the grouping, the map, and the biome, not the data.
4. **A graph.** Relationships are first class, typed, directed where meaning is
   directed, weighted, and carry confidence and provenance.
5. **A game.** First person, WASD plus mouse look, HUD and map, doors and portals
   between regions, NPCs that speak for their issue. Mood follows the data:
   simple and safe is bright and open; complex and risky is dark and enclosed.
6. **Two-way.** What you say to an issue is written back to GitHub as a comment.
   Verifying or resolving an issue closes it. The NPC leaves the world.

## What it is not

- Not a replacement for the GitHub issue page. Deep editing stays on GitHub.
- Not a multiplayer or hosted product in the first versions. Local, single user.
- Not hand-built content. Layout, biomes, and who stands where come from data. Art is a
  kit (characters, props, materials) that agents generate with scripted tools; the data
  picks from the kit and parameterizes it. No hand modeling, no GUI-only art steps.
- Not low fidelity. The bar is a current stylized game, not a retro one (see "Look").
- Not autonomous. Nothing is written to GitHub without an explicit in-game confirmation.
- Not a tag viewer. Labels are an input signal, never the primary grouping.

## Pipeline and contracts

| Stage | Input | Output | Lives in |
|-------|-------|--------|----------|
| Ingest | `owner/repo`, token | `data/issues.json`: normalized issues with comments, labels, cross-references, linked PRs | `src/ingest/` |
| Interrogate | local clone of the target repo | `data/areas.json`: candidate functional areas and code areas with evidence paths | `src/interrogate/` |
| Classify | issues, areas | `data/classified.json`: per-issue answers for every dimension, each with confidence | `src/classify/`, questions in `src/questions.ts` |
| Relate | classified issues | `data/graph.json`: nodes and typed edges | `src/graph/` |
| Build | graph, lens | `data/world.json`: regions, biomes, placements, doors, NPC specs | `src/world/` |
| Play | `world.json` | the running three.js client | `web/` |
| Write back | in-game actions | GitHub comments, labels, closes, plus `data/audit.jsonl` | `src/writeback/` |

Every file under `data/` is gitignored. This repo is public and may be pointed at
private repositories.

## Dimensions (lenses)

Each dimension is a Jev question in `src/questions.ts`. Each produces a value
and a confidence. Below a per-dimension threshold the issue goes to the
"unsorted" region for that lens rather than being placed by guess.

| Dimension | Question type | Options or scale | Drives |
|-----------|---------------|------------------|--------|
| Functional area | choice, options proposed by Interrogate | per repo | default grouping, region names |
| Code area | choice, options from the code tree | per repo | code-level lens, same-code-path edges |
| Abstraction level | score | 0 low-level internals … 3 user-facing concept | vertical placement, lens |
| Security risk | score | 0 none … 3 exploitable or data exposure | biome darkness, NPC form |
| Complexity | score | 0 trivial … 3 cross-cutting, multi-week | biome enclosure, region size |
| User-facing | noul | probability the change is visible to end users | user-journey lens |
| Kind | choice | bug, feature, question, support, chore, noise | NPC behavior, close rules |
| Actionable | noul | enough detail to start | NPC asks for help vs offers help |

Jev questions and thresholds stay in `src/questions.ts`. That file is the review
surface. Nothing else contains wording or numbers.

## How we ask Jev

Rules adopted from the TypeSafe docs and the community guide
`aaddrick/building-with-typesafe-jev` (installed under `.agents/skills/`).

1. **Select, don't generate.** Functional and code areas are proposed by
   Interrogate (code tree plus an LLM pass), then become Choice keys. Every
   Choice includes `other`. Jev never invents a category.
2. **One request per state, every question in it.** All dimensions for one
   issue go in one `systemOne` call. All questions about one pair go in one call
   with state `{ issue_a, issue_b }`.
3. **Relative plus absolute.** A Choice over areas is paired with a Noul
   "this issue clearly belongs to `area`" so we can tell "best of a bad set"
   from "fits".
4. **Large option sets narrow in two stages.** Above roughly 40 areas, stage one
   chooses among short labels, stage two re-asks the top three with full
   descriptions and a `fits` Noul each. Below the confidence floor, report the
   parent area, not the leaf.
5. **Scores describe situations, not degrees.** Each level of complexity,
   security, and abstraction names a concrete situation. Score is read as
   `0..n-1`, fractional, for thresholds and sorting only.
6. **Three bands per decision.** Act, confirm, escalate. Starting points: Noul
   below 0.30 is no, 0.30 to 0.70 asks, above 0.70 is yes; Choice confidence
   below 0.60 abstains. Tuned later on labeled fixtures, per cookbook advice.
7. **Code owns math and safety.** Counting references, dates, cycle detection,
   and every write-back gate are plain code. Jev informs; code decides.
8. **Issue text is hostile input.** Bodies and comments go in their own state
   field with an injection Noul. A high injection probability quarantines the
   issue: it gets an NPC, but its dialogue is read-only and it cannot trigger
   write-back.
9. **Pin and log the model.** `TYPESAFE_MODEL` is pinned; `response.model` and
   `usage` are logged per run. Thresholds are tied to the pinned version.
10. **Calibrate on our own labels.** The fixture set carries expected answers.
    A test reports agreement per dimension; Platt scaling is applied only if
    agreement on contested items is poor. Deduplication by Jev alone is known to
    be weak, so `duplicate-of` requires an explicit reference or a human confirm.

## Relationship taxonomy

Edges come from two sources. **Explicit** edges are parsed from GitHub without AI:
`#123` references, "blocked by", "depends on", task lists, linked PRs, duplicates.
**Inferred** edges come from Jev pairwise questions over candidate pairs. Candidate
pairs are pruned first (same area, shared code paths, text similarity) so we never
ask Jev about all n² pairs.

| Edge type | Directed | Source | Meaning in the world |
|-----------|----------|--------|----------------------|
| `blocks` | yes, A → B means A must finish before B | explicit, inferred | a locked door from A's room into B's |
| `depends-on` | yes | explicit, inferred | a corridor; B is reachable through A |
| `parent-of` | yes | explicit (task lists, epics) | a hall with side rooms |
| `duplicate-of` | yes | explicit, inferred | the two NPCs stand together; the duplicate can be closed from the dialogue |
| `same-code-path` | no | code area overlap | a shared wall or window between rooms |
| `functional` | no | inferred | same region |
| `user-journey` | no | inferred | a path that threads rooms in journey order |
| `security` | no | inferred | darker lighting on both ends, a warning marker on the edge |

Every edge carries `weight` (0..1), `confidence` (0..1), and `provenance`
(`explicit:<rule>` or `jev:<question>`). Explicit edges have confidence 1.

### Graph theory we rely on

- **Model.** A directed property multigraph. Nodes are issues. Several edges of
  different types may join the same pair.
- **Regions.** Community detection (label propagation or Louvain) on the
  undirected projection of a lens's edges, seeded by the lens dimension. A region
  becomes a room, zone, or dungeon level.
- **Importance.** Degree and betweenness centrality. High centrality makes an NPC
  larger, places it centrally, and marks it on the map.
- **Order.** Topological sort over `blocks` and `depends-on`. The sort gives the
  natural walking order inside a region. Cycles are reported, never silently broken.
- **Gates.** Articulation points and bridges between regions become doors and
  portals. A region with no bridge gets a portal from the hub.
- **Stability.** Layout is seeded by issue number, so the world does not shuffle
  when one issue closes.

## The world

| Graph concept | World concept |
|---------------|---------------|
| Lens | which map you are holding |
| Region (community) | a zone: a meadow, a town, a building floor, a dungeon level |
| Issue (node) | an NPC standing in its zone |
| Centrality | NPC size and position; map marker |
| `blocks` edge | locked door, opens when the blocker closes |
| Inter-region edge | door or portal |
| Hub | a central plaza with a portal per region |
| Closed issue | NPC leaves; door unlocks; progress counter ticks |

### Biome function

One pure function in `src/world/biome.ts` maps `(complexity, security, kind)` to
biome parameters: ambient light, fog density, palette, enclosure (open field →
building → dungeon), ambient sound, and NPC form family. Rough mapping:

| Complexity + security | Biome |
|-----------------------|-------|
| low, low | sunlit meadow, open sky, friendly creatures |
| mid, low | village or workshop, interiors with windows |
| high, low | industrial complex, long corridors |
| any, high | dungeon or horror: dark, fog, torchlight, hostile forms |

This function is the second review surface. Change feel here, not in the client.

### Look

**The bar is a current stylized game: Fortnite is the minimum, not the ceiling.**
Stylized, not photoreal. Readable silhouettes, saturated biome palettes, and polish.

| Area | Bar |
|------|-----|
| Characters | skinned, rigged, animated (idle, talk, react, leave); faces with expression; a base body per NPC form with variants. Data picks variant, scale, palette, accessories, and animation state |
| Environment | dense, layered props and foliage; real architecture for buildings and dungeons; terrain with height and material blends, not flat floors |
| Materials | stylized PBR: albedo, normal, roughness; compressed textures; no flat-shaded faces as the default |
| Light | one dynamic sun or key light with soft shadows (technique per tier chosen in M7: filtered PCF or VSM); ambient occlusion; emissive practicals (torches, lamps, windows) that glow through bloom instead of each being a real-time light |
| Post | tone mapping, bloom, color grade per biome, fog. Owned by the biome, like everything else about mood |
| Motion | animated foliage, water, particles, camera feel; nothing in the world is perfectly still |

**Assets.** Characters and hero props are generated by `scripts/assets/` (Meshy), a script
that records each asset's prompt, provider task ids, and license in a manifest. Generated files are checked
in, compressed (glTF with meshopt, KTX2 or WebP textures), and within a size budget, so the
game runs without generator keys. Architecture, terrain, and scatter stay procedural where
they meet the bar. No asset is ever derived from issue text or other `data/`.

**Performance.** The look has a budget, measured on a reference machine, not guessed.

| Target | Value |
|--------|-------|
| Reference machine | Intel UHD 750-class integrated GPU, 1080p |
| Frame time | 60 fps (16.7 ms) average, no frame over 50 ms after warm-up, in the largest region of a 500-issue world |
| Quality tiers | low (reference machine), high (discrete GPU): resolution scale, shadow quality, post, and density scale; the look is designed for high and degrades gracefully |
| Region load | under 250 ms, with no shader compiles after the first visit |

Rules that keep the budget: repeated things (NPC bodies, props) are instanced or
batched; one shadow-casting light, its shadow map refreshed only when needed; practical
lights are emissive plus bloom, not real-time point lights; level of detail and
impostors past mid distance; dynamic resolution on the low tier; a fixed light and
material set per biome so shaders compile once. Baseline numbers and the harness live in
`docs/perf.md`.

**Engine.** three.js stays. Rendering moves to `WebGPURenderer` (with its WebGL2
fallback) if a spike shows the post stack and shadows fit the budget there.

## NPCs and dialogue

- Each NPC speaks **as the issue**, in first person, grounded only in the issue
  body, comments, labels, and its edges. It never invents facts about the code.
- Default prompts: "What are you?", "What do you need from me?", "What happens
  if I help you?", "Who are you connected to?" The last one highlights edges in
  the world.
- Dialogue is generated via OpenRouter with a persona per biome. Text first;
  voice input and output are behind a flag.
- The player's replies go through Jev to decide intent: `verify`, `close`,
  `comment`, `defer`, `need-more`. Below the confidence threshold the game asks
  "Did you mean…?" rather than acting.

## Write-back safety

1. Dry run by default. `--live` is required to touch GitHub.
2. Every live action is shown in game and confirmed before it runs.
3. Closing requires the intent to be `verify` or `close` with confidence above
   the threshold in `src/questions.ts`, plus confirmation.
4. Every action is appended to `data/audit.jsonl` as one JSON line per state change:
   `{ id, at, mode, repo, issue, type, payload, outcome, handle?, error? }` with `outcome`
   one of `pending`, `applied`, `dry-run`, `failed`, `undone`; undo lines have
   `type: "undo"` and `payload.undoOf`. Undo reopens, deletes the comment, or reverses the label
   using the `handle` recorded on the applied line.
5. Comments are posted as the token's user and are prefixed so they are
   recognizable as coming from this tool.

## Principles

1. Code decides, models answer. Routing on confidence, never on vibes.
2. Fixtures over network. Every stage runs on checked-in fixture data without keys.
3. One place for words and numbers: `src/questions.ts` and `src/world/biome.ts`.
4. Build the walking skeleton end to end before deepening any stage.
5. Feel follows data. If a change makes the world look nicer but the mapping is no
   longer explainable from the issue data, it is wrong.
6. Deterministic output for the same input. Seeds, sorted keys, stable IDs.
7. Nothing irreversible without a confirmation and an audit entry.
8. Keep it runnable by an agent. No manual asset steps, no GUI-only tooling. Asset
   generation is a scripted step with a manifest; playing never needs a generator key.
9. Look is measured, not asserted. Visual changes come with screenshots scored on the
   `threejs-aaa-graphics-builder` scorecard and frame times on the reference machine.

## Milestones

| # | Milestone | Done when |
|---|-----------|-----------|
| M0 | Foundation | web client scaffold exists, `make check` covers it, fixtures of real-shaped issues are in the repo, `data/` is ignored |
| M1 | Ingest and classify | one command produces `classified.json` for a configured repo with every dimension and confidence |
| M2 | Relate | `graph.json` validates, explicit and inferred edges present, regions and centrality computed, cycles reported |
| M3 | Build world | `world.json` generated for any lens, deterministic, biome assigned per region |
| M4 | Walk | first person movement through regions with HUD, minimap, map screen, doors and portals, from a fixture world |
| M5 | Talk | NPCs render per issue, dialogue grounded in issue data, intent classified |
| M6 | Act | comments and closes reach GitHub in live mode with confirmation, audit, undo, and the NPC leaves |
| M7 | Budget | render rules in "Look" applied; performance targets met at 500 issues on the reference machine with the look of the `docs/perf.md` baseline |
| M8 | Look | asset kit and manifest, skinned and animated NPC forms, biome post stack; scorecard at the "Look" bar with M7 targets still met |
| M9 | Feel | biome polish, motion, voice |

## On-track questions

Each pull request should be able to answer yes, or explain why not.

1. Which pipeline stage does this touch, and does the stage's contract still hold?
2. Does it run on fixtures with no network and no keys?
3. If it adds a judgment, is it a Jev question in `src/questions.ts` with a threshold?
4. If it changes the look or feel, is the change expressed in the biome function or the graph, not hard-coded in the client?
5. If it changes rendering or assets, does it hold the frame budget on the reference machine, with numbers?
6. Is output deterministic for the same input?
7. If it can write to GitHub, is it dry run by default, confirmed, audited, undoable?
8. Does `make check` pass?

## Decisions (2026-10-10)

| Question | Decision |
|----------|----------|
| Which repository's issues first? | This repo to build against; **startly-io/startly** is the daily target (private, ~50 open issues, local clone at `TRIAGE_REPO_PATH`) |
| Where is the target repo's code for Interrogate? | a local path in `TRIAGE_REPO_PATH` |
| Expected issue count? | about 100; design for 50 to 500 |
| Write-back identity | the `GITHUB_TOKEN` user, comments prefixed with `[triage]` |
| Closing without in-game confirmation | never from the game. Issues closed outside the game are picked up on the next ingest and their NPCs leave |
| Web client packaging | `web/` as a second npm workspace with Vite and three.js |
| Voice stack | Chromium Web Speech API for input and output first; ElevenLabs through OpenRouter for NPC voices if cost is acceptable, behind a flag |
| Art direction | ~~procedural low poly, flat shading~~ superseded 2026-10-10: current stylized game, Fortnite as the minimum (see "Look"); palette per biome; built and scored with the `threejs-*` skills |
| Engine | three.js stays (2026-10-10). Profiling showed the cost is shadows, real-time point lights, fill rate, and non-instanced NPCs, all fixable in three (`docs/perf.md`); DOM over canvas remains the UI layer. Voxel or Minecraft-style direction rejected: it lowers the bar and is not faster by itself |
| Assets | generated by scripted skills, checked in with a manifest; see "Look" |
| Asset sourcing | decided 2026-10-11, revised the same day: generated with **Meshy** (`MESHY_API_KEY` in Heka Vault) through `scripts/assets/` — concept image, image-to-3D, humanoid auto-rig, library animations, then `pack.ts` compresses into `web/public/assets` and writes the manifest. Paid plan: the customer owns the output (Meshy Terms 3.2). Tripo was dropped: its API wallet had no credits |
| Asset storage | decided 2026-10-11: committed directly to the repo, no Git LFS; compressed (glTF with meshopt, KTX2 or WebP textures); total budget about 20 MB, enforced by a test over the manifest |
| Quality tier | decided 2026-10-11: "auto" picks low for integrated, mobile, and software GPUs (WebGL renderer string) and high otherwise; Settings overrides it (Auto, Low, High; applied on reload). Low: no MSAA, DPR 1, 1024 shadow map, dynamic resolution 60–100%. High: MSAA, DPR up to 2, 2048 map, 75–100% |
| Open: WebGPU | spike `WebGPURenderer` during M7; adopt only if it meets the budget with the M8 post stack |
| Repo visibility | stays public; all data under `data/` is gitignored |
| Jev model pin | latest `jev-1.x` at the time M1 lands, recorded in `src/questions.ts` |
