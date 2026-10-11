import type { Door, Vec3 } from "../../../src/world/types.ts";

/** Wrap an angle to [-π, π]. */
export function wrapAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
}

/**
 * The yaw a player at `from` would face to look at `to`. Yaw convention follows
 * three.js: yaw 0 looks down -Z, positive yaw turns toward -X.
 */
export function bearingTo(from: Vec3, to: Vec3): number {
  return Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));
}

/**
 * Signed screen offset of `to` relative to the view: negative = left, positive = right,
 * in radians.
 */
export function relativeBearing(yaw: number, from: Vec3, to: Vec3): number {
  return -wrapAngle(bearingTo(from, to) - yaw);
}

export type CompassKind = "door" | "portal" | "cardinal";

export interface CompassMark {
  id: string;
  kind: CompassKind;
  label: string;
  locked: boolean;
  /** Pixel x within the strip; 0 = left edge, width = right edge. */
  x: number;
  /** Mark lies beyond the strip's arc and was pinned to the edge. */
  clamped: boolean;
  /** Distance in world units (0 for cardinals). */
  distance: number;
}

export interface CompassOptions {
  yaw: number;
  player: Vec3;
  doors: Door[];
  width: number;
  /** Total visible arc of the strip in radians (default 180°). */
  arc?: number;
  labelFor?: (door: Door) => string;
}

/** Cardinal headings: north is -Z (minimap up). */
const CARDINALS: { label: string; heading: number }[] = [
  { label: "N", heading: 0 },
  { label: "E", heading: -Math.PI / 2 },
  { label: "S", heading: Math.PI },
  { label: "W", heading: Math.PI / 2 },
];

function toX(rel: number, arc: number, width: number): { x: number; clamped: boolean } {
  const half = arc / 2;
  const clamped = Math.abs(rel) > half;
  const k = Math.max(-1, Math.min(1, rel / half));
  return { x: width / 2 + k * (width / 2), clamped };
}

/** Marks for a horizontal compass strip. Cardinals come first, then doors by distance. */
export function compassMarks(opts: CompassOptions): CompassMark[] {
  const arc = opts.arc ?? Math.PI;
  const out: CompassMark[] = [];
  for (const c of CARDINALS) {
    const rel = -wrapAngle(c.heading - opts.yaw);
    const { x, clamped } = toX(rel, arc, opts.width);
    if (clamped) continue;
    out.push({
      id: `cardinal:${c.label}`,
      kind: "cardinal",
      label: c.label,
      locked: false,
      x,
      clamped,
      distance: 0,
    });
  }
  const doors = opts.doors
    .map((d) => {
      const rel = relativeBearing(opts.yaw, opts.player, d.position);
      const dx = d.position[0] - opts.player[0];
      const dz = d.position[2] - opts.player[2];
      return { d, rel, distance: Math.hypot(dx, dz) };
    })
    .sort((a, b) => b.distance - a.distance);
  for (const { d, rel, distance } of doors) {
    const { x, clamped } = toX(rel, arc, opts.width);
    out.push({
      id: d.id,
      kind: d.kind,
      label: opts.labelFor ? opts.labelFor(d) : d.to,
      locked: Boolean(d.locked),
      x,
      clamped,
      distance,
    });
  }
  return out;
}
