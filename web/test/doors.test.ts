import { describe, expect, it } from "vitest";
import type { Door } from "../../src/world/types.ts";
import { findTriggeredDoor, rearmDoors } from "../src/pure/doors.ts";

const open: Door = {
  id: "a->b",
  from: "a",
  to: "b",
  kind: "door",
  position: [10, 0, 10],
  facing: 0,
  edgeType: "depends-on",
};
const locked: Door = {
  ...open,
  id: "a->c",
  to: "c",
  position: [20, 0, 10],
  locked: { by: 12, title: "x" },
};
const doors = [open, locked];

describe("door triggers", () => {
  it("fires when an armed door is within 1.5 units", () => {
    const armed = new Set(["a->b", "a->c"]);
    expect(findTriggeredDoor([11, 1.7, 10], doors, armed)?.to).toBe("b");
    expect(findTriggeredDoor([12, 1.7, 10], doors, armed)).toBeNull();
  });

  it("never fires a locked door", () => {
    expect(findTriggeredDoor([20, 1.7, 10], doors, new Set(["a->c"]))).toBeNull();
  });

  it("does not fire until the player has left the radius once", () => {
    let armed: Set<string> = new Set();
    expect(findTriggeredDoor([10, 1.7, 10], doors, armed)).toBeNull();
    armed = rearmDoors([10, 1.7, 10], doors, armed);
    expect(armed.has("a->b")).toBe(false);
    armed = rearmDoors([10, 1.7, 14], doors, armed);
    expect(armed.has("a->b")).toBe(true);
    expect(findTriggeredDoor([10, 1.7, 10.5], doors, armed)?.id).toBe("a->b");
  });
});
