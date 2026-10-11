import type { Vec3 } from "../../../src/world/types.ts";
import type { Bounds } from "./collision.ts";
import { hashString, mulberry32 } from "./rng.ts";

export interface PropInstance {
  family: string;
  position: Vec3;
  rotation: number;
  scale: number;
}

/** Props that stand along walls instead of being scattered across the floor. */
const WALL_PROPS = new Set(["torch", "lamp", "pipe"]);

/**
 * Deterministic prop scatter for a region. The seed is derived from the region id and
 * the issue numbers it holds, so the layout is stable as long as the issue set is.
 * Props avoid a clearance circle around each `avoid` point (NPCs, doors, entrance).
 */
export function scatterProps(opts: {
  regionId: string;
  issues: number[];
  bounds: Bounds;
  families: string[];
  avoid: Vec3[];
  density?: number;
  clearance?: number;
}): PropInstance[] {
  const families = opts.families.filter((f) => f.length > 0);
  if (families.length === 0) return [];
  const seed = hashString(`${opts.regionId}:${[...opts.issues].sort((a, b) => a - b).join(",")}`);
  const rand = mulberry32(seed);
  const density = opts.density ?? 0.02;
  const clearance = opts.clearance ?? 2.5;
  const area = opts.bounds.w * opts.bounds.d;
  const target = Math.min(400, Math.max(4, Math.round(area * density)));
  const out: PropInstance[] = [];
  const margin = 1;
  let attempts = 0;
  while (out.length < target && attempts < target * 6) {
    attempts++;
    const family = families[Math.floor(rand() * families.length)] ?? families[0] ?? "crate";
    let x: number;
    let z: number;
    let rotation: number;
    if (WALL_PROPS.has(family)) {
      // Hug one of the four walls.
      const side = Math.floor(rand() * 4);
      const t = rand();
      const b = opts.bounds;
      if (side === 0) [x, z, rotation] = [b.x + margin, b.z + t * b.d, Math.PI / 2];
      else if (side === 1) [x, z, rotation] = [b.x + b.w - margin, b.z + t * b.d, -Math.PI / 2];
      else if (side === 2) [x, z, rotation] = [b.x + t * b.w, b.z + margin, 0];
      else [x, z, rotation] = [b.x + t * b.w, b.z + b.d - margin, Math.PI];
    } else {
      x = opts.bounds.x + margin + rand() * Math.max(0, opts.bounds.w - margin * 2);
      z = opts.bounds.z + margin + rand() * Math.max(0, opts.bounds.d - margin * 2);
      rotation = rand() * Math.PI * 2;
    }
    const scale = 0.7 + rand() * 0.6;
    let blocked = false;
    for (const a of opts.avoid) {
      const dx = a[0] - x;
      const dz = a[2] - z;
      if (dx * dx + dz * dz < clearance * clearance) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    out.push({ family, position: [x, 0, z], rotation, scale });
  }
  return out;
}
