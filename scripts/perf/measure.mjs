// Frame-time harness for the web client. Headed Chromium on the real GPU with vsync off,
// so the average frame time is GPU throughput, not the display's refresh rate. Worst-frame
// numbers are only meaningful with PERF_VSYNC=1; without vsync the GPU queue stalls the CPU.
//
//   node scripts/perf/measure.mjs regions <world-url>            every area: frame time, renderer.info, build time
//                                                                 (PERF_REGIONS=a,b to limit, PERF_REPEAT=n for a median)
//   node scripts/perf/measure.mjs ablate <world-url> <region>     one area, one cost removed at a time
//
// Needs `npm run dev -w web` and @playwright/test (a web/ dev dependency, hoisted to the root) (PERF_URL, default http://localhost:5173) and a display.
// Each sample is a 3 s, 360° camera pan from the region entrance after a warm-up pass.
import { chromium } from "@playwright/test";

const BASE = process.env.PERF_URL ?? "http://localhost:5173";
const SECONDS = Number(process.env.PERF_SECONDS ?? 3);
const [mode, worldUrl, region = "hub"] = process.argv.slice(2);
if (!["regions", "ablate"].includes(mode ?? "") || !worldUrl) {
  console.error("usage: measure.mjs regions <world-url> | ablate <world-url> <region>");
  process.exit(2);
}

const browser = await chromium.launch({
  headless: false,
  args: [
    "--ignore-gpu-blocklist",
    // PERF_VSYNC=1 measures what a player sees (capped at the refresh rate, real hitches).
    ...(process.env.PERF_VSYNC ? [] : ["--disable-gpu-vsync", "--disable-frame-rate-limit"]),
  ],
});
const page = await browser.newPage({
  viewport: {
    width: Number(process.env.PERF_WIDTH ?? 1920),
    height: Number(process.env.PERF_HEIGHT ?? 1080),
  },
  deviceScaleFactor: 1,
});
// three.js announces its renderer and scenes to devtools; keep the first scene. That is the
// game's (game.ts creates one Scene and reuses it); revisit if a Scene is ever built earlier.
await page.addInitScript(() => {
  const hook = new EventTarget();
  window.__THREE_DEVTOOLS__ = hook;
  hook.addEventListener("observe", (e) => {
    const o = e.detail;
    if (o.isScene) window.__perfScene ??= o;
    else if (o.isWebGLRenderer || o.domElement) window.__perfRenderer = o;
  });
});
await page.goto(`${BASE}/?world=${encodeURIComponent(worldUrl)}`);
await page.waitForFunction(() => window.__triage && window.__perfRenderer);
if (
  await page.evaluate(() => document.getElementById("hud-hint")?.textContent?.includes("not found"))
)
  throw new Error(`${worldUrl} did not load; the client fell back to the fixture`);
const gpu = await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const ext = gl?.getExtension("WEBGL_debug_renderer_info");
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
});
console.log(`gpu: ${gpu}`);

/** In the page: teleport (optional), settle, pan for SECONDS, report. */
async function sample(areaId, variant) {
  return page.evaluate(
    async ({ areaId, variant, seconds }) => {
      const T = window.__triage;
      const R = window.__perfRenderer;
      const S = window.__perfScene;
      let buildMs = null;
      if (areaId) {
        const t0 = performance.now();
        T.teleport(areaId);
        buildMs = performance.now() - t0;
      }
      if (variant) {
        R.shadowMap.enabled = !variant.includes("no-shadows");
        window.__perfDpr ??= R.getPixelRatio();
        R.setPixelRatio(window.__perfDpr * (variant.includes("half-res") ? 0.5 : 1));
        S.traverse((o) => {
          if (o.isPointLight) o.visible = !variant.includes("no-point-lights");
          if (o.isSprite && o.parent?.name.startsWith("npc-"))
            o.visible = !variant.includes("no-npc-labels");
          if (o.name.startsWith("npc-")) o.visible = !variant.includes("no-npcs");
          const m = o.material;
          if (m) for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true;
        });
      }
      await new Promise((r) => setTimeout(r, 1500));
      const frames = [];
      let last = performance.now();
      const start = last;
      await new Promise((done) => {
        const step = (now) => {
          frames.push(now - last);
          last = now;
          T.setYawPitch(((now - start) / (seconds * 1000)) * Math.PI * 2, -0.05);
          if (now - start < seconds * 1000) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
      const sorted = [...frames].sort((a, b) => a - b);
      const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
      let points = 0;
      let meshes = 0;
      S.traverse((o) => {
        if (o.isPointLight && o.visible) points++;
        if (o.isMesh) meshes++;
      });
      const info = R.info;
      return {
        area: areaId ?? undefined,
        variant: variant ?? undefined,
        issues: T.world.regions.find((r) => r.id === areaId)?.placements.length,
        fps: Math.round(1000 / avg),
        avgMs: +avg.toFixed(1),
        worstMs: +(sorted.at(-1) ?? 0).toFixed(0),
        over50: frames.filter((f) => f > 50).length,
        calls: info.render.calls,
        triangles: info.render.triangles,
        textures: info.memory.textures,
        programs: info.programs?.length,
        meshes,
        points,
        buildMs: buildMs === null ? undefined : +buildMs.toFixed(0),
      };
    },
    { areaId, variant, seconds: SECONDS },
  );
}

if (mode === "regions") {
  // PERF_REGIONS=a,b limits the tour; PERF_REPEAT=n reports the median-fps pass of n.
  const only = process.env.PERF_REGIONS?.split(",");
  const repeat = Math.max(1, Math.floor(Number(process.env.PERF_REPEAT ?? 1)) || 1);
  const all = await page.evaluate(() => ["hub", ...window.__triage.world.regions.map((r) => r.id)]);
  const ids = only ? all.filter((id) => only.includes(id)) : all;
  for (const id of ids) await sample(id); // warm-up: first visit compiles shaders
  for (const id of ids) {
    const runs = [];
    for (let i = 0; i < repeat; i++) runs.push(await sample(id));
    runs.sort((a, b) => a.fps - b.fps);
    const median = runs[Math.floor(runs.length / 2)];
    console.log(
      JSON.stringify({ ...median, runs: repeat > 1 ? runs.map((r) => r.fps) : undefined }),
    );
  }
} else {
  await sample(region);
  const variants = [
    "baseline",
    "no-shadows",
    "no-point-lights",
    "no-shadows,no-point-lights",
    "half-res",
    "no-npc-labels",
    "no-npcs",
    "no-npcs,no-shadows,no-point-lights",
    "half-res,no-shadows,no-point-lights",
    "baseline",
  ];
  for (const v of variants) console.log(JSON.stringify(await sample(null, v)));
}
await browser.close();
