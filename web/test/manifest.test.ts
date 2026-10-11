import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type AssetManifest, validateManifest } from "../src/pure/manifest.ts";

const ASSETS = resolve(import.meta.dirname, "..", "public", "assets");
const sizeOf = (file: string) => {
  try {
    return statSync(resolve(ASSETS, file)).size;
  } catch {
    return null;
  }
};

describe("checked-in asset manifest", () => {
  it("is valid, complete, and within the budget", () => {
    const m = JSON.parse(readFileSync(resolve(ASSETS, "manifest.json"), "utf8")) as AssetManifest;
    expect(validateManifest(m, sizeOf)).toEqual([]);
  });
});

describe("validateManifest", () => {
  const asset = {
    id: "npc-villager",
    kind: "character" as const,
    form: "villager" as const,
    file: "npc/villager.glb",
    bytes: 100,
    triangles: 8000,
    height: 1.8,
    clips: { idle: "Idle" },
    provenance: {
      provider: "tripo",
      taskIds: ["t1"],
      prompt: "stylized villager",
      terms: "https://example.com/terms",
      generatedAt: "2026-10-11",
    },
  };

  it("accepts a complete entry", () => {
    expect(validateManifest({ version: 1, assets: [asset] }, () => 100)).toEqual([]);
  });

  it("flags missing files, size drift, missing terms, and the budget", () => {
    const errs = validateManifest(
      {
        version: 1,
        assets: [{ ...asset, provenance: { ...asset.provenance, terms: "" } }],
      },
      () => null,
    );
    expect(errs.join("\n")).toMatch(/missing/);
    expect(errs.join("\n")).toMatch(/terms/);
    expect(validateManifest({ version: 1, assets: [asset] }, () => 99).join()).toMatch(/bytes/);
    expect(
      validateManifest({ version: 1, assets: [{ ...asset, bytes: 30e6 }] }, () => 30e6).join(),
    ).toMatch(/budget/);
  });

  it("allows one character per form", () => {
    const two = validateManifest({ version: 1, assets: [asset, { ...asset, id: "b" }] }, () => 100);
    expect(two.join()).toMatch(/second character/);
  });
});
