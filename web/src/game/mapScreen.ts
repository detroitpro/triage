import type { Region, World } from "../../../src/world/types.ts";
import { truncate } from "../pure/dialogueText.ts";
import {
  cycleTile,
  type Direction,
  HUB_TILE_ID,
  layoutMap,
  type MapLayout,
  pickInDirection,
} from "../pure/mapLayout.ts";
import { HUB_BIOME } from "./areas.ts";

export interface MapCallbacks {
  teleport(areaId: string): void;
  switchLens(lens: string): void;
  reviewedIn(regionId: string): number;
}

const CHART_W = 900;
const CHART_H = 470;

/**
 * The map screen: every area placed by its world bounds, door links drawn between
 * them, lens tabs as a segmented control. Keyboard: arrows move, Enter travels,
 * Tab/Esc close (handled by game.ts, which calls hide()).
 */
export class MapScreen {
  private root: HTMLElement;
  open = false;
  private layout: MapLayout | null = null;
  private selected: string | null = null;
  private world: World | null = null;

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
    document.addEventListener("keydown", (e) => this.onKey(e));
  }

  show(world: World, currentArea: string): void {
    this.open = true;
    this.world = world;
    this.selected = currentArea;
    this.root.classList.remove("hidden");
    this.render(world, currentArea);
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add("hidden");
    this.onClose();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.open || !this.layout) return;
    const dirs: Record<string, Direction> = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      KeyW: "up",
      KeyS: "down",
      KeyA: "left",
      KeyD: "right",
    };
    const dir = dirs[e.code];
    if (dir) {
      e.preventDefault();
      const step = dir === "right" || dir === "down" ? 1 : -1;
      const next =
        pickInDirection(this.layout.tiles, this.selected, dir) ??
        cycleTile(this.layout.tiles, this.selected, step);
      this.select(next);
      return;
    }
    if (e.code === "Enter" || e.code === "Space") {
      e.preventDefault();
      if (this.selected) this.travel(this.selected);
      return;
    }
    if (e.code === "BracketLeft" || e.code === "BracketRight") {
      const lenses = this.world?.lenses ?? [];
      const i = lenses.indexOf(this.world?.lens ?? "");
      const next =
        lenses[(i + (e.code === "BracketRight" ? 1 : -1) + lenses.length) % lenses.length];
      if (next) this.cb.switchLens(next);
    }
  }

  private select(id: string | null): void {
    this.selected = id;
    for (const t of this.root.querySelectorAll<SVGGElement>(".tile")) {
      t.classList.toggle("selected", t.dataset.area === id);
    }
    const detail = this.root.querySelector<HTMLElement>("#map-detail");
    if (detail && this.world) detail.innerHTML = this.detailFor(this.world, id);
  }

  private travel(id: string): void {
    this.hide();
    this.cb.teleport(id);
  }

  private detailFor(world: World, id: string | null): string {
    if (!id) return "";
    if (id === HUB_TILE_ID) return `<b>Hub</b> · plaza · ${world.hub.portals.length} portals`;
    const r = world.regions.find((x) => x.id === id);
    if (!r) return "";
    const n = r.placements.length;
    const reviewed = this.cb.reviewedIn(r.id);
    const locks = world.doors.filter((d) => d.from === r.id && d.locked).length;
    return `<b>${escapeHtml(r.label)}</b> · ${escapeHtml(r.biome.name)} · <span class="num">${reviewed}/${n}</span> reviewed${locks ? ` · ${locks} locked door${locks === 1 ? "" : "s"}` : ""}`;
  }

  private render(world: World, currentArea: string): void {
    const layout = layoutMap(
      { hub: world.hub, regions: world.regions, doors: [...world.doors, ...world.hub.portals] },
      CHART_W,
      CHART_H,
      28,
    );
    this.layout = layout;
    const lensTabs = world.lenses
      .map(
        (l) =>
          `<button class="${l === world.lens ? "active" : ""}" data-lens="${escapeHtml(l)}" type="button">${escapeHtml(l)}</button>`,
      )
      .join("");
    const regionById = new Map<string, Region>(world.regions.map((r) => [r.id, r]));
    const links = layout.links
      .map((l) => {
        const cls = `link ${l.kind}${l.locked ? " locked" : ""}`;
        // Slight curve so overlapping two-way links read as two strokes.
        const mx = (l.x1 + l.x2) / 2;
        const my = (l.y1 + l.y2) / 2;
        const dx = l.x2 - l.x1;
        const dy = l.y2 - l.y1;
        const len = Math.hypot(dx, dy) || 1;
        const cx = mx - (dy / len) * 18;
        const cy = my + (dx / len) * 18;
        const mark = l.locked
          ? `<circle class="door-mark" cx="${l.x1}" cy="${l.y1}" r="4" fill="#0d1016" stroke="var(--lock)"/>`
          : l.kind === "portal"
            ? `<circle class="door-mark" cx="${l.x1}" cy="${l.y1}" r="3.5" fill="var(--portal)" stroke="#0d1016"/>`
            : `<rect class="door-mark" x="${l.x1 - 3.5}" y="${l.y1 - 3.5}" width="7" height="7" fill="var(--accent)" stroke="#0d1016"/>`;
        return `<path class="${cls}" d="M${l.x1},${l.y1} Q${cx},${cy} ${l.x2},${l.y2}"/>${mark}`;
      })
      .join("");
    const tiles = layout.tiles
      .map((t) => {
        const region = regionById.get(t.id);
        const biome = region?.biome ?? HUB_BIOME;
        const n = region?.placements.length ?? 0;
        const reviewed = region ? this.cb.reviewedIn(region.id) : 0;
        const pct = n ? reviewed / n : 0;
        const ringR = 11;
        const circ = 2 * Math.PI * ringR;
        const inkDark = isBright(biome.palette.ground);
        const ink = inkDark ? "#0d1016" : "#f4f6f8";
        const classes = [
          "tile",
          t.id === currentArea ? "current" : "",
          t.id === this.selected ? "selected" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const labelChars = Math.max(4, Math.floor((t.w - 44) / 7.2));
        const metaChars = Math.max(4, Math.floor((t.w - 16) / 6.2));
        const meta = region
          ? `${biome.name} · ${n} issue${n === 1 ? "" : "s"}`
          : `plaza · ${world.hub.portals.length} portals`;
        const ring = region
          ? `<g transform="translate(${t.x + t.w - 18},${t.y + 18})">
              <circle class="ring-bg" r="${ringR}"/>
              <circle class="ring" r="${ringR}" stroke-dasharray="${circ * pct} ${circ}" ${pct >= 1 ? 'stroke="var(--ok)"' : 'stroke="var(--accent)"'}/>
              <text class="ring-num" y="3.5" fill="${ink}">${reviewed}</text>
            </g>`
          : "";
        return `<g class="${classes}" data-area="${escapeHtml(t.id)}" tabindex="-1">
          <rect class="body" x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" fill="${biome.palette.ground}" stroke="${biome.sky}"/>
          <rect x="${t.x}" y="${t.y}" width="${t.w}" height="6" fill="${biome.sky}"/>
          <text class="label" x="${t.x + 10}" y="${t.y + 26}" fill="${ink}">${escapeHtml(truncate(t.label, labelChars))}</text>
          <text class="meta" x="${t.x + 10}" y="${t.y + 42}" fill="${ink}">${escapeHtml(truncate(meta, metaChars))}</text>
          ${ring}
        </g>`;
      })
      .join("");
    this.root.innerHTML = `<div class="panel map-panel">
      <div class="map-head">
        <h2>Map<span class="repo">${escapeHtml(world.repo)}</span></h2>
        <div class="seg" role="tablist" aria-label="Lens">${lensTabs}</div>
      </div>
      <svg class="map-chart" viewBox="0 0 ${CHART_W} ${CHART_H}" role="img" aria-label="World map">
        <g class="links">${links}</g>
        <g class="tiles">${tiles}</g>
      </svg>
      <div class="map-foot">
        <div id="map-detail" class="muted">${this.detailFor(world, this.selected)}</div>
        <div class="legend"><span><i></i>door</span><span><i class="portal"></i>portal</span><span><i class="locked"></i>locked</span></div>
        <div class="keys-inline"><span class="keycap">←↑↓→</span>select<span class="keycap">Enter</span>travel<span class="keycap">[ ]</span>lens<span class="keycap">Tab</span>close</div>
      </div>
    </div>`;
    for (const b of this.root.querySelectorAll<HTMLElement>("[data-lens]")) {
      b.addEventListener("click", () => {
        const lens = b.dataset.lens;
        if (lens) this.cb.switchLens(lens);
      });
    }
    for (const t of this.root.querySelectorAll<SVGGElement>("[data-area]")) {
      t.addEventListener("mouseenter", () => this.select(t.dataset.area ?? null));
      t.addEventListener("click", () => {
        const id = t.dataset.area;
        if (id) this.travel(id);
      });
    }
  }
}

function isBright(hex: string): boolean {
  const h = hex.replace("#", "");
  if (h.length !== 6) return false;
  const n = Number.parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}
