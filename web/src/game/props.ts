import * as THREE from "three";
import type { Biome } from "../../../src/world/types.ts";
import type { PropInstance } from "../pure/scatter.ts";

interface Part {
  geometry: THREE.BufferGeometry;
  color: string;
  emissive?: string;
  /** Local offset and scale applied before the instance transform. */
  y: number;
  scale?: number;
}

type PartFactory = (biome: Biome) => Part[];

const cache = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    g = make();
    cache.set(key, g);
  }
  return g;
}

const FAMILIES: Record<string, PartFactory> = {
  tree: (b) => [
    {
      geometry: geo("trunk", () => new THREE.CylinderGeometry(0.15, 0.22, 1.2, 6)),
      color: "#6b4a2b",
      y: 0.6,
    },
    {
      geometry: geo("crown", () => new THREE.ConeGeometry(1.0, 2.2, 7)),
      color: b.palette.wall,
      y: 2.2,
    },
  ],
  flower: (b) => [
    {
      geometry: geo("stem", () => new THREE.CylinderGeometry(0.03, 0.03, 0.4, 4)),
      color: "#3f8f3a",
      y: 0.2,
    },
    {
      geometry: geo("bud", () => new THREE.SphereGeometry(0.12, 6, 5)),
      color: b.palette.accent,
      y: 0.45,
    },
  ],
  crate: () => [
    {
      geometry: geo("crate", () => new THREE.BoxGeometry(0.9, 0.9, 0.9)),
      color: "#8a6a3f",
      y: 0.45,
    },
  ],
  lamp: (b) => [
    {
      geometry: geo("post", () => new THREE.CylinderGeometry(0.06, 0.08, 2.6, 6)),
      color: "#333a44",
      y: 1.3,
    },
    {
      geometry: geo("bulb", () => new THREE.SphereGeometry(0.22, 8, 6)),
      color: b.palette.accent,
      emissive: b.palette.accent,
      y: 2.7,
    },
  ],
  pipe: () => [
    {
      geometry: geo("pipe", () => new THREE.CylinderGeometry(0.2, 0.2, 4, 8).rotateZ(Math.PI / 2)),
      color: "#4a4f5a",
      y: 1.8,
    },
  ],
  torch: (b) => [
    {
      geometry: geo("stick", () => new THREE.CylinderGeometry(0.05, 0.07, 0.8, 5)),
      color: "#3b2a1a",
      y: 1.4,
    },
    {
      geometry: geo("flame", () => new THREE.ConeGeometry(0.16, 0.4, 5)),
      color: b.palette.accent,
      emissive: b.palette.accent,
      y: 1.95,
    },
  ],
  bones: () => [
    {
      geometry: geo("bone", () =>
        new THREE.CylinderGeometry(0.05, 0.05, 0.7, 5).rotateZ(Math.PI / 2),
      ),
      color: "#d9d4c7",
      y: 0.06,
    },
    {
      geometry: geo("skull", () => new THREE.SphereGeometry(0.18, 6, 5)),
      color: "#d9d4c7",
      y: 0.18,
    },
  ],
};

/** Build one InstancedMesh per prop part so a region costs a handful of draw calls. */
export function buildProps(props: PropInstance[], biome: Biome): THREE.Group {
  const group = new THREE.Group();
  group.name = "props";
  const byFamily = new Map<string, PropInstance[]>();
  for (const p of props) {
    const list = byFamily.get(p.family) ?? [];
    list.push(p);
    byFamily.set(p.family, list);
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const [family, list] of byFamily) {
    const factory = FAMILIES[family];
    if (!factory) continue;
    for (const part of factory(biome)) {
      const material = new THREE.MeshLambertMaterial({ color: part.color, flatShading: true });
      if (part.emissive) {
        material.emissive = new THREE.Color(part.emissive);
        material.emissiveIntensity = 0.9;
      }
      const mesh = new THREE.InstancedMesh(part.geometry, material, list.length);
      list.forEach((inst, i) => {
        q.setFromAxisAngle(up, inst.rotation);
        const s = inst.scale * (part.scale ?? 1);
        m.compose(
          new THREE.Vector3(
            inst.position[0],
            inst.position[1] + part.y * inst.scale,
            inst.position[2],
          ),
          q,
          new THREE.Vector3(s, s, s),
        );
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = false;
      group.add(mesh);
    }
  }
  return group;
}
