import * as THREE from "three";
import type { Biome } from "../../../src/world/types.ts";
import type { Bounds } from "../pure/collision.ts";
import { biomeKind } from "./MaterialLibrary.ts";

/**
 * Key + fill + rim from the biome numbers, one shadow-casting key, and flickering practicals
 * (torches, lanterns) that are glow cards, not lights, so the light set is fixed per biome.
 * Shadows only ever come from the key, and its map is static: rendered once per area (or once
 * per grid cell in areas larger than the map), never per frame. Only static geometry casts;
 * NPCs and anything animated ground themselves with contact discs.
 */
export interface Practical {
  glow: THREE.Sprite;
  /** Resting scale of the glow card. */
  base: number;
  phase: number;
  /** 0 = steady, 1 = torch flicker. */
  flicker: number;
}

export interface LightingRig {
  group: THREE.Group;
  lights: THREE.Light[];
  key: THREE.DirectionalLight;
  practicals: Practical[];
  /** Call once per frame with the active camera. Marks the shadow map for redraw when it moves. */
  update(camera: THREE.Camera, t: number): void;
  /** Redraw the static shadow map on the next frame (a caster was added, removed, or changed). */
  invalidateShadows(): void;
  /** Register a practical's glow card so it flickers (0 = steady, 1 = torch). */
  addPractical(glow: THREE.Sprite, flicker: number): void;
}

/** Colour of the practicals (torches, lamps) per biome kind: glow cards, pools, bounce tint. */
export const PRACTICAL_COLOR: Record<string, string> = {
  dungeon: "#ff8a3c",
  industrial: "#ffcf7a",
  village: "#ffd79a",
};
export const SHADOW_MAP_SIZE = 2048;
/** Direction toward the key light (sun or torch key), shared by every biome. */
export const KEY_DIR = new THREE.Vector3(0.45, 1, 0.35).normalize();
/** Half the side of the shadow square around the player in areas too big to fit, in metres. */
export const SHADOW_HALF = 30;
/** In areas too big to fit, the map recentres on the player in steps of this many metres. */
export const SHADOW_STEP = 8;
/** Areas whose light-space half extent is at most this get one static map over the whole area. */
export const SHADOW_FIT_MAX = 44;
/** Tallest static caster (walls, pillars, trees) the fitted map must contain, in metres. */
export const CASTER_HEIGHT = 7;

/** Shadow camera placement: target on the ground and orthographic bounds in light space. */
export interface ShadowFit {
  /** True when one map covers the whole area. */
  fitted: boolean;
  center: [number, number];
  left: number;
  right: number;
  bottom: number;
  top: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const basis = new THREE.Matrix4();
const point = new THREE.Vector3();

/** Light-space x, y of a world point for a key light aimed at (cx, 0, cz). */
export function toLightSpace(
  cx: number,
  cz: number,
  x: number,
  y: number,
  z: number,
): [number, number] {
  const eye = point.set(cx, 0, cz).addScaledVector(KEY_DIR, 40).clone();
  basis.lookAt(eye, new THREE.Vector3(cx, 0, cz), UP);
  point.set(x, y, z).sub(eye);
  // basis is a pure rotation; its transpose takes world offsets into light space.
  const e = basis.elements;
  return [
    e[0] * point.x + e[1] * point.y + e[2] * point.z,
    e[4] * point.x + e[5] * point.y + e[6] * point.z,
  ];
}

/**
 * Where the shadow map sits. An area whose box (floor to CASTER_HEIGHT) fits within
 * SHADOW_FIT_MAX in light space gets one map fitted to that box, drawn once. Larger areas
 * get a SHADOW_HALF square around the player's position snapped to a SHADOW_STEP grid, so
 * the map is redrawn only when the player crosses a cell and the player stays within about
 * SHADOW_STEP * 0.71 metres of its centre in light space. Looking around never moves it.
 */
export function shadowFit(bounds: Bounds, x: number, z: number): ShadowFit {
  const cx = bounds.x + bounds.w / 2;
  const cz = bounds.z + bounds.d / 2;
  let left = Infinity;
  let right = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  for (const px of [bounds.x, bounds.x + bounds.w])
    for (const pz of [bounds.z, bounds.z + bounds.d])
      for (const py of [0, CASTER_HEIGHT]) {
        const [lx, ly] = toLightSpace(cx, cz, px, py, pz);
        left = Math.min(left, lx);
        right = Math.max(right, lx);
        bottom = Math.min(bottom, ly);
        top = Math.max(top, ly);
      }
  if (Math.max(-left, right, -bottom, top) <= SHADOW_FIT_MAX)
    return {
      fitted: true,
      center: [cx, cz],
      left: left - 1,
      right: right + 1,
      bottom: bottom - 1,
      top: top + 1,
    };
  const sx = Math.round(x / SHADOW_STEP) * SHADOW_STEP;
  const sz = Math.round(z / SHADOW_STEP) * SHADOW_STEP;
  return {
    fitted: false,
    center: [sx, sz],
    left: -SHADOW_HALF,
    right: SHADOW_HALF,
    bottom: -SHADOW_HALF,
    top: SHADOW_HALF,
  };
}

/** ACES exposure per biome: dark biomes get lifted so torchlight reads, bright ones stay crisp. */
export function exposureFor(biome: Biome): number {
  const kind = biomeKind(biome);
  if (kind === "dungeon") return 1.5;
  if (kind === "industrial") return 1.3;
  if (biome.enclosure === "building") return 1.15;
  return 0.8 + (1 - biome.ambient) * 0.3;
}

const configured = new WeakMap<THREE.WebGLRenderer, string>();

/**
 * Renderer settings the rig depends on. Safe to call every frame: it only touches the
 * renderer when the biome changes. game.ts can call this directly; areaBuilder also calls
 * it from a sentinel that renders before everything else so no program is compiled
 * against stale settings. DPR is left to game.ts, which already caps it at 2.
 */
export function configureRenderer(renderer: THREE.WebGLRenderer, biome: Biome): boolean {
  const key = `${biome.name}|${exposureFor(biome)}`;
  if (configured.get(renderer) === key) return false;
  configured.set(renderer, key);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposureFor(biome);
  if (!renderer.shadowMap.enabled) {
    renderer.shadowMap.enabled = true;
    // three r186 removed PCFSoftShadowMap; PCF with shadow.radius is the soft option.
    renderer.shadowMap.type = THREE.PCFShadowMap;
  }
  return true;
}

export function buildLightingRig(biome: Biome, bounds: Bounds): LightingRig {
  const kind = biomeKind(biome);
  const group = new THREE.Group();
  group.name = "lighting";
  const lights: THREE.Light[] = [];
  const dark = kind === "dungeon";
  const sky = new THREE.Color(biome.sky);
  const ground = new THREE.Color(biome.palette.ground);

  const hemi = new THREE.HemisphereLight(
    dark ? sky.clone().offsetHSL(0, 0, 0.1) : sky,
    // Dungeon floors bounce torchlight: warm from below, cool from above.
    dark ? ground.clone().lerp(new THREE.Color(PRACTICAL_COLOR.dungeon ?? "#ff8a3c"), 0.5) : ground,
    dark ? 0.45 : biome.ambient * (biome.enclosure === "open" ? 0.4 : 0.7),
  );
  group.add(hemi);
  lights.push(hemi);

  const keyColor =
    kind === "industrial"
      ? "#d6e4ff"
      : dark
        ? "#5560a8"
        : kind === "meadow"
          ? "#fff1d2"
          : "#ffe6c4";
  const key = new THREE.DirectionalLight(keyColor, dark ? 0.35 : biome.sun * 0.9);
  key.castShadow = true;
  key.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  const cam = key.shadow.camera;
  cam.near = 1;
  cam.far = 90;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 2;
  key.shadow.autoUpdate = false;
  key.shadow.needsUpdate = false;
  let placed = "";
  const place = (fit: ShadowFit) => {
    const id = `${fit.center[0]},${fit.center[1]}`;
    if (id === placed) return;
    placed = id;
    key.target.position.set(fit.center[0], 0, fit.center[1]);
    key.position.copy(key.target.position).addScaledVector(KEY_DIR, 40);
    cam.left = fit.left;
    cam.right = fit.right;
    cam.bottom = fit.bottom;
    cam.top = fit.top;
    cam.updateProjectionMatrix();
    key.target.updateMatrixWorld();
    key.updateMatrixWorld();
    key.shadow.needsUpdate = true;
  };
  // Areas that fit are placed now, so the first frame already draws the right map.
  const initial = shadowFit(bounds, bounds.x + bounds.w / 2, bounds.z + bounds.d / 2);
  if (initial.fitted) place(initial);
  group.add(key, key.target);
  lights.push(key);

  // In dungeons the fill is the torchlight: warm, low, and raking across the walls, since
  // torches are glow cards rather than lights. Elsewhere it is a cool sky fill.
  const torch = new THREE.Color(PRACTICAL_COLOR.dungeon ?? "#ff8a3c");
  const fill = new THREE.DirectionalLight(
    dark ? torch : sky.clone().offsetHSL(0, 0.05, 0.1),
    dark ? 0.8 : biome.ambient * 0.15,
  );
  fill.position.set(-14, dark ? 3 : 10, 8);
  group.add(fill, fill.target);
  lights.push(fill);

  const rimColor = dark ? "#8fb8ff" : kind === "industrial" ? "#ffd58a" : "#dfeeff";
  const rim = new THREE.DirectionalLight(rimColor, dark ? 1.6 : 0.5);
  group.add(rim, rim.target);
  lights.push(rim);

  // Enclosed rooms get a bounce light from below so ceilings and beams are not black. It
  // carries the warmth the practicals (glow cards, not lights) would have thrown on walls.
  if (biome.enclosure !== "open") {
    const practical = new THREE.Color(PRACTICAL_COLOR[kind] ?? "#ffd79a");
    const bounce = new THREE.DirectionalLight(
      ground.clone().offsetHSL(0, -0.1, 0.25).lerp(practical, 0.55),
      dark ? 0.55 : 0.75,
    );
    bounce.position.set(bounds.x + bounds.w / 2, -10, bounds.z + bounds.d / 2);
    bounce.target.position.set(bounds.x + bounds.w / 2, 10, bounds.z + bounds.d / 2);
    group.add(bounce, bounce.target);
    lights.push(bounce);
  }

  const practicals: Practical[] = [];
  const forward = new THREE.Vector3();
  const cx = bounds.x + bounds.w / 2;
  const cz = bounds.z + bounds.d / 2;
  fill.target.position.set(cx, 0, cz);

  const update = (camera: THREE.Camera, t: number) => {
    camera.getWorldDirection(forward);
    place(shadowFit(bounds, camera.position.x, camera.position.z));
    rim.target.position.copy(camera.position).setY(0);
    rim.position.copy(camera.position).addScaledVector(forward, 22).setY(12);
    for (const p of practicals) {
      if (p.flicker <= 0) continue;
      const n =
        Math.sin(t * 11 + p.phase) * 0.5 +
        Math.sin(t * 23.7 + p.phase * 3) * 0.3 +
        Math.sin(t * 5.3 + p.phase * 7) * 0.2;
      p.glow.scale.setScalar(p.base * (1 + n * 0.18 * p.flicker));
    }
  };

  const addPractical: LightingRig["addPractical"] = (glow, flicker) => {
    practicals.push({ glow, base: glow.scale.x, phase: practicals.length * 1.7, flicker });
  };

  const invalidateShadows = () => {
    key.shadow.needsUpdate = true;
  };

  return { group, lights, key, practicals, update, invalidateShadows, addPractical };
}
