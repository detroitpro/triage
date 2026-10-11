import * as THREE from "three";
import type { Door, Placement, Region, Vec3, World } from "../../../src/world/types.ts";
import { loadWorld } from "../load.ts";
import type { Action } from "../pure/actions.ts";
import { distanceXZ } from "../pure/collision.ts";
import { findTriggeredDoor, rearmDoors } from "../pure/doors.ts";
import { isReviewed, setReviewed } from "../pure/progress.ts";
import { lensUrl } from "../pure/worldUrl.ts";
import { Api } from "./api.ts";
import { type BuiltArea, buildArea, disposeArea } from "./areaBuilder.ts";
import { type Area, areaLabel, findArea, findPlacement, HUB_ID, hubArea } from "./areas.ts";
import { Dialogue, EDGE_COLORS } from "./dialogue.ts";
import { animateDoor, buildDoor, type DoorHandle } from "./doors.ts";
import { Hud } from "./hud.ts";
import { makeLabelSprite } from "./labels.ts";
import { escapeHtml, MapScreen } from "./mapScreen.ts";
import { animateNpc, type NpcHandle, setReviewedRing } from "./npc.ts";
import { Player } from "./player.ts";
import { Satchel } from "./satchel.ts";
import { loadSettings, mountSettings, type Settings } from "./settings.ts";
import { Verbs } from "./verbs.ts";

const TALK_DISTANCE = 2.5;

export interface TriageDebug {
  teleport(regionId: string): void;
  lookAt(issueNumber: number): void;
  setYawPitch(yaw: number, pitch: number): void;
  openMap(): void;
  closeMap(): void;
  talk(issueNumber: number): void;
  /** Verbs: drive the satchel and hold ring without a keyboard. */
  openSatchel(): void;
  closeSatchel(): void;
  selectToken(name: string | null): void;
  /** Stand by the issue and start the give hold with the token in hand (held until releaseHold). */
  give(issueNumber: number): boolean;
  /** Open the take radial for the issue. */
  take(issueNumber: number): void;
  /** Start the hold ring for any action; completes on its own after 700 ms. */
  startHold(action: Action): boolean;
  releaseHold(): void;
  /** Pretend the server applies everything, to exercise the rewind path offline. */
  simulateLive(on: boolean): void;
  api: Api;
  world: World;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private player: Player;
  private hud = new Hud();
  private map: MapScreen;
  private dialogue: Dialogue;
  private satchel: Satchel;
  private verbs: Verbs;
  private api: Api;
  private settings: Settings;
  private built: BuiltArea | null = null;
  private armedDoors = new Set<string>();
  private edgeLines = new THREE.Group();
  private clock = new THREE.Clock();
  private nearest: Placement | null = null;
  private lastTalked: number | null = null;
  private completedPrompted = new Set<string>();
  /** NPCs taken out of the scene by a release, kept for rewind. */
  private departed = new Map<number, NpcHandle>();
  private overlays = {
    help: el("help"),
    settings: el("settings"),
    done: el("region-done"),
    fade: el("fade"),
  };

  constructor(
    public world: World,
    canvas: HTMLCanvasElement,
  ) {
    this.settings = loadSettings();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.player = new Player(canvas, this.settings);
    this.scene.add(this.edgeLines);
    this.api = new Api(undefined, () => {
      this.hud.setMode("dry-run", true);
      this.hud.announce(
        "server unreachable: offline practice, nothing is written",
        "event",
        "Offline",
      );
    });
    this.map = new MapScreen(
      {
        teleport: (id) => this.travel(id),
        switchLens: (lens) => void this.switchLens(lens),
        reviewedIn: (id) => this.counts(id).reviewed,
      },
      () => this.onOverlayClosed(),
    );
    this.satchel = new Satchel({
      onSelect: (meta) => {
        if (!meta) this.hud.setToken(null);
        else this.hud.showToast(`${meta.name} in hand: walk up to an issue and hold G`);
      },
      onClose: () => this.onOverlayClosed(),
    });
    this.verbs = new Verbs(
      {
        world: () => this.world,
        npc: (issue) => this.built?.npcs.get(issue) ?? this.departed.get(issue),
        nearest: () => this.nearest,
        reducedMotion: () => this.settings.reducedMotion,
        removeNpc: (issue) => this.removeNpc(issue),
        restoreNpc: (issue) => this.restoreNpc(issue),
        released: (issue) => this.released(issue),
        unreleased: (issue, doors) => this.unreleased(issue, doors),
        regionExit: (issue) => this.regionExit(issue),
        modal: (on) => {
          if (on) {
            this.player.inputBlocked = true;
            this.player.unlock();
          } else this.onOverlayClosed();
        },
        commentPosted: (issue, text, state) => this.dialogue.markPosted(issue, text, state),
      },
      this.api,
      this.satchel,
      this.hud,
    );
    this.dialogue = new Dialogue({
      isReviewed: (issue) => isReviewed(localStorage, this.world.repo, issue),
      setReviewed: (issue, on) => this.markReviewed(issue, on),
      showEdges: (issue) => this.showEdges(issue),
      onClose: () => this.onOverlayClosed(),
      ask: (issue, q) => this.api.dialogue(issue, q),
      beginHold: (action, key, grantId) =>
        this.verbs.begin(action, key, performance.now(), false, grantId),
      endHold: (key) => this.verbs.end(key),
      labelSet: () => this.world.labelSet ?? [],
      repo: () => this.world.repo,
      offline: () => this.api.offline,
    });
    mountSettings(this.overlays.settings, this.settings, () => this.player.applySettings());
    el("gear").addEventListener("click", () => this.toggle("settings"));
    this.overlays.settings.addEventListener("click", (e) => {
      if (e.target === this.overlays.settings) this.toggle("settings");
    });
    window.addEventListener("resize", () => this.resize());
    document.addEventListener("keydown", (e) => this.onKey(e));
    document.addEventListener("keyup", (e) => this.verbs.keyUp(e));
    window.addEventListener("blur", () => this.verbs.cancel());
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 0 && this.player.locked && !this.anyOverlay()) this.verbs.pointerDown();
    });
    document.addEventListener("mouseup", () => this.verbs.pointerUp());
    this.resize();
    this.installDebug();
  }

  start(regionId: string | null): void {
    if (regionId && findArea(this.world, regionId)) this.travel(regionId, false);
    else this.travel(HUB_ID, false);
    this.renderer.setAnimationLoop(() => this.frame());
    void this.api.status().then(() => this.hud.setMode(this.api.mode, this.api.offline));
  }

  // ---- travel -----------------------------------------------------------------

  travel(areaId: string, fade = true, at?: { pos: Vec3; yaw?: number }): void {
    const area = findArea(this.world, areaId);
    if (!area) {
      this.hud.showToast(`unknown region ${areaId}`);
      return;
    }
    const go = () => {
      if (this.built) disposeArea(this.built);
      this.departed.clear();
      this.built = buildArea(area, this.world, (i) => isReviewed(localStorage, this.world.repo, i));
      // Released issues stay gone until the world is rebuilt by the pipeline.
      for (const p of area.placements) if (this.isReleased(p.issue)) this.removeNpc(p.issue);
      this.scene.add(this.built.group);
      this.applyAtmosphere(area);
      this.player.bounds = area.bounds;
      const spawn = at?.pos ?? area.entrance;
      const yaw = at?.yaw ?? this.yawTowardCenter(area, spawn);
      this.player.teleport(spawn, yaw);
      this.armedDoors = new Set();
      this.edgeLines.clear();
      this.hud.setArea(area, this.world);
      this.refreshCounts();
    };
    if (fade) {
      this.overlays.fade.classList.add("on");
      window.setTimeout(() => {
        go();
        this.overlays.fade.classList.remove("on");
      }, 260);
    } else go();
  }

  private yawTowardCenter(area: Area, from: Vec3): number {
    const cx = area.bounds.x + area.bounds.w / 2;
    const cz = area.bounds.z + area.bounds.d / 2;
    return Math.atan2(-(cx - from[0]), -(cz - from[2]));
  }

  private applyAtmosphere(area: Area): void {
    const b = area.biome;
    this.scene.background = new THREE.Color(b.sky);
    this.scene.fog = new THREE.FogExp2(b.fog.color, b.fog.density);
  }

  // ---- loop -------------------------------------------------------------------

  private frame(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    this.player.update(dt);
    const built = this.built;
    if (!built) return;
    for (const n of built.npcs.values()) animateNpc(n, t, this.settings.reducedMotion);
    for (const d of built.doors) animateDoor(d, t);
    const pos = this.player.pos;
    // Doors.
    const doors = built.area.doors;
    this.armedDoors = rearmDoors(pos, doors, this.armedDoors);
    const hit = findTriggeredDoor(pos, doors, this.armedDoors);
    if (hit && !this.anyOverlay()) {
      this.travel(hit.to, true, { pos: findArea(this.world, hit.to)?.entrance ?? [0, 0, 0] });
      return;
    }
    // Nearest NPC.
    let nearest: Placement | null = null;
    let best = TALK_DISTANCE;
    for (const n of built.npcs.values()) {
      const d = distanceXZ(pos, n.placement.position);
      if (d < best) {
        best = d;
        nearest = n.placement;
      }
    }
    if (nearest !== this.nearest) {
      this.nearest = nearest;
      this.hud.setPrompt(nearest);
    }
    this.verbs.frame(dt);
    this.hud.drawMinimap({
      bounds: built.area.bounds,
      npcs: [...built.npcs.values()].map((n) => ({
        placement: n.placement,
        reviewed: isReviewed(localStorage, this.world.repo, n.placement.issue),
      })),
      doors,
      player: pos,
      yaw: this.player.yaw,
      fill: built.area.biome.sky,
    });
    this.renderer.render(this.scene, this.player.camera);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.player.camera.aspect = w / h;
    this.player.camera.updateProjectionMatrix();
  }

  // ---- input and overlays ------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    if (this.verbs.radialOpen) {
      this.verbs.keyDown(e, true);
      return;
    }
    if (e.code === "Tab") {
      e.preventDefault();
      if (this.map.open) this.map.hide();
      else if (!this.dialogue.open && !this.satchel.open) this.openMap();
      return;
    }
    if (e.code === "Escape") {
      if (this.map.open) this.map.hide();
      else if (this.satchel.open) this.satchel.hide();
      else if (this.dialogue.open) this.dialogue.hide();
      else if (!this.overlays.settings.classList.contains("hidden")) this.toggle("settings");
      else if (!this.overlays.done.classList.contains("hidden")) this.hideDone();
      return;
    }
    if (e.code === "KeyI" && !this.dialogue.open && !this.map.open) {
      if (this.satchel.open) this.satchel.hide();
      else if (!this.anyOverlay()) this.openSatchel();
      return;
    }
    if (this.dialogue.open || this.satchel.open) return;
    if (this.verbs.keyDown(e, this.anyOverlay())) return;
    if (e.code === "KeyH") this.toggle("help");
    else if (e.code === "KeyP") this.toggle("settings");
    else if (e.code === "KeyE" && this.nearest && !this.anyOverlay()) this.talk(this.nearest.issue);
  }

  private toggle(name: "help" | "settings"): void {
    const o = this.overlays[name];
    const show = o.classList.contains("hidden");
    o.classList.toggle("hidden", !show);
    if (show) {
      this.player.inputBlocked = true;
      this.player.unlock();
    } else this.onOverlayClosed();
  }

  private anyOverlay(): boolean {
    return (
      this.map.open ||
      this.dialogue.open ||
      this.satchel.open ||
      this.verbs.radialOpen ||
      !this.overlays.help.classList.contains("hidden") ||
      !this.overlays.settings.classList.contains("hidden") ||
      !this.overlays.done.classList.contains("hidden")
    );
  }

  private onOverlayClosed(): void {
    if (this.anyOverlay()) return;
    this.player.inputBlocked = false;
    this.player.lock();
  }

  openMap(): void {
    this.player.inputBlocked = true;
    this.player.unlock();
    this.map.show(this.world, this.built?.area.id ?? HUB_ID);
  }

  openSatchel(): void {
    this.player.inputBlocked = true;
    this.player.unlock();
    this.satchel.show(this.world.labelSet ?? []);
  }

  talk(issue: number): void {
    const found = findPlacement(this.world, issue);
    if (!found) return;
    if (this.built?.area.id !== found.region.id)
      this.travel(found.region.id, false, { pos: this.standNear(found.placement) });
    this.lastTalked = issue;
    this.player.inputBlocked = true;
    this.player.unlock();
    this.dialogue.show(found.placement, found.region);
  }

  private standNear(p: Placement): Vec3 {
    return [p.position[0], 0, p.position[2] + 2];
  }

  // ---- progress -----------------------------------------------------------------

  private markReviewed(issue: number, on: boolean): void {
    setReviewed(localStorage, this.world.repo, issue, on);
    const h = this.built?.npcs.get(issue);
    if (h) setReviewedRing(h, on);
    this.refreshCounts();
    const region = this.built?.area.region;
    if (on && region && this.counts(region.id).reviewed === region.placements.length) {
      if (!this.completedPrompted.has(region.id)) {
        this.completedPrompted.add(region.id);
        this.dialogue.hide();
        this.showDone(region);
      }
    }
  }

  private counts(regionId: string): { reviewed: number; total: number } {
    const r = this.world.regions.find((x) => x.id === regionId);
    if (!r) return { reviewed: 0, total: 0 };
    const reviewed = r.placements.filter(
      (p) => isReviewed(localStorage, this.world.repo, p.issue) || this.isReleased(p.issue),
    ).length;
    return { reviewed, total: r.placements.length };
  }

  private refreshCounts(): void {
    const region = this.built?.area.region;
    const worldTotals = this.world.regions.reduce(
      (acc, r) => {
        const c = this.counts(r.id);
        return { reviewed: acc.reviewed + c.reviewed, total: acc.total + c.total };
      },
      { reviewed: 0, total: 0 },
    );
    this.hud.setCounts(region ? this.counts(region.id) : null, worldTotals);
  }

  private showDone(region: Region): void {
    const doors = this.world.doors.filter((d) => d.from === region.id);
    const items = [
      ...doors.map(
        (d) =>
          `<li><button class="btn" data-go="${d.to}" type="button" ${d.locked ? "disabled" : ""}>${d.kind} → ${escapeHtml(areaLabel(this.world, d.to))}${d.locked ? ` (locked by #${d.locked.by})` : ""}</button></li>`,
      ),
      `<li><button class="btn" data-go="${HUB_ID}" type="button">portal → Hub</button></li>`,
    ].join("");
    this.overlays.done.innerHTML = `<div class="panel"><h2>${escapeHtml(region.label)} is done</h2>
      <p>Every issue here is reviewed. Where next?</p><ul style="list-style:none;padding:0">${items}</ul>
      <p class="muted">Esc to stay.</p></div>`;
    this.overlays.done.classList.remove("hidden");
    this.player.inputBlocked = true;
    this.player.unlock();
    for (const b of this.overlays.done.querySelectorAll<HTMLElement>("[data-go]")) {
      b.addEventListener("click", () => {
        const to = b.dataset.go;
        this.hideDone();
        if (to) this.travel(to);
      });
    }
  }

  private hideDone(): void {
    this.overlays.done.classList.add("hidden");
    this.onOverlayClosed();
  }

  // ---- release: NPCs leaving and returning, doors unlocking ---------------------------

  private releasedKey(issue: number): string {
    return `triage:released:${this.world.repo}#${issue}`;
  }

  private isReleased(issue: number): boolean {
    return sessionStorage.getItem(this.releasedKey(issue)) === "1";
  }

  private removeNpc(issue: number): void {
    const h = this.built?.npcs.get(issue);
    if (!h) return;
    this.built?.npcs.delete(issue);
    h.group.removeFromParent();
    this.departed.set(issue, h);
    if (this.nearest?.issue === issue) {
      this.nearest = null;
      this.hud.setPrompt(null);
    }
  }

  private restoreNpc(issue: number): void {
    const h = this.departed.get(issue);
    if (!h || !this.built) return;
    this.departed.delete(issue);
    this.built.group.add(h.group);
    this.built.npcs.set(issue, h);
  }

  /** Counters tick; doors locked by this issue open with a banner. */
  private released(issue: number): Door[] {
    sessionStorage.setItem(this.releasedKey(issue), "1");
    this.refreshCounts();
    const unlocked: Door[] = [];
    for (const d of this.world.doors) {
      if (d.locked?.by !== issue) continue;
      unlocked.push({ ...d });
      delete d.locked;
      this.rebuildDoor(d);
      this.hud.onDoorUnlocked(
        d,
        `${areaLabel(this.world, d.from)} → ${areaLabel(this.world, d.to)}`,
      );
    }
    for (const p of this.world.hub.portals) {
      if (p.locked?.by !== issue) continue;
      unlocked.push({ ...p });
      delete p.locked;
      this.rebuildDoor(p);
      this.hud.onDoorUnlocked(p, `Hub → ${areaLabel(this.world, p.to)}`);
    }
    const region = findPlacement(this.world, issue)?.region;
    if (region && this.counts(region.id).reviewed === region.placements.length) {
      if (!this.completedPrompted.has(region.id)) {
        this.completedPrompted.add(region.id);
        this.showDone(region);
      }
    }
    return unlocked;
  }

  private unreleased(issue: number, doors: Door[]): void {
    sessionStorage.removeItem(this.releasedKey(issue));
    this.refreshCounts();
    for (const was of doors) {
      const d =
        this.world.doors.find((x) => x.id === was.id) ??
        this.world.hub.portals.find((x) => x.id === was.id);
      if (!d || !was.locked) continue;
      d.locked = was.locked;
      this.rebuildDoor(d);
    }
  }

  /** Swap the door's meshes in place when its lock changes. */
  private rebuildDoor(door: Door): void {
    const built = this.built;
    if (!built) return;
    const i = built.doors.findIndex((h) => h.door.id === door.id);
    if (i < 0) return;
    const old = built.doors[i] as DoorHandle;
    old.group.removeFromParent();
    const fresh = buildDoor(door, this.world, built.area.biome.palette.accent, built.lib);
    built.group.add(fresh.group);
    built.doors[i] = fresh;
    // Locked doors cast bars; the static shadow map must be redrawn without them (or with).
    built.rig.invalidateShadows();
  }

  /** The hourglass walk ends at the region's portal to the hub, else its entrance. */
  private regionExit(issue: number): Vec3 | null {
    const found = findPlacement(this.world, issue);
    if (!found) return null;
    const portal = this.world.doors.find((d) => d.from === found.region.id && d.to === HUB_ID);
    return portal?.position ?? found.region.entrance;
  }

  // ---- edges --------------------------------------------------------------------

  private showEdges(issue: number | null): void {
    this.edgeLines.clear();
    if (issue === null || !this.built) return;
    const from = this.built.npcs.get(issue);
    if (!from) return;
    const a = from.group.position.clone().add(new THREE.Vector3(0, 1, 0));
    for (const e of from.placement.edges) {
      const to = this.built.npcs.get(e.to);
      if (!to) continue;
      const b = to.group.position.clone().add(new THREE.Vector3(0, 1, 0));
      const color = EDGE_COLORS[e.type] ?? "#ffffff";
      const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, linewidth: 2 }));
      this.edgeLines.add(line);
      const label = makeLabelSprite([e.type], { color, height: 0.45 });
      label.position
        .copy(a)
        .lerp(b, 0.5)
        .add(new THREE.Vector3(0, 0.5, 0));
      this.edgeLines.add(label);
    }
  }

  // ---- lens ---------------------------------------------------------------------

  async switchLens(lens: string): Promise<void> {
    if (lens === this.world.lens) return;
    this.hud.showToast(`loading lens ${lens}…`);
    try {
      const loaded = await loadWorld(lensUrl(lens));
      if (loaded.fallback) {
        this.hud.showToast(`no world file for lens ${lens}`);
        return;
      }
      this.world = loaded.world;
      this.completedPrompted.clear();
      this.installDebug();
      this.map.hide();
      const anchor = this.lastTalked ?? this.nearest?.issue ?? null;
      const found = anchor !== null ? findPlacement(this.world, anchor) : null;
      if (found) this.travel(found.region.id, true, { pos: this.standNear(found.placement) });
      else this.travel(HUB_ID);
    } catch (err) {
      this.hud.showToast(`lens ${lens} failed: ${String(err)}`);
    }
  }

  // ---- debug api ----------------------------------------------------------------

  private installDebug(): void {
    // Stand 2 m in front of the NPC (it faces the region centre) and look at its chest.
    const standBy = (issue: number): Placement | null => {
      const found = findPlacement(this.world, issue);
      if (!found) return null;
      if (this.built?.area.id !== found.region.id) this.travel(found.region.id, false);
      const p = found.placement.position;
      const h = this.built?.npcs.get(issue);
      const r = h?.group.rotation.y ?? Math.PI;
      const fx = -Math.sin(r);
      const fz = -Math.cos(r);
      const dist = Math.min(TALK_DISTANCE - 0.1, 1.4 + 0.8 * found.placement.scale);
      this.player.teleport([p[0] + fx * dist, 0, p[2] + fz * dist], r + Math.PI);
      this.player.pitch = found.placement.form === "shade" ? 0.02 : -0.12;
      this.nearest = found.placement;
      this.hud.setPrompt(found.placement);
      return found.placement;
    };
    const api: TriageDebug = {
      teleport: (id) => this.travel(id, false),
      lookAt: (issue) => {
        const found = findPlacement(this.world, issue);
        if (!found) return;
        if (this.built?.area.id !== found.region.id) this.travel(found.region.id, false);
        const p = found.placement.position;
        const me = this.player.pos;
        this.player.yaw = Math.atan2(-(p[0] - me[0]), -(p[2] - me[2]));
        this.player.pitch = 0;
      },
      setYawPitch: (yaw, pitch) => {
        this.player.yaw = yaw;
        this.player.pitch = pitch;
      },
      openMap: () => this.openMap(),
      closeMap: () => this.map.hide(),
      talk: (issue) => this.talk(issue),
      openSatchel: () => this.openSatchel(),
      closeSatchel: () => this.satchel.hide(),
      selectToken: (name) => void this.satchel.select(name, this.world.labelSet ?? []),
      give: (issue) => {
        const p = standBy(issue);
        const token = this.satchel.selectedMeta;
        if (!p || !token) return false;
        return this.verbs.begin(
          { type: "label-add", issue, payload: { label: token.name } },
          "debug",
        );
      },
      take: (issue) => {
        if (standBy(issue)) this.verbs.openRadial(issue);
      },
      startHold: (action) => {
        standBy(action.issue);
        return this.verbs.begin(action, "debug");
      },
      releaseHold: () => this.verbs.cancel(),
      simulateLive: (on) => {
        this.api.simulateLive = on;
        this.hud.setMode(on ? "live" : this.api.mode, this.api.offline && !on);
      },
      api: this.api,
      world: this.world,
    };
    (window as unknown as { __triage: TriageDebug }).__triage = api;
  }
}

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e;
}

export { hubArea };
