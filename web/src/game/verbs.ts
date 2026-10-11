// The physical verbs: give and take badges, say it, release, send through the hourglass,
// rewind. Every GitHub verb goes propose → hold ring → confirm; the NPC changes within
// 100 ms of the ring completing (as a ghost), and turns solid only when the server says
// `applied: true`. Offline or dry run, ghosts stay ghosts and the HUD says "practice".
import * as THREE from "three";
import type { Door, LabelMeta, Placement, Vec3, World } from "../../../src/world/types.ts";
import { makeGlowSprite } from "../assets/WorldPropKit.ts";
import {
  type Action,
  type ActionResult,
  describeAction,
  REWIND_MS,
  rewindRemaining,
} from "../pure/actions.ts";
import { HoldTracker } from "../pure/hold.ts";
import { labelColor } from "../pure/satchel.ts";
import { easeInQuad, easeOutCubic, pulse, TweenManager } from "../pure/tween.ts";
import type { Api, Proposal } from "./api.ts";
import type { Hud } from "./hud.ts";
import { makeLabelSprite } from "./labels.ts";
import { type NpcHandle, refreshBadges } from "./npc.ts";
import type { Satchel } from "./satchel.ts";
import { playSfx } from "./sfx.ts";

export interface VerbsHost {
  world(): World;
  npc(issue: number): NpcHandle | undefined;
  nearest(): Placement | null;
  reducedMotion(): boolean;
  /** Detach the NPC from the scene (release / hourglass) but keep its handle for rewind. */
  removeNpc(issue: number): void;
  /** Put a removed NPC back at the same spot. */
  restoreNpc(issue: number): void;
  /** Counters tick and doors locked by this issue open. Returns the doors it unlocked. */
  released(issue: number): Door[];
  /** Rewind of a close: counters and locks go back. */
  unreleased(issue: number, doors: Door[]): void;
  /** Where the hourglass walk ends: the region's portal to the hub, else its entrance. */
  regionExit(issue: number): Vec3 | null;
  /** A modal verb (take radial) needs the pointer and blocks walking. */
  modal(on: boolean): void;
  /** Dialogue: a comment went out (or was rehearsed). */
  commentPosted(issue: number, text: string, state: "posted" | "practice"): void;
}

interface HeldAction {
  action: Action;
  key: string;
  proposal: Promise<Proposal>;
}

interface RewindToken {
  undoId: string;
  what: string;
  createdAt: number;
  reverse: () => void;
}

interface TakeRadial {
  issue: number;
  labels: string[];
  selected: number;
}

const GHOST_MATERIALS = new Map<string, THREE.Material>();

function ghostOf(m: THREE.Material): THREE.Material {
  let g = GHOST_MATERIALS.get(m.uuid);
  if (!g) {
    const color = (m as THREE.MeshStandardMaterial).color ?? new THREE.Color("#ffffff");
    g = new THREE.MeshBasicMaterial({
      color,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    g.userData.shared = true;
    GHOST_MATERIALS.set(m.uuid, g);
  }
  return g;
}

export class Verbs {
  private hold = new HoldTracker();
  private held: HeldAction | null = null;
  private rewind: RewindToken | null = null;
  private radial: TakeRadial | null = null;
  private fx = new TweenManager();
  /** Per-NPC undo of the practice "sit": original materials and scale. */
  private sat = new Map<number, () => void>();
  /** NPCs mid bow-out: their character plays its leave clip, not idle or talk. */
  private bowing = new Set<number>();
  /** Doors unlocked by a release, for rewind. */
  private unlocked = new Map<number, Door[]>();
  private seq = 0;

  constructor(
    private host: VerbsHost,
    private api: Api,
    private satchel: Satchel,
    private hud: Hud,
  ) {}

  get radialOpen(): boolean {
    return this.radial !== null;
  }

  get holding(): boolean {
    return this.held !== null;
  }

  private get labelSet(): LabelMeta[] {
    return this.host.world().labelSet ?? [];
  }

  // ---- input ---------------------------------------------------------------------------

  /** Returns true when the key was consumed. */
  keyDown(e: KeyboardEvent, overlayOpen: boolean): boolean {
    const now = performance.now();
    if (this.radial) {
      if (e.code === "Escape") {
        this.closeRadial();
        return true;
      }
      if (e.code === "ArrowLeft" || e.code === "ArrowRight" || e.code === "Tab") {
        e.preventDefault();
        const n = this.radial.labels.length;
        const d = e.code === "ArrowLeft" || (e.code === "Tab" && e.shiftKey) ? -1 : 1;
        this.radial.selected = (this.radial.selected + d + n) % n;
        this.hud.selectRadial(this.radial.selected);
        return true;
      }
      if (e.code === "KeyT" || e.code === "Enter") {
        const label = this.radial.labels[this.radial.selected];
        if (label && !e.repeat)
          this.begin(
            { type: "label-remove", issue: this.radial.issue, payload: { label } },
            e.code,
            now,
          );
        return true;
      }
      return true;
    }
    if (overlayOpen) return false;
    if (e.code === "KeyG") {
      const near = this.host.nearest();
      const token = this.satchel.selectedMeta;
      if (!near) {
        if (!e.repeat)
          this.hud.showToast(token ? "walk up to an issue to give it" : "nothing in hand");
        return true;
      }
      if (!token) {
        if (!e.repeat) this.hud.showToast("open the satchel (I) and pick a token first");
        return true;
      }
      if (near.labels.includes(token.name)) {
        if (!e.repeat) this.hud.showToast(`#${near.issue} already wears ${token.name}`);
        return true;
      }
      this.begin(
        { type: "label-add", issue: near.issue, payload: { label: token.name } },
        e.code,
        now,
        e.repeat,
      );
      return true;
    }
    if (e.code === "KeyT") {
      const near = this.host.nearest();
      if (!near) {
        if (!e.repeat) this.hud.showToast("look at an issue to see its badges");
        return true;
      }
      if (!e.repeat) this.openRadial(near.issue);
      return true;
    }
    if (e.code === "KeyR") {
      if (!this.rewind) {
        if (!e.repeat) this.hud.showToast("nothing to rewind");
        return true;
      }
      if (!e.repeat) this.beginRewind(e.code, now);
      return true;
    }
    return false;
  }

  keyUp(e: KeyboardEvent): void {
    this.end(e.code);
  }

  /** Mouse: with a token in hand and an issue in range, press-and-hold gives it. */
  pointerDown(): boolean {
    const near = this.host.nearest();
    const token = this.satchel.selectedMeta;
    if (!near || !token || near.labels.includes(token.name)) return false;
    this.begin(
      { type: "label-add", issue: near.issue, payload: { label: token.name } },
      "pointer",
      performance.now(),
    );
    return true;
  }

  pointerUp(): void {
    this.end("pointer");
  }

  // ---- hold ring -----------------------------------------------------------------------

  /** Start the ring for an action. The proposal is fetched alongside; nothing changes yet. */
  begin(
    action: Action,
    key: string,
    now = performance.now(),
    repeat = false,
    grantId?: string,
  ): boolean {
    const label = describeAction(action);
    if (!this.hold.press(label, key, now, { reduced: this.host.reducedMotion(), repeat }))
      return false;
    const proposal = this.api.propose(action, grantId).then((p) => {
      // The server may word it differently; the ring shows its description.
      if (this.held?.proposal === proposal && this.hold.current)
        this.hold.current.label = p.description;
      return p;
    });
    // A refused proposal surfaces in commit(); a cancelled hold just drops it.
    proposal.catch(() => {});
    this.held = { action, key, proposal };
    this.hud.setHold(0, label);
    playSfx("tick");
    return true;
  }

  /** Release the input that held the ring. Early release drops the proposal. */
  end(key?: string): void {
    if (!this.held) return;
    if (key !== undefined && this.held.key !== key) return;
    if (this.hold.release(key)) {
      this.held = null;
      this.hud.setHold(null);
    }
  }

  /** Debug and chips: release whatever is held. */
  cancel(): void {
    this.end();
  }

  private beginRewind(key: string, now: number): void {
    const token = this.rewind;
    if (!token) return;
    if (!this.hold.press(`Rewind: ${token.what}`, key, now, { reduced: this.host.reducedMotion() }))
      return;
    this.held = {
      action: { type: "comment", issue: 0, payload: {} },
      key,
      proposal: Promise.resolve({
        proposalId: `rewind:${token.undoId}`,
        mode: this.api.mode,
        description: `Rewind: ${token.what}`,
        expiresAt: "",
        action: { type: "comment", issue: 0, payload: {} },
      }),
    };
    this.hud.setHold(0, `Rewind: ${token.what}`);
  }

  // ---- per frame -----------------------------------------------------------------------

  frame(dt: number, now = performance.now()): void {
    this.fx.update(dt);
    const current = this.hold.current;
    if (current) this.hud.setHold(this.hold.progress(now), current.label);
    const done = this.hold.poll(now);
    if (done && this.held) {
      const entry = this.held;
      this.held = null;
      this.hud.setHold(1, done.label, true);
      window.setTimeout(() => {
        if (!this.hold.current) this.hud.setHold(null);
      }, 220);
      if (done.label.startsWith("Rewind: ")) void this.doRewind();
      else void this.commit(entry);
    }
    if (this.rewind) {
      const left = rewindRemaining(this.rewind.createdAt, now);
      if (left <= 0) {
        this.rewind = null;
        this.hud.setRewind(null);
      } else this.hud.setRewind(left, this.rewind.what);
    }
    const token = this.satchel.selectedMeta;
    if (token)
      this.hud.setToken(
        { name: token.name, color: labelColor(this.labelSet, token.name) },
        this.host.nearest() !== null,
      );
  }

  // ---- commit ----------------------------------------------------------------------------

  private async commit(entry: HeldAction): Promise<void> {
    const a = entry.action;
    const h = this.host.npc(a.issue);
    const practiceLikely = !this.api.simulateLive && (this.api.offline || this.api.mode !== "live");
    // 1. Visible state now, as a ghost.
    const revert = this.ghostApply(a, h, practiceLikely);
    playSfx(a.type === "close" ? "release" : "snap");
    if (this.radial) this.closeRadial();
    // 2. Confirm the proposal.
    let res: ActionResult;
    try {
      res = await this.api.confirm(await entry.proposal);
    } catch (err) {
      res = { ok: false, mode: "dry-run", undoId: "", applied: false, message: String(err) };
    }
    if (!res.ok) {
      revert();
      this.hud.showToast(`${describeAction(a)} failed: ${res.message || "server error"}`);
      return;
    }
    const what = describeAction(a);
    if (res.applied) {
      const reverse = this.solidify(a, h);
      this.hud.onAction(what, false);
      if (res.undoId) this.grantRewind(res.undoId, what, reverse);
    } else {
      // Dry run: ghosts stay. A close that was animated for live gets the practice seat.
      if (!practiceLikely) {
        revert();
        this.ghostApply(a, h, true);
      }
      this.hud.onAction(`${what} (nothing written)`, true);
    }
    if (a.type === "comment")
      this.host.commentPosted(a.issue, a.payload.text ?? "", res.applied ? "posted" : "practice");
    if (a.type === "label-add" && a.payload.label) this.satchel.applied.add(a.payload.label);
  }

  /** Immediate ghost state; returns an undo for the failure path. */
  private ghostApply(a: Action, h: NpcHandle | undefined, practice: boolean): () => void {
    switch (a.type) {
      case "label-add":
      case "label-remove": {
        const label = a.payload.label;
        if (!h || !label) return () => {};
        h.ghostLabels.push(label);
        refreshBadges(h, this.labelSet);
        return () => {
          h.ghostLabels = h.ghostLabels.filter((l) => l !== label);
          refreshBadges(h, this.labelSet);
        };
      }
      case "close": {
        if (!h) return () => {};
        if (practice) return this.sitDown(h);
        if (a.payload.reason === "not_planned") return this.hourglass(h);
        return this.bowOut(h);
      }
      default:
        return () => {};
    }
  }

  /** Server applied it: ghosts become solid. Returns the rewind reversal. */
  private solidify(a: Action, h: NpcHandle | undefined): () => void {
    const label = a.payload.label;
    const set = this.labelSet;
    const bump = (name: string, d: number) => {
      const m = set.find((l) => l.name === name);
      if (m) m.count = Math.max(0, m.count + d);
    };
    switch (a.type) {
      case "label-add": {
        if (!h || !label) return () => {};
        h.ghostLabels = h.ghostLabels.filter((l) => l !== label);
        if (!h.placement.labels.includes(label)) h.placement.labels.push(label);
        bump(label, 1);
        refreshBadges(h, set);
        return () => {
          h.placement.labels = h.placement.labels.filter((l) => l !== label);
          bump(label, -1);
          refreshBadges(h, set);
        };
      }
      case "label-remove": {
        if (!h || !label) return () => {};
        h.ghostLabels = h.ghostLabels.filter((l) => l !== label);
        h.placement.labels = h.placement.labels.filter((l) => l !== label);
        bump(label, -1);
        refreshBadges(h, set);
        return () => {
          if (!h.placement.labels.includes(label)) h.placement.labels.push(label);
          bump(label, 1);
          refreshBadges(h, set);
        };
      }
      case "close": {
        const issue = a.issue;
        const doors = this.host.released(issue);
        this.unlocked.set(issue, doors);
        return () => {
          this.host.restoreNpc(issue);
          const npc = this.host.npc(issue);
          if (npc) this.standUp(npc);
          this.host.unreleased(issue, this.unlocked.get(issue) ?? []);
          this.unlocked.delete(issue);
        };
      }
      default:
        return () => {};
    }
  }

  // ---- rewind ----------------------------------------------------------------------------

  private grantRewind(undoId: string, what: string, reverse: () => void): void {
    this.rewind = { undoId, what, createdAt: performance.now(), reverse };
    this.hud.setRewind(1, what);
    this.hud.showToast(`rewind available for ${REWIND_MS / 1000} s: hold R`);
  }

  private async doRewind(): Promise<void> {
    const token = this.rewind;
    if (!token) return;
    this.rewind = null;
    this.hud.setRewind(null);
    const r = await this.api.undo(token.undoId);
    if (!r.ok) {
      this.hud.showToast(`rewind failed: ${r.message}`);
      return;
    }
    token.reverse();
    playSfx("rewind");
    this.hud.announce(token.what, "unlock", "Rewound");
  }

  // ---- take radial -----------------------------------------------------------------------

  openRadial(issue: number): void {
    const h = this.host.npc(issue);
    if (!h) return;
    const labels = h.placement.labels.filter((l) => !h.ghostLabels.includes(l));
    if (labels.length === 0) {
      this.hud.showToast(`#${issue} wears no badges`);
      return;
    }
    this.radial = { issue, labels, selected: 0 };
    this.host.modal(true);
    this.hud.showRadial(
      labels.map((label) => ({ label, color: labelColor(this.labelSet, label), ghost: false })),
      0,
      (i) => {
        if (!this.radial) return;
        this.radial.selected = i;
        this.hud.selectRadial(i);
      },
    );
  }

  closeRadial(): void {
    if (!this.radial) return;
    this.radial = null;
    this.hud.hideRadial();
    this.end("KeyT");
    this.end("Enter");
    this.host.modal(false);
  }

  // ---- animations ------------------------------------------------------------------------

  /** Live release: the NPC shrinks with a light pulse and leaves. */
  /** Is this NPC playing its live release (bow-out)? */
  leaving(issue: number): boolean {
    return this.bowing.has(issue);
  }

  private bowOut(h: NpcHandle): () => void {
    this.bowing.add(h.placement.issue);
    h.authored.character?.play("leave", 0.15);
    // A glow card, not a light: adding a light would recompile every material mid-animation.
    const glow = makeGlowSprite("#ffe9a8", 0.01);
    glow.material = glow.material.clone();
    glow.material.userData.shared = false;
    glow.position.y = 1.2;
    h.group.add(glow);
    const base = h.group.scale.clone();
    const flash = pulse(0.25);
    const dur = this.host.reducedMotion() ? 0.25 : 0.7;
    const tween = this.fx.tween(
      dur,
      (t) => {
        const s = 1 - easeInQuad(t) * 0.98;
        h.group.scale.set(base.x * s, base.y * s, base.z * s);
        glow.scale.setScalar(0.01 + flash(t) * 4);
      },
      (t) => t,
      () => {
        glow.removeFromParent();
        glow.material.dispose();
        this.bowing.delete(h.placement.issue);
        this.host.removeNpc(h.placement.issue);
        h.group.scale.copy(base);
      },
    );
    return () => {
      tween.cancel();
      glow.removeFromParent();
      glow.material.dispose();
      this.bowing.delete(h.placement.issue);
      h.group.scale.copy(base);
      this.host.restoreNpc(h.placement.issue);
    };
  }

  /** Not planned: walk to the hub portal and fade out through it. */
  private hourglass(h: NpcHandle): () => void {
    const exit = this.host.regionExit(h.placement.issue) ?? h.placement.position;
    const start = h.group.position.clone();
    const end = new THREE.Vector3(exit[0], start.y, exit[2]);
    const dir = end.clone().sub(start);
    const dist = Math.max(0.01, dir.length());
    const yaw0 = h.group.rotation.y;
    const yaw1 = Math.atan2(-dir.x, -dir.z) + Math.PI;
    const base = h.group.scale.clone();
    const reduced = this.host.reducedMotion();
    const dur = reduced ? 0.4 : Math.min(3.2, 0.8 + dist / 4);
    const tween = this.fx.tween(
      dur,
      (t) => {
        h.group.position.lerpVectors(start, end, t);
        h.group.rotation.y = yaw0 + (yaw1 - yaw0) * Math.min(1, t * 4);
        if (!reduced) h.body.position.y = Math.abs(Math.sin(t * dur * 6)) * 0.06;
        const fade = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
        h.group.scale.set(base.x * fade, base.y * fade, base.z * fade);
      },
      (t) => t,
      () => {
        this.host.removeNpc(h.placement.issue);
        h.group.position.copy(start);
        h.group.rotation.y = yaw0;
        h.group.scale.copy(base);
        h.body.position.y = 0;
      },
    );
    return () => {
      tween.cancel();
      h.group.position.copy(start);
      h.group.rotation.y = yaw0;
      h.group.scale.copy(base);
      h.body.position.y = 0;
      this.host.restoreNpc(h.placement.issue);
    };
  }

  /** Practice close: the NPC turns ghost and sits down under a practice seal. */
  private sitDown(h: NpcHandle): () => void {
    if (this.sat.has(h.placement.issue)) return () => {};
    const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    h.body.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        originals.set(o, o.material);
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (m) o.material = ghostOf(m);
      }
    });
    const scale = h.body.scale.clone();
    const labelY = h.label.position.y;
    const seal = makeLabelSprite(["PRACTICE · released"], {
      color: "#ffd166",
      background: "rgba(20,24,32,0.85)",
      height: 0.42,
    });
    seal.name = "practiceSeal";
    seal.position.y = scale.y * 1.1 + 0.2;
    h.group.add(seal);
    h.practice = true;
    const dur = this.host.reducedMotion() ? 0.15 : 0.45;
    const t0 = scale.y;
    const tween = this.fx.tween(
      dur,
      (t) => {
        h.body.scale.y = t0 * (1 - 0.42 * t);
        h.label.position.y = labelY - t * 0.6;
      },
      easeOutCubic,
    );
    const undo = () => {
      tween.cancel();
      for (const [mesh, mat] of originals) {
        mesh.material = mat;
      }
      h.body.scale.copy(scale);
      h.label.position.y = labelY;
      seal.removeFromParent();
      h.practice = false;
      this.sat.delete(h.placement.issue);
    };
    this.sat.set(h.placement.issue, undo);
    return undo;
  }

  private standUp(h: NpcHandle): void {
    this.sat.get(h.placement.issue)?.();
  }

  /** Debug: force a rewind token without a server (used by the playtester). */
  debugGrantRewind(what = "debug"): void {
    this.seq += 1;
    this.grantRewind(`debug-${this.seq}`, what, () => this.hud.showToast("debug rewind"));
  }
}
