import * as THREE from "three";
import type { Biome, LabelMeta, NpcForm, Placement } from "../../../src/world/types.ts";
import { getMaterialLibrary, type MaterialLibrary } from "../assets/MaterialLibrary.ts";
import { animateNpcBody, buildNpcBody, type NpcBody, setBadges } from "../assets/NpcFactory.ts";
import { geo, makeContactDisc } from "../assets/WorldPropKit.ts";
import { truncate } from "../pure/dialogueText.ts";
import { makeLabelSprite } from "./labels.ts";

export interface NpcHandle {
  placement: Placement;
  group: THREE.Group;
  body: THREE.Group;
  ring: THREE.Mesh;
  /** Contact disc; the crowd hides it and draws an instanced one when the NPC is far. */
  disc: THREE.Mesh;
  label: THREE.Sprite;
  baseY: number;
  phase: number;
  /** Named joints (head, body, armL, armR, legL, legR, earL, earR, tail, wisps, tool). */
  joints: Record<string, THREE.Object3D>;
  /** Badge whose material swaps to `reward` when reviewed. */
  signal: THREE.Mesh;
  form: NpcForm;
  lib: MaterialLibrary;
  /** The authored body; badges hang off it. */
  authored: NpcBody;
  /** Labels rendered as ghosts (pending or practice). */
  ghostLabels: string[];
  practice: boolean;
}

/** When a caller only has the palette colour (legacy signature), build a stand-in biome. */
function fallbackBiome(color: string, form: NpcForm): Biome {
  return {
    name: `npc-${form}`,
    ambient: 0.8,
    sun: 1,
    sky: "#9ec9ff",
    fog: { color: "#d0e4ff", density: 0.004 },
    palette: { ground: "#7a9a5a", wall: "#9a8a6a", accent: "#f2c94c", npc: color },
    enclosure: form === "shade" ? "dungeon" : "open",
    props: [],
    npcForm: form,
    sound: "birds",
  };
}

export function buildNpc(
  p: Placement,
  color: string,
  reviewed: boolean,
  lib?: MaterialLibrary,
  labelSet: readonly LabelMeta[] = [],
): NpcHandle {
  const library = lib ?? getMaterialLibrary(fallbackBiome(color, p.form));
  const group = new THREE.Group();
  group.name = `npc-${p.issue}`;
  group.position.set(p.position[0], p.position[1], p.position[2]);
  const authored: NpcBody = buildNpcBody(p.form, library, (p.issue % 17) / 17);
  const body = authored.root;
  body.name = "body";
  body.scale.setScalar(p.scale);
  group.add(body);
  // Grounding: a soft contact disc plus the reviewed ring.
  const disc = makeContactDisc(0.75 * p.scale, authored.floats ? 0.4 : 0.6);
  group.add(disc);
  const ring = new THREE.Mesh(
    geo("npc.ring", () => new THREE.RingGeometry(0.72, 0.9, 32)),
    library.get("reward"),
  );
  ring.scale.setScalar(p.scale);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.visible = reviewed;
  ring.name = "reviewedRing";
  group.add(ring);
  if (reviewed) authored.signal.material = library.get("reward");
  const label = makeLabelSprite([`#${p.issue}`, truncate(p.title, 28)], { height: 0.9 });
  label.position.y = authored.labelHeight * p.scale + 0.45;
  group.add(label);
  setBadges(authored, p.labels, labelSet);
  return {
    placement: p,
    group,
    body,
    ring,
    disc,
    label,
    baseY: p.position[1],
    phase: (p.issue % 17) / 17,
    joints: authored.joints,
    signal: authored.signal,
    form: p.form,
    lib: library,
    authored,
    ghostLabels: [],
    practice: false,
  };
}

/** Re-dress the NPC from its placement labels plus any ghosts. */
export function refreshBadges(h: NpcHandle, labelSet: readonly LabelMeta[]): void {
  const solid = h.placement.labels.filter((l) => !h.ghostLabels.includes(l));
  setBadges(h.authored, solid, labelSet, h.ghostLabels);
}

export function animateNpc(h: NpcHandle, t: number, reducedMotion: boolean): void {
  if (reducedMotion || h.practice) return;
  animateNpcBody(h.authored, h.form, t, h.phase);
  if (h.ring.visible) h.ring.rotation.z = t * 0.4;
}

export function setReviewedRing(h: NpcHandle, on: boolean): void {
  h.ring.visible = on;
  h.signal.material = h.lib.get(on ? "reward" : "decalDark");
}
