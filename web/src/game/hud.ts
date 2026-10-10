import type { Door, Placement, Vec3, World } from "../../../src/world/types.ts";
import type { Bounds } from "../pure/collision.ts";
import { fitProjection, headingTriangle, project } from "../pure/minimap.ts";
import type { Area } from "./areas.ts";

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e as T;
}

export class Hud {
  private region = el<HTMLElement>("hud-region");
  private lens = el<HTMLElement>("hud-lens");
  private regionCount = el<HTMLElement>("hud-region-count");
  private worldCount = el<HTMLElement>("hud-world-count");
  private prompt = el<HTMLElement>("hud-prompt");
  private toast = el<HTMLElement>("toast");
  private minimap = el<HTMLCanvasElement>("minimap");
  private toastTimer = 0;

  setArea(area: Area, world: World): void {
    this.region.textContent = `${area.label} · ${area.biome.name}`;
    this.lens.textContent = `lens: ${world.lens} · ${world.repo}`;
  }

  setCounts(
    region: { reviewed: number; total: number } | null,
    world: { reviewed: number; total: number },
  ): void {
    this.regionCount.textContent = region
      ? `region ${region.reviewed}/${region.total} reviewed · ${region.total - region.reviewed} left`
      : "hub";
    this.worldCount.textContent = `world ${world.reviewed}/${world.total} reviewed · ${world.total - world.reviewed} left`;
  }

  setPrompt(p: Placement | null): void {
    this.prompt.textContent = p ? `E to talk to #${p.issue}` : "";
  }

  showToast(text: string, ms = 2500): void {
    this.toast.textContent = text;
    this.toast.classList.add("on");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove("on"), ms);
  }

  drawMinimap(opts: {
    bounds: Bounds;
    npcs: { placement: Placement; reviewed: boolean }[];
    doors: Door[];
    player: Vec3;
    yaw: number;
    fill: string;
  }): void {
    const c = this.minimap;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    const proj = fitProjection(opts.bounds, c.width, c.height, 10);
    const [x0, y0] = project(proj, [opts.bounds.x, opts.bounds.z]);
    ctx.fillStyle = opts.fill;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(x0, y0, opts.bounds.w * proj.scale, opts.bounds.d * proj.scale);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, y0, opts.bounds.w * proj.scale, opts.bounds.d * proj.scale);
    for (const d of opts.doors) {
      const [x, y] = project(proj, d.position);
      ctx.fillStyle = d.locked ? "#f87171" : d.kind === "portal" ? "#a78bfa" : "#ffd166";
      ctx.fillRect(x - 3, y - 3, 6, 6);
    }
    for (const n of opts.npcs) {
      const [x, y] = project(proj, n.placement.position);
      ctx.beginPath();
      ctx.arc(x, y, 2.5 + n.placement.centrality * 2, 0, Math.PI * 2);
      ctx.fillStyle = n.reviewed ? "#4ade80" : "#ffffff";
      ctx.fill();
    }
    const center = project(proj, opts.player);
    const [a, b, d] = headingTriangle(center, opts.yaw, 7);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(d[0], d[1]);
    ctx.closePath();
    ctx.fillStyle = "#38bdf8";
    ctx.fill();
  }
}
