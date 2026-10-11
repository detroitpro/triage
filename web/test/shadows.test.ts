import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Biome } from "../../src/world/types.ts";
import {
  buildLightingRig,
  CASTER_HEIGHT,
  SHADOW_FIT_MAX,
  SHADOW_STEP,
  shadowFit,
} from "../src/assets/LightingRig.ts";

const VILLAGE: Biome = {
  name: "village workshop",
  ambient: 0.6,
  sun: 0.7,
  sky: "#9ec5e8",
  fog: { color: "#9ec5e8", density: 0.01 },
  palette: { ground: "#7a6a55", wall: "#a08060", accent: "#e8a33d", npc: "#c9b79c" },
  enclosure: "building",
  props: ["crate", "lamp"],
  npcForm: "villager",
  sound: "town",
};
const biomeFor = (_kind: "village") => VILLAGE;

/** Project a world point through the rig's real shadow camera, after placing it. */
function inShadowMap(rig: ReturnType<typeof buildLightingRig>, p: THREE.Vector3): boolean {
  const cam = rig.key.shadow.camera;
  rig.key.updateMatrixWorld();
  rig.key.target.updateMatrixWorld();
  cam.position.setFromMatrixPosition(rig.key.matrixWorld);
  cam.lookAt(new THREE.Vector3().setFromMatrixPosition(rig.key.target.matrixWorld));
  cam.updateMatrixWorld();
  const v = p.clone().applyMatrix4(cam.matrixWorldInverse);
  return v.x >= cam.left && v.x <= cam.right && v.y >= cam.bottom && v.y <= cam.top;
}

function cameraAt(x: number, z: number, yaw = 0): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera();
  c.position.set(x, 1.7, z);
  c.rotation.y = yaw;
  c.updateMatrixWorld();
  return c;
}

describe("shadow map placement", () => {
  it("covers every corner of a mid-size area, floor to caster height, with one static map", () => {
    const bounds = { x: -10, z: 4, w: 56, d: 56 };
    const fit = shadowFit(bounds, 0, 0);
    expect(fit.fitted).toBe(true);
    const rig = buildLightingRig(biomeFor("village"), bounds);
    rig.update(cameraAt(-5, 10), 0);
    for (const x of [bounds.x, bounds.x + bounds.w])
      for (const z of [bounds.z, bounds.z + bounds.d])
        for (const y of [0, CASTER_HEIGHT])
          expect(inShadowMap(rig, new THREE.Vector3(x, y, z))).toBe(true);
  });

  it("draws a fitted map once: looking around or walking does not redraw it", () => {
    const rig = buildLightingRig(biomeFor("village"), { x: 0, z: 0, w: 41, d: 41 });
    expect(rig.key.shadow.needsUpdate).toBe(true);
    rig.key.shadow.needsUpdate = false;
    rig.update(cameraAt(5, 5, 0), 0);
    rig.update(cameraAt(30, 30, 2), 0.1);
    expect(rig.key.shadow.needsUpdate).toBe(false);
    rig.invalidateShadows();
    expect(rig.key.shadow.needsUpdate).toBe(true);
  });

  it("in large areas, redraws only when the player crosses a grid cell, and keeps them inside", () => {
    const bounds = { x: 0, z: 0, w: 144, d: 144 };
    expect(shadowFit(bounds, 0, 0).fitted).toBe(false);
    const rig = buildLightingRig(biomeFor("village"), bounds);
    rig.update(cameraAt(40, 40), 0);
    rig.key.shadow.needsUpdate = false;
    rig.update(cameraAt(41, 41, 1.5), 0.1);
    expect(rig.key.shadow.needsUpdate).toBe(false);
    rig.update(cameraAt(40 + SHADOW_STEP, 40), 0.2);
    expect(rig.key.shadow.needsUpdate).toBe(true);
    for (let x = 0; x <= 144; x += 3.1) {
      rig.update(cameraAt(x, 144 - x), 0);
      // The player and everything within 15 m of them casts into the map.
      for (const [dx, dz] of [
        [0, 0],
        [15, 0],
        [-15, 0],
        [0, 15],
        [0, -15],
      ] as const)
        expect(inShadowMap(rig, new THREE.Vector3(x + dx, 0, 144 - x + dz))).toBe(true);
    }
  });

  it("keeps fitted maps within the texel budget", () => {
    const fit = shadowFit({ x: 0, z: 0, w: 56, d: 56 }, 0, 0);
    expect(Math.max(-fit.left, fit.right, -fit.bottom, fit.top)).toBeLessThanOrEqual(
      SHADOW_FIT_MAX + 1,
    );
  });
});

describe("makeContactDisc", () => {
  it("honours the opacity per call", async () => {
    const { makeContactDisc } = await import("../src/assets/WorldPropKit.ts");
    const a = makeContactDisc(1, 0.4).material as THREE.MeshBasicMaterial;
    const b = makeContactDisc(1, 0.6).material as THREE.MeshBasicMaterial;
    expect(a.opacity).toBe(0.4);
    expect(b.opacity).toBe(0.6);
    expect(makeContactDisc(2, 0.4).material).toBe(a);
  });
});
