import { describe, expect, it } from "vitest";
import { decide } from "../src/route.ts";
import { fakeAssessment } from "./helpers.ts";

describe("decide", () => {
  it("queues a confident, actionable item", () => {
    const d = decide(fakeAssessment({ kind: "bug", urgency: 3 }));
    expect(d.route).toBe("queue");
    expect(d.urgent).toBe(true);
  });

  it("sends low-confidence classifications to a human", () => {
    expect(decide(fakeAssessment({ confidence: 0.4 })).route).toBe("human");
  });

  it("checks confidence before noise, so uncertain noise is not auto-closed", () => {
    expect(decide(fakeAssessment({ kind: "noise", confidence: 0.4 })).route).toBe("human");
  });

  it("closes confident noise", () => {
    expect(decide(fakeAssessment({ kind: "noise" })).route).toBe("close");
  });

  it("asks for more detail when the item is not actionable", () => {
    expect(decide(fakeAssessment({ actionable: 0.2 })).route).toBe("needs-info");
  });

  it("does not flag low urgency", () => {
    expect(decide(fakeAssessment({ urgency: 1 })).urgent).toBe(false);
  });
});
