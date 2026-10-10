// Dependency-free tween manager and easing curves (see the game-feel reference).
// Drive it with the real render delta so feedback stays live.

export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;
export const easeInQuad: Easing = (t) => t * t;
export const easeOutQuad: Easing = (t) => 1 - (1 - t) * (1 - t);
export const easeOutCubic: Easing = (t) => 1 - (1 - t) ** 3;
export const easeInOutCubic: Easing = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOutBack: Easing = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

/** A brief dip or pull: 0 → 1 → 0, peaking at `peak` (0..1). */
export function pulse(peak = 0.3): Easing {
  return (t) => (t < peak ? easeOutQuad(t / peak) : 1 - easeInOutCubic((t - peak) / (1 - peak)));
}

interface ActiveTween {
  elapsed: number;
  duration: number;
  easing: Easing;
  onUpdate: (value: number) => void;
  onComplete: (() => void) | undefined;
  cancelled: boolean;
}

export interface TweenHandle {
  cancel(): void;
  readonly done: boolean;
}

export class TweenManager {
  private tweens: ActiveTween[] = [];

  get size(): number {
    return this.tweens.length;
  }

  tween(
    durationSec: number,
    onUpdate: (value: number) => void,
    easing: Easing = easeOutCubic,
    onComplete?: () => void,
  ): TweenHandle {
    const t: ActiveTween = {
      elapsed: 0,
      duration: Math.max(1e-6, durationSec),
      easing,
      onUpdate,
      onComplete,
      cancelled: false,
    };
    this.tweens.push(t);
    return {
      cancel: () => {
        t.cancelled = true;
      },
      get done() {
        return t.cancelled || t.elapsed >= t.duration;
      },
    };
  }

  update(delta: number): void {
    for (let i = this.tweens.length - 1; i >= 0; i -= 1) {
      const t = this.tweens[i];
      if (!t) continue;
      if (t.cancelled) {
        this.tweens.splice(i, 1);
        continue;
      }
      t.elapsed += delta;
      const k = Math.min(t.elapsed / t.duration, 1);
      t.onUpdate(t.easing(k));
      if (t.elapsed >= t.duration) {
        t.onComplete?.();
        this.tweens.splice(i, 1);
      }
    }
  }

  cancelAll(): void {
    this.tweens = [];
  }
}

/**
 * Frame-rate independent exponential approach: moves `current` toward `target`
 * with time constant `tau` seconds. After `tau` seconds ~63% of the gap is closed.
 */
export function approach(current: number, target: number, dt: number, tau: number): number {
  if (tau <= 0) return target;
  return target + (current - target) * Math.exp(-dt / tau);
}
