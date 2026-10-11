# Performance baseline

The budget is in the charter ("Look"). This file holds the measured numbers and how to
reproduce them. Re-run after any rendering change and update the tables.

## Harness

```bash
npx tsx scripts/perf/scale-world.ts 500                 # data/world-500/<lens>.world.json
npm run dev -w web                                      # http://localhost:5173
node scripts/perf/measure.mjs regions /data/world-500/feature.world.json
node scripts/perf/measure.mjs ablate  /data/world-500/feature.world.json <region-id>
PERF_VSYNC=1 node scripts/perf/measure.mjs regions ...  # what a player sees; real worst frames
```

`scale-world.ts` copies the real graph until it has N issues and replaces the repo with a
placeholder, so a live server cannot act on the copies. Regions and doors keep their
count and get denser, so it stresses NPC count, not door count. `measure.mjs` drives
headed Chromium on the real GPU at 1920×1080, DPR 1 (`PERF_WIDTH`, `PERF_HEIGHT`), warms
every area once (shader compiles), then pans 360° for 3 s from the entrance. Without
`PERF_VSYNC` the average is GPU throughput and worst frames include queue stalls; worst
frames only mean something with `PERF_VSYNC=1`.

Area names below are neutral: the source world comes from a private repository.

## Baseline (2026-10-11, the look of 8070cc9)

Reference machine: Intel UHD 750 (RKL GT1, Mesa, ANGLE GL), 1920×1080, DPR 1.
Runs vary by about ±15%; compare runs from the same session.

### Per area, 500-issue world, warm

| Area | Issues | fps (vsync off) | fps (vsync on) | Worst frame, vsync on | Draw calls | Triangles | Point lights | Build |
|------|-------:|----:|----:|-----:|------:|-----:|---:|-----:|
| feature hub | 0 | 25 | 26 | 150 ms | 178 | 57k | 15 | 11 ms |
| feature, largest | 100 | 32 | 25 | 133 ms | 3,530 | 217k | 5 | 60 ms |
| feature, 72 issues | 72 | 32 | 27 | 128 ms | 2,535 | 112k | 5 | 18 ms |
| feature, smallest | 10 | 58 | 47 | 67 ms | 425 | 42k | 1 | 8 ms |
| security hub | 0 | 55 | 45 | 67 ms | 55 | 34k | 3 | 13 ms |
| security, largest | 256 | 29 | 22 | 133 ms | 7,639 | 446k | 5 | 86 ms |
| security, 224 issues | 224 | 27 | 24 | 183 ms | 6,699 | 406k | 5 | 58 ms |

At the real 49-issue world, areas run at 39–66 fps (vsync off) and the feature hub at 33.
No area meets the 60 fps budget at 500 issues; the best is 47 fps.

### What each cost is worth (ablation, avg ms per frame, vsync off)

| Variant | feature hub (500) | feature, largest (500) | security, 224 (500) | feature, largest (49) |
|---------|------:|------:|------:|------:|
| baseline | 22.6–32.7 | 29.8 | 32.8 | 23.3 |
| no shadows | 15.6 | 12.7 | 18.0 | 13.5 |
| no point lights | 15.1 | 24.8 | 27.8 | 16.3 |
| no shadows, no point lights | 13.1 | 11.3 | 15.9 | 10.7 |
| half resolution | 15.3 | 16.4 | 18.7 | 11.5 |
| no NPC labels | ≈ baseline | 30.4 | 32.5 | 25.4 |
| no NPCs | ≈ baseline | 18.2 | 18.2 | 19.4 |
| no NPCs, no shadows, no point lights | 14.4 | 11.4 | 16.3 | 10.4 |
| half res, no shadows, no point lights | 6.7 | 8.4 | 10.7 | 5.9 |

## Findings, by payoff

1. **Shadows are the biggest single cost**: removing them saves 40–60% of the frame. 2048
   map, PCF (three r186 removed `PCFSoftShadowMap` and falls back with a warning),
   rendered every frame, and every NPC part casts.
2. **Fill rate.** Half resolution saves 30–50%, so the GPU is fragment bound: MSAA,
   `MeshStandardMaterial` everywhere, and per-pixel point lights. At DPR 2 on a laptop
   this is four times the pixels.
3. **Real-time point lights.** The feature hub has one per portal (15) and is the slowest
   area with no NPCs at all. Light count also varies per area, so materials recompile on
   area changes (programs grow from 18 to 86 across a tour).
4. **NPCs are not instanced.** About 35 meshes and draw calls per NPC; 7,600 calls in the
   densest area. Worth 10–15 ms at 100–250 NPCs, and the main CPU cost on faster GPUs.
5. **Labels are cheap.** One canvas texture per NPC, within noise. Not a priority.

None of these is specific to three.js; any forward renderer pays the same for the same
scene. The fixes are the render rules in the charter's "Look" section (milestone M7).

## M7 progress

fps with vsync off (GPU throughput) per step, same harness and machine. Each cell after
the baseline is the median of 5 passes (`PERF_REPEAT=5`, step 1 re-measured that way);
runs vary by up to ±20% in dense areas, so differences under that are noise. Vsync-on fps stays near 30 until a frame fits in 16.7 ms, so it moves last.

| Step | feature hub | feature, largest (100) | feature, smallest (10) | security, 256 | security, 224 |
|------|----:|----:|----:|----:|----:|
| baseline (single pass) | 25 | 32 | 58 | 29 | 27 |
| 1. static shadow map; NPCs and animated parts stop casting | 36 | 51 | 127 | 40 | 48 |
| 2. no real-time point lights; practicals are glow cards | 59 | 69 | 130 | 43 | 44 |

After step 2 the feature tour compiles 36 shader programs instead of 53 and the count holds
across the tour. The dense security areas are bound by NPC draw calls (step 4).

### What players see (vsync on)

Median of 3 passes with no other GPU load; the low tier holds frame time with dynamic
resolution, so the scale it settled at is part of the result. Earlier step-3 numbers taken
while a playtest shared the GPU were 10–15% low and are replaced here.

| Step | feature hub | feature, largest (100) | feature, smallest (10) | security, 256 | security, 224 |
|------|----:|----:|----:|----:|----:|
| baseline | 26 | 25 | 47 | 22 | 24 |
| 3. quality tiers, dynamic resolution (low tier: no MSAA, 1024 shadows) | 60 @ 0.8 | 57 @ 0.65 | 60 @ 0.9 | 49 @ 0.6 | 54 @ 0.6 |
| 4. far NPCs as an instanced crowd, labels past 28 m hidden | 60 @ 0.8 | 57 @ 0.6 | 60 @ 0.9 | 45 @ 0.6 | 48 @ 0.6 |

`@` is the dynamic resolution scale. Step 4 cuts draw calls in the densest area from ~6,600
to ~250, and at a fixed scale hiding every NPC now moves fps only 67 → 70, so NPCs no longer
cost the GPU; the step 3 → 4 differences above are within run-to-run noise. On this GPU
the dense areas are bound by the environment: fill (half resolution: 67 → 88 fps at a fixed
scale) and shadow-map sampling on every receiving pixel (no shadows: 67 → 97).

## M7 gate (2026-10-11, all five steps)

Every area, 500-issue worlds and the real 49-issue world, vsync on, median of 3, low tier.

| World | Areas | fps | Worst frame | Region load |
|-------|------:|-----|-------------|-------------|
| real, 49 issues (feature lens) | 16 | 55–60 | ≤ 50 ms | ≤ 17 ms |
| 500 issues, feature lens | 16 | 55–60 | ≤ 67 ms (4 areas over 50) | ≤ 28 ms |
| 500 issues, security lens: hub, high-security | 2 | 58–60 | ≤ 33 ms | ≤ 11 ms |
| 500 issues, security lens: 224 and 256 NPCs | 2 | 47, 43 | 50, 83 ms | 59, 113 ms |

**Status: not met in full.** Met: region load under 250 ms everywhere, no shader compiles
after the first visit, 55–60 fps in every area up to 100 NPCs. Not met: the two areas with
224–256 NPCs (43–47 fps at the 0.6 resolution floor), and a few worst frames between 50 and
83 ms. Next levers, by measured payoff: cheaper shadow filtering on the low tier (shadow
sampling is ~30% of a dense frame), spatial chunks for scattered props so off-screen ones
are culled (373k triangles in the densest area, all from the environment), and a lower
resolution floor on the low tier. A 250-NPC region is also a layout question: the
pipeline could split regions that large.

## M8: generated characters (2026-10-11)

Meshy characters (one skinned mesh of ~15.5k triangles per near NPC, far crowd simplified at
bake time to ~5.5k triangles per body, uv seams kept so colours do not smear), vsync on, median of 3, low tier, 500 issues.

| Area | Issues | fps | Worst frame | Draw calls | Triangles | Scale |
|------|------:|----:|----:|----:|----:|----:|
| feature hub | 0 | 60 | 17 ms | 126 | 59k | 1.0 |
| feature, smallest | 10 | 60 | 17 ms | 78 | 162k | 1.0 |
| feature, largest | 100 | 60 | 17 ms | 206 | 700k | 1.0 |
| security, 256 | 256 | 60 | 39 ms | 249 | 1,688k | 0.95 |
| security, 224 | 224 | 60 | 23 ms | 185 | 1,449k | 1.0 |

The densest areas, which missed the M7 gate at 43–47 fps, now hold 60 fps at full resolution:
a near NPC is one draw call instead of about 35, and far bodies are simplified. Without the
far simplification the densest area drew 3.6M triangles and fell to 36 fps.
