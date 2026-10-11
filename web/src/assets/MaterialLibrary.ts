import * as THREE from "three";
import { POST } from "../../../src/world/post.ts";
import type { Biome } from "../../../src/world/types.ts";
import {
  cobbles,
  flagstones,
  hazardStripes,
  steelPlate,
  windowStrip,
} from "./ProceduralTextures.ts";

/**
 * Named material roles shared by every kit, parameterized by the biome palette.
 * One library per biome; meshes never get their own material instance.
 */
export type MaterialRole =
  | "bodyPrimary"
  | "bodySecondary"
  | "trim"
  | "hazard"
  | "hazardStripes"
  | "reward"
  | "glass"
  | "emissiveSignal"
  | "groundContact"
  | "decalDark"
  | "decalLight"
  | "ground"
  | "wall"
  | "wallPlaster"
  | "wood"
  | "stone"
  | "stoneLight"
  | "metal"
  | "foliage"
  | "foliageDark"
  | "foliageLight"
  | "bark"
  | "flame"
  | "windowLit"
  | "skin"
  | "eye"
  | "shadeEye"
  | "accentMatte";

export type BiomeKind = "meadow" | "village" | "industrial" | "dungeon" | "plaza";

export interface MaterialLibrary {
  biome: Biome;
  kind: BiomeKind;
  get(role: MaterialRole): THREE.MeshStandardMaterial;
  materials: Map<MaterialRole, THREE.MeshStandardMaterial>;
}

const libraries = new Map<string, MaterialLibrary>();

export function biomeKind(biome: Biome): BiomeKind {
  const n = biome.name.toLowerCase();
  if (biome.enclosure === "dungeon" || n.includes("dungeon")) return "dungeon";
  if (n.includes("industrial") || biome.sound === "machines") return "industrial";
  if (biome.enclosure === "building") return "village";
  if (n.includes("plaza") || n.includes("hub")) return "plaza";
  return "meadow";
}

function col(hex: string): THREE.Color {
  return new THREE.Color(hex);
}
function shift(c: THREE.Color, h: number, s: number, l: number): THREE.Color {
  return c.clone().offsetHSL(h, s, l);
}
function mix(a: THREE.Color, b: string, t: number): THREE.Color {
  return a.clone().lerp(col(b), t);
}
function luminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** Seconds, advanced by the area's frame hook; drives foliage sway in every library. */
export const WIND = { value: 0 };

/**
 * Ambient sway for instanced foliage (grass, flowers, canopies): a vertex offset phased by
 * each instance's position so neighbours do not move in step. Never used on collidable or
 * interactable geometry.
 */
function windy(m: THREE.MeshStandardMaterial, strength: number): THREE.MeshStandardMaterial {
  const amount = { value: strength };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = WIND;
    shader.uniforms.uWindAmount = amount;
    shader.vertexShader =
      `uniform float uWind;\nuniform float uWindAmount;\n${shader.vertexShader}`.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float windPhase = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.17;
      #else
        float windPhase = 0.0;
      #endif
      // Bend from the root: nothing at y = 0 moves, so stems and blades stay planted.
      float windLift = max(position.y, 0.0) * uWindAmount;
      transformed.x += sin(uWind * 1.4 + windPhase) * 0.045 * windLift;
      transformed.z += cos(uWind * 1.1 + windPhase * 1.3) * 0.03 * windLift;`,
      );
  };
  m.customProgramCacheKey = () => "wind";
  return m;
}

function standard(
  color: THREE.Color,
  opts: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.0,
    // Smooth by default (charter "Look": no flat-shaded faces as the default); stone opts in.
    flatShading: false,
    ...opts,
  });
  m.userData.shared = true;
  return m;
}

export function getMaterialLibrary(biome: Biome): MaterialLibrary {
  const key = `${biome.name}|${biome.enclosure}|${JSON.stringify(biome.palette)}`;
  const hit = libraries.get(key);
  if (hit) return hit;
  const kind = biomeKind(biome);
  const p = biome.palette;
  const ground = col(p.ground);
  const wall = col(p.wall);
  const accent = col(p.accent);
  const npc = col(p.npc);
  const npcLight = luminance(npc) > 0.55;
  const dark = kind === "dungeon";

  const materials = new Map<MaterialRole, THREE.MeshStandardMaterial>();
  const set = (role: MaterialRole, m: THREE.MeshStandardMaterial) => {
    m.name = `${kind}:${role}`;
    materials.set(role, m);
  };

  set("ground", standard(ground, { roughness: 1 }));
  set("wall", standard(wall, { roughness: 0.95 }));
  set("wallPlaster", standard(shift(wall, 0, -0.1, dark ? 0.04 : 0.14), { roughness: 1 }));
  set("wood", standard(mix(col("#7a5230"), p.wall, 0.25), { roughness: 0.8 }));
  set(
    "stone",
    standard(mix(col(dark ? "#5e5c6a" : "#8f8a82"), p.wall, 0.25), {
      roughness: 0.9,
      flatShading: true,
    }),
  );
  set(
    "stoneLight",
    standard(mix(col(dark ? "#82809a" : "#b5b0a6"), p.wall, 0.2), { roughness: 0.9 }),
  );
  set(
    "metal",
    standard(mix(col("#5d6672"), p.wall, 0.2), {
      roughness: 0.45,
      metalness: 0.65,
      map: kind === "industrial" ? steelPlate() : null,
    }),
  );
  // Foliage follows the ground palette, except where the ground is paving (the hub plaza).
  const leaf = kind === "plaza" ? col("#6aa84f") : ground;
  const wind = (biome.post ?? POST[kind] ?? POST.meadow).wind;
  set("foliage", windy(standard(shift(leaf, 0.015, 0.05, 0.05), { roughness: 0.75 }), wind));
  set("foliageDark", windy(standard(shift(leaf, -0.01, 0.0, -0.14), { roughness: 0.8 }), wind));
  set("foliageLight", windy(standard(shift(leaf, 0.03, 0.05, 0.14), { roughness: 0.7 }), wind));
  set("bark", standard(mix(col("#5b3d22"), p.ground, 0.15), { roughness: 0.95 }));

  set("bodyPrimary", standard(npc, { roughness: 0.75 }));
  set(
    "bodySecondary",
    standard(shift(npc, 0.0, -0.05, npcLight ? -0.18 : 0.18), { roughness: 0.8 }),
  );
  set("skin", standard(mix(col(dark ? "#9aa5b8" : "#f0c9a0"), p.npc, 0.25), { roughness: 0.7 }));
  set("eye", standard(col("#15131a"), { roughness: 0.3 }));
  set(
    "shadeEye",
    standard(col("#ff5a3c"), { emissive: col("#ff2e1a"), emissiveIntensity: 3, roughness: 0.4 }),
  );

  set("trim", standard(accent, { roughness: 0.5, metalness: 0.35 }));
  set("accentMatte", standard(accent, { roughness: 0.8 }));
  set("hazard", standard(mix(col("#ff5a2a"), p.accent, 0.2), { roughness: 0.6 }));
  set("hazardStripes", standard(col("#ffffff"), { map: hazardStripes(), roughness: 0.7 }));
  set(
    "reward",
    standard(col("#4ade80"), { emissive: col("#22c55e"), emissiveIntensity: 0.9, roughness: 0.4 }),
  );
  set(
    "glass",
    standard(col(dark ? "#8fb3ff" : "#cfe9ff"), {
      roughness: 0.12,
      metalness: 0.2,
      transparent: true,
      opacity: 0.55,
    }),
  );
  set(
    "emissiveSignal",
    standard(accent, { emissive: accent, emissiveIntensity: dark ? 2.2 : 1.4, roughness: 0.4 }),
  );
  set("groundContact", standard(col("#0c0b0f"), { roughness: 1 }));
  set("decalDark", standard(col(dark ? "#121117" : "#201d22"), { roughness: 0.95 }));
  set("decalLight", standard(col(dark ? "#8e8a9a" : "#efe9dc"), { roughness: 0.9 }));
  set(
    "flame",
    standard(col("#ffb347"), { emissive: col("#ff7a1a"), emissiveIntensity: 2.4, roughness: 0.5 }),
  );
  const warm = kind !== "industrial";
  const win = windowStrip(warm);
  set(
    "windowLit",
    standard(col("#ffffff"), {
      map: win,
      emissive: col("#ffffff"),
      emissiveMap: win,
      emissiveIntensity: warm ? 1.1 : 0.9,
      roughness: 0.3,
    }),
  );
  // Ground textures per enclosure; the palette color tints a light-grey texture.
  const groundMat = materials.get("ground");
  if (groundMat) {
    if (kind === "village") groundMat.map = cobbles();
    else if (kind === "dungeon") groundMat.map = flagstones();
    else if (kind === "industrial") groundMat.map = steelPlate();
    else if (kind === "plaza") groundMat.map = cobbles();
    if (groundMat.map) groundMat.color = shift(ground, 0, 0, dark ? 0.12 : 0.08);
  }

  const lib: MaterialLibrary = {
    biome,
    kind,
    materials,
    get(role) {
      const m = materials.get(role);
      if (!m) throw new Error(`missing material role ${role}`);
      return m;
    },
  };
  libraries.set(key, lib);
  return lib;
}

/** Sprites, lines and basic materials that are not part of the shared library. */
export function isSharedMaterial(m: THREE.Material): boolean {
  return Boolean(m.userData.shared);
}
