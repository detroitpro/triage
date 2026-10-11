// NPC level of detail by distance, with hysteresis so NPCs on the boundary do not flicker.

/** Inside this many metres an NPC is drawn at full detail and animated. */
export const NEAR = 16;
/** It drops to the instanced far body only past this, once near. */
export const FAR = 19;
/** Name labels past this distance are unreadable; hide them. */
export const LABEL = 28;

export interface NpcLod {
  detail: "near" | "far";
  label: boolean;
}

export function lodFor(distance: number, previous: NpcLod | undefined, forceNear = false): NpcLod {
  const wasNear = previous ? previous.detail === "near" : distance <= NEAR;
  const near = forceNear || distance <= NEAR || (wasNear && distance <= FAR);
  return { detail: near ? "near" : "far", label: distance <= LABEL };
}
