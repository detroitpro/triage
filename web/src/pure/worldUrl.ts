export const DEFAULT_WORLD_URL = "/data/world/feature.world.json";
export const FIXTURE_WORLD_URL = "/fixtures/sample.world.json";

export interface WorldQuery {
  url: string;
  region: string | null;
  lens: string | null;
}

/** Resolve which world file to load from the page's query string. */
export function resolveWorldQuery(search: string): WorldQuery {
  const params = new URLSearchParams(search);
  const lens = params.get("lens");
  const explicit = params.get("world");
  let url = DEFAULT_WORLD_URL;
  if (explicit) url = explicit;
  else if (lens) url = lensUrl(lens);
  return { url, region: params.get("region"), lens };
}

export function lensUrl(lens: string): string {
  return `/data/world/${encodeURIComponent(lens)}.world.json`;
}
