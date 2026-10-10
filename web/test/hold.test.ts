import { describe, expect, it } from "vitest";
import { HOLD_MS, HoldTracker, holdDone, holdProgress } from "../src/pure/hold.ts";

describe("hold-to-confirm", () => {
  it("fills over 700 ms and completes only after the full hold", () => {
    const h = new HoldTracker();
    expect(h.press("Release #161", "KeyR", 1000)).toBe(true);
    expect(h.progress(1000)).toBe(0);
    expect(h.progress(1350)).toBeCloseTo(0.5, 5);
    expect(h.poll(1699)).toBeNull();
    expect(h.progress(1699)).toBeLessThan(1);
    const done = h.poll(1000 + HOLD_MS);
    expect(done?.label).toBe("Release #161");
    expect(h.current).toBeNull();
  });

  it("cancels when released early", () => {
    const h = new HoldTracker();
    h.press("Give bug to #3", "KeyG", 0);
    expect(h.release("KeyG")).toBe(true);
    expect(h.poll(HOLD_MS + 10)).toBeNull();
    expect(h.progress(HOLD_MS)).toBe(0);
  });

  it("ignores key repeat and re-presses while held", () => {
    const h = new HoldTracker();
    h.press("x", "KeyG", 0);
    expect(h.press("x", "KeyG", 500, { repeat: true })).toBe(false);
    expect(h.press("x", "KeyG", 500)).toBe(false);
    expect(h.current?.startedAt).toBe(0);
    expect(h.poll(HOLD_MS)).not.toBeNull();
  });

  it("a repeat event alone never starts a hold", () => {
    const h = new HoldTracker();
    expect(h.press("x", "KeyG", 0, { repeat: true })).toBe(false);
    expect(h.current).toBeNull();
  });

  it("releasing a different key does not cancel", () => {
    const h = new HoldTracker();
    h.press("x", "KeyG", 0);
    expect(h.release("KeyT")).toBe(false);
    expect(h.current).not.toBeNull();
    expect(h.release()).toBe(true);
  });

  it("reduced motion is linear but still requires the hold", () => {
    const hold = { label: "x", key: "KeyG", startedAt: 0, duration: 700, reduced: true };
    expect(holdProgress(hold, 175)).toBeCloseTo(0.25, 5);
    expect(holdProgress(hold, 350)).toBeCloseTo(0.5, 5);
    expect(holdDone(hold, 699)).toBe(false);
    expect(holdDone(hold, 700)).toBe(true);
    const eased = { ...hold, reduced: false };
    expect(holdProgress(eased, 175)).toBeCloseTo(0.125, 5);
    expect(holdProgress(eased, 700)).toBe(1);
  });
});
