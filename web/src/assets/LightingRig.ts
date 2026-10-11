import * as THREE from "three";
import type { Biome } from "../../../src/world/types.ts";
import type { Bounds } from "../pure/collision.ts";
import { biomeKind } from "./MaterialLibrary.ts";

/**
 * Key + fill + rim from the biome numbers, one shadow-casting key, and flickering practicals
 * (torches, lanterns). Shadows only ever come from the key, and its map is static: rendered
 * once per area (or once per grid cell in areas larger than the map), never per frame. Only
 * static geometry casts; NPCs and anything animated ground themselves with contact discs.
 */
export interface Practical {
  light: THREE.PointLight;
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
  /** Add a practical point light; returns null once the per-region cap is reached. */
  addPractical(
    position: THREE.Vector3,
    color: THREE.ColorRepresentation,
    intensity: number,
    distance: number,
    flicker: number,
  ): THREE.PointLight | null;
}

export const PRACTICAL_CAP = 4;
export const SHADOW_MAP_SIZE = 2048;
/** Half the side of the square the key's shadow map covers, in metres. */
export const SHADOW_HALF = 30;
/** In areas larger than the map, the map recentres on the player in steps of this many metres. */
export const SHADOW_STEP = 8;

/**
 * Where the shadow map is centred. Areas that fit get one fixed centre (the map is drawn
 * once); larger areas snap the player's position to a grid, so the map is redrawn only when
 * the player crosses a cell and the player is always at least SHADOW_HALF - SHADOW_STEP
 * metres from its edge. Looking around never moves it.
 */
export function shadowCenter(bounds: Bounds, x: number, z: number): [number, number] {
  const cx = bounds.x + bounds.w / 2;
  const cz = bounds.z + bounds.d / 2;
  const fits = Math.max(bounds.w, bounds.d) / 2 <= SHADOW_HALF - 2;
  if (fits) return [cx, cz];
  return [Math.round(x / SHADOW_STEP) * SHADOW_STEP, Math.round(z / SHADOW_STEP) * SHADOW_STEP];
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
    ground,
    dark ? 0.3 : biome.ambient * (biome.enclosure === "open" ? 0.4 : 0.7),
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
  cam.left = -SHADOW_HALF;
  cam.right = SHADOW_HALF;
  cam.top = SHADOW_HALF;
  cam.bottom = -SHADOW_HALF;
  cam.near = 1;
  cam.far = 90;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 2;
  key.shadow.autoUpdate = false;
  key.shadow.needsUpdate = true;
  group.add(key, key.target);
  lights.push(key);

  const fill = new THREE.DirectionalLight(
    sky.clone().offsetHSL(0, 0.05, 0.1),
    dark ? 0.15 : biome.ambient * 0.15,
  );
  fill.position.set(-14, 10, 8);
  group.add(fill, fill.target);
  lights.push(fill);

  const rimColor = dark ? "#8fb8ff" : kind === "industrial" ? "#ffd58a" : "#dfeeff";
  const rim = new THREE.DirectionalLight(rimColor, dark ? 1.6 : 0.5);
  group.add(rim, rim.target);
  lights.push(rim);

  // Enclosed rooms get a bounce light from below so ceilings and beams are not black.
  if (biome.enclosure !== "open") {
    const bounce = new THREE.DirectionalLight(
      ground.clone().offsetHSL(0, -0.1, 0.25),
      dark ? 0.3 : 0.45,
    );
    bounce.position.set(bounds.x + bounds.w / 2, -10, bounds.z + bounds.d / 2);
    bounce.target.position.set(bounds.x + bounds.w / 2, 10, bounds.z + bounds.d / 2);
    group.add(bounce, bounce.target);
    lights.push(bounce);
  }

  const practicals: Practical[] = [];
  const keyDir = new THREE.Vector3(0.45, 1, 0.35).normalize();
  const forward = new THREE.Vector3();
  const anchor = new THREE.Vector3();
  const cx = bounds.x + bounds.w / 2;
  const cz = bounds.z + bounds.d / 2;
  fill.target.position.set(cx, 0, cz);

  let placed = false;
  const update = (camera: THREE.Camera, t: number) => {
    camera.getWorldDirection(forward);
    const [sx, sz] = shadowCenter(bounds, camera.position.x, camera.position.z);
    if (!placed || sx !== anchor.x || sz !== anchor.z) {
      placed = true;
      anchor.set(sx, 0, sz);
      key.target.position.copy(anchor);
      key.position.copy(anchor).addScaledVector(keyDir, 40);
      key.target.updateMatrixWorld();
      key.updateMatrixWorld();
      key.shadow.needsUpdate = true;
    }
    rim.target.position.copy(camera.position).setY(0);
    rim.position.copy(camera.position).addScaledVector(forward, 22).setY(12);
    for (const p of practicals) {
      if (p.flicker <= 0) continue;
      const n =
        Math.sin(t * 11 + p.phase) * 0.5 +
        Math.sin(t * 23.7 + p.phase * 3) * 0.3 +
        Math.sin(t * 5.3 + p.phase * 7) * 0.2;
      p.light.intensity = p.base * (1 + n * 0.18 * p.flicker);
    }
  };

  const addPractical: LightingRig["addPractical"] = (
    position,
    color,
    intensity,
    distance,
    flicker,
  ) => {
    if (practicals.length >= PRACTICAL_CAP) return null;
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.position.copy(position);
    light.castShadow = false;
    group.add(light);
    lights.push(light);
    practicals.push({ light, base: intensity, phase: practicals.length * 1.7, flicker });
    return light;
  };

  return { group, lights, key, practicals, update, addPractical };
}
