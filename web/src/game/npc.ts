import * as THREE from "three";
import type { NpcForm, Placement } from "../../../src/world/types.ts";
import { truncate } from "../pure/dialogueText.ts";
import { makeLabelSprite } from "./labels.ts";

export interface NpcHandle {
  placement: Placement;
  group: THREE.Group;
  body: THREE.Group;
  ring: THREE.Mesh;
  label: THREE.Sprite;
  baseY: number;
  phase: number;
}

function lambert(color: string, emissive?: string): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true });
  if (emissive) {
    m.emissive = new THREE.Color(emissive);
    m.emissiveIntensity = 1.2;
  }
  return m;
}

/** Procedural body per form family. Height is roughly 1.6 units before scaling. */
function buildBody(form: NpcForm, color: string): THREE.Group {
  const g = new THREE.Group();
  const main = lambert(color);
  const dark = lambert("#222222");
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  switch (form) {
    case "creature": {
      add(new THREE.SphereGeometry(0.55, 10, 8), main, 0, 0.6, 0);
      add(new THREE.ConeGeometry(0.14, 0.4, 5), main, -0.3, 1.2, 0);
      add(new THREE.ConeGeometry(0.14, 0.4, 5), main, 0.3, 1.2, 0);
      add(new THREE.SphereGeometry(0.07, 6, 5), dark, -0.18, 0.72, -0.48);
      add(new THREE.SphereGeometry(0.07, 6, 5), dark, 0.18, 0.72, -0.48);
      break;
    }
    case "villager": {
      add(new THREE.CapsuleGeometry(0.35, 0.8, 4, 8), main, 0, 0.75, 0);
      add(new THREE.CylinderGeometry(0.45, 0.45, 0.06, 10), dark, 0, 1.28, 0);
      add(new THREE.CylinderGeometry(0.25, 0.28, 0.35, 10), dark, 0, 1.45, 0);
      add(new THREE.SphereGeometry(0.05, 5, 4), dark, -0.12, 1.0, -0.33);
      add(new THREE.SphereGeometry(0.05, 5, 4), dark, 0.12, 1.0, -0.33);
      break;
    }
    case "worker": {
      add(new THREE.BoxGeometry(0.8, 0.9, 0.5), main, 0, 0.6, 0);
      add(new THREE.BoxGeometry(0.45, 0.45, 0.45), main, 0, 1.3, 0);
      add(
        new THREE.SphereGeometry(0.3, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
        lambert("#ffd166"),
        0,
        1.45,
        0,
      );
      add(new THREE.SphereGeometry(0.05, 5, 4), dark, -0.12, 1.32, -0.24);
      add(new THREE.SphereGeometry(0.05, 5, 4), dark, 0.12, 1.32, -0.24);
      break;
    }
    case "shade": {
      add(new THREE.ConeGeometry(0.5, 2.0, 7), lambert(color), 0, 1.0, 0);
      const eye = lambert("#ff3b3b", "#ff3b3b");
      add(new THREE.SphereGeometry(0.07, 6, 5), eye, -0.12, 1.4, -0.3);
      add(new THREE.SphereGeometry(0.07, 6, 5), eye, 0.12, 1.4, -0.3);
      break;
    }
  }
  return g;
}

export function buildNpc(p: Placement, color: string, reviewed: boolean): NpcHandle {
  const group = new THREE.Group();
  group.name = `npc-${p.issue}`;
  group.position.set(p.position[0], p.position[1], p.position[2]);
  const body = buildBody(p.form, color);
  body.scale.setScalar(p.scale);
  group.add(body);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.5 * p.scale, 0.7 * p.scale, 24),
    new THREE.MeshBasicMaterial({ color: "#4ade80", side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.visible = reviewed;
  group.add(ring);
  const label = makeLabelSprite([`#${p.issue}`, truncate(p.title, 28)], { height: 0.9 });
  label.position.y = 1.9 * p.scale + 0.4;
  group.add(label);
  // Face the region center-ish: look along -Z by default; the caller may rotate.
  return {
    placement: p,
    group,
    body,
    ring,
    label,
    baseY: p.position[1],
    phase: (p.issue % 17) / 17,
  };
}

export function animateNpc(h: NpcHandle, t: number, reducedMotion: boolean): void {
  if (reducedMotion) return;
  h.body.position.y = Math.sin(t * 2 + h.phase * Math.PI * 2) * 0.05;
}

export function setReviewedRing(h: NpcHandle, on: boolean): void {
  h.ring.visible = on;
}
