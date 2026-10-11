import * as THREE from "three";
import { POST } from "../../../src/world/post.ts";
import type { Bounds } from "../pure/collision.ts";
import { mulberry32 } from "../pure/rng.ts";
import { KEY_DIR } from "./LightingRig.ts";
import { type MaterialLibrary, WIND } from "./MaterialLibrary.ts";
import { noise2 } from "./ProceduralTextures.ts";
import { FAMILIES, geo, instanced, matrixAt, merged } from "./WorldPropKit.ts";

export const WALL_HEIGHT: Record<string, number> = { open: 0, building: 4.6, dungeon: 6 };

// ---- ground ---------------------------------------------------------------------------

/** Flat faceted ground with per-face colour jitter so a plain plane reads as terrain. */
export function buildGround(b: Bounds, lib: MaterialLibrary, seed: number): THREE.Mesh {
  const base = lib.get("ground");
  const segX = Math.max(4, Math.round(b.w / 2));
  const segZ = Math.max(4, Math.round(b.d / 2));
  const g = new THREE.PlaneGeometry(b.w, b.d, segX, segZ).toNonIndexed();
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos ? pos.count * 3 : 0);
  const rand = mulberry32(seed);
  const c = new THREE.Color();
  const jitter = lib.kind === "meadow" || lib.kind === "plaza" ? 0.07 : 0.045;
  if (pos) {
    for (let i = 0; i < pos.count; i += 3) {
      c.set(0xd9d9d9);
      c.offsetHSL(0, 0, (rand() - 0.5) * jitter);
      for (let k = 0; k < 3; k++) {
        colors[(i + k) * 3] = c.r;
        colors[(i + k) * 3 + 1] = c.g;
        colors[(i + k) * 3 + 2] = c.b;
      }
    }
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  if (base.map) {
    const uv = g.attributes.uv;
    if (uv) {
      const rx = b.w / 3.2;
      const rz = b.d / 3.2;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * rx, uv.getY(i) * rz);
    }
  }
  // One ground material per library: vertex colours on, otherwise identical to the role.
  let mat = lib.materials.get("groundVertex" as never) as THREE.MeshStandardMaterial | undefined;
  if (!mat) {
    mat = base.clone();
    mat.vertexColors = true;
    mat.userData.shared = true;
    lib.materials.set("groundVertex" as never, mat);
  }
  const mesh = new THREE.Mesh(g, mat);
  mesh.position.set(b.x + b.w / 2, 0, b.z + b.d / 2);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = "ground";
  return mesh;
}

// ---- open: fence, hills, far silhouettes, sky ---------------------------------------------

function fence(b: Bounds, lib: MaterialLibrary): THREE.Object3D[] {
  const step = 2.6;
  const posts: THREE.Matrix4[] = [];
  const rails: THREE.Matrix4[] = [];
  const side = (len: number, place: (t: number) => [number, number], rot: number) => {
    const n = Math.max(1, Math.round(len / step));
    const actual = len / n;
    for (let i = 0; i <= n; i++) {
      const [x, z] = place(i * actual);
      posts.push(matrixAt(x, 0.5, z, rot + (i % 3) * 0.05));
      if (i < n) {
        const [mx, mz] = place((i + 0.5) * actual);
        rails.push(matrixAt(mx, 0.72, mz, rot, actual / 2.6, 1, 1));
        rails.push(matrixAt(mx, 0.36, mz, rot + 0.02, actual / 2.6, 1, 1));
      }
    }
  };
  side(b.w, (t) => [b.x + t, b.z], 0);
  side(b.w, (t) => [b.x + t, b.z + b.d], 0);
  side(b.d, (t) => [b.x, b.z + t], Math.PI / 2);
  side(b.d, (t) => [b.x + b.w, b.z + t], Math.PI / 2);
  return [
    instanced(
      geo("fence.post", () => new THREE.BoxGeometry(0.18, 1.0, 0.18)),
      lib.get("wood"),
      posts,
      {
        castShadow: true,
        name: "fence.posts",
      },
    ),
    instanced(
      geo("fence.rail", () => new THREE.BoxGeometry(2.6, 0.09, 0.12)),
      lib.get("bark"),
      rails,
      {
        name: "fence.rails",
      },
    ),
  ];
}

function heightOutside(x: number, z: number, b: Bounds, seed: number): number {
  const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
  const dz = Math.max(b.z - z, 0, z - (b.z + b.d));
  const dist = Math.hypot(dx, dz);
  const t = THREE.MathUtils.smoothstep(dist, 3, 34);
  const n = noise2(x * 0.045 + seed, z * 0.045 - seed) * 0.7 + noise2(x * 0.12, z * 0.12) * 0.3;
  return t * (3 + n * 14);
}

/** Rolling hills around an open region; the fog reveals ridges instead of a hard edge. */
function hills(b: Bounds, lib: MaterialLibrary, seed: number): THREE.Mesh {
  const R = 110;
  const w = b.w + 2 * R;
  const d = b.d + 2 * R;
  const seg = 56;
  const g = new THREE.PlaneGeometry(w, d, seg, seg).toNonIndexed();
  g.rotateX(-Math.PI / 2);
  const cx = b.x + b.w / 2;
  const cz = b.z + b.d / 2;
  const pos = g.attributes.position;
  const colors: number[] = [];
  const low = lib.get("ground").color.clone();
  const high = lib.get("foliageDark").color.clone();
  const c = new THREE.Color();
  if (pos) {
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx;
      const z = pos.getZ(i) + cz;
      pos.setY(i, heightOutside(x, z, b, seed) - 0.05);
    }
    for (let i = 0; i < pos.count; i += 3) {
      const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      c.copy(low).lerp(high, THREE.MathUtils.clamp(y / 9, 0, 1));
      c.offsetHSL(0, 0, (noise2(i * 0.37, i * 0.11) - 0.5) * 0.08);
      for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
    }
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 1,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.position.set(cx, 0, cz);
  mesh.receiveShadow = true;
  mesh.name = "hills";
  return mesh;
}

/** Far trees keep this far from far houses (houses are ~6 m wide, canopies ~4 m). */
const FAR_HOUSE_CLEAR = 7.5;

function farLayer(b: Bounds, lib: MaterialLibrary, seed: number): THREE.Object3D[] {
  const rand = mulberry32(seed ^ 0x5151);
  const cx = b.x + b.w / 2;
  const cz = b.z + b.d / 2;
  const trees: THREE.Matrix4[] = [];
  const houses: THREE.Matrix4[] = [];
  // Houses first; trees keep clear of them (rounded canopies are wide and would clip walls).
  const housePts: [number, number][] = [];
  const houseCount = lib.kind === "plaza" ? 10 : 4;
  for (let i = 0; i < houseCount; i++) {
    const ang = (i / houseCount) * Math.PI * 2 + rand() * 0.4;
    const r = 14 + rand() * 12;
    const x = cx + Math.cos(ang) * (b.w / 2 + r);
    const z = cz + Math.sin(ang) * (b.d / 2 + r);
    const y = heightOutside(x, z, b, seed) - 0.2;
    houses.push(matrixAt(x, y, z, ang + Math.PI / 2 + (rand() - 0.5), 0.9 + rand() * 0.5));
    housePts.push([x, z]);
  }
  const treeCount = lib.kind === "plaza" ? 40 : 90;
  for (let i = 0; i < treeCount; i++) {
    const ang = rand() * Math.PI * 2;
    const r = 8 + rand() * 50;
    const x = cx + Math.cos(ang) * (b.w / 2 + r);
    const z = cz + Math.sin(ang) * (b.d / 2 + r);
    const scale = 0.8 + rand() * 0.9;
    const spin = rand() * 6.28;
    if (housePts.some(([hx, hz]) => Math.hypot(x - hx, z - hz) < FAR_HOUSE_CLEAR)) continue;
    const y = heightOutside(x, z, b, seed) - 0.3;
    trees.push(matrixAt(x, y, z, spin, scale));
  }
  const out: THREE.Object3D[] = [];
  for (const part of FAMILIES.farTree?.(lib.kind) ?? [])
    out.push(instanced(part.geometry, lib.get(part.role), trees, { name: "far.trees" }));
  for (const part of FAMILIES.farHouse?.(lib.kind) ?? [])
    out.push(
      instanced(part.geometry, lib.get(part.role), houses, { name: `far.house.${part.role}` }),
    );
  return out;
}

/**
 * Stylized sky: zenith-to-horizon gradient from the biome, a sun disc and halo in the key
 * light's direction (HDR, so it blooms), and soft drifting cloud bands. One draw call.
 */
function skyDome(b: Bounds, lib: MaterialLibrary): THREE.Mesh {
  const horizon = new THREE.Color(lib.biome.fog.color);
  const zenith = new THREE.Color(lib.biome.sky).offsetHSL(0.01, 0.1, -0.1);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    uniforms: {
      uTop: { value: zenith },
      uHorizon: { value: horizon },
      uSun: { value: new THREE.Color("#fff1d2").multiplyScalar(lib.biome.sun) },
      uSunDir: { value: KEY_DIR.clone() },
      uClouds: { value: (lib.biome.post ?? POST[lib.kind] ?? POST.meadow).clouds },
      uTime: WIND,
    },
    vertexShader: `varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform vec3 uTop, uHorizon, uSun, uSunDir;
      uniform float uTime, uClouds;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
        // Clouds: two noise octaves projected on a dome, fading toward the horizon.
        vec2 uv = d.xz / max(d.y + 0.25, 0.05) * 1.6 + vec2(uTime * 0.01, 0.0);
        float c = noise(uv) * 0.65 + noise(uv * 2.3 + 7.0) * 0.35;
        c = smoothstep(0.85 - uClouds * 0.4, 0.95 - uClouds * 0.25, c) * smoothstep(0.02, 0.25, d.y);
        col = mix(col, mix(uHorizon, vec3(1.0), 0.7), c * 0.6);
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSun * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.25);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  mat.userData.shared = false;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), mat);
  mesh.position.set(b.x + b.w / 2, 0, b.z + b.d / 2);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  mesh.name = "sky";
  return mesh;
}

export function buildOpenEnclosure(
  b: Bounds,
  lib: MaterialLibrary,
  seed: number,
): THREE.Object3D[] {
  return [skyDome(b, lib), hills(b, lib, seed), ...fence(b, lib), ...farLayer(b, lib, seed)];
}

// ---- building: timber frame or industrial hall --------------------------------------------

interface Segment {
  cx: number;
  cz: number;
  len: number;
  rot: number;
  index: number;
  /** Unit normal pointing into the room. */
  nx: number;
  nz: number;
}

function perimeterSegments(b: Bounds, segLen: number): Segment[] {
  const segs: Segment[] = [];
  const side = (
    len: number,
    place: (t: number) => [number, number],
    rot: number,
    nx: number,
    nz: number,
  ) => {
    const n = Math.max(1, Math.round(len / segLen));
    const actual = len / n;
    for (let i = 0; i < n; i++) {
      const [cx, cz] = place((i + 0.5) * actual);
      segs.push({ cx, cz, len: actual, rot, index: i, nx, nz });
    }
  };
  side(b.w, (t) => [b.x + t, b.z], 0, 0, 1);
  side(b.w, (t) => [b.x + t, b.z + b.d], 0, 0, -1);
  side(b.d, (t) => [b.x, b.z + t], Math.PI / 2, 1, 0);
  side(b.d, (t) => [b.x + b.w, b.z + t], Math.PI / 2, -1, 0);
  return segs;
}

export function buildBuildingEnclosure(b: Bounds, lib: MaterialLibrary): THREE.Object3D[] {
  const H = WALL_HEIGHT.building ?? 4.6;
  const industrial = lib.kind === "industrial";
  const segs = perimeterSegments(b, 4);
  const panels: THREE.Matrix4[] = [];
  const posts: THREE.Matrix4[] = [];
  const braces: THREE.Matrix4[] = [];
  const windows: THREE.Matrix4[] = [];
  const plinth: THREE.Matrix4[] = [];
  const rails: THREE.Matrix4[] = [];
  const ribs: THREE.Matrix4[] = [];
  const t = 0.4;
  for (const s of segs) {
    // Panel offset slightly outward so timbers stand proud of the plaster.
    const ox = -s.nx * 0.08;
    const oz = -s.nz * 0.08;
    panels.push(matrixAt(s.cx + ox, H / 2, s.cz + oz, s.rot, s.len / 4, H / 4.6, 1));
    plinth.push(matrixAt(s.cx, 0.3, s.cz, s.rot, s.len / 4, 1, 1));
    rails.push(matrixAt(s.cx, 2.3, s.cz, s.rot, s.len / 4, 1, 1));
    rails.push(matrixAt(s.cx, H - 0.12, s.cz, s.rot, s.len / 4, 1, 1));
    // Posts at segment edges.
    const hx = Math.cos(s.rot) * (s.len / 2);
    const hz = Math.sin(s.rot) * (s.len / 2);
    posts.push(matrixAt(s.cx - hx, H / 2, s.cz - hz, s.rot, 1, H / 4.6, 1));
    if (s.index % 2 === 1) {
      windows.push(matrixAt(s.cx, 2.2, s.cz, s.rot, s.len / 4, 1, 1));
      posts.push(matrixAt(s.cx - hx * 0.4, 1.0, s.cz - hz * 0.4, s.rot, 0.7, 0.4, 0.8));
      posts.push(matrixAt(s.cx + hx * 0.4, 1.0, s.cz + hz * 0.4, s.rot, 0.7, 0.4, 0.8));
    } else if (!industrial) {
      // Diagonal braces in the lower panel.
      braces.push(matrixAt(s.cx - hx * 0.35, 1.3, s.cz - hz * 0.35, s.rot, 1, 1, 1));
      braces.push(matrixAt(s.cx + hx * 0.35, 1.3, s.cz + hz * 0.35, s.rot + Math.PI, 1, 1, 1));
    } else {
      // Corrugation ribs on steel panels.
      for (let k = -1; k <= 1; k++)
        ribs.push(
          matrixAt(s.cx + hx * 0.45 * k, H / 2, s.cz + hz * 0.45 * k, s.rot, 1, H / 4.6, 1),
        );
    }
  }
  const out: THREE.Object3D[] = [];
  out.push(
    instanced(
      geo("bld.panel", () => new THREE.BoxGeometry(4, 4.6, t)),
      lib.get(industrial ? "metal" : "wallPlaster"),
      panels,
      { name: "walls.panels" },
    ),
    instanced(
      geo("bld.post", () => new THREE.BoxGeometry(0.28, 4.6, 0.5)),
      lib.get(industrial ? "decalDark" : "wood"),
      posts,
      { name: "walls.posts" },
    ),
    instanced(
      geo("bld.plinth", () => new THREE.BoxGeometry(4.02, 0.6, 0.6)),
      lib.get(industrial ? "hazardStripes" : "stone"),
      plinth,
      { name: "walls.plinth" },
    ),
    instanced(
      geo("bld.rail", () => new THREE.BoxGeometry(4.02, 0.22, 0.52)),
      lib.get(industrial ? "metal" : "wood"),
      rails,
      { name: "walls.rails" },
    ),
    instanced(
      geo("bld.window", () => new THREE.BoxGeometry(2.4, 1.3, 0.3)),
      lib.get("windowLit"),
      windows,
      { name: "walls.windows" },
    ),
  );
  if (braces.length)
    out.push(
      instanced(
        geo("bld.brace", () => new THREE.BoxGeometry(0.2, 1.9, 0.46).rotateZ(0.6)),
        lib.get("wood"),
        braces,
        { name: "walls.braces" },
      ),
    );
  if (ribs.length)
    out.push(
      instanced(
        geo("bld.rib", () => new THREE.BoxGeometry(0.12, 4.6, 0.5)),
        lib.get("decalDark"),
        ribs,
        {
          name: "walls.ribs",
        },
      ),
    );
  // Ceiling: plank slab with beams across the short axis and a ridge beam.
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(b.w, b.d),
    lib.get(industrial ? "wall" : "wallPlaster"),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(b.x + b.w / 2, H, b.z + b.d / 2);
  ceiling.receiveShadow = true;
  ceiling.name = "ceiling";
  out.push(ceiling);
  const beams: THREE.Matrix4[] = [];
  const alongX = b.w < b.d;
  const span = alongX ? b.w : b.d;
  const run = alongX ? b.d : b.w;
  const n = Math.max(2, Math.round(run / 3.5));
  for (let i = 0; i <= n; i++) {
    const u = (i / n) * run;
    const x = alongX ? b.x + b.w / 2 : b.x + u;
    const z = alongX ? b.z + u : b.z + b.d / 2;
    beams.push(matrixAt(x, H - 0.25, z, alongX ? 0 : Math.PI / 2, span / 4, 1, 1));
  }
  beams.push(
    matrixAt(b.x + b.w / 2, H - 0.42, b.z + b.d / 2, alongX ? Math.PI / 2 : 0, run / 4, 1.1, 1.1),
  );
  out.push(
    instanced(
      geo("bld.beam", () => new THREE.BoxGeometry(4, 0.4, 0.34)),
      lib.get(industrial ? "metal" : "wood"),
      beams,
      { name: "ceiling.beams", castShadow: true },
    ),
  );
  if (industrial) {
    // Ducts hanging below the beams.
    const ducts: THREE.Matrix4[] = [];
    for (let i = 1; i < n; i += 2) {
      const u = (i / n) * run;
      const x = alongX ? b.x + b.w / 2 : b.x + u;
      const z = alongX ? b.z + u : b.z + b.d / 2;
      ducts.push(matrixAt(x, H - 0.9, z, alongX ? 0 : Math.PI / 2, span / 4, 1, 1));
    }
    out.push(
      instanced(
        geo("bld.duct", () => new THREE.BoxGeometry(4, 0.5, 0.6)),
        lib.get("metal"),
        ducts,
        {
          name: "ceiling.ducts",
        },
      ),
    );
  }
  return out;
}

// ---- dungeon: stone block walls, trim, pillars, ceiling ---------------------------------

export function buildDungeonEnclosure(
  b: Bounds,
  lib: MaterialLibrary,
  seed: number,
): THREE.Object3D[] {
  const H = WALL_HEIGHT.dungeon ?? 6;
  const rand = mulberry32(seed ^ 0x2a2a);
  const blocks: THREE.Matrix4[] = [];
  const backing: THREE.Matrix4[] = [];
  const trim: THREE.Matrix4[] = [];
  const pillars: THREE.Matrix4[] = [];
  const rowH = 0.75;
  const rows = Math.ceil((H - 0.6) / rowH);
  const side = (
    len: number,
    place: (t: number) => [number, number],
    rot: number,
    nx: number,
    nz: number,
  ) => {
    // Backing panel hides the gaps between jittered blocks.
    const [mx, mz] = place(len / 2);
    backing.push(matrixAt(mx - nx * 0.25, H / 2, mz - nz * 0.25, rot, len / 4, H / 4.6, 1));
    trim.push(matrixAt(mx + nx * 0.05, H - 0.3, mz + nz * 0.05, rot, len / 4, 1, 1));
    trim.push(matrixAt(mx + nx * 0.05, 0.25, mz + nz * 0.05, rot, len / 4, 0.8, 1.2));
    for (let r = 0; r < rows; r++) {
      let t = r % 2 ? -0.6 : 0;
      while (t < len) {
        const bl = 1.1 + rand() * 1.1;
        const end = Math.min(len, t + bl);
        if (end - Math.max(t, 0) > 0.3) {
          const c = (Math.max(t, 0) + end) / 2;
          const [x, z] = place(c);
          const depth = 0.9 + rand() * 0.25;
          blocks.push(
            matrixAt(
              x + nx * (depth - 1) * 0.15,
              0.6 + r * rowH + rowH / 2,
              z + nz * (depth - 1) * 0.15,
              rot,
              (end - Math.max(t, 0)) / 1.0 - 0.06,
              rowH / 0.8 - 0.05,
              depth,
            ),
          );
        }
        t += bl;
      }
    }
    // Pillars every ~8 m, against the wall.
    const n = Math.max(1, Math.round(len / 8));
    for (let i = 0; i <= n; i++) {
      const [x, z] = place((i / n) * len);
      pillars.push(matrixAt(x + nx * 0.55, 0, z + nz * 0.55, rot));
    }
  };
  side(b.w, (t) => [b.x + t, b.z], 0, 0, 1);
  side(b.w, (t) => [b.x + t, b.z + b.d], 0, 0, -1);
  side(b.d, (t) => [b.x, b.z + t], Math.PI / 2, 1, 0);
  side(b.d, (t) => [b.x + b.w, b.z + t], Math.PI / 2, -1, 0);

  const out: THREE.Object3D[] = [];
  out.push(
    instanced(
      geo("dng.backing", () => new THREE.BoxGeometry(4, 4.6, 0.5)),
      lib.get("wall"),
      backing,
      {
        name: "walls.backing",
      },
    ),
    instanced(
      geo("dng.block", () => new THREE.BoxGeometry(1, 0.8, 0.5)),
      lib.get("stone"),
      blocks,
      {
        name: "walls.blocks",
      },
    ),
    instanced(
      geo("dng.trim", () => new THREE.BoxGeometry(4, 0.4, 0.7)),
      lib.get("stoneLight"),
      trim,
      {
        name: "walls.trim",
      },
    ),
    instanced(
      geo("dng.pillar", () => {
        const parts = [
          new THREE.BoxGeometry(1.1, 0.5, 1.1).translate(0, 0.25, 0),
          new THREE.CylinderGeometry(0.36, 0.42, H - 1.2, 8).translate(0, H / 2 - 0.1, 0),
          new THREE.BoxGeometry(1.0, 0.5, 1.0).translate(0, H - 0.45, 0),
          new THREE.BoxGeometry(1.2, 0.2, 1.2).translate(0, H - 0.1, 0),
        ];
        return merged(parts);
      }),
      lib.get("stoneLight"),
      pillars,
      { name: "walls.pillars", castShadow: true },
    ),
  );
  // Ceiling slab, ribs and stalactites.
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.d), lib.get("groundContact"));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(b.x + b.w / 2, H, b.z + b.d / 2);
  ceiling.name = "ceiling";
  out.push(ceiling);
  const ribs: THREE.Matrix4[] = [];
  const alongX = b.w < b.d;
  const span = alongX ? b.w : b.d;
  const run = alongX ? b.d : b.w;
  const n = Math.max(2, Math.round(run / 8));
  for (let i = 0; i <= n; i++) {
    const u = (i / n) * run;
    const x = alongX ? b.x + b.w / 2 : b.x + u;
    const z = alongX ? b.z + u : b.z + b.d / 2;
    ribs.push(matrixAt(x, H - 0.3, z, alongX ? 0 : Math.PI / 2, span / 4, 1, 1));
  }
  out.push(
    instanced(
      geo("dng.rib", () => new THREE.BoxGeometry(4, 0.6, 0.8)),
      lib.get("stone"),
      ribs,
      {
        name: "ceiling.ribs",
      },
    ),
  );
  const drips: THREE.Matrix4[] = [];
  const count = Math.round((b.w * b.d) / 25);
  for (let i = 0; i < count; i++) {
    const x = b.x + 1 + rand() * (b.w - 2);
    const z = b.z + 1 + rand() * (b.d - 2);
    drips.push(matrixAt(x, H, z, rand() * 6.28, 0.5 + rand() * 0.9));
  }
  out.push(
    instanced(
      geo("dng.stalactite", () =>
        new THREE.ConeGeometry(0.3, 1.6, 5).rotateX(Math.PI).translate(0, -0.8, 0),
      ),
      lib.get("stone"),
      drips,
      { name: "ceiling.stalactites" },
    ),
  );
  return out;
}
