import * as THREE from "three";
import type { LabelMeta, NpcForm } from "../../../src/world/types.ts";
import { contextLabel, labelColor, type TokenShape, tokenShape } from "../pure/satchel.ts";
import {
  type CharacterInstance,
  type CharacterTemplate,
  characterTemplate,
  instantiateCharacter,
} from "./CharacterKit.ts";
import type { MaterialLibrary, MaterialRole } from "./MaterialLibrary.ts";
import { geo, merged } from "./WorldPropKit.ts";

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
  form: NpcForm;
  /** Generated, skinned character driving this body (instead of joint wobble), when the kit has one. */
  character?: CharacterInstance;
  /** Badge placement for bodies without the authored joints (generated characters). */
  badgeRig?: BadgeRig;
}

type Builder = (lib: MaterialLibrary) => Omit<NpcBody, "form">;

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
  m.castShadow = false;
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

export function buildNpcBody(form: NpcForm, lib: MaterialLibrary, phase = 0): NpcBody {
  const template = characterTemplate(form);
  if (template) return generatedBody(form, lib, instantiateCharacter(template, phase), template);
  return { ...(BUILDERS[form] ?? villager)(lib), form };
}

/** A generated character in the NpcBody slot: same badges, signal, and label contract. */
function generatedBody(
  form: NpcForm,
  lib: MaterialLibrary,
  character: CharacterInstance,
  template: CharacterTemplate,
): NpcBody {
  const root = new THREE.Group();
  root.name = `generated-${form}`;
  const body = new THREE.Group();
  body.name = "bodyJoint";
  root.add(body);
  body.add(character.root);
  const h = template.height;
  // The reviewed signal floats above the head, small: a status gem, not a prop.
  const signal = mesh(
    "signal.gem.small",
    () => new THREE.OctahedronGeometry(0.055),
    "decalDark",
    lib,
    0,
    h + 0.16,
    0,
  );
  signal.name = "signal";
  body.add(signal);
  // Badges ride the chest bone so they move with the animation, flush with the front surface
  // and smaller than on the chunky authored forms. No hat ribbon or tabard: they would clip
  // a sculpted outfit.
  const chest = chestAnchor(character.root, template, template.chest, BADGE_SCALE_GENERATED);
  body.position.y = template.asset.hover ?? 0;
  const badgeRig: BadgeRig = {
    chest: [0, 0, -0.012],
    cols: 3,
    band: { y: 0, r: 0, h: 0 },
    tabard: [0, 0, 0, 0, 0, 0],
    minimal: true,
  };
  return {
    root,
    joints: { body: chest, bodyJoint: body },
    signal,
    labelHeight: h + 0.55,
    floats: (template.asset.hover ?? 0) > 0,
    form,
    character,
    badgeRig,
  };
}

/** An anchor on the bone nearest the chest, at the chest's front surface, facing -Z. */
function chestAnchor(
  character: THREE.Object3D,
  _template: CharacterTemplate,
  point: [number, number, number],
  scale: number,
): THREE.Object3D {
  character.updateMatrixWorld(true);
  // The character is turned to face -Z and scaled; the point is in scaled model space.
  const [, y, z] = point;
  const target = new THREE.Vector3(0, y, -z);
  const parentInverse = new THREE.Matrix4();
  if (character.parent) parentInverse.copy(character.parent.matrixWorld).invert();
  let best: THREE.Bone | null = null;
  let bestDy = Number.POSITIVE_INFINITY;
  const p = new THREE.Vector3();
  character.traverse((o) => {
    if (!(o instanceof THREE.Bone)) return;
    p.setFromMatrixPosition(o.matrixWorld).applyMatrix4(parentInverse);
    // Only the spine/neck chain: shoulders and arms share heights with the chest.
    if (!/spine|chest|neck/i.test(o.name) && Math.abs(p.x) > 0.02) return;
    if (/shoulder|arm|clavicle|leg|thigh/i.test(o.name)) return;
    const dy = Math.abs(p.y - y);
    if (dy < bestDy) {
      bestDy = dy;
      best = o;
    }
  });
  const anchor = new THREE.Object3D();
  anchor.name = "chestAnchor";
  const bone = best as THREE.Bone | null;
  if (!bone) {
    anchor.position.copy(target);
    character.parent?.add(anchor);
    anchor.scale.setScalar(scale);
    return anchor;
  }
  bone.add(anchor);
  // Place and orient the anchor in the body's space, then express that under the bone.
  const world = new THREE.Matrix4().compose(
    target,
    new THREE.Quaternion(),
    new THREE.Vector3().setScalar(scale),
  );
  if (character.parent) world.premultiply(character.parent.matrixWorld);
  const local = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(world);
  local.decompose(anchor.position, anchor.quaternion, anchor.scale);
  return anchor;
}

const BADGE_SCALE_GENERATED = 0.55;

/** Idle motion per form; `t` is seconds, `phase` 0..1 per NPC. */
export function animateNpcBody(body: NpcBody, form: NpcForm, t: number, phase: number): void {
  if (body.character) {
    body.character.update(t);
    // Floating generated forms bob around their hover height.
    const hover = body.character.hover;
    if (hover > 0 && body.joints.bodyJoint)
      body.joints.bodyJoint.position.y = hover + Math.sin(t * 1.6 + phase * 6.28) * 0.06;
    return;
  }
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

// ---- badges ---------------------------------------------------------------------------
//
// Every NPC wears its labels: small shaped badges stacked in rows on the chest, a ribbon
// around the hat or head for the first `context:*` label, and a tabard (collar, yoke or
// sash per form) tinted with that label's colour. Ghost badges are translucent wireframes:
// the dry-run / pending state. Materials are cached per colour and marked shared so
// disposeArea leaves them alone.

interface BadgeRig {
  /** Centre of the badge block in the body joint's space; badges face -Z. */
  chest: [number, number, number];
  cols: number;
  /** Ribbon around the hat/head, in the head joint's space. */
  band: { y: number; r: number; h: number };
  /** Tabard panel or collar in body space: [x, y, z, w, h, d]. */
  tabard: [number, number, number, number, number, number];
  /** Generated characters: chest badges only, no ribbon or tabard. */
  minimal?: boolean;
}

const RIGS: Record<NpcForm, BadgeRig> = {
  creature: {
    chest: [0, -0.02, -0.57],
    cols: 2,
    band: { y: 0.2, r: 0.42, h: 0.07 },
    tabard: [0, 0.3, -0.12, 0.9, 0.12, 0.9],
  },
  villager: {
    chest: [0, 0.62, -0.43],
    cols: 3,
    band: { y: 0.4, r: 0.29, h: 0.08 },
    tabard: [0, 0.5, -0.39, 0.5, 0.42, 0.05],
  },
  worker: {
    chest: [0, 0.8, -0.33],
    cols: 3,
    band: { y: 0.33, r: 0.335, h: 0.06 },
    tabard: [0, 0.9, 0, 0.82, 0.1, 0.54],
  },
  shade: {
    chest: [0, 0.72, -0.38],
    cols: 2,
    band: { y: 0.0, r: 0.34, h: 0.06 },
    tabard: [0, 0.55, 0, 0.74, 0.1, 0.74],
  },
};

const BADGE_W = 0.2;
const BADGE_H = 0.13;
const BADGE_GAP = 0.04;

const badgeMaterials = new Map<string, THREE.Material>();

function badgeMaterial(color: string, ghost: boolean): THREE.Material {
  const key = `${color}:${ghost ? "ghost" : "solid"}`;
  let m = badgeMaterials.get(key);
  if (!m) {
    m = ghost
      ? new THREE.MeshBasicMaterial({
          color,
          wireframe: true,
          transparent: true,
          opacity: 0.75,
          depthWrite: false,
        })
      : new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.45,
          roughness: 0.55,
          metalness: 0.1,
          flatShading: true,
        });
    m.userData.shared = true;
    badgeMaterials.set(key, m);
  }
  return m;
}

/** Badges face -Z (the NPC's front); CircleGeometry faces +Z, so flat shapes are turned. */
function badgeGeometry(shape: TokenShape): THREE.BufferGeometry {
  switch (shape) {
    case "crest":
      return geo("badge.crest", () =>
        new THREE.CircleGeometry(BADGE_H * 0.78, 5).rotateZ(-Math.PI / 2).rotateY(Math.PI),
      );
    case "gear":
    case "wrench":
      return geo("badge.octo", () => new THREE.CircleGeometry(BADGE_H * 0.72, 8).rotateY(Math.PI));
    case "stopwatch":
    case "lantern":
      return geo("badge.round", () =>
        new THREE.CircleGeometry(BADGE_H * 0.68, 12).rotateY(Math.PI),
      );
    case "hourglass":
      return geo("badge.hourglass", () =>
        merged([
          new THREE.CircleGeometry(BADGE_H * 0.5, 3).rotateZ(Math.PI / 2).translate(0, 0.05, 0),
          new THREE.CircleGeometry(BADGE_H * 0.5, 3).rotateZ(-Math.PI / 2).translate(0, -0.05, 0),
        ]).rotateY(Math.PI),
      );
    default:
      return geo("badge.tag", () => new THREE.BoxGeometry(BADGE_W, BADGE_H, 0.03));
  }
}

function badgesGroup(body: NpcBody): THREE.Group {
  const existing = body.root.userData.badges as THREE.Group | undefined;
  if (existing) {
    existing.clear();
    (existing.userData.ribbon as THREE.Object3D | undefined)?.removeFromParent();
    existing.userData.ribbon = undefined;
    return existing;
  }
  const g = new THREE.Group();
  g.name = "badges";
  body.root.userData.badges = g;
  (body.joints.body ?? body.root).add(g);
  return g;
}

/** Labels currently rendered on the body (solid then ghost), for callers that re-render. */
export function badgeLabels(body: NpcBody): { solid: string[]; ghost: string[] } {
  const g = body.root.userData.badges as THREE.Group | undefined;
  const state = g?.userData.labels as { solid: string[]; ghost: string[] } | undefined;
  return state ?? { solid: [], ghost: [] };
}

/**
 * Dress the NPC. `labels` render solid, `ghostLabels` translucent (pending or practice).
 * Rebuilds the badge block each call; cheap enough for a handful of labels.
 */
export function setBadges(
  body: NpcBody,
  labels: readonly string[],
  labelSet: readonly LabelMeta[],
  ghostLabels: readonly string[] = [],
): void {
  const rig = body.badgeRig ?? RIGS[body.form] ?? RIGS.villager;
  const group = badgesGroup(body);
  group.userData.labels = { solid: [...labels], ghost: [...ghostLabels] };
  const all: { name: string; ghost: boolean }[] = [
    ...labels.map((name) => ({ name, ghost: false })),
    ...ghostLabels.filter((l) => !labels.includes(l)).map((name) => ({ name, ghost: true })),
  ];
  // Chest block: rows of `cols`, centred, top row first.
  const cols = rig.cols;
  const rows = Math.ceil(all.length / cols);
  const [cx, cy, cz] = rig.chest;
  all.forEach((b, i) => {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, all.length - row * cols);
    const col = i % cols;
    const x = cx + (col - (inRow - 1) / 2) * (BADGE_W + BADGE_GAP);
    const y = cy + ((rows - 1) / 2 - row) * (BADGE_H + BADGE_GAP);
    const color = labelColor(labelSet, b.name);
    const shape = tokenShape(b.name);
    // Dark backing plate for contrast at distance; the badge sits a hair in front.
    const plate = new THREE.Mesh(
      geo("badge.plate", () => new THREE.BoxGeometry(BADGE_W + 0.04, BADGE_H + 0.04, 0.02)),
      b.ghost ? badgeMaterial("#000000", true) : badgeMaterial("#14181f", false),
    );
    plate.position.set(x, y, cz + 0.02);
    plate.castShadow = false;
    const badge = new THREE.Mesh(badgeGeometry(shape), badgeMaterial(color, b.ghost));
    badge.position.set(x, y, cz - 0.01);
    badge.castShadow = false;
    badge.name = `badge:${b.name}`;
    badge.userData.label = b.name;
    badge.userData.ghost = b.ghost;
    group.add(plate, badge);
  });
  // Context label: ribbon on the hat and a tinted tabard.
  const ctx = contextLabel([...labels, ...ghostLabels]);
  const head = body.joints.head;
  if (ctx && !rig.minimal) {
    const ghost = !labels.includes(ctx);
    const color = labelColor(labelSet, ctx);
    const mat = badgeMaterial(color, ghost);
    const band = new THREE.Mesh(
      geo(
        `badge.band.${body.form}`,
        () => new THREE.CylinderGeometry(rig.band.r, rig.band.r, rig.band.h, 12, 1, true),
      ),
      mat,
    );
    band.position.y = rig.band.y;
    band.castShadow = false;
    band.name = "ribbon";
    // Ribbons live in head space; parent them there but track them from the badge group.
    const ribbonHolder = new THREE.Group();
    ribbonHolder.name = "ribbonHolder";
    ribbonHolder.add(band);
    (head ?? group).add(ribbonHolder);
    group.userData.ribbon = ribbonHolder;
    const [tx, ty, tz, tw, th, td] = rig.tabard;
    const tabard = new THREE.Mesh(
      geo(`badge.tabard.${body.form}`, () => new THREE.BoxGeometry(tw, th, td)),
      mat,
    );
    tabard.position.set(tx, ty, tz);
    tabard.castShadow = false;
    tabard.name = "tabard";
    group.add(tabard);
  }
}
