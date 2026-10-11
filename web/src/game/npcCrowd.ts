import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { NpcForm } from "../../../src/world/types.ts";
import type { MaterialLibrary } from "../assets/MaterialLibrary.ts";
import { buildNpcBody } from "../assets/NpcFactory.ts";
import { makeContactDisc } from "../assets/WorldPropKit.ts";
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
  private discs: THREE.InstancedMesh;
  private lod = new Map<number, NpcLod>();
  private m = new THREE.Matrix4();

  constructor(
    private readonly npcs: Map<number, NpcHandle>,
    lib: MaterialLibrary,
  ) {
    this.group.name = "npcCrowd";
    const capacity = Math.max(1, npcs.size);
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
    const disc = makeContactDisc(1, 0.55);
    this.discs = new THREE.InstancedMesh(disc.geometry, disc.material, capacity);
    this.discs.name = "crowd-discs";
    this.discs.count = 0;
    this.discs.frustumCulled = false;
    this.discs.renderOrder = disc.renderOrder;
    this.group.add(this.discs);
  }

  /** Is this NPC currently drawn at full detail (and so worth animating)? */
  isNear(issue: number): boolean {
    return this.lod.get(issue)?.detail !== "far";
  }

  update(player: THREE.Vector3): void {
    const counts = new Map<NpcForm, number>();
    let discs = 0;
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
      mesh.setMatrixAt(i, this.m);
      counts.set(h.form, i + 1);
      this.m.multiplyMatrices(h.group.matrixWorld, h.disc.matrix);
      this.discs.setMatrixAt(discs++, this.m);
    }
    for (const [form, mesh] of this.bodies) {
      mesh.count = counts.get(form) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.discs.count = discs;
    this.discs.instanceMatrix.needsUpdate = true;
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
    m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
    m.userData.shared = true;
    crowdMaterials.set(lib, m);
  }
  return m;
}
