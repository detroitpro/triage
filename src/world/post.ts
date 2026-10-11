// Finishing-pass values per biome. Bloom thresholds stay above 1: unlit white (labels,
// paper, lit skin) tops out at 1.0, and only HDR emissive (glow cards, flames) passes.
// (charter "Look": post is owned by the biome). Dependency
// free so the client imports the same table for older world files and for the hub.
import type { BiomePost } from "./types.ts";

export const POST = {
  meadow: {
    bloom: 0.35,
    bloomThreshold: 1.05,
    saturation: 1.15,
    contrast: 1.06,
    warmth: 0.12,
    vignette: 0.25,
    environment: 0.22,
    wind: 1.0,
    clouds: 0.55,
  },
  plaza: {
    bloom: 0.35,
    bloomThreshold: 1.05,
    saturation: 1.1,
    contrast: 1.05,
    warmth: 0.1,
    vignette: 0.25,
    environment: 0.22,
    wind: 0.7,
    clouds: 0.45,
  },
  village: {
    bloom: 0.45,
    bloomThreshold: 1.05,
    saturation: 1.1,
    contrast: 1.08,
    warmth: 0.18,
    vignette: 0.35,
    environment: 0.18,
    wind: 0.6,
    clouds: 0.3,
  },
  industrial: {
    bloom: 0.55,
    bloomThreshold: 1.05,
    saturation: 0.95,
    contrast: 1.12,
    warmth: -0.08,
    vignette: 0.4,
    environment: 0.12,
    wind: 0.0,
    clouds: 0.0,
  },
  dungeon: {
    bloom: 0.7,
    bloomThreshold: 1.05,
    saturation: 0.9,
    contrast: 1.15,
    warmth: -0.05,
    vignette: 0.55,
    environment: 0.04,
    wind: 0.0,
    clouds: 0.0,
  },
} as const satisfies Record<string, BiomePost>;

/** Problems with a post block, for validateWorld. */
export function postProblems(p: BiomePost): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(p)) if (!Number.isFinite(v)) out.push(`${k} is not finite`);
  if (p.bloom < 0 || p.bloom > 2) out.push(`bloom ${p.bloom} outside 0..2`);
  if (p.environment < 0 || p.environment > 1) out.push(`environment ${p.environment} outside 0..1`);
  if (p.warmth < -1 || p.warmth > 1) out.push(`warmth ${p.warmth} outside -1..1`);
  if (p.vignette < 0 || p.vignette > 1) out.push(`vignette ${p.vignette} outside 0..1`);
  if (p.saturation < 0 || p.contrast <= 0) out.push("saturation or contrast out of range");
  if (p.wind < 0 || p.wind > 2) out.push(`wind ${p.wind} outside 0..2`);
  if (p.clouds < 0 || p.clouds > 1) out.push(`clouds ${p.clouds} outside 0..1`);
  return out;
}
