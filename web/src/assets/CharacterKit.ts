import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { NpcForm } from "../../../src/world/types.ts";
import { type AssetManifest, type CharacterAsset, characterFor } from "../pure/manifest.ts";

/**
 * Generated characters (charter "Look": the asset kit). The manifest at
 * /assets/manifest.json lists one rigged, animated GLB per NPC form; `preloadCharacters`
 * loads them once at boot. Any form without a usable asset keeps its procedural body, so
 * the game always runs, with or without the kit.
 */
export interface CharacterTemplate {
  asset: CharacterAsset;
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  /** Uniform scale that brings the model to the form's height in world units. */
  scale: number;
  /** Height after scaling, for labels and badges. */
  height: number;
  /** Front of the body (largest +Z of the model, scaled; the body faces -Z once turned). */
  frontZ: number;
  /** Rough head radius, for the context ribbon. */
  headRadius: number;
}

/** A live character: a skinned clone and its mixer. */
export interface CharacterInstance {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  /** Cross-fade to a clip by role ("idle", "talk", "react", "leave"); falls back to idle. */
  play(role: string, fade?: number): void;
  /** Advance the mixer to `t` seconds. */
  update(t: number): void;
  /** Stop and release the mixer's cached actions. */
  dispose(): void;
  height: number;
}

const templates = new Map<NpcForm, CharacterTemplate>();

export const MANIFEST_URL = "/assets/manifest.json";

export async function preloadCharacters(
  fetchFn: typeof fetch = fetch,
  timeoutMs = 8000,
): Promise<NpcForm[]> {
  // One deadline covers the manifest and every model: boot never waits longer than this.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((r) => {
    timer = setTimeout(() => r(null), timeoutMs);
  });
  let manifest: AssetManifest | null;
  try {
    manifest = await Promise.race([
      fetchFn(MANIFEST_URL).then((res) => (res.ok ? (res.json() as Promise<AssetManifest>) : null)),
      deadline,
    ]);
  } catch {
    manifest = null;
  }
  if (!manifest || !Array.isArray(manifest.assets)) {
    clearTimeout(timer);
    return [];
  }
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const forms: NpcForm[] = ["creature", "villager", "worker", "shade"];
  const loaded: NpcForm[] = [];
  const kit = manifest;
  await Promise.all(
    forms.map(async (form) => {
      const asset = characterFor(kit, form);
      if (!asset) return;
      try {
        const gltf = await Promise.race([loader.loadAsync(`/assets/${asset.file}`), deadline]);
        if (!gltf) throw new Error("timed out");
        templates.set(form, toTemplate(asset, gltf.scene, gltf.animations));
        loaded.push(form);
      } catch (err) {
        console.warn(`character ${form}: ${asset.file} failed, using the procedural body`, err);
      }
    }),
  );
  clearTimeout(timer);
  return loaded;
}

export function characterTemplate(form: NpcForm): CharacterTemplate | undefined {
  return templates.get(form);
}

/** For tests and QA: install a template built in code. */
export function registerCharacterTemplate(form: NpcForm, template: CharacterTemplate): void {
  templates.set(form, template);
}

export function toTemplate(
  asset: CharacterAsset,
  scene: THREE.Object3D,
  animations: THREE.AnimationClip[],
): CharacterTemplate {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const raw = Math.max(0.01, box.max.y - box.min.y);
  const scale = asset.height / raw;
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      // NPCs ground themselves with contact discs; the shadow map is static (charter "Look").
      o.castShadow = false;
      o.receiveShadow = false;
      o.frustumCulled = false; // skinned bounds lag the animation; NPCs are few up close
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        m.userData.shared = true;
      o.geometry.userData.shared = true;
    }
  });
  const clips = new Map<string, THREE.AnimationClip>();
  for (const [role, name] of Object.entries(asset.clips)) {
    const clip = animations.find((a) => a.name === name);
    if (clip) clips.set(role, clip);
  }
  const frontZ = box.max.z * scale;
  const headRadius = ((box.max.x - box.min.x) * scale) / 6;
  return { asset, scene, clips, scale, height: asset.height, frontZ, headRadius };
}

export function instantiateCharacter(template: CharacterTemplate, phase = 0): CharacterInstance {
  const root = cloneSkinned(template.scene);
  root.scale.setScalar(template.scale);
  // Generated models face +Z; NPC bodies face -Z.
  root.rotation.y = Math.PI;
  const mixer = new THREE.AnimationMixer(root);
  let current: THREE.AnimationAction | null = null;
  let last: number | null = null;
  const play = (role: string, fade = 0.25) => {
    const resolved = template.clips.has(role) ? role : "idle";
    const clip = template.clips.get(resolved);
    if (!clip) return;
    const next = mixer.clipAction(clip);
    if (next === current) return;
    // Loop mode follows the clip that actually plays: a missing "leave" falls back to an
    // idle that must keep looping.
    const once = resolved === "leave" || resolved === "react";
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Number.POSITIVE_INFINITY);
    next.clampWhenFinished = once;
    next.play();
    if (current) next.crossFadeFrom(current, fade, false);
    current = next;
  };
  play("idle", 0);
  // Desynchronise idles so a crowd does not breathe in step.
  if (current)
    (current as THREE.AnimationAction).time = phase * (template.clips.get("idle")?.duration ?? 1);
  // Pose now: reduced motion never advances the mixer, and nothing should show the T-pose.
  mixer.update(0);
  return {
    root,
    mixer,
    play,
    update(t) {
      if (last !== null) mixer.update(Math.min(0.1, Math.max(0, t - last)));
      last = t;
    },
    height: template.height,
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    },
  };
}
