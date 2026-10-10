// Satchel: the repo's labels as inventory tokens. Shape from the namespace, colour from
// the label, selection state for the grid. Dependency-free so it stays testable.
import type { LabelMeta } from "../../../src/world/types.ts";

export type TokenShape =
  | "crest"
  | "tool"
  | "gear"
  | "scroll"
  | "stopwatch"
  | "lantern"
  | "hourglass"
  | "wrench"
  | "tag";

/** Namespace (before the colon) or the whole name for un-namespaced labels. */
export function labelNamespace(name: string): string {
  const i = name.indexOf(":");
  return i > 0 ? name.slice(0, i) : "";
}

export function tokenShape(name: string): TokenShape {
  const ns = labelNamespace(name).toLowerCase();
  switch (ns) {
    case "context":
      return "crest";
    case "app":
      return "tool";
    case "platform":
      return "gear";
    case "feature":
      return "scroll";
  }
  switch (name.toLowerCase()) {
    case "performance":
      return "stopwatch";
    case "needs-info":
      return "lantern";
    case "later":
      return "hourglass";
    case "infra":
      return "wrench";
    default:
      return "tag";
  }
}

export const DEFAULT_LABEL_COLOR = "8a97a8";

/** CSS colour for a label; GitHub colours come without '#'. */
export function labelColor(labelSet: readonly LabelMeta[], name: string): string {
  const meta = labelSet.find((l) => l.name === name);
  const raw = (meta?.color ?? DEFAULT_LABEL_COLOR).replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(raw) ? `#${raw.toLowerCase()}` : `#${DEFAULT_LABEL_COLOR}`;
}

/** The first `context:*` label decides the tabard tint and hat ribbon. */
export function contextLabel(labels: readonly string[]): string | null {
  return labels.find((l) => labelNamespace(l) === "context") ?? null;
}

const SHAPE_ORDER: TokenShape[] = [
  "crest",
  "tool",
  "gear",
  "scroll",
  "stopwatch",
  "lantern",
  "hourglass",
  "wrench",
  "tag",
];

/** Grid order: grouped by shape (namespaces first), then by name. */
export function sortTokens(labelSet: readonly LabelMeta[]): LabelMeta[] {
  return [...labelSet].sort((a, b) => {
    const sa = SHAPE_ORDER.indexOf(tokenShape(a.name));
    const sb = SHAPE_ORDER.indexOf(tokenShape(b.name));
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });
}

/**
 * A token is dim when no open issue wears it and it has not been applied this session.
 * Giving a token (even in practice) lights it up.
 */
export function tokenDim(meta: LabelMeta, appliedThisSession: ReadonlySet<string>): boolean {
  return meta.count <= 0 && !appliedThisSession.has(meta.name);
}

export type GridDir = "left" | "right" | "up" | "down";

/** Move a grid cursor; wraps horizontally within the row and clamps vertically. */
export function moveSelection(index: number, count: number, cols: number, dir: GridDir): number {
  if (count <= 0) return -1;
  const c = Math.max(1, cols);
  const i = Math.max(0, Math.min(count - 1, index));
  const row = Math.floor(i / c);
  const col = i % c;
  const rowStart = row * c;
  const rowLen = Math.min(c, count - rowStart);
  switch (dir) {
    case "left":
      return rowStart + ((col - 1 + rowLen) % rowLen);
    case "right":
      return rowStart + ((col + 1) % rowLen);
    case "up":
      return row === 0 ? i : i - c;
    case "down": {
      const next = i + c;
      return next < count ? next : i;
    }
  }
}

/** Gear outline: `teeth` teeth between radius r1 (valley) and r2 (tip), centred at 12,12. */
function gearPath(teeth = 8, r1 = 7, r2 = 10): string {
  const pts: string[] = [];
  const steps = teeth * 4;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2 - Math.PI / 2;
    const phase = i % 4;
    const r = phase === 0 || phase === 3 ? r1 : r2;
    pts.push(`${(12 + Math.cos(a) * r).toFixed(2)} ${(12 + Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z`;
}

/** SVG path data (24×24 box, fill-rule evenodd) for each token shape. */
export function glyphPath(shape: TokenShape): string {
  switch (shape) {
    case "crest":
      return "M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5Zm0 3.2 5 1.9V11c0 3.4-2.2 6.4-5 8-2.8-1.6-5-4.6-5-8V7.1Z";
    case "tool":
      return "M14 3l3-1 5 5-1 3-2.2-.6L17 11.2 12.8 7l1.8-1.8ZM11.3 8.5l4.2 4.2L7 21.2a2 2 0 0 1-2.8 0l-1.4-1.4a2 2 0 0 1 0-2.8Z";
    case "gear":
      return gearPath();
    case "scroll":
      return "M6 3h11a3 3 0 0 1 3 3v2h-4v9a4 4 0 0 1-4 4H5a3 3 0 0 1-3-3v-2h10v2a2 2 0 0 0 2 2 2 2 0 0 0 2-2V6a1 1 0 0 0-1-1H6ZM4 6a2 2 0 0 1 2-2v10H4Zm3 2h6v2H7Zm0 4h6v2H7Z";
    case "stopwatch":
      return "M10 2h4v2h-1v1.1a8 8 0 1 1-2 0V4h-1Zm2 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm-1 2h2v4.5h-2ZM18 4l1.5 1.5-1.6 1.6-1.5-1.5Z";
    case "lantern":
      return "M10 2h4v2h-4ZM8 5h8l1.5 3v8L16 20H8l-1.5-4V8ZM9.5 8l-1 2v5l1 3h5l1-3v-5l-1-2Zm1.5 2h2v6h-2Zm-1 11h4v1h-4Z";
    case "hourglass":
      return "M5 2h14v2.5l-1 1.5-4 5 4 5 1 1.5V22H5v-2.5l1-1.5 4-5-4-5-1-1.5Zm2.5 2.5v.5l4 5h1l4-5v-.5Zm4 10-4 5v.5h9v-.5l-4-5Z";
    case "wrench":
      return "M21.5 6.5a5.5 5.5 0 0 1-7.2 5.2L6.5 19.5a2.1 2.1 0 0 1-3-3l7.8-7.8A5.5 5.5 0 0 1 17.5 1.5l-3 3 .8 2.2 2.2.8 3-3c.6.6 1 1.3 1 2Z";
    default:
      return "M3 3h8l10 10-8 8L3 11Zm4.5 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z";
  }
}
