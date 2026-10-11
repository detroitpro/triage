import type { QualityChoice } from "../pure/quality.ts";

export interface Settings {
  /** Render quality tier; "auto" picks from the GPU. Applies on reload (MSAA is per context). */
  quality: QualityChoice;
  fov: number;
  sensitivity: number;
  reducedMotion: boolean;
  /** UI text scale multiplier, 0.85..1.4. */
  textScale: number;
}

const KEY = "triage:settings";
export const DEFAULT_SETTINGS: Settings = {
  quality: "auto",
  fov: 75,
  sensitivity: 1,
  reducedMotion: false,
  textScale: 1,
};

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

export function loadSettings(): Settings {
  let s: Settings;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    s = {
      quality: parsed.quality === "low" || parsed.quality === "high" ? parsed.quality : "auto",
      fov: num(parsed.fov, DEFAULT_SETTINGS.fov, 50, 110),
      sensitivity: num(parsed.sensitivity, DEFAULT_SETTINGS.sensitivity, 0.2, 3),
      reducedMotion: Boolean(parsed.reducedMotion),
      textScale: num(parsed.textScale, DEFAULT_SETTINGS.textScale, 0.85, 1.4),
    };
  } catch {
    s = { ...DEFAULT_SETTINGS };
  }
  applyTextScale(s.textScale);
  return s;
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

/** Push the text scale into CSS so every HUD and overlay font follows it. */
export function applyTextScale(scale: number): void {
  document.documentElement.style.setProperty("--ui-scale", String(scale));
}

interface RangeSpec {
  id: keyof Settings;
  name: string;
  desc: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
}

const RANGES: RangeSpec[] = [
  {
    id: "fov",
    name: "Field of view",
    desc: "Wider sees more of the region; narrower feels calmer.",
    min: 50,
    max: 110,
    step: 1,
    fmt: (v) => `${v}°`,
  },
  {
    id: "sensitivity",
    name: "Look sensitivity",
    desc: "Mouse turn speed.",
    min: 0.2,
    max: 3,
    step: 0.1,
    fmt: (v) => `${v.toFixed(1)}×`,
  },
  {
    id: "textScale",
    name: "Text size",
    desc: "Scales the HUD, map and dialogue text.",
    min: 0.85,
    max: 1.4,
    step: 0.05,
    fmt: (v) => `${Math.round(v * 100)}%`,
  },
];

/** Render the settings panel into `root`; `onChange` fires on every edit. */
export function mountSettings(
  root: HTMLElement,
  settings: Settings,
  onChange: (s: Settings) => void,
  /** The tier "auto" resolved to on this machine, shown next to the choice. */
  autoTier = "",
): void {
  const rows = RANGES.map(
    (r) => `<label class="setting">
      <span class="name">${r.name}</span>
      <span class="value num" id="s-${r.id}-v">${r.fmt(Number(settings[r.id]))}</span>
      <input type="range" id="s-${r.id}" min="${r.min}" max="${r.max}" step="${r.step}" value="${String(settings[r.id])}" />
      <span class="desc">${r.desc}</span>
    </label>`,
  ).join("");
  root.innerHTML = `
    <div class="panel">
      <h2>Settings</h2>
      <label class="setting">
        <span class="name">Quality</span>
        <span class="value"><select id="s-quality">
          <option value="auto" ${settings.quality === "auto" ? "selected" : ""}>Auto${autoTier ? ` (${autoTier})` : ""}</option>
          <option value="low" ${settings.quality === "low" ? "selected" : ""}>Low</option>
          <option value="high" ${settings.quality === "high" ? "selected" : ""}>High</option>
        </select></span>
        <span class="desc">Low renders at a lower resolution that adapts to hold 60 fps.
          <button type="button" id="s-quality-apply" class="apply" hidden>Apply and reload</button></span>
      </label>
      ${rows}
      <label class="setting">
        <span class="name">Reduced motion</span>
        <span class="switch"><input type="checkbox" id="s-rm" ${settings.reducedMotion ? "checked" : ""} /></span>
        <span class="desc">No head bob, landing dip or sprint zoom. NPCs stop idling.</span>
      </label>
      <p class="muted"><span class="keycap">P</span> or <span class="keycap">Esc</span> closes.</p>
    </div>`;
  const rm = root.querySelector<HTMLInputElement>("#s-rm");
  const inputs = RANGES.map((r) => ({
    spec: r,
    input: root.querySelector<HTMLInputElement>(`#s-${r.id}`),
    value: root.querySelector<HTMLElement>(`#s-${r.id}-v`),
  }));
  const emit = () => {
    for (const { spec, input, value } of inputs) {
      const v = Number(input?.value ?? settings[spec.id]);
      if (spec.id === "fov") settings.fov = v;
      else if (spec.id === "sensitivity") settings.sensitivity = v;
      else if (spec.id === "textScale") settings.textScale = v;
      if (value) value.textContent = spec.fmt(v);
    }
    settings.reducedMotion = Boolean(rm?.checked);
    applyTextScale(settings.textScale);
    saveSettings(settings);
    onChange(settings);
  };
  const quality = root.querySelector<HTMLSelectElement>("#s-quality");
  // A change only takes effect on reload (MSAA is per context), so it waits for Apply:
  // arrow keys on a closed select fire "change" on every step.
  const apply = root.querySelector<HTMLButtonElement>("#s-quality-apply");
  quality?.addEventListener("change", () => {
    if (apply) apply.hidden = quality.value === settings.quality;
  });
  apply?.addEventListener("click", () => {
    const v = quality?.value;
    settings.quality = v === "low" || v === "high" ? v : "auto";
    saveSettings(settings);
    window.location.reload();
  });
  for (const { input } of inputs) input?.addEventListener("input", emit);
  rm?.addEventListener("change", emit);
}
