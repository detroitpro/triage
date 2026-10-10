import type { Door, Vec3 } from "../../../src/world/types.ts";
import { distanceXZ } from "./collision.ts";

export const DOOR_TRIGGER_DISTANCE = 1.5;

/**
 * Decide whether walking at `pos` should trigger a door. Locked doors never trigger.
 * `armed` is a per-door latch: a door only fires once the player has left its radius
 * since the last travel, so arriving next to a door does not bounce you straight back.
 */
export function findTriggeredDoor(
  pos: Vec3,
  doors: Door[],
  armed: ReadonlySet<string>,
  radius = DOOR_TRIGGER_DISTANCE,
): Door | null {
  let best: Door | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const door of doors) {
    if (door.locked) continue;
    if (!armed.has(door.id)) continue;
    const d = distanceXZ(pos, door.position);
    if (d <= radius && d < bestDist) {
      best = door;
      bestDist = d;
    }
  }
  return best;
}

/** Doors outside the radius become armed; returns the next armed set (pure). */
export function rearmDoors(
  pos: Vec3,
  doors: Door[],
  armed: ReadonlySet<string>,
  radius = DOOR_TRIGGER_DISTANCE,
): Set<string> {
  const next = new Set(armed);
  for (const door of doors) {
    if (distanceXZ(pos, door.position) > radius + 0.5) next.add(door.id);
  }
  return next;
}
