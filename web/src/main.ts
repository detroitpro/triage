import { preloadCharacters } from "./assets/CharacterKit.ts";
import { Game } from "./game/game.ts";
import { simplifierReady } from "./game/npcCrowd.ts";
import { loadWorld } from "./load.ts";
import { resolveWorldQuery } from "./pure/worldUrl.ts";

async function boot(): Promise<void> {
  const canvas = document.getElementById("view") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("missing #view canvas");
  const query = resolveWorldQuery(window.location.search);
  // Generated characters load alongside the world; any that fail keep their procedural body.
  const [loaded] = await Promise.all([
    loadWorld(query.url),
    preloadCharacters(),
    // Far crowds of generated characters are simplified at bake time.
    simplifierReady.catch(() => undefined),
  ]);
  const game = new Game(loaded.world, canvas);
  game.start(query.region);
  if (loaded.fallback) {
    const hint = document.getElementById("hud-hint");
    if (hint)
      hint.textContent = `${query.url} not found; showing fixture world · click to play · H help · Tab map`;
  }
}

boot().catch((err) => {
  const region = document.getElementById("hud-region");
  if (region) region.textContent = `failed to load world: ${String(err)}`;
  console.error(err);
});
