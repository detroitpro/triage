export interface Settings {
  fov: number;
  sensitivity: number;
  reducedMotion: boolean;
}

const KEY = "triage:settings";
export const DEFAULT_SETTINGS: Settings = { fov: 75, sensitivity: 1, reducedMotion: false };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      fov: typeof parsed.fov === "number" ? parsed.fov : DEFAULT_SETTINGS.fov,
      sensitivity:
        typeof parsed.sensitivity === "number" ? parsed.sensitivity : DEFAULT_SETTINGS.sensitivity,
      reducedMotion: Boolean(parsed.reducedMotion),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

/** Render the settings panel into `root`; `onChange` fires on every edit. */
export function mountSettings(
  root: HTMLElement,
  settings: Settings,
  onChange: (s: Settings) => void,
): void {
  root.innerHTML = `
    <div class="panel">
      <h2>Settings</h2>
      <label class="setting">Field of view <input type="range" id="s-fov" min="50" max="110" step="1" value="${settings.fov}" /> <span id="s-fov-v">${settings.fov}</span></label>
      <label class="setting">Mouse sensitivity <input type="range" id="s-sens" min="0.2" max="3" step="0.1" value="${settings.sensitivity}" /> <span id="s-sens-v">${settings.sensitivity.toFixed(1)}</span></label>
      <label class="setting"><input type="checkbox" id="s-rm" ${settings.reducedMotion ? "checked" : ""} /> Reduced motion (no head bob)</label>
      <p class="muted">Press P or Esc to close.</p>
    </div>`;
  const fov = root.querySelector<HTMLInputElement>("#s-fov");
  const sens = root.querySelector<HTMLInputElement>("#s-sens");
  const rm = root.querySelector<HTMLInputElement>("#s-rm");
  const fovV = root.querySelector<HTMLElement>("#s-fov-v");
  const sensV = root.querySelector<HTMLElement>("#s-sens-v");
  const emit = () => {
    settings.fov = Number(fov?.value ?? settings.fov);
    settings.sensitivity = Number(sens?.value ?? settings.sensitivity);
    settings.reducedMotion = Boolean(rm?.checked);
    if (fovV) fovV.textContent = String(settings.fov);
    if (sensV) sensV.textContent = settings.sensitivity.toFixed(1);
    saveSettings(settings);
    onChange(settings);
  };
  fov?.addEventListener("input", emit);
  sens?.addEventListener("input", emit);
  rm?.addEventListener("change", emit);
}
