export interface Settings {
  fov: number;
  sensitivity: number;
  reducedMotion: boolean;
  /** UI text scale multiplier, 0.85..1.4. */
  textScale: number;
}

const KEY = "triage:settings";
export const DEFAULT_SETTINGS: Settings = {
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
  for (const { input } of inputs) input?.addEventListener("input", emit);
  rm?.addEventListener("change", emit);
}
