import { describe, expect, it } from "vitest";
import {
  approach,
  easeOutBack,
  easeOutCubic,
  linear,
  pulse,
  TweenManager,
} from "../src/pure/tween.ts";

describe("TweenManager", () => {
  it("runs a tween to completion with eased values and fires onComplete once", () => {
    const m = new TweenManager();
    const seen: number[] = [];
    let done = 0;
    m.tween(
      1,
      (v) => seen.push(v),
      linear,
      () => done++,
    );
    m.update(0.25);
    m.update(0.25);
    m.update(0.6);
    expect(seen).toEqual([0.25, 0.5, 1]);
    expect(done).toBe(1);
    expect(m.size).toBe(0);
    m.update(1);
    expect(done).toBe(1);
  });

  it("applies the easing curve", () => {
    const m = new TweenManager();
    let last = -1;
    m.tween(1, (v) => {
      last = v;
    });
    m.update(0.5);
    expect(last).toBeCloseTo(easeOutCubic(0.5));
  });

  it("cancels without firing onComplete", () => {
    const m = new TweenManager();
    let done = 0;
    const h = m.tween(
      1,
      () => {},
      linear,
      () => done++,
    );
    h.cancel();
    expect(h.done).toBe(true);
    m.update(2);
    expect(done).toBe(0);
    expect(m.size).toBe(0);
  });

  it("runs several tweens independently", () => {
    const m = new TweenManager();
    const a: number[] = [];
    const b: number[] = [];
    m.tween(0.5, (v) => a.push(v), linear);
    m.tween(1, (v) => b.push(v), linear);
    m.update(0.5);
    expect(a.at(-1)).toBe(1);
    expect(b.at(-1)).toBe(0.5);
    expect(m.size).toBe(1);
  });
});

describe("easing", () => {
  it("curves start at 0 and end at 1", () => {
    for (const e of [linear, easeOutCubic, easeOutBack]) {
      expect(e(0)).toBeCloseTo(0);
      expect(e(1)).toBeCloseTo(1);
    }
  });
  it("easeOutBack overshoots past 1", () => {
    expect(easeOutBack(0.8)).toBeGreaterThan(1);
  });
  it("pulse rises to 1 at the peak and returns to 0", () => {
    const p = pulse(0.3);
    expect(p(0)).toBeCloseTo(0);
    expect(p(0.3)).toBeCloseTo(1);
    expect(p(1)).toBeCloseTo(0);
  });
});

describe("approach", () => {
  it("closes ~63% of the gap after one time constant", () => {
    expect(approach(0, 10, 0.2, 0.2)).toBeCloseTo(10 * (1 - Math.exp(-1)), 5);
  });
  it("is frame-rate independent", () => {
    let a = 0;
    for (let i = 0; i < 10; i++) a = approach(a, 1, 0.01, 0.1);
    const b = approach(0, 1, 0.1, 0.1);
    expect(a).toBeCloseTo(b, 6);
  });
  it("snaps when tau is zero", () => {
    expect(approach(3, 7, 0.016, 0)).toBe(7);
  });
});
