// Quality tiers and dynamic resolution (charter "Look", performance). Pure: no DOM, no three.

export type QualityChoice = "auto" | "low" | "high";
export type Tier = "low" | "high";

export interface QualityProfile {
  tier: Tier;
  /** Device pixel ratio cap before dynamic scaling. */
  maxDpr: number;
  /** Dynamic resolution range, as a fraction of the capped DPR. */
  minScale: number;
  maxScale: number;
  /** MSAA. A WebGL context attribute: changing it needs a reload. */
  antialias: boolean;
  shadowMapSize: number;
}

export const PROFILES: Record<Tier, QualityProfile> = {
  low: {
    tier: "low",
    maxDpr: 1,
    minScale: 0.6,
    maxScale: 1,
    antialias: false,
    shadowMapSize: 1024,
  },
  high: {
    tier: "high",
    maxDpr: 2,
    minScale: 0.75,
    maxScale: 1,
    antialias: true,
    shadowMapSize: 2048,
  },
};

/** Integrated, mobile, and software GPUs start on the low tier. */
const LOW_GPU =
  /intel|mali|adreno|powervr|videocore|llvmpipe|swiftshader|software|microsoft basic/i;

/** Tier for "auto": from the unmasked WebGL renderer string, when the browser exposes one. */
export function detectTier(renderer: string | null): Tier {
  if (!renderer) return "low";
  return LOW_GPU.test(renderer) ? "low" : "high";
}

export function resolveTier(choice: QualityChoice, renderer: string | null): Tier {
  return choice === "auto" ? detectTier(renderer) : choice;
}

/** Frame budget the controller holds, in ms (60 fps). */
export const TARGET_MS = 1000 / 60;

/**
 * Dynamic resolution: lowers the render scale when frames run over budget and probes back
 * up when they have stayed on budget for a while. With vsync, a frame that misses 16.7 ms
 * shows as 33 ms, so "over" is easy to see; headroom is not, hence the slow upward probe
 * that backs off after a probe fails.
 */
export class DynamicResolution {
  scale: number;
  private ema = TARGET_MS;
  private overFor = 0;
  private okFor = 0;
  private probeWait: number;
  private sinceProbe = Number.POSITIVE_INFINITY;

  constructor(
    private readonly min: number,
    private readonly max: number,
    /** Seconds on budget before trying a higher scale; doubles after each failed probe. */
    private readonly probeAfter = 4,
    private readonly step = 0.05,
  ) {
    this.scale = max;
    this.probeWait = probeAfter;
  }

  /** The scene changed (new area): forget the probe back-off. */
  reset(): void {
    this.probeWait = this.probeAfter;
    this.overFor = 0;
    this.okFor = 0;
  }

  /** Feed one frame's duration in ms. Returns true when `scale` changed. */
  update(frameMs: number): boolean {
    // Ignore stalls (tab switch, area build); they say nothing about steady-state cost.
    if (frameMs > 250) return false;
    this.ema += (frameMs - this.ema) * 0.1;
    const dt = frameMs / 1000;
    this.sinceProbe += dt;
    if (this.ema > TARGET_MS * 1.15) {
      this.overFor += dt;
      this.okFor = 0;
    } else {
      this.overFor = 0;
      this.okFor += dt;
    }
    if (this.overFor > 0.5 && this.scale > this.min) {
      // A drop right after a probe means the probe failed: undo it and wait longer next time.
      const failedProbe = this.sinceProbe < 2;
      if (failedProbe) this.probeWait = Math.min(this.probeWait * 2, 120);
      this.scale = Math.max(this.min, round(this.scale - this.step * (failedProbe ? 1 : 2)));
      this.overFor = 0;
      this.ema = TARGET_MS;
      return true;
    }
    if (this.okFor > this.probeWait && this.scale < this.max) {
      this.scale = Math.min(this.max, round(this.scale + this.step));
      this.okFor = 0;
      this.sinceProbe = 0;
      return true;
    }
    return false;
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
