import type { World } from "../../../src/world/types.ts";
import { HUB_ID } from "./areas.ts";

export interface MapCallbacks {
  teleport(areaId: string): void;
  switchLens(lens: string): void;
  reviewedIn(regionId: string): number;
}

export class MapScreen {
  private root: HTMLElement;
  open = false;

  constructor(
    private cb: MapCallbacks,
    private onClose: () => void,
  ) {
    const root = document.getElementById("map");
    if (!root) throw new Error("missing #map");
    this.root = root;
    root.addEventListener("click", (e) => {
      if (e.target === root) this.hide();
    });
  }

  show(world: World, currentArea: string): void {
    this.open = true;
    this.root.classList.remove("hidden");
    this.render(world, currentArea);
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add("hidden");
    this.onClose();
  }

  private render(world: World, currentArea: string): void {
    const total = world.regions.reduce((n, r) => n + r.placements.length, 0) || 1;
    const lensButtons = world.lenses
      .map(
        (l) =>
          `<button class="btn ${l === world.lens ? "active" : ""}" data-lens="${l}" type="button">${l}</button>`,
      )
      .join("");
    const tiles = world.regions
      .map((r) => {
        const reviewed = this.cb.reviewedIn(r.id);
        const n = r.placements.length;
        const span = n / total > 0.34 ? "grid-column: span 2;" : "";
        return `<div class="tile ${r.id === currentArea ? "current" : ""}" data-area="${r.id}" style="background:${r.biome.sky};${span}">
          <div class="t-label">${escapeHtml(r.label)}</div>
          <div class="t-meta">${escapeHtml(r.biome.name)} · ${n} issue${n === 1 ? "" : "s"} · ${reviewed}/${n} reviewed</div>
          <div class="bar"><div style="width:${n ? (reviewed / n) * 100 : 0}%"></div></div>
        </div>`;
      })
      .join("");
    this.root.innerHTML = `<div class="panel" style="width: 720px">
      <h2>Map · ${escapeHtml(world.repo)}</h2>
      <h3>Lens</h3><div>${lensButtons}</div>
      <h3>Regions (click to travel)</h3>
      <div class="tiles">
        <div class="tile ${currentArea === HUB_ID ? "current" : ""}" data-area="${HUB_ID}" style="background:#c7ced6">
          <div class="t-label">Hub</div><div class="t-meta">plaza · ${world.regions.length} portals</div>
        </div>
        ${tiles}
      </div>
      <p class="muted">Tab or Esc closes.</p>
    </div>`;
    for (const b of this.root.querySelectorAll<HTMLElement>("[data-lens]")) {
      b.addEventListener("click", () => {
        const lens = b.dataset.lens;
        if (lens) this.cb.switchLens(lens);
      });
    }
    for (const t of this.root.querySelectorAll<HTMLElement>("[data-area]")) {
      t.addEventListener("click", () => {
        const id = t.dataset.area;
        if (!id) return;
        this.hide();
        this.cb.teleport(id);
      });
    }
  }
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}
