import { describe, expect, it } from "vitest";
import {
  describeAction,
  localIntent,
  offerFor,
  offlineResult,
  rewindRemaining,
} from "../src/pure/actions.ts";

describe("action names", () => {
  it("uses the physical verb", () => {
    expect(
      describeAction({ type: "label-add", issue: 161, payload: { label: "context:analysis" } }),
    ).toBe("Give context:analysis to #161");
    expect(describeAction({ type: "label-remove", issue: 3, payload: { label: "bug" } })).toBe(
      "Take bug from #3",
    );
    expect(describeAction({ type: "comment", issue: 3, payload: { text: "hi" } })).toBe(
      "Say it to #3",
    );
    expect(describeAction({ type: "close", issue: 161, payload: { reason: "completed" } })).toBe(
      "Release #161",
    );
    expect(describeAction({ type: "close", issue: 9, payload: { reason: "not_planned" } })).toBe(
      "Send #9 through the hourglass",
    );
  });

  it("offline results are never applied", () => {
    const r = offlineResult({ type: "close", issue: 1, payload: { reason: "completed" } }, 3);
    expect(r).toMatchObject({ ok: true, mode: "dry-run", applied: false, undoId: "offline-3" });
  });
});

describe("rewind window", () => {
  it("drains from 1 to 0 over 30 s", () => {
    expect(rewindRemaining(0, 0)).toBe(1);
    expect(rewindRemaining(0, 15_000)).toBeCloseTo(0.5, 5);
    expect(rewindRemaining(0, 30_000)).toBe(0);
    expect(rewindRemaining(0, 40_000)).toBe(0);
  });
});

describe("offers", () => {
  it("turns act/confirm label intents into give", () => {
    expect(offerFor({ choice: "label", confidence: 0.9, band: "act", label: "bug" })).toEqual({
      kind: "give",
      label: "bug",
    });
    expect(offerFor({ choice: "label", confidence: 0.6, band: "confirm" })).toEqual({
      kind: "wheel",
    });
  });

  it("turns verify/close into release and everything else into the wheel", () => {
    expect(offerFor({ choice: "verify", confidence: 0.8, band: "confirm" })).toEqual({
      kind: "release",
    });
    expect(offerFor({ choice: "close", confidence: 0.9, band: "act" })).toEqual({
      kind: "release",
    });
    expect(offerFor({ choice: "verify", confidence: 0.3, band: "ask" })).toEqual({ kind: "wheel" });
    expect(offerFor({ choice: "comment", confidence: 0.9, band: "act" })).toEqual({
      kind: "wheel",
    });
    expect(offerFor(undefined)).toEqual({ kind: "wheel" });
  });
});

describe("offline intent", () => {
  it("reads only unmistakable verbs", () => {
    expect(localIntent("close")).toMatchObject({ choice: "verify", band: "confirm" });
    expect(localIntent("Release this one")).toMatchObject({ choice: "verify" });
    expect(localIntent("add label context:analysis", ["context:Analysis"])).toMatchObject({
      choice: "label",
      label: "context:Analysis",
      band: "confirm",
    });
    expect(localIntent("tag bug")).toMatchObject({ choice: "label", label: "bug" });
    expect(localIntent("later")).toMatchObject({ choice: "defer", band: "ask" });
    expect(localIntent("why does this happen?")).toMatchObject({ choice: "need_more" });
    expect(localIntent("I think the cookie is fine")).toMatchObject({
      choice: "comment",
      band: "ask",
    });
  });
});

describe("take offers", () => {
  it("offers take when the intent says remove", () => {
    expect(
      offerFor({ choice: "label", confidence: 0.9, band: "act", label: "bug", remove: true }),
    ).toEqual({ kind: "take", label: "bug" });
  });
});
