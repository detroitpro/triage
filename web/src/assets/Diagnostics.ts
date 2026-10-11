import * as THREE from "three";

/**
 * Renderer diagnostics for the QA inspector and the debug console. Published on
 * `window.__THREE_GAME_DIAGNOSTICS__` (what inspect-threejs-canvas.mjs reads) and, when
 * game.ts has installed it, as `window.__triage.diagnostics`.
 */
export interface RendererDiagnostics {
  renderer: {
    calls: number;
    triangles: number;
    points: number;
    lines: number;
    geometries: number;
    textures: number;
    programs: number;
  };
  frame: number;
  dpr: number;
  shadowMap: { enabled: boolean; size: number; casters: number };
  toneMapping: string;
  exposure: number;
  lights: { point: number; directional: number; hemisphere: number };
  area: string;
  updatedAt: number;
}

const TONE_NAMES: Record<number, string> = {
  [THREE.NoToneMapping]: "none",
  [THREE.LinearToneMapping]: "linear",
  [THREE.ReinhardToneMapping]: "reinhard",
  [THREE.CineonToneMapping]: "cineon",
  [THREE.ACESFilmicToneMapping]: "aces",
  [THREE.AgXToneMapping]: "agx",
  [THREE.NeutralToneMapping]: "neutral",
};

interface State {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene | null;
  area: string;
  shadowSize: number;
  last: RendererDiagnostics | null;
  running: boolean;
}

let state: State | null = null;

/** Snapshot `renderer.info` right now. Call between frames for a complete count. */
export function readDiagnostics(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene | null,
  area: string,
  shadowSize: number,
): RendererDiagnostics {
  const info = renderer.info;
  let point = 0;
  let directional = 0;
  let hemisphere = 0;
  let casters = 0;
  scene?.traverse((o) => {
    if (o instanceof THREE.PointLight) point++;
    else if (o instanceof THREE.DirectionalLight) {
      directional++;
      if (o.castShadow) casters++;
    } else if (o instanceof THREE.HemisphereLight) hemisphere++;
  });
  return {
    renderer: {
      calls: info.render.calls,
      triangles: info.render.triangles,
      points: info.render.points,
      lines: info.render.lines,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
    },
    frame: info.render.frame,
    dpr: renderer.getPixelRatio(),
    shadowMap: { enabled: renderer.shadowMap.enabled, size: shadowSize, casters },
    toneMapping: TONE_NAMES[renderer.toneMapping] ?? String(renderer.toneMapping),
    exposure: renderer.toneMappingExposure,
    lights: { point, directional, hemisphere },
    area,
    updatedAt: performance.now(),
  };
}

function publish(d: RendererDiagnostics): void {
  const w = window as unknown as {
    __THREE_GAME_DIAGNOSTICS__?: RendererDiagnostics;
    __triage?: { diagnostics?: RendererDiagnostics };
  };
  w.__THREE_GAME_DIAGNOSTICS__ = d;
  if (w.__triage) w.__triage.diagnostics = d;
}

/**
 * Start (or retarget) the diagnostics poller. Runs on its own rAF so it reads
 * `renderer.info` between frames: before the next render resets it, after the last
 * one finished. Cheap: one snapshot every ~20 frames.
 */
export function installDiagnostics(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene | null,
  area: string,
  shadowSize: number,
): void {
  if (state && state.renderer === renderer) {
    state.scene = scene;
    state.area = area;
    state.shadowSize = shadowSize;
    return;
  }
  const s: State = { renderer, scene, area, shadowSize, last: null, running: true };
  state = s;
  let frames = 0;
  const tick = () => {
    if (state !== s) return;
    frames++;
    if (frames % 20 === 1) {
      s.last = readDiagnostics(s.renderer, s.scene, s.area, s.shadowSize);
      publish(s.last);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function lastDiagnostics(): RendererDiagnostics | null {
  return state?.last ?? null;
}
