import type { Door } from "../../../src/world/types.ts";
import type { Bounds } from "./collision.ts";
import { fitProjection, project } from "./minimap.ts";

export interface MapTile {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export interface MapLink {
  id: string;
  from: string;
  to: string;
  kind: Door["kind"];
  locked: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface MapLayout {
  tiles: MapTile[];
  links: MapLink[];
  scale: number;
  width: number;
  height: number;
}

export interface MapSource {
  hub: { bounds: Bounds };
  regions: { id: string; label: string; bounds: Bounds }[];
  doors: Door[];
}

export const HUB_TILE_ID = "hub";

/** Union of all area rectangles on the XZ plane. */
export function worldExtent(src: MapSource): Bounds {
  const all = [src.hub.bounds, ...src.regions.map((r) => r.bounds)];
  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const b of all) {
    minX = Math.min(minX, b.x);
    minZ = Math.min(minZ, b.z);
    maxX = Math.max(maxX, b.x + b.w);
    maxZ = Math.max(maxZ, b.z + b.d);
  }
  if (!Number.isFinite(minX)) return { x: 0, z: 0, w: 1, d: 1 };
  return { x: minX, z: minZ, w: Math.max(1, maxX - minX), d: Math.max(1, maxZ - minZ) };
}

/**
 * Place every area by its world bounds, scaled to fit `width` x `height` pixels.
 * Door links run from the door's world position to the center of the target tile.
 */
export function layoutMap(src: MapSource, width: number, height: number, pad = 24): MapLayout {
  const extent = worldExtent(src);
  const proj = fitProjection(extent, width, height, pad);
  const tileOf = (id: string, label: string, b: Bounds): MapTile => {
    const [x, y] = project(proj, [b.x, b.z]);
    const w = b.w * proj.scale;
    const h = b.d * proj.scale;
    return { id, label, x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
  };
  const tiles: MapTile[] = [
    tileOf(HUB_TILE_ID, "Hub", src.hub.bounds),
    ...src.regions.map((r) => tileOf(r.id, r.label, r.bounds)),
  ];
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const links: MapLink[] = [];
  for (const d of src.doors) {
    const target = byId.get(d.to);
    if (!target || !byId.has(d.from)) continue;
    const [x1, y1] = project(proj, d.position);
    links.push({
      id: d.id,
      from: d.from,
      to: d.to,
      kind: d.kind,
      locked: Boolean(d.locked),
      x1,
      y1,
      x2: target.cx,
      y2: target.cy,
    });
  }
  return { tiles, links, scale: proj.scale, width, height };
}

export type Direction = "up" | "down" | "left" | "right";

const DIR: Record<Direction, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/**
 * Pick the tile nearest in `dir` from `currentId`, weighting sideways drift so arrow
 * keys feel spatial. Returns null when nothing lies that way.
 */
export function pickInDirection(
  tiles: MapTile[],
  currentId: string | null,
  dir: Direction,
): string | null {
  const cur = tiles.find((t) => t.id === currentId);
  if (!cur) return tiles[0]?.id ?? null;
  const [ux, uy] = DIR[dir];
  let best: { id: string; score: number } | null = null;
  for (const t of tiles) {
    if (t.id === cur.id) continue;
    const dx = t.cx - cur.cx;
    const dy = t.cy - cur.cy;
    const along = dx * ux + dy * uy;
    const across = Math.abs(dx * uy - dy * ux);
    if (along <= 0 || across > along * 1.5 + 1) continue;
    const score = along + across * 0.6;
    if (!best || score < best.score) best = { id: t.id, score };
  }
  return best?.id ?? null;
}

/** Next tile in list order (wraps). Fallback when no tile lies in the arrow direction. */
export function cycleTile(tiles: MapTile[], currentId: string | null, step: 1 | -1): string | null {
  if (tiles.length === 0) return null;
  const i = tiles.findIndex((t) => t.id === currentId);
  const n = tiles.length;
  const next = i < 0 ? 0 : (i + step + n) % n;
  return tiles[next]?.id ?? null;
}
