import type { Biome, Door, Placement, Vec3, World } from "../../../src/world/types.ts";
import type { Bounds } from "../pure/collision.ts";
import { distanceXZ } from "../pure/collision.ts";
import { compassMarks } from "../pure/compass.ts";
import { truncate } from "../pure/dialogueText.ts";
import { fitProjection, headingTriangle, project } from "../pure/minimap.ts";
import { themeVars } from "../pure/theme.ts";
import type { Area } from "./areas.ts";

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e as T;
}

/** How close (world units) a door must be for the reticle to change shape. */
const DOOR_RANGE = 4;
const BANNER_MS = 2300;

/**
 * Push the biome palette into CSS custom properties so every panel, meter and
 * glyph carries the current region's mood. Safe to call on every region change.
 */
export function applyBiomeTheme(biome: Biome): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(themeVars(biome))) root.style.setProperty(k, v);
  root.dataset.biome = biome.enclosure;
}

/** Small flat-shaded SVG mark per enclosure; the HUD's status glyph. */
export function biomeGlyphPath(biome: Biome): string {
  switch (biome.enclosure) {
    case "building":
      return '<path d="M3 11 12 4l9 7v9H3z" fill="none"/><path d="M9 20v-6h6v6" fill="none"/><path d="M12 4 3 11" />';
    case "dungeon":
      return '<path d="M4 20V11a8 8 0 0 1 16 0v9" fill="none"/><path d="M9 20v-5a3 3 0 0 1 6 0v5" fill="none"/><path d="M4 20h16" fill="none"/>';
    default:
      return '<circle cx="16" cy="7" r="3"/><path d="M2 19c3-5 5-7 8-7s4 3 6 3 3-2 6-2v6H2z" stroke="none"/>';
  }
}

export type BannerKind = "event" | "reward" | "unlock";

interface Announcement {
  kicker: string;
  text: string;
  kind: BannerKind;
}

export interface HudFrame {
  bounds: Bounds;
  npcs: { placement: Placement; reviewed: boolean }[];
  doors: Door[];
  player: Vec3;
  yaw: number;
  fill: string;
}

export class Hud {
  private root = el<HTMLElement>("hud");
  private region = el<HTMLElement>("hud-region");
  private biome = el<HTMLElement>("hud-biome");
  private lens = el<HTMLElement>("hud-lens");
  private glyph = el<HTMLElement>("hud-biome-glyph");
  private regionCount = el<HTMLElement>("hud-region-count");
  private regionLeft = el<HTMLElement>("hud-region-left");
  private regionFill = el<HTMLElement>("hud-region-fill");
  private worldCount = el<HTMLElement>("hud-world-count");
  private worldFill = el<HTMLElement>("hud-world-fill");
  private prompt = el<HTMLElement>("hud-prompt");
  private promptIssue = el<HTMLElement>("prompt-issue");
  private promptTitle = el<HTMLElement>("prompt-title");
  private crosshair = el<HTMLElement>("crosshair");
  private banner = el<HTMLElement>("hud-banner");
  private toast = el<HTMLElement>("toast");
  private minimap = el<HTMLCanvasElement>("minimap");
  private minimapCaption = el<HTMLElement>("minimap-caption");
  private compass = el<HTMLCanvasElement>("compass");
  private toastTimer = 0;
  private bannerTimer = 0;
  private queue: Announcement[] = [];
  private bannerBusy = false;
  private world: World | null = null;
  private areaId = "";
  private areaLabel = "";
  private lastRegionReviewed = -1;
  private seenReviewed = new Set<number>();
  private seenLocked = new Map<string, boolean>();
  private reticleState = "";
  private nearDoor: Door | null = null;
  private seeded = false;
  private pendingCleared: string | null = null;

  constructor() {
    document.addEventListener("pointerlockchange", () => {
      this.root.classList.toggle("locked", document.pointerLockElement !== null);
    });
    this.fitCanvas(this.minimap);
    this.fitCanvas(this.compass);
    window.addEventListener("resize", () => {
      this.fitCanvas(this.minimap);
      this.fitCanvas(this.compass);
    });
  }

  private fitCanvas(c: HTMLCanvasElement): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = c.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || c.width));
    const h = Math.max(1, Math.round(rect.height || c.height));
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.dataset.dpr = String(dpr);
  }

  // ---- status ---------------------------------------------------------------------

  setArea(area: Area, world: World): void {
    this.world = world;
    const changedArea = area.id !== this.areaId;
    this.areaId = area.id;
    this.areaLabel = area.label;
    this.region.textContent = area.label;
    this.biome.textContent = area.biome.name;
    this.lens.textContent = world.lens;
    this.glyph.innerHTML = biomeGlyphPath(area.biome);
    this.minimapCaption.textContent = area.region ? `${area.placements.length} here` : "plaza";
    applyBiomeTheme(area.biome);
    if (changedArea) {
      this.lastRegionReviewed = -1;
      this.seenReviewed = new Set();
      this.seenLocked = new Map();
      this.nearDoor = null;
      this.seeded = false;
      this.pendingCleared = null;
    }
  }

  // ---- objective ------------------------------------------------------------------

  setCounts(
    region: { reviewed: number; total: number } | null,
    world: { reviewed: number; total: number },
  ): void {
    const regionMeter = this.regionFill.parentElement;
    if (region) {
      const left = region.total - region.reviewed;
      this.regionCount.innerHTML = `${region.reviewed}<i>/</i>${region.total}`;
      this.regionLeft.textContent = left === 0 ? "clear" : `${left} left`;
      this.regionFill.style.width = `${region.total ? (region.reviewed / region.total) * 100 : 0}%`;
      regionMeter?.classList.toggle("done", region.total > 0 && left === 0);
      regionMeter?.style.setProperty("--tick", `${100 / Math.max(1, region.total)}%`);
      if (this.lastRegionReviewed >= 0 && region.reviewed > this.lastRegionReviewed) {
        this.punch(this.regionCount);
        if (left === 0 && region.total > 0) this.pendingCleared = this.areaLabel;
      }
      this.lastRegionReviewed = region.reviewed;
    } else {
      this.regionCount.innerHTML = "<i>—</i>";
      this.regionLeft.textContent = "hub";
      this.regionFill.style.width = "0%";
      regionMeter?.classList.remove("done");
      this.lastRegionReviewed = -1;
    }
    this.worldCount.innerHTML = `${world.reviewed}<i>/</i>${world.total}`;
    this.worldFill.style.width = `${world.total ? (world.reviewed / world.total) * 100 : 0}%`;
  }

  private punch(target: HTMLElement): void {
    target.classList.remove("punch");
    void target.offsetWidth;
    target.classList.add("punch");
  }

  // ---- prompt and reticle ---------------------------------------------------------

  setPrompt(p: Placement | null): void {
    if (p) {
      this.promptIssue.textContent = `#${p.issue}`;
      this.promptTitle.textContent = truncate(p.title, 40);
      this.prompt.classList.add("on");
    } else this.prompt.classList.remove("on");
    this.setReticle(p ? "npc" : this.nearDoor ? this.doorState(this.nearDoor) : "");
  }

  private doorState(d: Door): string {
    return d.locked ? "door locked" : "door";
  }

  private setReticle(state: string): void {
    if (state === this.reticleState) return;
    this.reticleState = state;
    this.crosshair.className = `reticle ${state}`.trim();
  }

  // ---- feedback ---------------------------------------------------------------------

  /** Queue a short event banner at top center. */
  announce(text: string, kind: BannerKind = "event", kicker = ""): void {
    this.queue.push({ text, kind, kicker });
    if (!this.bannerBusy) this.nextBanner();
  }

  private nextBanner(): void {
    const a = this.queue.shift();
    if (!a) {
      this.bannerBusy = false;
      return;
    }
    this.bannerBusy = true;
    this.banner.className = `banner ${a.kind}`;
    this.banner.innerHTML = a.kicker
      ? `<span class="kicker">${escapeText(a.kicker)}</span>${escapeText(a.text)}`
      : escapeText(a.text);
    void this.banner.offsetWidth;
    this.banner.classList.add("on");
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.banner.classList.remove("on");
      this.bannerTimer = window.setTimeout(() => this.nextBanner(), 260);
    }, BANNER_MS);
  }

  /** Reward feedback for a newly reviewed issue (deduped per region visit). */
  onReviewed(issue: number): void {
    if (this.seenReviewed.has(issue)) return;
    this.seenReviewed.add(issue);
    this.announce(`#${issue}`, "reward", "Reviewed");
  }

  onRegionCleared(label: string): void {
    this.announce(label, "reward", "Region cleared");
  }

  onDoorUnlocked(door: Door, destinationLabel?: string): void {
    this.seenLocked.set(door.id, false);
    this.announce(destinationLabel ?? this.doorLabel(door), "unlock", "Door unlocked");
  }

  showToast(text: string, ms = 2500): void {
    this.toast.textContent = text;
    this.toast.classList.add("on");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove("on"), ms);
  }

  // ---- per-frame --------------------------------------------------------------------

  /** Legacy name kept for game.ts; now updates minimap, compass and reticle. */
  drawMinimap(opts: HudFrame): void {
    this.frame(opts);
  }

  frame(opts: HudFrame): void {
    this.detectRewards(opts);
    this.updateNearDoor(opts);
    this.paintMinimap(opts);
    this.paintCompass(opts);
  }

  /** Reward events are derived from state so game.ts needs no extra calls today. */
  private detectRewards(opts: HudFrame): void {
    if (!this.seeded) {
      this.seeded = true;
      for (const n of opts.npcs) if (n.reviewed) this.seenReviewed.add(n.placement.issue);
    } else {
      for (const n of opts.npcs) if (n.reviewed) this.onReviewed(n.placement.issue);
    }
    if (this.pendingCleared !== null) {
      this.onRegionCleared(this.pendingCleared);
      this.pendingCleared = null;
    }
    for (const d of opts.doors) {
      const was = this.seenLocked.get(d.id);
      const now = Boolean(d.locked);
      if (was === true && !now) this.onDoorUnlocked(d);
      this.seenLocked.set(d.id, now);
    }
  }

  private updateNearDoor(opts: HudFrame): void {
    let near: Door | null = null;
    let best = DOOR_RANGE;
    for (const d of opts.doors) {
      const dist = distanceXZ(opts.player, d.position);
      if (dist < best) {
        best = dist;
        near = d;
      }
    }
    this.nearDoor = near;
    if (!this.prompt.classList.contains("on")) this.setReticle(near ? this.doorState(near) : "");
  }

  private doorLabel(d: Door): string {
    if (d.to === "hub") return "Hub";
    return this.world?.regions.find((r) => r.id === d.to)?.label ?? d.to;
  }

  private paintMinimap(opts: HudFrame): void {
    const c = this.minimap;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = Number(c.dataset.dpr ?? 1);
    const W = c.width / dpr;
    const H = c.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const proj = fitProjection(opts.bounds, W, H, 22);
    const [x0, y0] = project(proj, [opts.bounds.x, opts.bounds.z]);
    const w = opts.bounds.w * proj.scale;
    const h = opts.bounds.d * proj.scale;
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim() || "#ffd166";
    const ground = css.getPropertyValue("--ground-lift").trim() || opts.fill;
    // Region floor.
    ctx.fillStyle = ground;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(x0, y0, w, h);
    ctx.globalAlpha = 1;
    // Survey grid every 10 units.
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    const step = 10 * proj.scale;
    ctx.beginPath();
    for (let gx = x0 + step; gx < x0 + w - 1; gx += step) {
      ctx.moveTo(gx, y0);
      ctx.lineTo(gx, y0 + h);
    }
    for (let gy = y0 + step; gy < y0 + h - 1; gy += step) {
      ctx.moveTo(x0, gy);
      ctx.lineTo(x0 + w, gy);
    }
    ctx.stroke();
    // Outline with doubled hairline.
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, y0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 - 3, y0 - 3, w + 6, h + 6);
    // Doors and portals.
    for (const d of opts.doors) {
      const [x, y] = project(proj, d.position);
      if (d.kind === "portal") {
        ctx.fillStyle = "#c4a7ff";
        ctx.beginPath();
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x + 5, y);
        ctx.lineTo(x, y + 5);
        ctx.lineTo(x - 5, y);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = d.locked ? "#ff6b6b" : accent;
        ctx.fillRect(x - 4, y - 4, 8, 8);
        if (d.locked) {
          // padlock shackle
          ctx.strokeStyle = "#ff6b6b";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y - 5, 3, Math.PI, 0);
          ctx.stroke();
        }
      }
    }
    // NPCs: unreviewed glow in accent, reviewed dim with a check ring.
    for (const n of opts.npcs) {
      const [x, y] = project(proj, n.placement.position);
      const r = 2.5 + n.placement.centrality * 2.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (n.reviewed) {
        ctx.fillStyle = "rgba(127,224,160,0.35)";
        ctx.fill();
        ctx.strokeStyle = "#7fe0a0";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = accent;
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    // Player: view wedge plus heading triangle.
    const center = project(proj, opts.player);
    const fx = -Math.sin(opts.yaw);
    const fy = -Math.cos(opts.yaw);
    const ang = Math.atan2(fy, fx);
    ctx.beginPath();
    ctx.moveTo(center[0], center[1]);
    ctx.arc(center[0], center[1], 22, ang - 0.6, ang + 0.6);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fill();
    const [a, b, d] = headingTriangle(center, opts.yaw, 7);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(d[0], d[1]);
    ctx.closePath();
    ctx.fillStyle = accent;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  }

  private paintCompass(opts: HudFrame): void {
    const c = this.compass;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = Number(c.dataset.dpr ?? 1);
    const W = c.width / dpr;
    const H = c.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim() || "#ffd166";
    const arc = Math.PI;
    // Tick rail: a tick every 15 degrees.
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const tickStep = Math.PI / 12;
    const base = Math.ceil((opts.yaw - arc / 2) / tickStep) * tickStep;
    for (let hdg = base; hdg <= opts.yaw + arc / 2; hdg += tickStep) {
      const rel = -(hdg - opts.yaw);
      const x = W / 2 + (rel / (arc / 2)) * (W / 2);
      const major = Math.abs(Math.round(hdg / (Math.PI / 2)) * (Math.PI / 2) - hdg) < 1e-6;
      ctx.moveTo(x, 18);
      ctx.lineTo(x, 18 - (major ? 10 : 5));
    }
    ctx.stroke();
    const marks = compassMarks({
      yaw: opts.yaw,
      player: opts.player,
      doors: opts.doors,
      width: W,
      arc,
      labelFor: (d) => this.doorLabel(d),
    });
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 3;
    for (const m of marks) {
      if (m.kind !== "cardinal") continue;
      ctx.font = `700 ${m.label === "N" ? 15 : 13}px system-ui, sans-serif`;
      ctx.fillStyle = m.label === "N" ? accent : "rgba(255,255,255,0.9)";
      ctx.fillText(m.label, m.x, 9);
    }
    // Door labels: lay out left to right, dropping to a second row on overlap and
    // skipping labels that would be cut by the strip's faded edges.
    ctx.font = "600 11px system-ui, sans-serif";
    const doorMarks = marks.filter((m) => m.kind !== "cardinal").sort((a, b) => a.x - b.x);
    const rows: number[] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const m of doorMarks) {
      const color = m.locked ? "#ff6b6b" : m.kind === "portal" ? "#c4a7ff" : accent;
      ctx.globalAlpha = m.clamped ? 0.5 : 1;
      const x = Math.max(10, Math.min(W - 10, m.x));
      ctx.fillStyle = color;
      ctx.beginPath();
      if (m.kind === "portal") {
        ctx.moveTo(x, 20);
        ctx.lineTo(x + 6, 26);
        ctx.lineTo(x, 32);
        ctx.lineTo(x - 6, 26);
      } else {
        ctx.moveTo(x - 5, 21);
        ctx.lineTo(x + 5, 21);
        ctx.lineTo(x + 5, 31);
        ctx.lineTo(x - 5, 31);
      }
      ctx.closePath();
      ctx.fill();
      if (m.locked) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, 21, 3.5, Math.PI, 0);
        ctx.stroke();
      }
      const edgeZone = W * 0.14;
      if (m.clamped || x < edgeZone || x > W - edgeZone) {
        ctx.globalAlpha = 1;
        continue;
      }
      const text = `${truncate(m.label, 18)} · ${Math.round(m.distance)}m`;
      const half = ctx.measureText(text).width / 2 + 6;
      const row = x - half > (rows[0] ?? 0) ? 0 : x - half > (rows[1] ?? 0) ? 1 : -1;
      if (row < 0) continue;
      rows[row] = x + half;
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillText(text, x, 43 + row * 12);
      ctx.globalAlpha = 1;
    }
    ctx.shadowBlur = 0;
  }
}

function escapeText(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}
