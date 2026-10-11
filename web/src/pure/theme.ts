// Biome palette → UI theme variables. Pure color math; the HUD applies the result
// as CSS custom properties so the interface carries the world's mood.

export type Rgb = [number, number, number];

export interface ThemeSource {
  sky: string;
  palette: { ground: string; wall: string; accent: string };
}

export function parseHex(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return [128, 128, 128];
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: Rgb): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear blend of two colors; t = 0 gives `a`, t = 1 gives `b`. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** Relative luminance, 0..1 (WCAG). */
export function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const INK_DARK: Rgb = [13, 16, 22];
const INK_LIGHT: Rgb = [244, 246, 248];
const PANEL_BASE: Rgb = [9, 11, 16];

/** Text color that reads on `bg`. */
export function readableOn(bg: Rgb): Rgb {
  return contrast(bg, INK_DARK) >= contrast(bg, INK_LIGHT) ? INK_DARK : INK_LIGHT;
}

/** Lift a color until it reads as text on the dark panel. */
export function ensureLuminous(c: Rgb, min = 0.35): Rgb {
  let out = c;
  for (let i = 0; i < 12 && luminance(out) < min; i += 1) out = mix(out, INK_LIGHT, 0.15);
  return out;
}

function rgba(c: Rgb, a: number): string {
  return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`;
}

/**
 * Build the CSS variable set for a biome. Keys are custom property names.
 * Panels are the sky tinted toward near-black so a meadow HUD is slate-blue and
 * a dungeon HUD is near-black; the accent is lifted until it reads on that panel.
 */
export function themeVars(src: ThemeSource): Record<string, string> {
  const sky = parseHex(src.sky);
  const ground = parseHex(src.palette.ground);
  const wall = parseHex(src.palette.wall);
  const accentRaw = parseHex(src.palette.accent);
  const panel = mix(sky, PANEL_BASE, 0.84);
  const panelStrong = mix(sky, PANEL_BASE, 0.9);
  const accent = ensureLuminous(accentRaw, 0.3);
  const accentInk = readableOn(accent);
  const edge = mix(sky, INK_LIGHT, 0.45);
  const groundLift = ensureLuminous(ground, 0.12);
  const skyLift = ensureLuminous(sky, 0.25);
  return {
    "--sky": toHex(sky),
    "--sky-lift": toHex(skyLift),
    "--ground": toHex(ground),
    "--ground-lift": toHex(groundLift),
    "--wall": toHex(wall),
    "--accent": toHex(accent),
    "--accent-raw": toHex(accentRaw),
    "--accent-ink": toHex(accentInk),
    "--accent-soft": rgba(accent, 0.22),
    "--accent-glow": rgba(accent, 0.55),
    "--panel": rgba(panel, 0.86),
    "--panel-solid": toHex(panel),
    "--panel-strong": rgba(panelStrong, 0.94),
    "--edge": rgba(edge, 0.34),
    "--edge-strong": rgba(edge, 0.7),
    "--fg": toHex(INK_LIGHT),
    "--muted": rgba(mix(INK_LIGHT, sky, 0.35), 0.72),
  };
}
