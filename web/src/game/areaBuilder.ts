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
  PRACTICAL_COLOR,
  SHADOW_MAP_SIZE,
} from "../assets/LightingRig.ts";
import { getMaterialLibrary, type MaterialLibrary, WIND } from "../assets/MaterialLibrary.ts";
import { radialFalloff } from "../assets/ProceduralTextures.ts";
import { extraFamilies, geo, isSharedGeometry, makeGlowSprite } from "../assets/WorldPropKit.ts";
import type { Bounds } from "../pure/collision.ts";
import { hashString } from "../pure/rng.ts";
import { type PropInstance, scatterProps } from "../pure/scatter.ts";
import type { Area } from "./areas.ts";
import { buildDoor, type DoorHandle } from "./doors.ts";
import { makeLabelSprite } from "./labels.ts";
import { buildNpc, type NpcHandle } from "./npc.ts";
import { NpcCrowd } from "./npcCrowd.ts";
import { buildProps } from "./props.ts";

export interface BuiltArea {
  area: Area;
  group: THREE.Group;
  npcs: Map<number, NpcHandle>;
  doors: DoorHandle[];
  lights: THREE.Light[];
  lib: MaterialLibrary;
  rig: LightingRig;
  /** Far NPCs, instanced; call `crowd.update` each frame with the player position. */
  crowd: NpcCrowd;
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
  shadowMapSize = SHADOW_MAP_SIZE,
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
  const rig = buildLightingRig(biome, bounds, shadowMapSize);
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
  // Keep the arrival view open: nothing taller than a decal within ENTRANCE_CLEAR of the
  // entrance, so the first frame in a region shows the region, not a tree trunk.
  const [ex, , ez] = area.entrance;
  const clearOf = (p: PropInstance) =>
    Math.hypot(p.position[0] - ex, p.position[2] - ez) > ENTRANCE_CLEAR;
  const props = [...main.filter(clearOf), ...mid.filter(clearOf), ...decals];
  group.add(buildProps(props, biome, lib));

  // Practicals: torches flicker, lanterns are steady. Each is an emissive prop plus glow
  // cards, never a real-time light (charter "Look"), so every practical in the room glows
  // and the light count, and with it every shader, stays fixed per biome.
  const flame = lib.kind === "dungeon";
  const candidates = props.filter((p) => p.family === (flame ? "torch" : "lamp"));
  for (const p of candidates) {
    // The flame sits in front of the bracket, which faces into the room.
    const glow = makeGlowSprite(PRACTICAL_COLOR[lib.kind] ?? "#ffe0a0", flame ? 1.2 : 1.1);
    glow.position.set(
      p.position[0] + (flame ? Math.sin(p.rotation) * 0.25 : Math.cos(p.rotation) * 0.4) * p.scale,
      (flame ? 2.3 : 2.4) * p.scale,
      p.position[2] + (flame ? Math.cos(p.rotation) * 0.25 : -Math.sin(p.rotation) * 0.4) * p.scale,
    );
    group.add(glow);
    rig.addPractical(glow, flame ? 1 : 0.15);
  }

  // Torches light the stone around them: one additive decal on the wall and one on the floor
  // per torch, all one instanced mesh, in place of the pools real lights used to cast.
  if (flame && candidates.length) group.add(torchPools(candidates, bounds));

  // NPCs face the region centre.
  const npcs = new Map<number, NpcHandle>();
  const center = new THREE.Vector3(bounds.x + bounds.w / 2, 0, bounds.z + bounds.d / 2);
  for (const p of area.placements) {
    const h = buildNpc(p, biome.palette.npc, reviewed(p.issue), lib, world.labelSet ?? []);
    const dx = center.x - p.position[0];
    const dz = center.z - p.position[2];
    h.group.rotation.y = Math.atan2(-dx, -dz) + Math.PI;
    group.add(h.group);
    npcs.set(p.issue, h);
  }
  const crowd = new NpcCrowd(npcs, lib);
  group.add(crowd.group);

  // Doors and portals.
  const doors = area.doors.map((d) => {
    const h = buildDoor(d, world, biome.palette.accent, lib);
    group.add(h.group);
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
      WIND.value = performance.now() / 1000;
      installDiagnostics(r, scene, area.id, shadowMapSize);
    });
  };
  group.add(sentinel);

  return { area, group, npcs, doors, lights, lib, rig, crowd };
}

export function disposeArea(built: BuiltArea): void {
  // Several objects may share one area-owned material (torch pools): dispose each once.
  const disposed = new Set<THREE.Material>();
  built.group.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
      // three shares one geometry across every Sprite; only meshes own theirs.
      const g = obj instanceof THREE.Mesh ? (obj.geometry as THREE.BufferGeometry) : undefined;
      if (g && !isSharedGeometry(g)) g.dispose();
      const mat = obj.material as THREE.Material | THREE.Material[];
      const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const m of mats) {
        if (m.userData.shared || disposed.has(m)) continue;
        disposed.add(m);
        const map = (m as THREE.SpriteMaterial).map;
        if (map && !map.userData.shared) map.dispose();
        m.dispose();
      }
    }
    if (obj instanceof THREE.InstancedMesh) obj.dispose();
    // Each rendered SkinnedMesh owns a bone texture; skeletons are per NPC clone.
    if (obj instanceof THREE.SkinnedMesh) obj.skeleton.dispose();
    if (obj instanceof THREE.DirectionalLight) obj.shadow.dispose();
  });
  for (const h of built.npcs.values()) h.authored.character?.dispose();
  built.group.removeFromParent();
}

/** Metres around the entrance kept free of props (decals aside). */
const ENTRANCE_CLEAR = 7;

/** Dungeon wall faces sit within this distance inside the bounds (jittered stone blocks). */
const WALL_FACE = 0.65;

function torchPools(torches: PropInstance[], b: Bounds): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    geo("torch.pool", () => new THREE.PlaneGeometry(1, 1)),
    torchPoolMaterial(),
    torches.length * 2,
  );
  mesh.name = "torchPools";
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const size = new THREE.Vector3();
  torches.forEach((t, i) => {
    // Torches face into the room; the wall is behind them at the bounds edge.
    const fx = Math.sin(t.rotation);
    const fz = Math.cos(t.rotation);
    const [x, , z] = t.position;
    const back =
      fx > 0.5 ? x - b.x : fx < -0.5 ? b.x + b.w - x : fz > 0.5 ? z - b.z : b.z + b.d - z;
    const wall = Math.max(0, back - WALL_FACE);
    pos.set(x - fx * wall, 2.2 * t.scale, z - fz * wall);
    m.compose(pos, q.setFromEuler(e.set(0, t.rotation, 0)), size.set(5, 4.4, 1));
    mesh.setMatrixAt(i * 2, m);
    pos.set(x + fx * 0.6, 0.03, z + fz * 0.6);
    m.compose(pos, q.setFromEuler(e.set(-Math.PI / 2, 0, 0)), size.set(4.4, 4.4, 1));
    mesh.setMatrixAt(i * 2 + 1, m);
  });
  return mesh;
}

let poolMaterial: THREE.MeshBasicMaterial | null = null;
function torchPoolMaterial(): THREE.MeshBasicMaterial {
  if (!poolMaterial) {
    poolMaterial = new THREE.MeshBasicMaterial({
      map: radialFalloff(),
      // Deeper than the flame colour: additive light on stone reads orange, not yellow.
      color: "#ff6a1a",
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    poolMaterial.userData.shared = true;
  }
  return poolMaterial;
}
