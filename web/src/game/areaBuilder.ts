import * as THREE from "three";
import type { World } from "../../../src/world/types.ts";
import { installDiagnostics } from "../assets/Diagnostics.ts";
import {
  buildBuildingEnclosure,
  buildDungeonEnclosure,
  buildGround,
  buildOpenEnclosure,
} from "../assets/EnclosureKit.ts";
import {
  buildLightingRig,
  configureRenderer,
  type LightingRig,
  SHADOW_MAP_SIZE,
} from "../assets/LightingRig.ts";
import { getMaterialLibrary, type MaterialLibrary } from "../assets/MaterialLibrary.ts";
import { extraFamilies, geo, isSharedGeometry, makeGlowSprite } from "../assets/WorldPropKit.ts";
import { hashString } from "../pure/rng.ts";
import { type PropInstance, scatterProps } from "../pure/scatter.ts";
import type { Area } from "./areas.ts";
import { buildDoor, type DoorHandle } from "./doors.ts";
import { makeLabelSprite } from "./labels.ts";
import { buildNpc, type NpcHandle } from "./npc.ts";
import { buildProps } from "./props.ts";

export interface BuiltArea {
  area: Area;
  group: THREE.Group;
  npcs: Map<number, NpcHandle>;
  doors: DoorHandle[];
  lights: THREE.Light[];
  lib: MaterialLibrary;
  rig: LightingRig;
}

/** Scatter one family set with its own seed suffix so layers do not collide. */
function scatterLayer(
  area: Area,
  families: string[],
  density: number,
  clearance: number,
  suffix: string,
  avoid: [number, number, number][],
): PropInstance[] {
  if (families.length === 0) return [];
  return scatterProps({
    regionId: `${area.id}:${suffix}`,
    issues: area.placements.map((p) => p.issue),
    bounds: area.bounds,
    families,
    avoid,
    density,
    clearance,
  });
}

export function buildArea(
  area: Area,
  world: World,
  reviewed: (issue: number) => boolean,
): BuiltArea {
  const { biome, bounds } = area;
  const lib = getMaterialLibrary(biome);
  const seed = hashString(area.id);
  const group = new THREE.Group();
  group.name = `area-${area.id}`;

  // Ground: faceted, vertex-tinted, textured per enclosure. It is also the per-frame hook
  // host (never frustum-culled) so the rig and diagnostics get the renderer without game.ts.
  const ground = buildGround(bounds, lib, seed);
  group.add(ground);

  // Enclosure: open = fence + hills + far silhouettes + sky; building = timber or steel
  // hall with lit windows and a beamed ceiling; dungeon = block walls, pillars, ribs.
  const enclosure =
    biome.enclosure === "open"
      ? buildOpenEnclosure(bounds, lib, seed)
      : biome.enclosure === "building"
        ? buildBuildingEnclosure(bounds, lib)
        : buildDungeonEnclosure(bounds, lib, seed);
  for (const o of enclosure) group.add(o);

  // Lighting rig from the biome numbers only.
  const rig = buildLightingRig(biome, bounds);
  group.add(rig.group);
  const lights: THREE.Light[] = [...rig.lights];

  // Props in three layers: the biome's own families, kit mid props, ground decals.
  const avoid: [number, number, number][] = [
    ...area.placements.map((p) => p.position),
    ...area.doors.map((d) => d.position),
    area.entrance,
  ];
  const extras = extraFamilies(lib.kind);
  const open = biome.enclosure === "open";
  const main = scatterLayer(area, biome.props, open ? 0.03 : 0.016, 2.5, "main", avoid);
  const mid = scatterLayer(area, extras.mid, open ? 0.012 : 0.008, 3.2, "mid", [
    ...avoid,
    ...main.map((p) => p.position),
  ]);
  const decalDensity = open ? 0.12 : lib.kind === "village" ? 0.04 : 0.012;
  const decals = scatterLayer(area, extras.decals, decalDensity, 1.2, "decals", avoid);
  const props = [...main, ...mid, ...decals];
  group.add(buildProps(props, biome, lib));

  // Practicals: torches flicker, lanterns are steady. The rig caps them per region.
  const practicalFamily = lib.kind === "dungeon" ? "torch" : "lamp";
  const candidates = props.filter((p) => p.family === practicalFamily);
  // Spread the capped practicals across the room instead of taking the first few.
  const stride = Math.max(1, Math.floor(candidates.length / 4));
  for (let i = 0; i < candidates.length; i += stride) {
    const p = candidates[i];
    if (!p) continue;
    const pos = new THREE.Vector3(p.position[0], 0, p.position[2]);
    const flicker = practicalFamily === "torch";
    if (flicker) {
      // The flame sits in front of the bracket, which faces into the room.
      pos.x += Math.sin(p.rotation) * 0.25 * p.scale;
      pos.z += Math.cos(p.rotation) * 0.25 * p.scale;
      pos.y = 2.3 * p.scale;
    } else {
      pos.x += Math.cos(p.rotation) * 0.4 * p.scale;
      pos.z -= Math.sin(p.rotation) * 0.4 * p.scale;
      pos.y = 2.4 * p.scale;
    }
    const added = rig.addPractical(
      pos,
      flicker ? "#ff8a3c" : lib.kind === "industrial" ? "#ffcf7a" : "#ffd79a",
      flicker ? 34 : 12,
      flicker ? 18 : 12,
      flicker ? 1 : 0.15,
    );
    if (!added) break;
  }

  // Every practical gets a glow card whether or not it earned a real light.
  for (const p of candidates) {
    const flame = practicalFamily === "torch";
    const glow = makeGlowSprite(flame ? "#ff9a4a" : "#ffe0a0", flame ? 1.6 : 1.1);
    glow.position.set(
      p.position[0] + (flame ? Math.sin(p.rotation) * 0.25 : Math.cos(p.rotation) * 0.4) * p.scale,
      (flame ? 2.3 : 2.4) * p.scale,
      p.position[2] + (flame ? Math.cos(p.rotation) * 0.25 : -Math.sin(p.rotation) * 0.4) * p.scale,
    );
    group.add(glow);
    if (flame) {
      // Warm pool on the floor and wall: the bounce a real light would give.
      const pool = makeGlowSprite("#ff8a3c", 5.5);
      pool.position.set(p.position[0], 1.2, p.position[2]);
      pool.material = pool.material.clone();
      pool.material.opacity = 0.28;
      pool.material.userData.shared = false;
      group.add(pool);
    }
  }

  // NPCs face the region centre.
  const npcs = new Map<number, NpcHandle>();
  const center = new THREE.Vector3(bounds.x + bounds.w / 2, 0, bounds.z + bounds.d / 2);
  for (const p of area.placements) {
    const h = buildNpc(p, biome.palette.npc, reviewed(p.issue), lib);
    const dx = center.x - p.position[0];
    const dz = center.z - p.position[2];
    h.group.rotation.y = Math.atan2(-dx, -dz) + Math.PI;
    group.add(h.group);
    npcs.set(p.issue, h);
  }

  // Doors and portals.
  const doors = area.doors.map((d) => {
    const h = buildDoor(d, world, biome.palette.accent, lib);
    group.add(h.group);
    if (h.light) lights.push(h.light);
    return h;
  });

  // Entrance marker: inlaid ring with the region label on a low plinth.
  const pad = new THREE.Mesh(
    geo("entrance.ring", () => new THREE.RingGeometry(0.8, 1.15, 32)),
    lib.get("emissiveSignal"),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(area.entrance[0], 0.02, area.entrance[2]);
  const padCore = new THREE.Mesh(
    geo("entrance.core", () => new THREE.CircleGeometry(0.7, 24)),
    lib.get("stoneLight"),
  );
  padCore.rotation.x = -Math.PI / 2;
  padCore.position.set(area.entrance[0], 0.018, area.entrance[2]);
  group.add(pad, padCore);
  if (area.region) {
    const banner = makeLabelSprite([area.label], { height: 0.6 });
    banner.position.set(area.entrance[0], 2.6, area.entrance[2]);
    group.add(banner);
  }

  // Per-frame hook on a sentinel that renders first: renderer settings before any program
  // compiles, key light follow, flicker, diagnostics. game.ts never has to call us.
  const start = performance.now();
  const sentinel = new THREE.Mesh(
    geo("sentinel", () => new THREE.PlaneGeometry(0.01, 0.01)),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  );
  sentinel.name = "frameHook";
  sentinel.renderOrder = -1000;
  sentinel.frustumCulled = false;
  sentinel.position.set(bounds.x + bounds.w / 2, -5, bounds.z + bounds.d / 2);
  // Never mutate renderer state mid-draw: three compiles programs and VAOs against the
  // settings in force when an object is drawn. Defer to a microtask between frames.
  let pending = false;
  sentinel.onBeforeRender = (renderer, scene, camera) => {
    if (pending) return;
    pending = true;
    const r = renderer as THREE.WebGLRenderer;
    queueMicrotask(() => {
      pending = false;
      if (configureRenderer(r, biome)) {
        scene.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(m)) for (const x of m) x.needsUpdate = true;
          else if (m) m.needsUpdate = true;
        });
      }
      rig.update(camera, (performance.now() - start) / 1000);
      installDiagnostics(r, scene, area.id, SHADOW_MAP_SIZE);
    });
  };
  group.add(sentinel);

  return { area, group, npcs, doors, lights, lib, rig };
}

export function disposeArea(built: BuiltArea): void {
  built.group.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
      const g = obj.geometry as THREE.BufferGeometry | undefined;
      if (g && !isSharedGeometry(g)) g.dispose();
      const mat = obj.material as THREE.Material | THREE.Material[];
      const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const m of mats) {
        if (m.userData.shared) continue;
        const map = (m as THREE.SpriteMaterial).map;
        if (map && !map.userData.shared) map.dispose();
        m.dispose();
      }
    }
    if (obj instanceof THREE.DirectionalLight) obj.shadow.dispose();
  });
  built.group.removeFromParent();
}
