import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { instantiateCharacter, preloadCharacters, toTemplate } from "../src/assets/CharacterKit.ts";
import type { CharacterAsset } from "../src/pure/manifest.ts";

const asset: CharacterAsset = {
  id: "t",
  kind: "character",
  form: "villager",
  file: "npc/t.glb",
  bytes: 1,
  triangles: 1,
  height: 1.8,
  clips: { idle: "Idle", leave: "Leave" },
  provenance: {
    provider: "procedural",
    taskIds: [],
    prompt: "test",
    license: "test",
    terms: "",
    generatedAt: "2026-10-11",
  },
};

function rig(): { scene: THREE.Group; clips: THREE.AnimationClip[] } {
  const geo = new THREE.BoxGeometry(0.5, 1, 0.3).translate(0, 0.5, 0);
  const n = geo.attributes.position?.count ?? 0;
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
  geo.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute(
      Array.from({ length: n * 4 }, (_, i) => (i % 4 ? 0 : 1)),
      4,
    ),
  );
  const bone = new THREE.Bone();
  bone.name = "Spine";
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  const scene = new THREE.Group();
  scene.add(mesh);
  const q = (a: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, a)).toArray();
  const idle = new THREE.AnimationClip("Idle", 1, [
    new THREE.QuaternionKeyframeTrack("Spine.quaternion", [0, 1], [...q(0.3), ...q(0.3)]),
  ]);
  return { scene, clips: [idle] };
}

describe("character templates", () => {
  it("scale the model to its form height and mark shared resources", () => {
    const { scene, clips } = rig();
    const t = toTemplate(asset, scene, clips);
    expect(t.scale).toBeCloseTo(1.8, 5);
    let shared = 0;
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry.userData.shared) shared++;
    });
    expect(shared).toBe(1);
  });

  it("poses at once (never the bind pose) and keeps idle looping when leave is missing", () => {
    const { scene, clips } = rig();
    const c = instantiateCharacter(toTemplate(asset, scene, clips));
    let spine: THREE.Object3D | undefined;
    c.root.traverse((o) => {
      if (o.name === "Spine") spine = o;
    });
    expect(spine?.rotation.z ?? 0).toBeCloseTo(0.3, 3);
    c.play("leave");
    const action = c.mixer.existingAction(clips[0] as THREE.AnimationClip);
    expect(action?.loop).toBe(THREE.LoopRepeat);
    c.dispose();
  });
});

describe("preloadCharacters", () => {
  it("returns no characters, without throwing, for a missing or malformed manifest", async () => {
    const notFound = (async () => new Response("", { status: 404 })) as typeof fetch;
    const malformed = (async () => new Response(JSON.stringify({ version: 1 }))) as typeof fetch;
    const hung = (() => new Promise<Response>(() => {})) as typeof fetch;
    expect(await preloadCharacters(notFound)).toEqual([]);
    expect(await preloadCharacters(malformed)).toEqual([]);
    expect(await preloadCharacters(hung, 20)).toEqual([]);
  });
});
