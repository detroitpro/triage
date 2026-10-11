import * as THREE from "three";
import type { Biome } from "../../../src/world/types.ts";
import { biomeKind, WIND } from "./MaterialLibrary.ts";
import { postFor } from "./PostStack.ts";

/**
 * Ambient motes around the player (charter "Look", motion: nothing is perfectly still):
 * pollen in meadows, dust in halls, embers in dungeons. One Points draw call; every mote
 * drifts on the GPU and wraps inside a box that follows the camera, so the CPU only moves
 * the box. Density comes from the biome (`post.motes`); 0 builds nothing.
 */
const BOX = 24;
const MAX = 600;

interface Style {
  color: string;
  size: number;
  /** Vertical drift per second, metres (embers rise, dust settles). */
  rise: number;
  /** HDR brightness multiplier: embers glow (bloom), dust does not. */
  glow: number;
}

const STYLES: Record<string, Style> = {
  meadow: { color: "#fff3b0", size: 0.06, rise: 0.05, glow: 1.2 },
  plaza: { color: "#fff3b0", size: 0.05, rise: 0.04, glow: 1.1 },
  village: { color: "#ffe2b8", size: 0.04, rise: -0.02, glow: 0.9 },
  industrial: { color: "#cfd8e3", size: 0.035, rise: -0.03, glow: 0.7 },
  dungeon: { color: "#ff7a2e", size: 0.05, rise: 0.25, glow: 2.4 },
};

export function buildMotes(biome: Biome): THREE.Points | null {
  const density = postFor(biome).motes;
  const count = Math.round(MAX * density);
  if (count <= 0) return null;
  const style = STYLES[biomeKind(biome)] ?? (STYLES.meadow as Style);
  const seeds = new Float32Array(count * 4);
  let s = 1;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < count * 4; i++) seeds[i] = rand();
  const g = new THREE.BufferGeometry();
  // Positions are computed in the shader; three still needs a position attribute to draw.
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute("seed", new THREE.BufferAttribute(seeds, 4));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: WIND,
      uCenter: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color(style.color).multiplyScalar(style.glow) },
      uSize: { value: style.size },
      uRise: { value: style.rise },
      uBox: { value: BOX },
      uPixelRatio: { value: 1 },
    },
    vertexShader: `attribute vec4 seed;
      uniform float uTime, uSize, uRise, uBox, uPixelRatio;
      uniform vec3 uCenter;
      varying float vFade;
      void main() {
        // Each mote wanders on its own slow loop and drifts up or down, wrapping in the box.
        vec3 p = seed.xyz * uBox;
        float t = uTime * (0.15 + seed.w * 0.2);
        p += vec3(sin(t + seed.w * 6.28), uRise * uTime, cos(t * 0.8 + seed.x * 6.28)) * 1.5;
        vec3 origin = uCenter - vec3(uBox * 0.5, 2.0, uBox * 0.5);
        p = origin + mod(p - origin + uBox * 100.0, vec3(uBox, 8.0, uBox));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        // Fade near the box edges so wrapping never pops, and twinkle gently.
        vec3 local = abs(p - uCenter) / vec3(uBox * 0.5, 4.0, uBox * 0.5);
        vFade = (1.0 - smoothstep(0.7, 1.0, max(local.x, local.z))) * (0.6 + 0.4 * sin(uTime * 2.0 + seed.w * 40.0));
        gl_PointSize = uSize * uPixelRatio * 900.0 / max(-mv.z, 0.5);
      }`,
    fragmentShader: `uniform vec3 uColor;
      varying float vFade;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vFade;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
  mat.userData.shared = false;
  const points = new THREE.Points(g, mat);
  points.name = "motes";
  points.frustumCulled = false;
  points.renderOrder = 5;
  return points;
}

/** Recentre the mote box on the camera (call from the frame hook). */
export function followMotes(points: THREE.Points, camera: THREE.Camera, pixelRatio: number): void {
  const u = (points.material as THREE.ShaderMaterial).uniforms;
  u.uCenter?.value.copy(camera.position);
  if (u.uPixelRatio) u.uPixelRatio.value = pixelRatio;
}
