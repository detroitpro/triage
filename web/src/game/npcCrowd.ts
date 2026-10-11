import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { NpcForm } from "../../../src/world/types.ts";
import type { MaterialLibrary } from "../assets/MaterialLibrary.ts";
import { buildNpcBody } from "../assets/NpcFactory.ts";
import { lodFor, type NpcLod } from "../pure/lod.ts";
import type { NpcHandle } from "./npc.ts";

/**
 * Level of detail for a region's NPCs (charter "Look": instance repeated things, LOD past
 * mid distance). Near NPCs keep their authored, animated bodies (~35 draw calls each). Far
 * ones are drawn as one instanced, vertex-coloured rest pose per form plus one instanced
 * contact disc, so a crowd of any size costs a handful of draw calls. Labels hide past
 * reading distance. Every frame the instances copy each NPC group's live transform, so
 * scaling, walking, and removal need no bookkeeping beyond the NpcHandle map.
 */
export class NpcCrowd {
  readonly group = new THREE.Group();
  private bodies = new Map<NpcForm, THREE.InstancedMesh>();
  /** Contact discs by opacity: floating forms ground more softly than standing ones. */
  private discs = new Map<number, THREE.InstancedMesh>();
  private capacity: number;
  private lod = new Map<number, NpcLod>();
  private m = new THREE.Matrix4();

  constructor(
    private readonly npcs: Map<number, NpcHandle>,
    lib: MaterialLibrary,
  ) {
    this.group.name = "npcCrowd";
    const capacity = Math.max(1, npcs.size);
    this.capacity = capacity;
    const forms = new Set([...npcs.values()].map((h) => h.form));
    for (const form of forms) {
      const mesh = new THREE.InstancedMesh(bakedBody(form, lib), crowdMaterial(lib), capacity);
      mesh.name = `crowd-${form}`;
      mesh.count = 0;
      // The instances span the whole region; per-instance culling is not worth the CPU.
      mesh.frustumCulled = false;
      this.bodies.set(form, mesh);
      this.group.add(mesh);
    }
    for (const h of npcs.values()) {
      const material = h.disc.material as THREE.MeshBasicMaterial;
      if (this.discs.has(material.opacity)) continue;
      const discs = new THREE.InstancedMesh(h.disc.geometry, material, capacity);
      discs.name = `crowd-discs-${material.opacity}`;
      discs.count = 0;
      discs.frustumCulled = false;
      discs.renderOrder = h.disc.renderOrder;
      this.discs.set(material.opacity, discs);
      this.group.add(discs);
    }
  }

  /** Is this NPC currently drawn at full detail (and so worth animating)? */
  isNear(issue: number): boolean {
    return this.lod.get(issue)?.detail !== "far";
  }

  update(player: THREE.Vector3): void {
    const counts = new Map<NpcForm, number>();
    const discCounts = new Map<number, number>();
    for (const [issue, h] of this.npcs) {
      const p = h.group.position;
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      // Ghosted (practice) NPCs keep their per-mesh materials, so they always stay near.
      const lod = lodFor(d, this.lod.get(issue), h.practice);
      this.lod.set(issue, lod);
      const far = lod.detail === "far";
      h.body.visible = !far;
      h.disc.visible = !far;
      h.label.visible = lod.label;
      if (!far || !h.group.parent) continue;
      const mesh = this.bodies.get(h.form);
      if (!mesh) continue;
      h.group.updateWorldMatrix(true, false);
      // Instance = the NPC group's world transform times the body's own (scale, float).
      this.m.multiplyMatrices(h.group.matrixWorld, h.body.matrix);
      const i = counts.get(h.form) ?? 0;
      // Capacity is the region's NPC count at build time; nothing adds NPCs after that.
      if (i >= this.capacity) continue;
      mesh.setMatrixAt(i, this.m);
      counts.set(h.form, i + 1);
      const opacity = (h.disc.material as THREE.MeshBasicMaterial).opacity;
      const discs = this.discs.get(opacity);
      if (!discs) continue;
      const j = discCounts.get(opacity) ?? 0;
      this.m.multiplyMatrices(h.group.matrixWorld, h.disc.matrix);
      discs.setMatrixAt(j, this.m);
      discCounts.set(opacity, j + 1);
    }
    for (const [form, mesh] of this.bodies) {
      mesh.count = counts.get(form) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const [opacity, discs] of this.discs) {
      discs.count = discCounts.get(opacity) ?? 0;
      discs.instanceMatrix.needsUpdate = true;
    }
    for (const issue of this.lod.keys()) if (!this.npcs.has(issue)) this.lod.delete(issue);
  }
}

const baked = new WeakMap<MaterialLibrary, Map<NpcForm, THREE.BufferGeometry>>();

/** One geometry per form and library: the rest pose, each part coloured by its material. */
function bakedBody(form: NpcForm, lib: MaterialLibrary): THREE.BufferGeometry {
  let byForm = baked.get(lib);
  if (!byForm) {
    byForm = new Map();
    baked.set(lib, byForm);
  }
  const hit = byForm.get(form);
  if (hit) return hit;
  const body = buildNpcBody(form, lib).root;
  body.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  const color = new THREE.Color();
  body.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    const mat = (Array.isArray(o.material) ? o.material[0] : o.material) as
      | THREE.MeshStandardMaterial
      | undefined;
    if (!mat || mat.transparent) return;
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(
      o.matrixWorld,
    );
    for (const name of Object.keys(g.attributes))
      if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    // Emissive parts (eyes, signals) keep their glow colour; everything else its albedo.
    color.copy(mat.color);
    if (mat.emissive && mat.emissiveIntensity > 0 && mat.emissive.getHex() !== 0)
      color.copy(mat.emissive).multiplyScalar(Math.min(2, mat.emissiveIntensity));
    const n = g.attributes.position?.count ?? 0;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([color.r, color.g, color.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    parts.push(g);
  });
  const out = mergeGeometries(parts, false);
  if (!out) throw new Error(`could not bake NPC form ${form}`);
  out.userData.shared = true;
  for (const p of parts) p.dispose();
  byForm.set(form, out);
  return out;
}

const crowdMaterials = new WeakMap<MaterialLibrary, THREE.MeshStandardMaterial>();

function crowdMaterial(lib: MaterialLibrary): THREE.MeshStandardMaterial {
  let m = crowdMaterials.get(lib);
  if (!m) {
    // Flat shading like the authored NPC materials, so the near/far switch does not pop.
    m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      metalness: 0,
      flatShading: true,
    });
    m.userData.shared = true;
    crowdMaterials.set(lib, m);
  }
  return m;
}
