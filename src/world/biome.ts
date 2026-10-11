// The biome function: (complexity, security, kind) -> look and feel. Second review surface.
// Change feel here, not in web/. Charter: "Biome function".
import { THRESHOLDS } from "../questions.ts";
import type { Biome } from "./types.ts";

const MEADOW: Biome = {
  name: "sunlit meadow",
  ambient: 0.9,
  sun: 1.0,
  sky: "#8ed6ff",
  fog: { color: "#cfeeff", density: 0.004 },
  palette: { ground: "#7ccf5a", wall: "#c9a86a", accent: "#ffd166", npc: "#f4e1c1" },
  enclosure: "open",
  props: ["tree", "flower"],
  npcForm: "creature",
  sound: "birds",
  post: {
    bloom: 0.35,
    bloomThreshold: 1.05,
    saturation: 1.15,
    contrast: 1.06,
    warmth: 0.12,
    vignette: 0.25,
    environment: 0.22,
  },
};

const VILLAGE: Biome = {
  name: "village workshop",
  ambient: 0.7,
  sun: 0.8,
  sky: "#b9d7ea",
  fog: { color: "#d8dde3", density: 0.008 },
  palette: { ground: "#a89272", wall: "#c9b79c", accent: "#d9823b", npc: "#e0c9a6" },
  enclosure: "building",
  props: ["crate", "lamp"],
  npcForm: "villager",
  sound: "town",
  post: {
    bloom: 0.45,
    bloomThreshold: 1.02,
    saturation: 1.1,
    contrast: 1.08,
    warmth: 0.18,
    vignette: 0.35,
    environment: 0.18,
  },
};

const INDUSTRIAL: Biome = {
  name: "industrial complex",
  ambient: 0.45,
  sun: 0.5,
  sky: "#6f7a86",
  fog: { color: "#7d8690", density: 0.016 },
  palette: { ground: "#4f565e", wall: "#6b737c", accent: "#f2b134", npc: "#9fb3c8" },
  enclosure: "building",
  props: ["pipe", "crate", "lamp"],
  npcForm: "worker",
  sound: "machines",
  post: {
    bloom: 0.55,
    bloomThreshold: 1.0,
    saturation: 0.95,
    contrast: 1.12,
    warmth: -0.08,
    vignette: 0.4,
    environment: 0.12,
  },
};

const DUNGEON: Biome = {
  name: "dungeon",
  ambient: 0.12,
  sun: 0.15,
  sky: "#05060a",
  fog: { color: "#0b0d14", density: 0.045 },
  palette: { ground: "#23242b", wall: "#2f3038", accent: "#ff4d3d", npc: "#5a6b7a" },
  enclosure: "dungeon",
  props: ["torch", "bones"],
  npcForm: "shade",
  sound: "drips",
  post: {
    bloom: 0.7,
    bloomThreshold: 0.95,
    saturation: 0.9,
    contrast: 1.15,
    warmth: -0.05,
    vignette: 0.55,
    environment: 0.04,
  },
};

/**
 * `complexity` is the region's mean score level (0..3), `security` its maximum, `kind` the dominant kind.
 * High security always wins; otherwise complexity picks the biome.
 */
export function biomeFor(complexity: number, security: number, kind: string): Biome {
  if (security >= THRESHOLDS.highSecurity) return DUNGEON;
  if (security >= 1.5 && complexity >= THRESHOLDS.highComplexity) return DUNGEON;
  if (complexity >= THRESHOLDS.highComplexity) return INDUSTRIAL;
  if (complexity >= 1) return VILLAGE;
  if (complexity >= 0.5 && (kind === "performance" || kind === "chore")) return VILLAGE;
  return MEADOW;
}

export const BIOMES = { MEADOW, VILLAGE, INDUSTRIAL, DUNGEON } as const;
