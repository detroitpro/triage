// world.json: the contract between the pipeline (src/world) and the client (web/).
// Keep this file dependency-free; web/ imports it directly.

export type Vec3 = [number, number, number];

export type Enclosure = "open" | "building" | "dungeon";
export type NpcForm = "creature" | "villager" | "worker" | "shade";
export type EdgeType =
  | "blocks"
  | "depends-on"
  | "parent-of"
  | "duplicate-of"
  | "same-code-path"
  | "functional"
  | "user-journey"
  | "security";

export interface Biome {
  /** Human name, e.g. "sunlit meadow". */
  name: string;
  /** 0..1 ambient light intensity. */
  ambient: number;
  /** 0..1 directional (sun or torch) intensity. */
  sun: number;
  /** Hex colors. */
  sky: string;
  fog: { color: string; density: number };
  palette: { ground: string; wall: string; accent: string; npc: string };
  enclosure: Enclosure;
  /** Prop families the client may scatter: "tree", "flower", "crate", "lamp", "pipe", "torch", "bones". */
  props: string[];
  npcForm: NpcForm;
  /** Ambient sound family: "birds", "town", "machines", "drips". */
  sound: string;
}

export interface Dimensions {
  functionalArea: string;
  codeArea: string;
  abstraction: number;
  security: number;
  complexity: number;
  userFacing: number;
  kind: string;
  actionable: number;
  /** Confidence per dimension, 0..1. */
  confidence: Record<string, number>;
  /** True when the issue text looked like a prompt injection; dialogue is read-only. */
  quarantined: boolean;
}

export interface PlacementEdge {
  to: number;
  type: EdgeType;
  direction: "out" | "in" | "none";
  weight: number;
}

export interface Placement {
  issue: number;
  title: string;
  url: string;
  /** First ~400 chars of the body, for the dialogue panel fallback. */
  summary: string;
  labels: string[];
  position: Vec3;
  /** 0.6..2.0, from centrality. */
  scale: number;
  form: NpcForm;
  centrality: number;
  dimensions: Dimensions;
  edges: PlacementEdge[];
}

export interface Region {
  id: string;
  label: string;
  /** Floor rectangle on the XZ plane, y = 0. */
  bounds: { x: number; z: number; w: number; d: number };
  entrance: Vec3;
  biome: Biome;
  stats: { count: number; complexity: number; security: number; reviewed: number };
  placements: Placement[];
}

export interface Door {
  id: string;
  from: string;
  to: string;
  kind: "door" | "portal";
  /** Where the door stands, inside `from`. */
  position: Vec3;
  /** Yaw in radians the player faces when passing through. */
  facing: number;
  edgeType: EdgeType;
  locked?: { by: number; title: string };
}

export interface Hub {
  id: "hub";
  bounds: { x: number; z: number; w: number; d: number };
  spawn: Vec3;
  portals: Door[];
}

export interface World {
  version: 1;
  repo: string;
  lens: string;
  lenses: string[];
  builtAt: string;
  graphHash: string;
  hub: Hub;
  regions: Region[];
  doors: Door[];
}
