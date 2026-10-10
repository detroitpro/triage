import { describe, expect, it } from "vitest";
import { parseItem } from "../src/item.ts";

describe("parseItem", () => {
  it("treats plain text as the body", () => {
    expect(parseItem("  the app crashes  ")).toEqual({ body: "the app crashes" });
  });

  it("reads JSON items", () => {
    expect(parseItem('{"title":"t","body":"b","source":"github","extra":1}')).toEqual({
      title: "t",
      body: "b",
      source: "github",
    });
  });

  it("rejects JSON without a body", () => {
    expect(() => parseItem('{"title":"t"}')).toThrow(/body/);
  });

  it("rejects empty input", () => {
    expect(() => parseItem("   ")).toThrow(/empty/);
  });
});
