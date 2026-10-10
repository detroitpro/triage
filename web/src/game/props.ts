import * as THREE from "three";
import type { Biome } from "../../../src/world/types.ts";
import { getMaterialLibrary, type MaterialLibrary } from "../assets/MaterialLibrary.ts";
import { instanceFamily } from "../assets/WorldPropKit.ts";
import type { PropInstance } from "../pure/scatter.ts";

/**
 * Build one InstancedMesh per prop part so a region costs a handful of draw calls.
 * Materials and geometries come from the shared kit; nothing here is per-instance.
 */
export function buildProps(
  props: PropInstance[],
  biome: Biome,
  lib?: MaterialLibrary,
): THREE.Group {
  const library = lib ?? getMaterialLibrary(biome);
  const group = new THREE.Group();
  group.name = "props";
  const byFamily = new Map<string, PropInstance[]>();
  for (const p of props) {
    const list = byFamily.get(p.family) ?? [];
    list.push(p);
    byFamily.set(p.family, list);
  }
  for (const [family, list] of byFamily) {
    for (const mesh of instanceFamily(family, list, library)) group.add(mesh);
  }
  return group;
}
