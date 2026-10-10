import * as THREE from "three";
import type { World } from "../../../src/world/types.ts";
import type { Bounds } from "../pure/collision.ts";
import { scatterProps } from "../pure/scatter.ts";
import type { Area } from "./areas.ts";
import { buildDoor, type DoorHandle } from "./doors.ts";
import { buildNpc, type NpcHandle } from "./npc.ts";
import { buildProps } from "./props.ts";

export interface BuiltArea {
  area: Area;
  group: THREE.Group;
  npcs: Map<number, NpcHandle>;
  doors: DoorHandle[];
  lights: THREE.Light[];
}

const WALL_HEIGHT: Record<string, number> = { open: 0, building: 4, dungeon: 6 };

function lambert(color: string): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

/** Four walls around `b`, with window gaps when `windows` is set. */
function buildWalls(b: Bounds, height: number, color: string, windows: boolean): THREE.Group {
  const g = new THREE.Group();
  const mat = lambert(color);
  const thick = 0.4;
  const segLen = 4;
  const addPanel = (cx: number, cz: number, len: number, y: number, h: number, alongX: boolean) => {
    const geo = alongX
      ? new THREE.BoxGeometry(len, h, thick)
      : new THREE.BoxGeometry(thick, h, len);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(cx, y + h / 2, cz);
    g.add(m);
  };
  const side = (len: number, place: (t: number) => [number, number], alongX: boolean) => {
    const n = Math.max(1, Math.ceil(len / segLen));
    const actual = len / n;
    for (let i = 0; i < n; i++) {
      const [cx, cz] = place((i + 0.5) * actual);
      if (windows && i % 2 === 1) {
        addPanel(cx, cz, actual, 0, 1.0, alongX);
        addPanel(cx, cz, actual, 2.4, height - 2.4, alongX);
      } else {
        addPanel(cx, cz, actual, 0, height, alongX);
      }
    }
  };
  side(b.w, (t) => [b.x + t, b.z], true);
  side(b.w, (t) => [b.x + t, b.z + b.d], true);
  side(b.d, (t) => [b.x, b.z + t], false);
  side(b.d, (t) => [b.x + b.w, b.z + t], false);
  return g;
}

/** Low fence posts around an open region so the edge is visible. */
function buildFence(b: Bounds, color: string): THREE.InstancedMesh {
  const step = 3;
  const points: [number, number][] = [];
  for (let x = b.x; x <= b.x + b.w; x += step) points.push([x, b.z], [x, b.z + b.d]);
  for (let z = b.z + step; z < b.z + b.d; z += step) points.push([b.x, z], [b.x + b.w, z]);
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.2, 0.9, 0.2),
    lambert(color),
    points.length,
  );
  const m = new THREE.Matrix4();
  points.forEach(([x, z], i) => {
    m.makeTranslation(x, 0.45, z);
    mesh.setMatrixAt(i, m);
  });
  return mesh;
}

export function buildArea(
  area: Area,
  world: World,
  reviewed: (issue: number) => boolean,
): BuiltArea {
  const { biome, bounds } = area;
  const group = new THREE.Group();
  group.name = `area-${area.id}`;
  const lights: THREE.Light[] = [];

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(bounds.w, bounds.d),
    lambert(biome.palette.ground),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(bounds.x + bounds.w / 2, 0, bounds.z + bounds.d / 2);
  group.add(ground);

  // Enclosure.
  const height = WALL_HEIGHT[biome.enclosure] ?? 0;
  if (biome.enclosure === "open") {
    group.add(buildFence(bounds, biome.palette.wall));
  } else {
    group.add(buildWalls(bounds, height, biome.palette.wall, biome.enclosure === "building"));
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(bounds.w, bounds.d),
      lambert(biome.enclosure === "dungeon" ? "#0b0910" : biome.palette.wall),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(bounds.x + bounds.w / 2, height, bounds.z + bounds.d / 2);
    group.add(ceiling);
  }

  // Lights from the biome numbers only.
  const hemi = new THREE.HemisphereLight(biome.sky, biome.palette.ground, biome.ambient * 1.2);
  const sun = new THREE.DirectionalLight("#ffffff", biome.sun);
  sun.position.set(bounds.x + bounds.w * 0.3, 20, bounds.z + bounds.d * 0.2);
  sun.target.position.set(bounds.x + bounds.w / 2, 0, bounds.z + bounds.d / 2);
  group.add(hemi, sun, sun.target);
  lights.push(hemi, sun);

  // Props, seeded by region id + issue numbers.
  const issues = area.placements.map((p) => p.issue);
  const avoid = [
    ...area.placements.map((p) => p.position),
    ...area.doors.map((d) => d.position),
    area.entrance,
  ];
  const props = scatterProps({
    regionId: area.id,
    issues,
    bounds,
    families: biome.props,
    avoid,
    density: biome.enclosure === "open" ? 0.03 : 0.015,
  });
  group.add(buildProps(props, biome));
  if (biome.enclosure === "dungeon") {
    // Torches become point lights; cap the count to keep the shader cheap.
    const torches = props.filter((p) => p.family === "torch").slice(0, 8);
    for (const t of torches) {
      const light = new THREE.PointLight(biome.palette.accent, 2.5, 12, 1.5);
      light.position.set(t.position[0], 2.0, t.position[2]);
      group.add(light);
      lights.push(light);
    }
  }

  // NPCs.
  const npcs = new Map<number, NpcHandle>();
  const center = new THREE.Vector3(bounds.x + bounds.w / 2, 0, bounds.z + bounds.d / 2);
  for (const p of area.placements) {
    const h = buildNpc(p, biome.palette.npc, reviewed(p.issue));
    const dx = center.x - p.position[0];
    const dz = center.z - p.position[2];
    h.group.rotation.y = Math.atan2(-dx, -dz) + Math.PI;
    group.add(h.group);
    npcs.set(p.issue, h);
  }

  // Doors and portals.
  const doors = area.doors.map((d) => {
    const h = buildDoor(d, world, biome.palette.accent);
    group.add(h.group);
    return h;
  });

  // Entrance marker.
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(1.0, 20),
    new THREE.MeshBasicMaterial({ color: biome.palette.accent, transparent: true, opacity: 0.5 }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(area.entrance[0], 0.01, area.entrance[2]);
  group.add(pad);

  return { area, group, npcs, doors, lights };
}

export function disposeArea(built: BuiltArea): void {
  built.group.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
      obj.geometry?.dispose();
      const mat = obj.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else if (mat) {
        (mat as THREE.SpriteMaterial).map?.dispose();
        mat.dispose();
      }
    }
  });
  built.group.removeFromParent();
}
