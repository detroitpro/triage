import type { Vec3 } from "../../../src/world/types.ts";
import type { Bounds } from "./collision.ts";

export interface Projection {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Fit `bounds` (XZ world rectangle) into a canvas of `width` x `height` pixels
 * with `pad` pixels of margin, preserving aspect ratio and centering.
 */
export function fitProjection(bounds: Bounds, width: number, height: number, pad = 8): Projection {
  const innerW = Math.max(1, width - pad * 2);
  const innerH = Math.max(1, height - pad * 2);
  const scale = Math.min(innerW / Math.max(bounds.w, 1e-6), innerH / Math.max(bounds.d, 1e-6));
  const drawnW = bounds.w * scale;
  const drawnH = bounds.d * scale;
  return {
    scale,
    offsetX: pad + (innerW - drawnW) / 2 - bounds.x * scale,
    offsetY: pad + (innerH - drawnH) / 2 - bounds.z * scale,
  };
}

/** World XZ to canvas pixel. +X right, +Z down (matching a top-down view). */
export function project(p: Projection, pos: Vec3 | [number, number]): [number, number] {
  const x = pos[0];
  const z = pos.length === 3 ? pos[2] : pos[1];
  return [x * p.scale + p.offsetX, z * p.scale + p.offsetY];
}

/**
 * Triangle for the player's heading. `yaw` follows three.js convention: yaw 0
 * looks down -Z, positive yaw turns toward -X (counter-clockwise from above).
 */
export function headingTriangle(
  center: [number, number],
  yaw: number,
  size: number,
): [[number, number], [number, number], [number, number]] {
  const fx = -Math.sin(yaw);
  const fy = -Math.cos(yaw);
  const [cx, cy] = center;
  const tip: [number, number] = [cx + fx * size, cy + fy * size];
  const rx = -fy;
  const ry = fx;
  const back = 0.7;
  const left: [number, number] = [
    cx - fx * size * back + rx * size * 0.6,
    cy - fy * size * back + ry * size * 0.6,
  ];
  const right: [number, number] = [
    cx - fx * size * back - rx * size * 0.6,
    cy - fy * size * back - ry * size * 0.6,
  ];
  return [tip, left, right];
}
