import * as THREE from "three";
import type { Door, World } from "../../../src/world/types.ts";
import { getMaterialLibrary, type MaterialLibrary } from "../assets/MaterialLibrary.ts";
import { radialFalloff } from "../assets/ProceduralTextures.ts";
import { geo, makeContactDisc, makeGlowSprite, merged } from "../assets/WorldPropKit.ts";
import { truncate } from "../pure/dialogueText.ts";
import { areaLabel } from "./areas.ts";
import { makeLabelSprite } from "./labels.ts";

export interface DoorHandle {
  door: Door;
  group: THREE.Group;
  /** Outer portal ring (kept for callers that only know this field). */
  ring?: THREE.Mesh;
  /** All portal rings, outer to inner. */
  rings?: THREE.Mesh[];
  disc?: THREE.Mesh;
  /** Locked signal lamp; pulses. */
  signal?: THREE.Mesh;
  /** Glow card on the signal lamp; pulses with it. Emissive plus glow, never a real light. */
  glow?: THREE.Sprite;
}

function fallbackLib(accent: string): MaterialLibrary {
  return getMaterialLibrary({
    name: "door-fallback",
    ambient: 0.8,
    sun: 1,
    sky: "#9ec9ff",
    fog: { color: "#d0e4ff", density: 0.004 },
    palette: { ground: "#7a9a5a", wall: "#9a8a6a", accent, npc: "#cccccc" },
    enclosure: "open",
    props: [],
    npcForm: "villager",
    sound: "birds",
  });
}

const discMaterials = new Map<string, THREE.MeshBasicMaterial>();
function discMaterial(color: string): THREE.MeshBasicMaterial {
  let m = discMaterials.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      map: radialFalloff(),
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    m.userData.shared = true;
    discMaterials.set(color, m);
  }
  return m;
}

interface PortalParts {
  rings: THREE.Mesh[];
  disc: THREE.Mesh;
}

function buildPortal(group: THREE.Group, lib: MaterialLibrary, locked: boolean): PortalParts {
  const accent = locked ? "#ff3b3b" : lib.biome.palette.accent;
  const stone = lib.get(lib.kind === "dungeon" ? "stone" : "stoneLight");
  // Pedestal: two stepped discs and a rune ring.
  const base = new THREE.Mesh(
    geo("portal.base", () => new THREE.CylinderGeometry(1.9, 2.1, 0.22, 12)),
    stone,
  );
  base.position.y = 0.11;
  base.receiveShadow = true;
  const step = new THREE.Mesh(
    geo("portal.step", () => new THREE.CylinderGeometry(1.4, 1.6, 0.2, 12)),
    lib.get("stone"),
  );
  step.position.y = 0.32;
  step.receiveShadow = true;
  const stand = new THREE.Mesh(
    geo("portal.stand", () =>
      merged([
        new THREE.BoxGeometry(0.5, 0.6, 0.5).translate(0, 0.3, 0),
        new THREE.CylinderGeometry(0.18, 0.26, 0.5, 8).translate(0, 0.85, 0),
      ]),
    ),
    lib.get("metal"),
  );
  stand.position.y = 0.42;
  stand.castShadow = true;
  group.add(base, step, stand);
  const rings: THREE.Mesh[] = [];
  const outer = new THREE.Mesh(
    geo("portal.ring0", () => new THREE.TorusGeometry(1.45, 0.11, 8, 32)),
    lib.get("metal"),
  );
  const mid = new THREE.Mesh(
    geo("portal.ring1", () => new THREE.TorusGeometry(1.2, 0.055, 6, 28)),
    locked ? lib.get("hazard") : lib.get("emissiveSignal"),
  );
  const inner = new THREE.Mesh(
    geo("portal.ring2", () => new THREE.TorusGeometry(0.95, 0.045, 6, 24)),
    lib.get("trim"),
  );
  // Runes studded around the outer ring.
  const runes = new THREE.Mesh(
    geo("portal.runes", () => {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        parts.push(
          new THREE.OctahedronGeometry(0.12).translate(Math.cos(a) * 1.45, Math.sin(a) * 1.45, 0),
        );
      }
      return merged(parts);
    }),
    locked ? lib.get("hazard") : lib.get("emissiveSignal"),
  );
  outer.add(runes);
  for (const r of [outer, mid, inner]) {
    r.position.y = 2.0;
    group.add(r);
    rings.push(r);
  }
  const disc = new THREE.Mesh(
    geo("portal.disc", () => new THREE.CircleGeometry(1.0, 32)),
    discMaterial(accent),
  );
  disc.position.y = 2.0;
  disc.renderOrder = 2;
  group.add(disc);
  // A halo and a pool of light on the floor: the portal reads as a light source without
  // being one.
  const halo = makeGlowSprite(accent, 4);
  halo.material = portalHaloMaterial(halo.material);
  halo.position.set(0, 2.0, 0.3);
  group.add(halo);
  const pool = new THREE.Mesh(
    geo("portal.pool", () => new THREE.CircleGeometry(2.2, 24)),
    discMaterial(accent),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.44;
  pool.material = discMaterial(accent);
  pool.renderOrder = 1;
  group.add(pool);
  return { rings, disc };
}

function buildFrame(
  group: THREE.Group,
  lib: MaterialLibrary,
  locked: boolean,
): { signal?: THREE.Mesh; glow?: THREE.Sprite } {
  const dungeon = lib.kind === "dungeon";
  const industrial = lib.kind === "industrial";
  const frameMat = lib.get(dungeon ? "stoneLight" : industrial ? "metal" : "wood");
  const trimMat = lib.get(dungeon ? "stone" : industrial ? "decalDark" : "bark");
  const add = (m: THREE.Mesh) => {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  // Threshold step and a dark passage plane so the doorway reads as depth.
  const threshold = add(
    new THREE.Mesh(
      geo("door.step", () => new THREE.BoxGeometry(2.8, 0.14, 1.1)),
      lib.get("stone"),
    ),
  );
  threshold.position.y = 0.07;
  const passage = new THREE.Mesh(
    geo("door.passage", () => new THREE.PlaneGeometry(1.7, 2.6)),
    lib.get("groundContact"),
  );
  passage.position.set(0, 1.3, 0.12);
  passage.rotation.y = Math.PI;
  group.add(passage);
  const passageFront = passage.clone();
  passageFront.rotation.y = 0;
  passageFront.position.z = -0.12;
  group.add(passageFront);
  // Side posts with bases and capitals.
  for (const side of [-1, 1]) {
    const post = add(
      new THREE.Mesh(
        geo("door.post", () => new THREE.BoxGeometry(0.34, 2.9, 0.42)),
        frameMat,
      ),
    );
    post.position.set(side * 1.02, 1.45, 0);
    const foot = add(
      new THREE.Mesh(
        geo("door.foot", () => new THREE.BoxGeometry(0.5, 0.34, 0.56)),
        trimMat,
      ),
    );
    foot.position.set(side * 1.02, 0.31, 0);
    const bracket = add(
      new THREE.Mesh(
        geo("door.bracket", () => new THREE.BoxGeometry(0.4, 0.4, 0.3).rotateZ(Math.PI / 4)),
        trimMat,
      ),
    );
    bracket.position.set(side * 0.78, 2.72, 0);
    bracket.scale.set(0.6, 0.6, 1);
  }
  const lintel = add(
    new THREE.Mesh(
      geo("door.lintel", () => new THREE.BoxGeometry(2.9, 0.4, 0.5)),
      frameMat,
    ),
  );
  lintel.position.y = 3.05;
  const keystone = add(
    new THREE.Mesh(
      geo("door.keystone", () => new THREE.BoxGeometry(0.5, 0.52, 0.56)),
      trimMat,
    ),
  );
  keystone.position.y = 3.1;
  // Sign plate with a lit strip beneath; the label sprite sits on it.
  const plate = add(
    new THREE.Mesh(
      geo("door.plate", () => new THREE.BoxGeometry(1.9, 0.5, 0.12)),
      lib.get("decalDark"),
    ),
  );
  plate.position.set(0, 3.55, -0.1);
  const strip = new THREE.Mesh(
    geo("door.strip", () => new THREE.BoxGeometry(1.8, 0.06, 0.14)),
    locked ? lib.get("hazard") : lib.get("emissiveSignal"),
  );
  strip.position.set(0, 3.28, -0.12);
  group.add(strip);
  const stripBack = strip.clone();
  stripBack.position.z = 0.12;
  group.add(stripBack);
  if (!locked) return {};
  // Locked: hazard-striped crossbars and a red signal lamp.
  const bar = add(
    new THREE.Mesh(
      geo("door.bar", () => new THREE.BoxGeometry(2.3, 0.22, 0.14)),
      lib.get("hazardStripes"),
    ),
  );
  bar.position.y = 1.35;
  const bar2 = add(
    new THREE.Mesh(
      geo("door.bar2", () => new THREE.BoxGeometry(2.3, 0.14, 0.12).rotateZ(0.5)),
      lib.get("decalDark"),
    ),
  );
  bar2.position.y = 1.3;
  const brackets = add(
    new THREE.Mesh(
      geo("door.barBrackets", () =>
        merged([
          new THREE.BoxGeometry(0.2, 0.36, 0.26).translate(-1.02, 0, 0),
          new THREE.BoxGeometry(0.2, 0.36, 0.26).translate(1.02, 0, 0),
        ]),
      ),
      lib.get("metal"),
    ),
  );
  brackets.position.y = 1.35;
  const signal = new THREE.Mesh(
    geo("door.lamp", () => new THREE.SphereGeometry(0.16, 10, 8)),
    lockLampMaterial(),
  );
  signal.position.set(0, 3.95, 0);
  group.add(signal);
  const cage = add(
    new THREE.Mesh(
      geo("door.lampBase", () => new THREE.CylinderGeometry(0.1, 0.16, 0.18, 8)),
      lib.get("metal"),
    ),
  );
  cage.position.set(0, 3.8, 0);
  // The lamp must read as "blocked" from either side before the label is legible: a red
  // glow card on each face of the lintel and a faint red wash over the doorway.
  const glow = makeGlowSprite(LOCK_RED, 1.4);
  glow.material = lockGlowMaterial(glow.material, 0.9);
  glow.position.set(0, 4.05, 0.4);
  group.add(glow);
  const back = makeGlowSprite(LOCK_RED, 1.4);
  back.material = glow.material;
  back.position.set(0, 4.05, -0.4);
  group.add(back);
  glow.userData.pair = back;
  for (const z of [0.6, -0.6]) {
    const wash = makeGlowSprite(LOCK_RED, 3.4);
    wash.material = lockGlowMaterial(wash.material, 0.32);
    wash.position.set(0, 2.3, z);
    group.add(wash);
  }
  return { signal, glow };
}

// Signal red. The post stack tone maps every pixel (ACES), which pushes bright red toward the
// torches' orange, so the lamp stays at a moderate intensity where ACES keeps the hue.
const LOCK_RED = "#ff0814";
let lockLamp: THREE.MeshStandardMaterial | null = null;
function lockLampMaterial(): THREE.MeshStandardMaterial {
  if (!lockLamp) {
    lockLamp = new THREE.MeshStandardMaterial({
      color: LOCK_RED,
      emissive: LOCK_RED,
      emissiveIntensity: 0.9,
      roughness: 0.4,
    });
    lockLamp.userData.shared = true;
  }
  return lockLamp;
}
const lockGlows = new Map<number, THREE.SpriteMaterial>();
function lockGlowMaterial(base: THREE.SpriteMaterial, opacity: number): THREE.SpriteMaterial {
  let m = lockGlows.get(opacity);
  if (!m) {
    m = base.clone();
    m.opacity = opacity;
    m.userData.shared = true;
    lockGlows.set(opacity, m);
  }
  return m;
}

export function buildDoor(
  door: Door,
  world: World,
  accent: string,
  lib?: MaterialLibrary,
): DoorHandle {
  const library = lib ?? fallbackLib(accent);
  const group = new THREE.Group();
  group.name = `door-${door.id}`;
  group.position.set(door.position[0], door.position[1], door.position[2]);
  group.rotation.y = door.facing;
  const locked = Boolean(door.locked);
  const handle: DoorHandle = { door, group };
  if (door.kind === "portal") {
    const portal = buildPortal(group, library, locked);
    handle.rings = portal.rings;
    const outer = portal.rings[0];
    if (outer) handle.ring = outer;
    handle.disc = portal.disc;
  } else {
    group.add(makeContactDisc(1.6, 0.35));
    const extra = buildFrame(group, library, locked);
    if (extra.signal) handle.signal = extra.signal;
    if (extra.glow) handle.glow = extra.glow;
  }
  const lines = locked
    ? [`Locked by #${door.locked?.by}`, truncate(door.locked?.title ?? "", 30)]
    : [`${door.kind === "portal" ? "⟲" : "→"} ${areaLabel(world, door.to)}`];
  const label = makeLabelSprite(lines, { color: locked ? "#ff8080" : "#ffffff", height: 0.7 });
  label.position.y = door.kind === "portal" ? 3.9 : 4.3;
  group.add(label);
  return handle;
}

export function animateDoor(h: DoorHandle, t: number): void {
  if (h.rings) {
    const [outer, mid, inner] = h.rings;
    if (outer) outer.rotation.y = t * 0.35;
    if (mid) {
      mid.rotation.y = -t * 0.6;
      mid.rotation.x = Math.sin(t * 0.7) * 0.5;
    }
    if (inner) {
      inner.rotation.x = t * 0.9;
      inner.rotation.y = t * 0.5;
    }
  } else if (h.ring) h.ring.rotation.y = t * 0.8;
  if (h.disc) {
    const s = 1 + Math.sin(t * 2.2) * 0.06;
    h.disc.scale.set(s, s, 1);
    h.disc.rotation.z = -t * 0.25;
  }
  if (h.signal) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.5);
    h.signal.scale.setScalar(0.9 + pulse * 0.25);
    if (h.glow) {
      h.glow.scale.setScalar(1.0 + pulse * 0.8);
      (h.glow.userData.pair as THREE.Sprite | undefined)?.scale.setScalar(1.0 + pulse * 0.8);
    }
  }
}

const portalHalos = new Map<THREE.SpriteMaterial, THREE.SpriteMaterial>();
/** Portal halos are large; at full glow they wash the ring geometry out. */
function portalHaloMaterial(base: THREE.SpriteMaterial): THREE.SpriteMaterial {
  let m = portalHalos.get(base);
  if (!m) {
    m = base.clone();
    m.opacity = 0.45;
    m.userData.shared = true;
    portalHalos.set(base, m);
  }
  return m;
}
