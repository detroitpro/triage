// The asset manifest (charter "Look": generated assets are checked in with a manifest).
// Pure: the shape, the budget, and validation; tests run it over web/public/assets.

import type { NpcForm } from "../../../src/world/types.ts";

/** Total size of the assets in the manifest, in bytes (charter decision: ~20 MB). The test
 * also requires every file under web/public/assets to be listed, so nothing bypasses it. */
export const ASSET_BUDGET_BYTES = 20 * 1024 * 1024;

export interface AssetProvenance {
  /** "tripo", "gemini", "procedural", or "hand". */
  provider: string;
  /** Provider task IDs, in pipeline order (model, rig, animations). */
  taskIds: string[];
  prompt: string;
  /** Provider seed when one was used, for regeneration. */
  seed?: number | string;
  /** Licence of the output under the provider's terms, e.g. "Tripo paid plan: commercial use". */
  license: string;
  /** Link to the provider's output terms, checked before the asset landed. */
  terms: string;
  generatedAt: string;
}

export interface CharacterAsset {
  id: string;
  kind: "character";
  form: NpcForm;
  /** Path under /assets/. */
  file: string;
  bytes: number;
  triangles: number;
  /** World height in metres the model is scaled to. */
  height: number;
  /** Clip name in the GLB for each role; "idle" is required. */
  clips: { idle: string; talk?: string; react?: string; leave?: string };
  /** Self-illumination 0..1 (dark-cloaked forms stay readable in dark biomes). */
  selfLight?: number;
  /** Hover height in metres; the body bobs around it (floating forms). */
  hover?: number;
  provenance: AssetProvenance;
}

export interface AssetManifest {
  version: 1;
  assets: CharacterAsset[];
}

export function characterFor(m: AssetManifest, form: NpcForm): CharacterAsset | undefined {
  return m.assets.find((a) => a.kind === "character" && a.form === form);
}

/** Problems with the manifest; `sizeOf` returns a file's size in bytes, or null if missing. */
/** Files under the assets folder that the manifest does not list (the manifest itself aside). */
export function unlisted(m: AssetManifest, files: readonly string[]): string[] {
  const listed = new Set(m.assets.map((a) => a.file));
  return files.filter((f) => f !== "manifest.json" && !listed.has(f));
}

export function validateManifest(
  m: AssetManifest,
  sizeOf: (file: string) => number | null,
): string[] {
  const errors: string[] = [];
  if (m.version !== 1) errors.push(`version ${m.version} is not 1`);
  const forms = new Set<string>();
  let total = 0;
  for (const a of m.assets) {
    const where = `${a.id ?? "?"}`;
    if (!a.file || a.file.includes("..")) errors.push(`${where}: bad file path`);
    const size = sizeOf(a.file);
    if (size === null) errors.push(`${where}: ${a.file} missing`);
    else {
      total += size;
      if (size !== a.bytes) errors.push(`${where}: bytes ${a.bytes} but file is ${size}`);
    }
    if (a.kind === "character") {
      if (forms.has(a.form)) errors.push(`${where}: second character for ${a.form}`);
      forms.add(a.form);
      if (!a.clips?.idle) errors.push(`${where}: no idle clip`);
      if (!(a.height > 0.3 && a.height < 6))
        errors.push(`${where}: height ${a.height} out of range`);
      if (a.selfLight !== undefined && !(a.selfLight >= 0 && a.selfLight <= 1))
        errors.push(`${where}: selfLight ${a.selfLight} outside 0..1`);
      if (a.hover !== undefined && !(a.hover >= 0 && a.hover <= 1.5))
        errors.push(`${where}: hover ${a.hover} outside 0..1.5`);
    }
    const p = a.provenance;
    if (!p?.provider || !p.prompt || !p.generatedAt || !p.license)
      errors.push(`${where}: incomplete provenance`);
    if (p && p.provider !== "procedural" && p.provider !== "hand" && !/^https:\/\//.test(p.terms))
      errors.push(`${where}: provider terms link missing`);
  }
  if (total > ASSET_BUDGET_BYTES)
    errors.push(`assets total ${total} bytes, over the ${ASSET_BUDGET_BYTES}-byte budget`);
  return errors;
}
