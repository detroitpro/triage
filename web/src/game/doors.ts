import * as THREE from "three";
import type { Door, World } from "../../../src/world/types.ts";
import { truncate } from "../pure/dialogueText.ts";
import { areaLabel } from "./areas.ts";
import { makeLabelSprite } from "./labels.ts";

export interface DoorHandle {
  door: Door;
  group: THREE.Group;
  ring?: THREE.Mesh;
}

export function buildDoor(door: Door, world: World, accent: string): DoorHandle {
  const group = new THREE.Group();
  group.name = `door-${door.id}`;
  group.position.set(door.position[0], door.position[1], door.position[2]);
  group.rotation.y = door.facing;
  const locked = Boolean(door.locked);
  const color = locked ? "#d62828" : accent;
  let ring: THREE.Mesh | undefined;
  if (door.kind === "portal") {
    const mat = new THREE.MeshBasicMaterial({ color });
    ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.12, 8, 24), mat);
    ring.position.y = 1.5;
    group.add(ring);
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(1.1, 24),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
      }),
    );
    glow.position.y = 1.5;
    group.add(glow);
    const light = new THREE.PointLight(color, 1.5, 8);
    light.position.y = 1.5;
    group.add(light);
  } else {
    const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
    const postL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.6, 0.25), mat);
    postL.position.set(-0.9, 1.3, 0);
    const postR = postL.clone();
    postR.position.x = 0.9;
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.25, 0.25), mat);
    lintel.position.y = 2.6;
    group.add(postL, postR, lintel);
    if (locked) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.15, 0.1), mat);
      bar.position.y = 1.3;
      group.add(bar);
    }
  }
  const lines = locked
    ? [`Locked by #${door.locked?.by}`, truncate(door.locked?.title ?? "", 30)]
    : [`${door.kind === "portal" ? "⟲" : "→"} ${areaLabel(world, door.to)}`];
  const label = makeLabelSprite(lines, { color: locked ? "#ff8080" : "#ffffff", height: 0.7 });
  label.position.y = 3.2;
  group.add(label);
  return ring ? { door, group, ring } : { door, group };
}

export function animateDoor(h: DoorHandle, t: number): void {
  if (h.ring) h.ring.rotation.y = t * 0.8;
}
