// The asset manifest (charter "Look": generated assets are checked in with a manifest).
// Pure: the shape, the budget, and validation; tests run it over web/public/assets.

import type { NpcForm } from "../../../src/world/types.ts";

/** Total size of everything under web/public/assets, in bytes (charter decision: ~20 MB). */
export const ASSET_BUDGET_BYTES = 20 * 1024 * 1024;

export interface AssetProvenance {
  /** "tripo", "gemini", "procedural", or "hand". */
  provider: string;
  /** Provider task IDs, in pipeline order (model, rig, animations). */
  taskIds: string[];
  prompt: string;
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
    }
    const p = a.provenance;
    if (!p?.provider || !p.prompt || !p.generatedAt) errors.push(`${where}: incomplete provenance`);
    if (p && p.provider !== "procedural" && p.provider !== "hand" && !/^https:\/\//.test(p.terms))
      errors.push(`${where}: provider terms link missing`);
  }
  if (total > ASSET_BUDGET_BYTES)
    errors.push(`assets total ${total} bytes, over the ${ASSET_BUDGET_BYTES}-byte budget`);
  return errors;
}
