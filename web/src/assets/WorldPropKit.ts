import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32 } from "../pure/rng.ts";
import type { PropInstance } from "../pure/scatter.ts";
import type { BiomeKind, MaterialLibrary, MaterialRole } from "./MaterialLibrary.ts";
import { radialFalloff } from "./ProceduralTextures.ts";

/** One instanced part of a prop family: geometry + material role + local placement. */
export interface PartSpec {
  geometry: THREE.BufferGeometry;
  role: MaterialRole;
  /** Local offset applied before the instance transform (scaled by the instance). */
  y: number;
  x?: number;
  z?: number;
  scale?: number;
  castShadow?: boolean;
}

export type FamilyFactory = (kind: BiomeKind) => PartSpec[];

// ---- shared geometry cache ------------------------------------------------------

const geometries = new Map<string, THREE.BufferGeometry>();
export function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geometries.get(key);
  if (!g) {
    g = make();
    g.userData.shared = true;
    geometries.set(key, g);
  }
  return g;
}

function box(w: number, h: number, d: number): THREE.BoxGeometry {
  return new THREE.BoxGeometry(w, h, d);
}
function cyl(rt: number, rb: number, h: number, seg = 8): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(rt, rb, h, seg);
}
function translate(g: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  return g.translate(x, y, z);
}
export function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Keep uvs only when every part has them (blobs have none), so the merge never fails.
  const keepUv = parts.every((p) => p.attributes.uv);
  const stripped = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "normal" && !(keepUv && name === "uv"))
        g.deleteAttribute(name);
    }
    return g;
  });
  const out = mergeGeometries(stripped, false);
  if (!out) throw new Error("mergeGeometries failed");
  return out;
}

/** Icosahedron with jittered vertices: a faceted rock that reads at any scale. */
export function facetedRock(seed: number, detail = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const rand = mulberry32(seed);
  const pos = g.attributes.position;
  if (!pos) return g;
  // Jitter shared positions consistently by hashing the rounded coordinate.
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let f = seen.get(key);
    if (f === undefined) {
      f = 0.75 + rand() * 0.45;
      seen.set(key, f);
    }
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f * 0.75, pos.getZ(i) * f);
  }
  g.computeVertexNormals();
  return g;
}

/** A gable prism (roof) centred at the origin, width w, ridge height h, depth d. */
export function gablePrism(w: number, h: number, d: number): THREE.BufferGeometry {
  const hw = w / 2;
  const hd = d / 2;
  const v = [
    [-hw, 0, -hd],
    [hw, 0, -hd],
    [hw, 0, hd],
    [-hw, 0, hd],
    [0, h, -hd],
    [0, h, hd],
  ];
  const faces = [
    [0, 4, 1],
    [3, 2, 5],
    [0, 3, 5, 0, 5, 4],
    [1, 4, 5, 1, 5, 2],
    [0, 1, 2, 0, 2, 3],
  ];
  const out: number[] = [];
  for (const f of faces) for (const i of f) out.push(...(v[i] ?? [0, 0, 0]));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * A lumpy, smooth-shaded ball for canopies and bushes: an icosphere pushed in and out by a
 * seeded hash so every tree kind has its own silhouette, squashed a little vertically.
 */
function blob(radius: number, seed: number, squash: number): THREE.BufferGeometry {
  // Polyhedra are non-indexed: weld shared vertices so normals (and the noise) are smooth.
  const raw = new THREE.IcosahedronGeometry(radius, 3);
  raw.deleteAttribute("normal");
  raw.deleteAttribute("uv");
  const g = mergeVertices(raw);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 3.1 + seed) * Math.sin(v.y * 2.7 + seed * 0.7) * Math.sin(v.z * 3.3);
    v.multiplyScalar(1 + n * 0.14);
    v.y *= squash;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A tuft of tapered blades fanned around the origin; reads as grass, not a billboard. */
function grassTuft(blades: number, w: number, h: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < blades; i++) {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(w / 2, 0);
    shape.lineTo(w * 0.1, h * (0.8 + (i % 2) * 0.2));
    shape.closePath();
    const blade = new THREE.ShapeGeometry(shape);
    blade.rotateX(0.25 + (i % 3) * 0.1);
    blade.rotateY((i / blades) * Math.PI * 2);
    parts.push(blade);
  }
  return merged(parts);
}

function crateEdges(size: number): THREE.BufferGeometry {
  const t = size * 0.08;
  const s = size + 0.01;
  const parts: THREE.BufferGeometry[] = [];
  for (const y of [-1, 1]) {
    for (const z of [-1, 1]) parts.push(translate(box(s, t, t), 0, (y * s) / 2, (z * s) / 2));
    for (const x of [-1, 1]) parts.push(translate(box(t, t, s), (x * s) / 2, (y * s) / 2, 0));
  }
  for (const x of [-1, 1])
    for (const z of [-1, 1]) parts.push(translate(box(t, s, t), (x * s) / 2, 0, (z * s) / 2));
  return merged(parts);
}

// ---- families ---------------------------------------------------------------------

export const FAMILIES: Record<string, FamilyFactory> = {
  // Rounded, clustered canopy (stylized broadleaf), shadowed underside to sunlit crown.
  tree: () => [
    {
      geometry: geo("tree.trunk", () => cyl(0.18, 0.34, 2.2, 10)),
      role: "bark",
      y: 1.1,
    },
    { geometry: geo("tree.roots", () => cyl(0.42, 0.6, 0.22, 10)), role: "bark", y: 0.11 },
    {
      geometry: geo("tree.c1", () => blob(1.45, 11, 0.8)),
      role: "foliageDark",
      y: 2.55,
      castShadow: true,
    },
    {
      geometry: geo("tree.c2", () => blob(1.1, 23, 0.85).translate(0.55, 0, 0.25)),
      role: "foliage",
      y: 3.2,
    },
    {
      geometry: geo("tree.c3", () => blob(0.85, 37, 0.9).translate(-0.35, 0, -0.2)),
      role: "foliageLight",
      y: 3.75,
    },
  ],
  flower: () => [
    {
      geometry: geo("flower.stem", () => cyl(0.025, 0.035, 0.45, 4)),
      role: "foliageDark",
      y: 0.22,
    },
    { geometry: geo("flower.leaf", () => grassTuft(3, 0.1, 0.22)), role: "foliage", y: 0 },
    {
      geometry: geo("flower.head", () => cyl(0.09, 0.03, 0.07, 6)),
      role: "accentMatte",
      y: 0.47,
    },
    {
      geometry: geo("flower.core", () => new THREE.SphereGeometry(0.05, 5, 4)),
      role: "trim",
      y: 0.5,
    },
  ],
  grass: () => [
    { geometry: geo("grass.tuft", () => grassTuft(5, 0.16, 0.42)), role: "foliage", y: 0 },
  ],
  rock: () => [
    {
      geometry: geo("rock.a", () => facetedRock(3)),
      role: "stone",
      y: 0.3,
      scale: 0.6,
      castShadow: true,
    },
    {
      geometry: geo("rock.b", () => facetedRock(9)),
      role: "stoneLight",
      y: 0.22,
      scale: 0.35,
      x: 0.5,
      z: 0.3,
    },
  ],
  crate: () => [
    {
      geometry: geo("crate.box", () => box(0.9, 0.9, 0.9)),
      role: "wood",
      y: 0.45,
      castShadow: true,
    },
    { geometry: geo("crate.edges", () => crateEdges(0.9)), role: "decalDark", y: 0.45 },
  ],
  barrel: () => [
    {
      geometry: geo("barrel.body", () => cyl(0.36, 0.4, 0.95, 10)),
      role: "wood",
      y: 0.48,
      castShadow: true,
    },
    {
      geometry: geo("barrel.hoops", () =>
        merged([
          new THREE.TorusGeometry(0.4, 0.03, 4, 12).rotateX(Math.PI / 2).translate(0, 0.25, 0),
          new THREE.TorusGeometry(0.4, 0.03, 4, 12).rotateX(Math.PI / 2).translate(0, -0.25, 0),
        ]),
      ),
      role: "metal",
      y: 0.48,
    },
  ],
  stall: () => [
    {
      geometry: geo("stall.table", () =>
        merged([
          box(2.2, 0.1, 1.0).translate(0, 0.85, 0),
          box(0.1, 0.85, 0.1).translate(-1.0, 0.42, -0.4),
          box(0.1, 0.85, 0.1).translate(1.0, 0.42, -0.4),
          box(0.1, 0.85, 0.1).translate(-1.0, 0.42, 0.4),
          box(0.1, 0.85, 0.1).translate(1.0, 0.42, 0.4),
          box(0.08, 2.3, 0.08).translate(-1.05, 1.15, -0.45),
          box(0.08, 2.3, 0.08).translate(1.05, 1.15, -0.45),
          box(0.08, 2.0, 0.08).translate(-1.05, 1.0, 0.45),
          box(0.08, 2.0, 0.08).translate(1.05, 1.0, 0.45),
        ]),
      ),
      role: "wood",
      y: 0,
      castShadow: true,
    },
    {
      geometry: geo("stall.awning", () =>
        new THREE.PlaneGeometry(2.4, 1.3).rotateX(-Math.PI / 2 + 0.3).translate(0, 2.2, 0),
      ),
      role: "accentMatte",
      y: 0,
    },
    {
      geometry: geo("stall.goods", () =>
        merged([
          box(0.4, 0.3, 0.3).translate(-0.6, 1.05, 0),
          box(0.3, 0.25, 0.3).translate(0.1, 1.02, 0.15),
          cyl(0.15, 0.15, 0.3, 8).translate(0.7, 1.05, -0.1),
        ]),
      ),
      role: "trim",
      y: 0,
    },
  ],
  lamp: () => [
    { geometry: geo("lamp.base", () => cyl(0.14, 0.2, 0.3, 6)), role: "stone", y: 0.15 },
    {
      geometry: geo("lamp.post", () =>
        merged([
          cyl(0.05, 0.07, 2.6, 6).translate(0, 1.3, 0),
          box(0.5, 0.05, 0.05).translate(0.2, 2.6, 0),
        ]),
      ),
      role: "metal",
      y: 0,
      castShadow: true,
    },
    {
      geometry: geo("lamp.cage", () =>
        merged([
          box(0.34, 0.05, 0.34).translate(0.4, 2.2, 0),
          box(0.3, 0.06, 0.3).translate(0.4, 2.56, 0),
          cyl(0.0, 0.2, 0.14, 4).translate(0.4, 2.64, 0),
          box(0.03, 0.36, 0.03).translate(0.26, 2.38, -0.14),
          box(0.03, 0.36, 0.03).translate(0.54, 2.38, -0.14),
          box(0.03, 0.36, 0.03).translate(0.26, 2.38, 0.14),
          box(0.03, 0.36, 0.03).translate(0.54, 2.38, 0.14),
        ]),
      ),
      role: "decalDark",
      y: 0,
    },
    { geometry: geo("lamp.glass", () => box(0.24, 0.3, 0.24)), role: "windowLit", y: 2.38, x: 0.4 },
  ],
  pipe: () => [
    {
      geometry: geo("pipe.run", () => cyl(0.2, 0.2, 4, 10).rotateZ(Math.PI / 2)),
      role: "metal",
      y: 2.4,
    },
    {
      geometry: geo("pipe.flanges", () =>
        merged([
          cyl(0.28, 0.28, 0.12, 10)
            .rotateZ(Math.PI / 2)
            .translate(-1.2, 0, 0),
          cyl(0.28, 0.28, 0.12, 10)
            .rotateZ(Math.PI / 2)
            .translate(1.2, 0, 0),
          box(0.12, 0.7, 0.12).translate(0, 0.35, 0),
        ]),
      ),
      role: "decalDark",
      y: 2.4,
    },
    {
      geometry: geo("pipe.valve", () => new THREE.TorusGeometry(0.22, 0.04, 6, 10)),
      role: "hazard",
      y: 2.7,
      x: 0.6,
    },
  ],
  tank: () => [
    {
      geometry: geo("tank.body", () => cyl(1.0, 1.0, 2.3, 12)),
      role: "metal",
      y: 1.35,
      castShadow: true,
    },
    {
      geometry: geo(
        "tank.cap",
        () => new THREE.SphereGeometry(1.0, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2),
      ),
      role: "metal",
      y: 2.5,
    },
    { geometry: geo("tank.band", () => cyl(1.03, 1.03, 0.3, 12)), role: "hazardStripes", y: 0.9 },
    {
      geometry: geo("tank.legs", () =>
        merged([
          box(0.14, 0.3, 0.14).translate(-0.7, 0.15, -0.7),
          box(0.14, 0.3, 0.14).translate(0.7, 0.15, -0.7),
          box(0.14, 0.3, 0.14).translate(-0.7, 0.15, 0.7),
          box(0.14, 0.3, 0.14).translate(0.7, 0.15, 0.7),
        ]),
      ),
      role: "decalDark",
      y: 0,
    },
  ],
  torch: () => [
    { geometry: geo("torch.bracket", () => box(0.16, 0.5, 0.12)), role: "metal", y: 1.5, z: 0.5 },
    {
      geometry: geo("torch.stick", () => cyl(0.05, 0.07, 0.9, 5).rotateX(-0.35)),
      role: "wood",
      y: 1.7,
      z: 0.4,
    },
    {
      geometry: geo("torch.cup", () => cyl(0.12, 0.08, 0.16, 6)),
      role: "decalDark",
      y: 2.1,
      z: 0.25,
    },
    {
      geometry: geo("torch.flame", () =>
        merged([
          new THREE.ConeGeometry(0.17, 0.5, 6).translate(0, 0.25, 0),
          new THREE.SphereGeometry(0.11, 6, 5).translate(0, 0.05, 0),
        ]),
      ),
      role: "flame",
      y: 2.15,
      z: 0.25,
    },
  ],
  bones: () => [
    {
      geometry: geo("bones.ribs", () =>
        merged([
          new THREE.TorusGeometry(0.22, 0.025, 4, 10, Math.PI).translate(0, 0, -0.2),
          new THREE.TorusGeometry(0.26, 0.025, 4, 10, Math.PI).translate(0, 0, 0),
          new THREE.TorusGeometry(0.22, 0.025, 4, 10, Math.PI).translate(0, 0, 0.2),
          cyl(0.035, 0.035, 0.9, 5)
            .rotateX(Math.PI / 2)
            .translate(0, 0.03, 0.1),
          cyl(0.03, 0.03, 0.7, 5)
            .rotateZ(Math.PI / 2)
            .translate(0.6, 0.04, 0.5),
        ]),
      ),
      role: "decalLight",
      y: 0.02,
    },
    {
      geometry: geo("bones.skull", () =>
        merged([
          new THREE.SphereGeometry(0.19, 8, 6).translate(0, 0, 0),
          box(0.2, 0.1, 0.16).translate(0, -0.12, -0.08),
        ]),
      ),
      role: "decalLight",
      y: 0.2,
      z: -0.65,
    },
  ],
  stalagmite: () => [
    {
      geometry: geo("stalagmite", () =>
        merged([
          new THREE.ConeGeometry(0.45, 1.6, 6).translate(0, 0.8, 0),
          new THREE.ConeGeometry(0.25, 0.9, 5).translate(0.35, 0.45, 0.2),
        ]),
      ),
      role: "stone",
      y: 0,
      castShadow: true,
    },
  ],
  chain: () => [
    {
      geometry: geo("chain", () =>
        merged([
          cyl(0.035, 0.035, 2.4, 5).translate(0, 1.2, 0),
          new THREE.TorusGeometry(0.12, 0.03, 4, 8).translate(0, 0, 0),
        ]),
      ),
      role: "decalDark",
      y: 0,
    },
  ],
  hazardDecal: () => [
    {
      geometry: geo("hazard.decal", () => new THREE.PlaneGeometry(2.4, 0.5).rotateX(-Math.PI / 2)),
      role: "hazardStripes",
      y: 0.012,
    },
  ],
  cobblePatch: () => [
    {
      geometry: geo("cobble.patch", () =>
        merged([
          cyl(0.14, 0.17, 0.05, 6).translate(0, 0, 0),
          cyl(0.11, 0.14, 0.045, 6).translate(0.28, 0, 0.07),
          cyl(0.13, 0.15, 0.04, 6).translate(-0.06, 0, 0.3),
          cyl(0.1, 0.13, 0.045, 6).translate(0.23, 0, 0.33),
          cyl(0.12, 0.14, 0.04, 6).translate(-0.3, 0, 0.1),
        ]),
      ),
      role: "stoneLight",
      y: 0.01,
      scale: 0.6,
    },
  ],
  farTree: () => [
    {
      geometry: geo("farTree.canopy", () =>
        merged([
          blob(1.9, 5, 0.8).translate(0, 3.0, 0),
          blob(1.3, 19, 0.85).translate(0.6, 4.1, 0.3),
        ]),
      ),
      role: "foliageDark",
      y: 0,
    },
    {
      geometry: geo("farTree.trunk", () => cyl(0.22, 0.34, 2.2, 6).translate(0, 1.1, 0)),
      role: "bark",
      y: 0,
    },
  ],
  farHouse: () => [
    {
      geometry: geo("farHouse.walls", () => box(6, 3.6, 5).translate(0, 1.8, 0)),
      role: "wallPlaster",
      y: 0,
    },
    {
      geometry: geo("farHouse.roof", () => gablePrism(6.6, 2.4, 5.6).translate(0, 3.6, 0)),
      role: "bark",
      y: 0,
    },
    {
      geometry: geo("farHouse.chimney", () => box(0.7, 1.6, 0.7).translate(1.6, 4.6, -1.2)),
      role: "stone",
      y: 0,
    },
  ],
};

/** Prop families the kit adds on top of `biome.props`, per biome kind. */
export function extraFamilies(kind: BiomeKind): { mid: string[]; decals: string[] } {
  switch (kind) {
    case "meadow":
      return { mid: ["rock"], decals: ["grass", "grass", "flower"] };
    case "plaza":
      return { mid: ["barrel", "stall"], decals: ["cobblePatch"] };
    case "village":
      return { mid: ["stall", "barrel"], decals: ["cobblePatch"] };
    case "industrial":
      return { mid: ["tank", "barrel"], decals: ["hazardDecal"] };
    case "dungeon":
      return { mid: ["stalagmite"], decals: ["bones"] };
  }
}

// ---- building instanced meshes -----------------------------------------------------

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const JITTER_ROLES = new Set<MaterialRole>([
  "foliage",
  "foliageDark",
  "foliageLight",
  "stone",
  "stoneLight",
  "bark",
]);
const _c = new THREE.Color();

/** One InstancedMesh per part for a list of instances of one family. */
export function instanceFamily(
  family: string,
  list: PropInstance[],
  lib: MaterialLibrary,
  receiveShadow = true,
): THREE.Object3D[] {
  const factory = FAMILIES[family];
  if (!factory || list.length === 0) return [];
  const out: THREE.Object3D[] = [];
  for (const part of factory(lib.kind)) {
    const mesh = new THREE.InstancedMesh(part.geometry, lib.get(part.role), list.length);
    mesh.name = `${family}.${part.role}`;
    list.forEach((inst, i) => {
      _q.setFromAxisAngle(UP, inst.rotation);
      const s = inst.scale * (part.scale ?? 1);
      _p.set(part.x ?? 0, part.y, part.z ?? 0)
        .multiplyScalar(inst.scale)
        .applyQuaternion(_q);
      _p.x += inst.position[0];
      _p.y += inst.position[1];
      _p.z += inst.position[2];
      _s.set(s, s, s);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
      if (JITTER_ROLES.has(part.role)) {
        // Cheap variation: lightness jitter per instance from its own transform.
        const j = (((inst.rotation * 7.13 + inst.scale * 3.1) % 1) - 0.5) * 0.16;
        mesh.setColorAt(i, _c.set(0xffffff).offsetHSL(0, 0, j));
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = Boolean(part.castShadow);
    mesh.receiveShadow = receiveShadow;
    out.push(mesh);
  }
  return out;
}

/** Build an InstancedMesh from explicit matrices. */
export function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  matrices: THREE.Matrix4[],
  opts: { castShadow?: boolean; receiveShadow?: boolean; name?: string } = {},
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, i) => {
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = Boolean(opts.castShadow);
  mesh.receiveShadow = opts.receiveShadow ?? true;
  if (opts.name) mesh.name = opts.name;
  return mesh;
}

export function matrixAt(
  x: number,
  y: number,
  z: number,
  rotY = 0,
  sx = 1,
  sy = sx,
  sz = sx,
): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  _q.setFromAxisAngle(UP, rotY);
  m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  return m;
}

// ---- contact shadow -----------------------------------------------------------------

const contactMaterials = new Map<number, THREE.MeshBasicMaterial>();
/** Dark soft disc under NPCs and props: cheaper than a shadow and never missing. */
export function makeContactDisc(radius: number, opacity = 0.55): THREE.Mesh {
  // One shared material per opacity: NPCs no longer cast into the shadow map, so the disc is
  // their only grounding, and floating and standing forms need different strengths.
  let contactMaterial = contactMaterials.get(opacity);
  if (!contactMaterial) {
    contactMaterial = new THREE.MeshBasicMaterial({
      map: radialFalloff(),
      color: "#000000",
      transparent: true,
      opacity,
      depthWrite: false,
    });
    contactMaterial.userData.shared = true;
    contactMaterials.set(opacity, contactMaterial);
  }
  const disc = new THREE.Mesh(
    geo("contact.disc", () => new THREE.PlaneGeometry(2, 2)),
    contactMaterial,
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.015;
  disc.scale.setScalar(radius);
  disc.renderOrder = 1;
  disc.name = "contactShadow";
  return disc;
}

const glowMaterials = new Map<string, THREE.SpriteMaterial>();
/** Additive glow card for flames and lanterns: the cheap half of a practical light. */
export function makeGlowSprite(color: string, size: number): THREE.Sprite {
  let m = glowMaterials.get(color);
  if (!m) {
    m = new THREE.SpriteMaterial({
      map: radialFalloff(),
      // HDR on purpose (linear colour above 1): the core of a glow card clears the bloom
      // threshold, which white text and lit surfaces never do.
      color: new THREE.Color(color).multiplyScalar(1.6),
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    m.userData.shared = true;
    glowMaterials.set(color, m);
  }
  const s = new THREE.Sprite(m);
  s.scale.set(size, size, 1);
  s.name = "glow";
  return s;
}

export function isSharedGeometry(g: THREE.BufferGeometry): boolean {
  return Boolean(g.userData.shared);
}
