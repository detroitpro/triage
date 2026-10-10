import type { World } from "../../src/world/types.ts";
import { FIXTURE_WORLD_URL } from "./pure/worldUrl.ts";

export interface Loaded {
  world: World;
  url: string;
  fallback: boolean;
}

/** Fetch a world file; on 404 (or any failure) fall back to the bundled fixture. */
export async function loadWorld(url: string, fetchFn: typeof fetch = fetch): Promise<Loaded> {
  try {
    const res = await fetchFn(url);
    if (res.ok) {
      const world = (await res.json()) as World;
      if (world.version !== 1 || !Array.isArray(world.regions)) throw new Error("bad world file");
      return { world, url, fallback: false };
    }
  } catch (err) {
    console.warn(`world load failed for ${url}:`, err);
  }
  if (url === FIXTURE_WORLD_URL) throw new Error("fixture world missing");
  const res = await fetchFn(FIXTURE_WORLD_URL);
  if (!res.ok) throw new Error(`fixture world missing (${res.status})`);
  return { world: (await res.json()) as World, url: FIXTURE_WORLD_URL, fallback: true };
}
