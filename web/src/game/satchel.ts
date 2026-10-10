// Satchel overlay (I): the repo's labels as tokens in a grid. Arrow keys and the mouse move
// a cursor; Enter or click picks the token into your hand; Esc closes. Lore on hover.
import type { LabelMeta } from "../../../src/world/types.ts";
import {
  glyphPath,
  labelColor,
  labelNamespace,
  moveSelection,
  sortTokens,
  tokenDim,
  tokenShape,
} from "../pure/satchel.ts";
import { escapeHtml } from "./mapScreen.ts";

const COLS = 6;

export interface SatchelCallbacks {
  onSelect(token: LabelMeta | null): void;
  onClose(): void;
}

export class Satchel {
  private root: HTMLElement;
  private grid: HTMLElement;
  private lore: HTMLElement;
  open = false;
  private tokens: LabelMeta[] = [];
  private cursor = 0;
  /** The token in hand, by name. */
  selected: string | null = null;
  /** Tokens given at least once this session (practice counts); they stop being dim. */
  readonly applied = new Set<string>();

  constructor(private cb: SatchelCallbacks) {
    this.root = must("satchel");
    this.grid = must("satchel-grid");
    this.lore = must("satchel-lore");
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.hide();
    });
    document.addEventListener("keydown", (e) => this.onKey(e));
  }

  get selectedMeta(): LabelMeta | null {
    return this.tokens.find((t) => t.name === this.selected) ?? null;
  }

  show(labelSet: readonly LabelMeta[]): void {
    this.tokens = sortTokens(labelSet);
    this.open = true;
    this.root.classList.remove("hidden");
    const idx = this.tokens.findIndex((t) => t.name === this.selected);
    this.cursor = idx >= 0 ? idx : 0;
    this.render();
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add("hidden");
    this.cb.onClose();
  }

  /** Pick by name (debug api and dialogue offers); null empties the hand. */
  select(name: string | null, labelSet?: readonly LabelMeta[]): LabelMeta | null {
    if (labelSet) this.tokens = sortTokens(labelSet);
    const meta = name ? (this.tokens.find((t) => t.name === name) ?? null) : null;
    this.selected = meta?.name ?? null;
    this.cb.onSelect(meta);
    if (this.open) this.render();
    return meta;
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.open) return;
    const dir =
      e.code === "ArrowLeft"
        ? "left"
        : e.code === "ArrowRight"
          ? "right"
          : e.code === "ArrowUp"
            ? "up"
            : e.code === "ArrowDown"
              ? "down"
              : null;
    if (dir) {
      e.preventDefault();
      this.cursor = moveSelection(this.cursor, this.tokens.length, COLS, dir);
      this.render();
      return;
    }
    if (e.code === "Enter" || e.code === "Space") {
      e.preventDefault();
      this.pick(this.cursor);
    }
  }

  private pick(i: number): void {
    const t = this.tokens[i];
    if (!t) return;
    // Picking the token already in hand puts it back.
    this.select(this.selected === t.name ? null : t.name);
    if (this.selected) this.hide();
  }

  private render(): void {
    this.grid.style.setProperty("--cols", String(COLS));
    this.grid.innerHTML = this.tokens
      .map((t, i) => {
        const color = labelColor(this.tokens, t.name);
        const ns = labelNamespace(t.name);
        const short = ns ? t.name.slice(ns.length + 1) : t.name;
        const cls = [
          "token",
          i === this.cursor ? "cursor" : "",
          t.name === this.selected ? "selected" : "",
          tokenDim(t, this.applied) ? "dim" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `<button type="button" class="${cls}" role="option" data-i="${i}" style="--tc:${color}" aria-selected="${t.name === this.selected}" title="${escapeHtml(t.name)}">
          ${this.applied.has(t.name) ? '<span class="lit">used</span>' : ""}
          <span class="count ${t.count === 0 ? "zero" : ""}">${t.count}</span>
          <svg class="token-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="${glyphPath(tokenShape(t.name))}"/></svg>
          <span class="tname">${ns ? `<span class="tns">${escapeHtml(ns)}:</span>` : ""}${escapeHtml(short)}</span>
        </button>`;
      })
      .join("");
    for (const b of this.grid.querySelectorAll<HTMLElement>("[data-i]")) {
      const i = Number(b.dataset.i);
      b.addEventListener("click", () => this.pick(i));
      b.addEventListener("mouseenter", () => {
        this.cursor = i;
        for (const o of this.grid.querySelectorAll(".token")) o.classList.remove("cursor");
        b.classList.add("cursor");
        this.renderLore();
      });
    }
    this.renderLore();
  }

  private renderLore(): void {
    const t = this.tokens[this.cursor];
    if (!t) {
      this.lore.innerHTML = `<span class="muted">No labels in this repo.</span>`;
      return;
    }
    const color = labelColor(this.tokens, t.name);
    this.lore.style.setProperty("--tc", color);
    const worn =
      t.count === 0
        ? "No open issue wears it."
        : `${t.count} open issue${t.count === 1 ? "" : "s"} wear it.`;
    const desc = t.description.trim() || "No lore written for this label.";
    this.lore.innerHTML = `<b>${escapeHtml(t.name)}</b> · ${escapeHtml(tokenShape(t.name))}<span class="muted">${escapeHtml(desc)} ${worn}</span>`;
  }
}

function must(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e;
}
