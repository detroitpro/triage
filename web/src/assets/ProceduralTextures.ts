import * as THREE from "three";
import { mulberry32 } from "../pure/rng.ts";

/**
 * Small canvas-generated textures shared by every kit. Each is built once and cached;
 * they are never disposed with an area because every biome reuses them.
 */
const cache = new Map<string, THREE.Texture>();

function canvasTexture(
  key: string,
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  opts: { repeat?: boolean; srgb?: boolean } = {},
): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts.repeat !== false) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.userData.shared = true;
  cache.set(key, tex);
  return tex;
}

/** Diagonal black / warning-orange stripes for locked bars, tank bands and floor edges. */
export function hazardStripes(): THREE.Texture {
  return canvasTexture("hazard", 128, (ctx, s) => {
    ctx.fillStyle = "#f4b12a";
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = "#17161a";
    const w = s / 4;
    for (let i = -2; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(i * w, 0);
      ctx.lineTo(i * w + w / 2, 0);
      ctx.lineTo(i * w + w / 2 - s, s);
      ctx.lineTo(i * w - s, s);
      ctx.closePath();
      ctx.fill();
    }
  });
}

/** Soft radial falloff: contact shadows under NPCs, portal discs, light pools. */
export function radialFalloff(): THREE.Texture {
  return canvasTexture(
    "radial",
    128,
    (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.55, "rgba(255,255,255,0.55)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    },
    { repeat: false },
  );
}

/** Lit window strip with mullions; used as map + emissiveMap on building walls. */
export function windowStrip(warm: boolean): THREE.Texture {
  return canvasTexture(`window-${warm ? "warm" : "cool"}`, 128, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    if (warm) {
      g.addColorStop(0, "#fff3cf");
      g.addColorStop(1, "#ffc46b");
    } else {
      g.addColorStop(0, "#d8f0ff");
      g.addColorStop(1, "#7fb6e8");
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = "#2a2420";
    const bar = s * 0.06;
    ctx.fillRect(s / 2 - bar / 2, 0, bar, s);
    ctx.fillRect(0, s / 2 - bar / 2, s, bar);
    ctx.fillRect(0, 0, s, bar);
    ctx.fillRect(0, s - bar, s, bar);
    ctx.fillRect(0, 0, bar, s);
    ctx.fillRect(s - bar, 0, bar, s);
  });
}

/** Rounded cobbles on dark mortar. Light grey so the palette tint dominates. */
export function cobbles(): THREE.Texture {
  return canvasTexture("cobbles", 256, (ctx, s) => {
    const rand = mulberry32(7);
    ctx.fillStyle = "#5e5953";
    ctx.fillRect(0, 0, s, s);
    const cell = s / 8;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const jitter = (rand() - 0.5) * cell * 0.25;
        const x = col * cell + (row % 2 ? cell / 2 : 0) + jitter;
        const y = row * cell + (rand() - 0.5) * cell * 0.2;
        const w = cell * (0.78 + rand() * 0.15);
        const h = cell * (0.72 + rand() * 0.15);
        const shade = 140 + Math.floor(rand() * 75);
        ctx.fillStyle = `rgb(${shade},${shade - 4},${shade - 10})`;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, cell * 0.3);
        ctx.fill();
        // Wrap-around copies keep the tiling seamless.
        ctx.beginPath();
        ctx.roundRect(x - s, y, w, h, cell * 0.3);
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(x, y - s, w, h, cell * 0.3);
        ctx.fill();
      }
    }
  });
}

/** Large flagstones with dark grout for dungeon floors. */
export function flagstones(): THREE.Texture {
  return canvasTexture("flagstones", 256, (ctx, s) => {
    const rand = mulberry32(11);
    ctx.fillStyle = "#3a3a42";
    ctx.fillRect(0, 0, s, s);
    const cell = s / 4;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const x = col * cell + 3;
        const y = row * cell + 3;
        const shade = 120 + Math.floor(rand() * 50);
        ctx.fillStyle = `rgb(${shade},${shade},${shade + 6})`;
        ctx.fillRect(x, y, cell - 6, cell - 6);
        // A crack or chip on some stones.
        if (rand() < 0.4) {
          ctx.strokeStyle = "#3a3a42";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + rand() * cell, y);
          ctx.lineTo(x + rand() * cell, y + cell - 6);
          ctx.stroke();
        }
      }
    }
  });
}

/** Riveted steel plate for industrial walls and tanks. */
export function steelPlate(): THREE.Texture {
  return canvasTexture("steel", 128, (ctx, s) => {
    ctx.fillStyle = "#b9bec6";
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "#7d848d";
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, s - 3, s - 3);
    ctx.fillStyle = "#6c737b";
    for (const [x, y] of [
      [10, 10],
      [s - 10, 10],
      [10, s - 10],
      [s - 10, s - 10],
    ]) {
      ctx.beginPath();
      ctx.arc(x ?? 0, y ?? 0, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Deterministic value noise in [0,1), continuous, for terrain and jitter. */
export function noise2(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number) => {
    let n = (a * 374761393 + b * 668265263) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const a = h(xi, zi);
  const b = h(xi + 1, zi);
  const c = h(xi, zi + 1);
  const d = h(xi + 1, zi + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
