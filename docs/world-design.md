# World design brief

The gameplay-systems skill asks for three artifacts before a broad build. These are
the issue world's versions. Charter: `docs/CHARTER.md`.

## Design brief

- **Player promise.** Walk through your backlog as a place. Every open issue is someone
  standing in a landscape whose mood tells you how hard and how dangerous it is.
- **Target feeling.** Calm curiosity in the meadow, focus in the workshop, unease in the
  dungeon. Progress feels like clearing a place of its inhabitants.
- **Primary verb.** Talk (approach an NPC, press E, read, reply).
- **Secondary verbs.** Walk, look, travel through doors and portals, switch lens, mark reviewed,
  close (write-back, later milestone).
- **5 to 30 second loop.** Spot a labeled NPC, walk to it, open dialogue, learn what it is and
  who it is connected to, decide: reviewed, reply, or move on.
- **1 to 5 minute arc.** Clear a region. Locked doors open as blockers close. The end-of-region
  prompt offers the next region.
- **Lose / learn / restart.** No fail state. Confusion is the cost: a region you cannot read.
  Readability is the whole design problem.
- **Reward and risk.** Reward: a region emptied, a door unlocked, counters ticking. Risk:
  write-back is irreversible without undo, so it is gated and confirmed.
- **Better player.** Uses the map and lenses to choose a region, follows blocking chains in
  topological order, uses "who are you connected to" before deciding.
- **Next decision.** Always visible: the nearest unreviewed NPC label, a door label, the
  region counter, the minimap.
- **Non-goals for this slice.** Combat, inventory, multiplayer, voice, generated assets.

## Core loop contract

Player does **talk** to achieve **a reviewed region** while **blocked doors and
dark regions** create pressure; success gives **an unlocked door and a cleared counter**,
failure costs **nothing but time**, retry is **instant** (walk to the next NPC).

Proof in code: E maps to dialogue (`player.ts`, `game.ts`); the objective is the HUD counter and
minimap dots; pressure is the biome and locked doors (`doors.ts`); reward changes state
(`progress.ts`, door unlock); no restart needed.

## Level plan

- **Spatial format.** A hub plaza with one portal per region; regions are tiled zones sized
  by issue count; doors on shared walls follow graph edges; portals for distant regions.
- **Camera.** First person at 1.7 m, FOV 75 default. Sees the current zone, its NPCs, its
  doors. Fog hides the tile grid beyond.
- **Start, first decision, first reward.** Spawn in the hub facing the portal ring; choose a
  region; the first NPC is a few steps inside the entrance.
- **Landmarks.** The region banner on entry, the hub portal behind you, a central NPC sized by
  centrality, doors on the walls labeled with their destination.
- **Escalation.** Lenses: feature is gentle, security and complexity lenses push the player
  toward dungeons. Locked doors chain regions in dependency order.
- **Recovery beats.** The hub, the map screen, the meadow regions.
- **Telegraphs.** Locked doors are red with the blocker's name; quarantined NPCs are marked;
  dungeons are visible as dark tiles on the map.
- **Modular pieces.** Everything is parameterized by `Biome` from the pipeline: palette,
  enclosure, props, NPC form, light levels. The client never decides mood from issue data.

## Art direction

> Superseded in part (2026-10-10): the bar is now a current stylized game, Fortnite as the
> minimum; see the charter's "Look" section. The kits and material roles below still apply;
> flat shading and low poly do not. Light stacks follow the charter's render rules: one key
> light per biome, practicals are emissive plus bloom, not real-time lights.

One kit per biome, materials as named roles
shared across kits (`groundContact`, `bodyPrimary`, `trim`, `hazard`, `emissiveSignal`,
`glass`, `decalDark`). UI colors come from the current biome palette. Four biomes:

| Biome | Kit | Light stack |
|-------|-----|-------------|
| sunlit meadow | layered trees, rocks, grass cards, flowers, split-rail fence, far hills | warm key, sky fill, rim, soft shadows |
| village workshop | timber-frame walls, lit windows, market stalls, crates, lanterns, cobble decals, roof silhouettes beyond | warm key through windows, emissive lanterns |
| industrial complex | pipes, tanks, gantries, hazard stripes, caged lamps, ducts, chain-link | cool key, emissive sodium lamps, rim |
| dungeon | stone block walls with trim, torches with flicker, chains, bones, pillars, drips | dim cool key, emissive torches with bloom, low fill, strong rim on NPCs |

NPC forms are authored silhouettes recognizable as dark shapes: creature (round body, ears,
feet, tail), villager (body, head, hat, apron, satchel), worker (helmet, visor, vest, tool),
shade (cloak, hood, glowing eyes, floating). Scale from centrality.

## Interaction contract (decided 2026-10-10)

The game must not recreate the GitHub page. Every GitHub verb has a physical verb, a
visible state on the NPC, and immediate feedback. There is no "manage issue" menu.

| GitHub verb | Physical verb | Visible state | Feedback |
|-------------|---------------|---------------|----------|
| add label | **give** a token from the satchel (I) | badge on the NPC's body, tabard color for the context | badge snaps on, banner, sound |
| remove label | **take** a badge off the NPC | badge gone, token back in the satchel | badge detaches |
| comment | **say** it: reply, then choose "Say it" on the choice wheel | speech bubble marked as posted | bubble seals |
| close (completed) | **release**: verify, NPC bows out | NPC leaves, counter ticks, doors unlock | region banner |
| close (not planned) | **send through the hourglass door** | NPC walks out | banner |
| close (duplicate) | **lead** to the twin, they merge | one NPC remains | merge animation |
| blocked by | **chain** to another NPC (C) | chain between them, locked door | chain sound |
| assign | **recruit**: banner with the login; self-assign makes them follow | banner | — |
| milestone | **send to camp**: campfire per milestone | NPC sits at the camp | — |

Rules the playtester agent checks:

1. Physical verb, visible state, instant feedback: the NPC changes within 100 ms of the action.
2. Commit by holding, not by modal: a hold-to-confirm ring around the reticle names the action;
   releasing early cancels. This is the charter's confirmation step.
3. Undo is an item: a rewind token appears for 30 s after any live action and reverses it
   through the audit log.
4. Dry run is visible: without `--live`, badges, chains, and seals render as ghosts and the HUD
   shows a "practice" tag. A region can be rehearsed end to end.
5. Text is a fallback: free-form replies stay, but anything that is really a verb is
   interpreted by Jev and offered as the physical action instead of posted as prose.

Satchel: the repo's labels as tokens. Shape from the namespace (`context:` crest, `app:` tool,
`platform:` gear, `feature:` scroll, `performance` stopwatch, `needs-info` lantern, `later`
hourglass, `infra` wrench, otherwise a plain tag), color from the GitHub label color, lore
text from the label description, count from how many open issues wear it. Unused tokens are dim.

## Scorecard (fixture world, 2026-10-10)

Genre equivalents: Hero = the NPCs (what you look at and approach); Obstacles = locked doors
and dungeon mood; Rewards = reviewed marks and unlocked doors; VFX = travel, talk, review feedback.

| Category | Before | After | Evidence |
|----------|-------:|------:|----------|
| Art direction | 1 | 2 | biome drives forms (tree tiers, timber frames, stone blocks), materials, lighting, and the HUD palette via `applyBiomeTheme` |
| Hero/player (NPCs) | 1 | 2 | four authored silhouettes with named joints, material zones, contact disc, per-form idle |
| Obstacles (doors, dungeon) | 1 | 2 | door frames with lintel, keystone, lit sign plate; locked = hazard bar + pulsing red lamp; portals with counter-rotating rings |
| Rewards (reviewed, unlock) | 1 | 2 | reviewed banner, counter punch, meter spring fill, minimap ring, emissive badge on the NPC |
| World/environment | 1 | 2 | near/mid/far layers per biome: grass cards and rocks, stalls and crates, far hills, roofs, stalactites |
| Materials | 1 | 2 | 27 shared roles per biome, 5 canvas textures (hazard, windows, cobbles, flagstones, steel), vertex-tinted ground |
| Lighting/render | 1 | 2 | sRGB + ACES, exposure per biome, key/fill/rim, one 2048 shadow key, torch practicals with flicker |
| VFX/motion | 1 | 2 | accel/decel curves, sprint FOV ease, head bob by speed, landing dip, travel FOV pull, reduced-motion fallback |
| UI/HUD | 1 | 3 | status cluster, region meter, compass strip, framed minimap, keycap prompt, biome-themed palette; no stat cards |
| Performance evidence | 1 | 2 | inspector metrics and renderer diagnostics below, all within the desktop budget |

Average 2.1 (premium needs 2.3). Next passes: dungeon readability (contrast 26), label scaling in dense regions, map layout above ~10 regions.

Measured (desktop 1280×720, software GL so FPS is not valid; `docs/evidence/`):

| View | entropy bits | edge density | contrast | draw calls | triangles |
|------|-------------:|-------------:|---------:|-----------:|----------:|
| meadow | 2.51 → 4.41 | 0.128 → 0.248 | 142 → 182 | 230 | 38k |
| village | 2.48 → 4.60 | 0.113 → 0.428 | 82 → 84 | 233 | 24k |
| dungeon | 0.31 → 2.39 | 0.020 → 0.055 | 8.9 → 26 | 115 | 27k |
| hub | not captured → 5.0 | → 0.419 | → 191 | 64 | 29k |

Budget: ≤300 calls, ≤750k triangles, 1 shadow light (2048), ≤4 practicals per region, no post passes.
