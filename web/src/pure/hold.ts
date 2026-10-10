// Hold-to-confirm: a ring fills while a key is held; releasing early cancels. This is the
// charter's confirmation step, so the duration is never skipped: reduced motion removes the
// easing, not the hold. Time is injected (ms) so tests do not sleep.

export const HOLD_MS = 700;

export interface Hold {
  /** Action name shown beside the ring, e.g. "Give context:analysis to #161". */
  label: string;
  /** Which input holds it: a KeyboardEvent.code or "pointer". */
  key: string;
  startedAt: number;
  duration: number;
  reduced: boolean;
}

export const easeInOutQuad = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

/** Ring fill 0..1. Eased unless reduced motion; reaches 1 only once the full duration has passed. */
export function holdProgress(h: Hold, now: number): number {
  const raw = Math.max(0, Math.min(1, (now - h.startedAt) / h.duration));
  return h.reduced ? raw : easeInOutQuad(raw);
}

export function holdDone(h: Hold, now: number): boolean {
  return now - h.startedAt >= h.duration;
}

/**
 * Tracks one hold at a time. `press` ignores key-repeat events and presses while a hold is
 * already running, so auto-repeat can never advance or restart the ring.
 */
export class HoldTracker {
  current: Hold | null = null;

  press(
    label: string,
    key: string,
    now: number,
    opts: { reduced?: boolean; repeat?: boolean; duration?: number } = {},
  ): boolean {
    if (opts.repeat || this.current) return false;
    this.current = {
      label,
      key,
      startedAt: now,
      duration: opts.duration ?? HOLD_MS,
      reduced: opts.reduced ?? false,
    };
    return true;
  }

  /** Release the named input (or any, when omitted). Returns true if a hold was cancelled. */
  release(key?: string): boolean {
    if (!this.current) return false;
    if (key !== undefined && this.current.key !== key) return false;
    this.current = null;
    return true;
  }

  progress(now: number): number {
    return this.current ? holdProgress(this.current, now) : 0;
  }

  /** Returns the completed hold once, then clears it. */
  poll(now: number): Hold | null {
    const h = this.current;
    if (!h || !holdDone(h, now)) return null;
    this.current = null;
    return h;
  }
}
