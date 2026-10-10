import * as THREE from "three";
import type { NpcForm } from "../../../src/world/types.ts";
import type { MaterialLibrary, MaterialRole } from "./MaterialLibrary.ts";
import { geo } from "./WorldPropKit.ts";

/**
 * Four authored silhouettes. Each body is ~1.6-2.0 units tall before scaling, faces -Z,
 * and exposes named joints so idle motion can move parts without touching geometry.
 */
export interface NpcBody {
  root: THREE.Group;
  joints: Record<string, THREE.Object3D>;
  /** Chest or forehead badge whose material swaps when the issue is reviewed. */
  signal: THREE.Mesh;
  /** Suggested label height above the feet (unscaled). */
  labelHeight: number;
  /** Floating forms hover; their base height is animated instead of bobbing in place. */
  floats: boolean;
}

type Builder = (lib: MaterialLibrary) => NpcBody;

function mesh(
  key: string,
  make: () => THREE.BufferGeometry,
  role: MaterialRole,
  lib: MaterialLibrary,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(geo(`npc.${key}`, make), lib.get(role));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = false;
  return m;
}

function joint(
  name: string,
  x: number,
  y: number,
  z: number,
  joints: Record<string, THREE.Object3D>,
): THREE.Group {
  const j = new THREE.Group();
  j.name = name;
  j.position.set(x, y, z);
  joints[name] = j;
  return j;
}

function sphere(r: number, w = 10, h = 8): THREE.SphereGeometry {
  return new THREE.SphereGeometry(r, w, h);
}
function capsule(r: number, len: number, seg = 8): THREE.CapsuleGeometry {
  return new THREE.CapsuleGeometry(r, len, 3, seg);
}
function cone(r: number, h: number, seg = 6): THREE.ConeGeometry {
  return new THREE.ConeGeometry(r, h, seg);
}
function cyl(rt: number, rb: number, h: number, seg = 10): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(rt, rb, h, seg);
}
function box(w: number, h: number, d: number): THREE.BoxGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

function eyes(
  lib: MaterialLibrary,
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  r = 0.055,
): void {
  const l = mesh("eye", () => sphere(0.06, 6, 5), "eye", lib, -x, y, z);
  const rr = mesh("eye", () => sphere(0.06, 6, 5), "eye", lib, x, y, z);
  l.scale.setScalar(r / 0.06);
  rr.scale.setScalar(r / 0.06);
  l.castShadow = rr.castShadow = false;
  parent.add(l, rr);
}

/** Round animal: body, belly, head with snout, ears, four feet, tail. */
const creature: Builder = (lib) => {
  const root = new THREE.Group();
  const joints: Record<string, THREE.Object3D> = {};
  const body = joint("body", 0, 0.62, 0, joints);
  root.add(body);
  const torso = mesh("cr.body", () => sphere(0.55, 12, 9), "bodyPrimary", lib);
  torso.scale.set(1, 0.9, 1.08);
  body.add(torso);
  const belly = mesh("cr.belly", () => sphere(0.42, 10, 8), "bodySecondary", lib, 0, -0.1, -0.22);
  belly.scale.set(1, 0.85, 0.7);
  belly.castShadow = false;
  body.add(belly);
  const head = joint("head", 0, 0.5, -0.32, joints);
  body.add(head);
  head.add(mesh("cr.head", () => sphere(0.4, 12, 9), "bodyPrimary", lib));
  const snout = mesh("cr.snout", () => sphere(0.2, 8, 6), "bodySecondary", lib, 0, -0.08, -0.33);
  snout.scale.set(1.2, 0.8, 0.9);
  head.add(snout);
  head.add(mesh("cr.nose", () => sphere(0.07, 6, 5), "eye", lib, 0, -0.03, -0.5));
  eyes(lib, head, 0.17, 0.1, -0.33, 0.065);
  for (const side of [-1, 1]) {
    const ear = joint(side < 0 ? "earL" : "earR", side * 0.26, 0.3, 0.02, joints);
    ear.rotation.z = -side * 0.35;
    head.add(ear);
    ear.add(mesh("cr.ear", () => cone(0.14, 0.42, 5), "bodyPrimary", lib, 0, 0.18, 0));
    const inner = mesh("cr.earIn", () => cone(0.08, 0.28, 5), "accentMatte", lib, 0, 0.16, -0.04);
    inner.castShadow = false;
    ear.add(inner);
  }
  for (const [name, x, z] of [
    ["footFL", -0.3, -0.25],
    ["footFR", 0.3, -0.25],
    ["footBL", -0.32, 0.25],
    ["footBR", 0.32, 0.25],
  ] as const) {
    const f = joint(name, x, 0.1, z, joints);
    root.add(f);
    const foot = mesh("cr.foot", () => sphere(0.17, 8, 6), "bodySecondary", lib);
    foot.scale.set(1, 0.6, 1.2);
    f.add(foot);
  }
  const tail = joint("tail", 0, -0.05, 0.5, joints);
  tail.rotation.x = -0.6;
  body.add(tail);
  tail.add(
    mesh(
      "cr.tail",
      () => cone(0.14, 0.55, 6).rotateX(-Math.PI / 2),
      "bodyPrimary",
      lib,
      0,
      0,
      0.25,
    ),
  );
  tail.add(mesh("cr.tailTip", () => sphere(0.1, 6, 5), "bodySecondary", lib, 0, 0, 0.5));
  const signal = mesh(
    "badge",
    () => new THREE.OctahedronGeometry(0.11),
    "decalDark",
    lib,
    0,
    0.72,
    0.0,
  );
  signal.name = "signal";
  head.add(signal);
  return { root, joints, signal, labelHeight: 1.8, floats: false };
};

/** Villager: boots, legs, torso with apron and belt, arms, head with hat, satchel. */
const villager: Builder = (lib) => {
  const root = new THREE.Group();
  const joints: Record<string, THREE.Object3D> = {};
  for (const side of [-1, 1]) {
    const leg = joint(side < 0 ? "legL" : "legR", side * 0.17, 0.62, 0, joints);
    root.add(leg);
    leg.add(mesh("vi.leg", () => cyl(0.13, 0.15, 0.6, 8), "bodySecondary", lib, 0, -0.3, 0));
    leg.add(mesh("vi.boot", () => box(0.26, 0.16, 0.38), "decalDark", lib, 0, -0.56, -0.05));
  }
  const body = joint("body", 0, 0.62, 0, joints);
  root.add(body);
  const torso = mesh("vi.torso", () => capsule(0.36, 0.5), "bodyPrimary", lib, 0, 0.46, 0);
  body.add(torso);
  const apron = mesh("vi.apron", () => box(0.5, 0.78, 0.1), "decalLight", lib, 0, 0.3, -0.33);
  apron.castShadow = false;
  body.add(apron);
  body.add(mesh("vi.belt", () => cyl(0.39, 0.39, 0.1, 10), "decalDark", lib, 0, 0.2, 0));
  body.add(mesh("vi.buckle", () => box(0.14, 0.12, 0.05), "trim", lib, 0, 0.2, -0.37));
  const satchel = mesh("vi.satchel", () => box(0.3, 0.26, 0.14), "wood", lib, 0.42, 0.12, 0.05);
  body.add(satchel);
  const strap = mesh(
    "vi.strap",
    () => box(0.06, 0.95, 0.06).rotateZ(0.55),
    "bark",
    lib,
    0.18,
    0.58,
    -0.3,
  );
  strap.castShadow = false;
  body.add(strap);
  for (const side of [-1, 1]) {
    const arm = joint(side < 0 ? "armL" : "armR", side * 0.44, 0.75, 0, joints);
    body.add(arm);
    arm.add(mesh("vi.arm", () => capsule(0.1, 0.45, 6), "bodyPrimary", lib, 0, -0.3, 0));
    arm.add(mesh("vi.hand", () => sphere(0.11, 7, 6), "skin", lib, 0, -0.66, 0));
  }
  const head = joint("head", 0, 1.08, 0, joints);
  body.add(head);
  head.add(mesh("vi.head", () => sphere(0.3, 12, 9), "skin", lib, 0, 0.1, 0));
  head.add(
    mesh("vi.nose", () => cone(0.05, 0.12, 5).rotateX(-Math.PI / 2), "skin", lib, 0, 0.06, -0.32),
  );
  eyes(lib, head, 0.11, 0.14, -0.27, 0.045);
  head.add(mesh("vi.brim", () => cyl(0.46, 0.46, 0.05, 12), "decalDark", lib, 0, 0.3, 0));
  head.add(mesh("vi.crown", () => cyl(0.24, 0.27, 0.34, 10), "decalDark", lib, 0, 0.48, 0));
  head.add(mesh("vi.band", () => cyl(0.275, 0.275, 0.08, 10), "trim", lib, 0, 0.36, 0));
  const signal = mesh(
    "badge",
    () => new THREE.OctahedronGeometry(0.1),
    "decalDark",
    lib,
    -0.18,
    0.62,
    -0.33,
  );
  signal.name = "signal";
  body.add(signal);
  return { root, joints, signal, labelHeight: 2.05, floats: false };
};

/** Worker: boots, legs, torso with hi-vis vest, gloves, helmet with brim and visor, tool. */
const worker: Builder = (lib) => {
  const root = new THREE.Group();
  const joints: Record<string, THREE.Object3D> = {};
  for (const side of [-1, 1]) {
    const leg = joint(side < 0 ? "legL" : "legR", side * 0.19, 0.64, 0, joints);
    root.add(leg);
    leg.add(mesh("wo.leg", () => cyl(0.15, 0.17, 0.62, 8), "bodySecondary", lib, 0, -0.31, 0));
    leg.add(mesh("wo.boot", () => box(0.3, 0.2, 0.42), "decalDark", lib, 0, -0.58, -0.05));
  }
  const body = joint("body", 0, 0.64, 0, joints);
  root.add(body);
  body.add(mesh("wo.torso", () => box(0.78, 0.9, 0.5), "bodyPrimary", lib, 0, 0.46, 0));
  const vest = mesh("wo.vest", () => box(0.84, 0.62, 0.56), "hazard", lib, 0, 0.56, 0);
  body.add(vest);
  for (const y of [0.42, 0.66]) {
    const stripe = mesh("wo.stripe", () => box(0.86, 0.07, 0.58), "decalLight", lib, 0, y, 0);
    stripe.castShadow = false;
    body.add(stripe);
  }
  body.add(mesh("wo.belt", () => box(0.82, 0.1, 0.54), "decalDark", lib, 0, 0.08, 0));
  body.add(mesh("wo.pouch", () => box(0.22, 0.2, 0.14), "wood", lib, 0.3, -0.02, -0.3));
  for (const side of [-1, 1]) {
    const arm = joint(side < 0 ? "armL" : "armR", side * 0.5, 0.82, 0, joints);
    body.add(arm);
    arm.add(mesh("wo.arm", () => capsule(0.12, 0.5, 6), "bodyPrimary", lib, 0, -0.32, 0));
    arm.add(mesh("wo.glove", () => sphere(0.13, 7, 6), "trim", lib, 0, -0.7, 0));
  }
  const tool = joint("tool", 0, -0.72, -0.1, joints);
  joints.armR?.add(tool);
  tool.rotation.x = 0.4;
  tool.add(mesh("wo.handle", () => cyl(0.03, 0.035, 0.7, 6), "wood", lib, 0, -0.2, 0));
  tool.add(mesh("wo.head", () => box(0.26, 0.12, 0.12), "metal", lib, 0, 0.18, 0));
  const head = joint("head", 0, 1.08, 0, joints);
  body.add(head);
  head.add(mesh("wo.head", () => box(0.46, 0.44, 0.44), "skin", lib, 0, 0.12, 0));
  eyes(lib, head, 0.12, 0.16, -0.23, 0.045);
  head.add(
    mesh(
      "wo.helmet",
      () => new THREE.SphereGeometry(0.33, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2),
      "trim",
      lib,
      0,
      0.26,
      0,
    ),
  );
  head.add(mesh("wo.brim", () => cyl(0.38, 0.38, 0.05, 12), "trim", lib, 0, 0.27, 0));
  const visor = mesh("wo.visor", () => box(0.4, 0.14, 0.06), "glass", lib, 0, 0.17, -0.26);
  visor.castShadow = false;
  head.add(visor);
  const signal = mesh(
    "badge",
    () => new THREE.OctahedronGeometry(0.1),
    "decalDark",
    lib,
    -0.22,
    0.72,
    -0.3,
  );
  signal.name = "signal";
  body.add(signal);
  return { root, joints, signal, labelHeight: 2.05, floats: false };
};

/** Shade: floating cloak with tattered hem, hood with a dark void and glowing eyes, wisps. */
const shade: Builder = (lib) => {
  const root = new THREE.Group();
  const joints: Record<string, THREE.Object3D> = {};
  const body = joint("body", 0, 0.45, 0, joints);
  root.add(body);
  const cloak = mesh("sh.cloak", () => cone(0.55, 1.7, 9), "bodyPrimary", lib, 0, 0.85, 0);
  body.add(cloak);
  const hem = mesh(
    "sh.hem",
    () => cone(0.62, 0.5, 9).rotateX(Math.PI),
    "decalDark",
    lib,
    0,
    0.12,
    0,
  );
  hem.castShadow = false;
  body.add(hem);
  const shoulders = mesh("sh.shoulders", () => sphere(0.42, 9, 7), "bodyPrimary", lib, 0, 1.45, 0);
  shoulders.scale.set(1.15, 0.6, 1);
  body.add(shoulders);
  for (const side of [-1, 1]) {
    const arm = joint(side < 0 ? "armL" : "armR", side * 0.38, 1.35, -0.1, joints);
    body.add(arm);
    arm.rotation.x = -0.5;
    arm.add(mesh("sh.arm", () => capsule(0.08, 0.5, 6), "bodyPrimary", lib, 0, -0.3, 0));
    arm.add(
      mesh("sh.claw", () => cone(0.07, 0.2, 4).rotateX(Math.PI), "decalLight", lib, 0, -0.65, 0),
    );
  }
  const head = joint("head", 0, 1.62, 0, joints);
  body.add(head);
  const hood = mesh("sh.hood", () => cone(0.38, 0.75, 8), "decalDark", lib, 0, 0.3, 0.05);
  hood.rotation.x = 0.25;
  head.add(hood);
  const face = mesh("sh.face", () => sphere(0.26, 9, 7), "eye", lib, 0, 0.12, -0.08);
  face.castShadow = false;
  head.add(face);
  for (const side of [-1, 1]) {
    const eye = mesh("sh.eye", () => sphere(0.06, 6, 5), "shadeEye", lib, side * 0.11, 0.16, -0.3);
    eye.scale.set(1.3, 0.7, 1);
    eye.castShadow = false;
    head.add(eye);
  }
  const sigil = mesh(
    "sh.sigil",
    () => new THREE.OctahedronGeometry(0.1),
    "emissiveSignal",
    lib,
    0,
    1.1,
    -0.42,
  );
  sigil.castShadow = false;
  body.add(sigil);
  const wisps = joint("wisps", 0, 0.9, 0, joints);
  body.add(wisps);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const w = mesh(
      "sh.wisp",
      () => sphere(0.06, 5, 4),
      "shadeEye",
      lib,
      Math.cos(a) * 0.7,
      Math.sin(a * 2) * 0.2,
      Math.sin(a) * 0.7,
    );
    w.castShadow = false;
    wisps.add(w);
  }
  const signal = mesh(
    "badge",
    () => new THREE.OctahedronGeometry(0.1),
    "decalDark",
    lib,
    0,
    1.75,
    -0.3,
  );
  signal.name = "signal";
  body.add(signal);
  return { root, joints, signal, labelHeight: 2.6, floats: true };
};

const BUILDERS: Record<NpcForm, Builder> = { creature, villager, worker, shade };

export function buildNpcBody(form: NpcForm, lib: MaterialLibrary): NpcBody {
  return (BUILDERS[form] ?? villager)(lib);
}

/** Idle motion per form; `t` is seconds, `phase` 0..1 per NPC. */
export function animateNpcBody(body: NpcBody, form: NpcForm, t: number, phase: number): void {
  const j = body.joints;
  const w = t * 2 + phase * Math.PI * 2;
  const s = Math.sin(w);
  switch (form) {
    case "creature":
      if (j.body) j.body.position.y = 0.62 + s * 0.03;
      if (j.head) j.head.rotation.y = Math.sin(w * 0.5) * 0.25;
      if (j.earL) j.earL.rotation.z = 0.35 + Math.max(0, Math.sin(w * 3.1)) * 0.25;
      if (j.earR) j.earR.rotation.z = -0.35 - Math.max(0, Math.sin(w * 2.7 + 1)) * 0.25;
      if (j.tail) j.tail.rotation.y = Math.sin(w * 2.3) * 0.5;
      break;
    case "villager":
    case "worker":
      if (j.body) j.body.position.y = (form === "worker" ? 0.64 : 0.62) + Math.abs(s) * 0.025;
      if (j.head) j.head.rotation.y = Math.sin(w * 0.4) * 0.3;
      if (j.armL) j.armL.rotation.x = Math.sin(w * 0.9) * 0.12;
      if (j.armR)
        j.armR.rotation.x =
          form === "worker" ? -0.5 + Math.sin(w * 1.5) * 0.15 : -Math.sin(w * 0.9) * 0.12;
      if (j.tool) j.tool.rotation.z = Math.sin(w * 1.5) * 0.08;
      break;
    case "shade":
      if (j.body) {
        j.body.position.y = 0.45 + s * 0.12;
        j.body.rotation.y = Math.sin(w * 0.3) * 0.15;
      }
      if (j.head) j.head.rotation.z = Math.sin(w * 0.6) * 0.08;
      if (j.wisps) j.wisps.rotation.y = t * 1.2 + phase;
      if (j.armL) j.armL.rotation.x = -0.5 + Math.sin(w * 0.7) * 0.15;
      if (j.armR) j.armR.rotation.x = -0.5 + Math.cos(w * 0.7) * 0.15;
      break;
  }
}
