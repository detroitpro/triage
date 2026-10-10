import type { Vec3 } from "../../../src/world/types.ts";

export interface Bounds {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** Player radius used when clamping against region walls. */
export const PLAYER_RADIUS = 0.4;
/** Eye height above the floor. */
export const EYE_HEIGHT = 1.7;

/**
 * Clamp a position so the player stays inside `bounds` (minus radius) and never
 * drops below the floor. Pure: returns a new tuple.
 */
export function clampToBounds(pos: Vec3, bounds: Bounds, radius = PLAYER_RADIUS): Vec3 {
  const minX = bounds.x + radius;
  const maxX = bounds.x + bounds.w - radius;
  const minZ = bounds.z + radius;
  const maxZ = bounds.z + bounds.d - radius;
  const x = Math.min(Math.max(pos[0], Math.min(minX, maxX)), Math.max(minX, maxX));
  const z = Math.min(Math.max(pos[2], Math.min(minZ, maxZ)), Math.max(minZ, maxZ));
  const y = Math.max(pos[1], EYE_HEIGHT);
  return [x, y, z];
}

export function insideBounds(pos: Vec3, bounds: Bounds): boolean {
  return (
    pos[0] >= bounds.x &&
    pos[0] <= bounds.x + bounds.w &&
    pos[2] >= bounds.z &&
    pos[2] <= bounds.z + bounds.d
  );
}

/** Distance on the XZ plane (height is ignored for triggers). */
export function distanceXZ(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dz * dz);
}
