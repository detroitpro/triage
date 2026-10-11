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
  /** One instanced mesh per material in the form's baked body (one for procedural forms). */
  private bodies = new Map<NpcForm, THREE.InstancedMesh[]>();
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
      const parts = bakedBody(form, lib).map((part, i) => {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity);
        mesh.name = `crowd-${form}-${i}`;
        mesh.count = 0;
        // The instances span the whole region; per-instance culling is not worth the CPU.
        mesh.frustumCulled = false;
        this.group.add(mesh);
        return mesh;
      });
      this.bodies.set(form, parts);
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
      const parts = this.bodies.get(h.form);
      if (!parts) continue;
      h.group.updateWorldMatrix(true, false);
      // Instance = the NPC group's world transform times the body's own (scale, float).
      this.m.multiplyMatrices(h.group.matrixWorld, h.body.matrix);
      const i = counts.get(h.form) ?? 0;
      // Capacity is the region's NPC count at build time; nothing adds NPCs after that.
      if (i >= this.capacity) continue;
      for (const mesh of parts) mesh.setMatrixAt(i, this.m);
      counts.set(h.form, i + 1);
      const opacity = (h.disc.material as THREE.MeshBasicMaterial).opacity;
      const discs = this.discs.get(opacity);
      if (!discs) continue;
      const j = discCounts.get(opacity) ?? 0;
      this.m.multiplyMatrices(h.group.matrixWorld, h.disc.matrix);
      discs.setMatrixAt(j, this.m);
      discCounts.set(opacity, j + 1);
    }
    for (const [form, parts] of this.bodies)
      for (const mesh of parts) {
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

interface BakedPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

const baked = new WeakMap<MaterialLibrary, Map<NpcForm, BakedPart[]>>();

/**
 * The far body for a form and library, posed once. Procedural forms merge into one
 * vertex-coloured mesh. Generated characters are posed at their idle clip's first frame
 * (never the T-pose they were rigged in) and keep their own textured materials, one part
 * per material.
 */
function bakedBody(form: NpcForm, lib: MaterialLibrary): BakedPart[] {
  let byForm = baked.get(lib);
  if (!byForm) {
    byForm = new Map();
    baked.set(lib, byForm);
  }
  const hit = byForm.get(form);
  if (hit) return hit;
  const built = buildNpcBody(form, lib);
  const body = built.root;
  if (built.character) {
    built.character.mixer.update(0);
    built.character.update(0);
  }
  body.updateMatrixWorld(true);
  const flat: THREE.BufferGeometry[] = [];
  const textured = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const color = new THREE.Color();
  const v = new THREE.Vector3();
  body.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    const mat = (Array.isArray(o.material) ? o.material[0] : o.material) as
      | THREE.MeshStandardMaterial
      | undefined;
    if (!mat || (mat.transparent && !mat.map)) return;
    let g = o.geometry.clone();
    if (o instanceof THREE.SkinnedMesh) {
      // Apply the current pose: bone transforms per vertex, then the mesh's world matrix.
      o.skeleton.update();
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        o.getVertexPosition(i, v);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      g.deleteAttribute("skinIndex");
      g.deleteAttribute("skinWeight");
    }
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(o.matrixWorld);
    if (o instanceof THREE.SkinnedMesh) g.computeVertexNormals();
    if (mat.map) {
      for (const name of Object.keys(g.attributes))
        if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
      const list = textured.get(mat) ?? [];
      list.push(g);
      textured.set(mat, list);
      return;
    }
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
    flat.push(g);
  });
  const parts: BakedPart[] = [];
  const merge = (list: THREE.BufferGeometry[]) => {
    const out = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (!out) throw new Error(`could not bake NPC form ${form}`);
    out.userData.shared = true;
    return out;
  };
  if (flat.length) parts.push({ geometry: merge(flat), material: crowdMaterial(lib) });
  for (const [material, list] of textured) parts.push({ geometry: merge(list), material });
  byForm.set(form, parts);
  return parts;
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
