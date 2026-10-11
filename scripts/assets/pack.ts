// Pack a generated character into web/public/assets and record it in the manifest:
//   tsx scripts/assets/pack.ts <form>
// Reads asset-work/<form>/animate.glb (mesh, skin, merged clips) and meshy-job.json, then:
// textures to 1024 px WebP, unused data pruned, geometry quantized and meshopt-compressed
// (decoded by GLTFLoader's MeshoptDecoder in the client). Clip names are mapped to the roles
// the game plays (idle, talk, react, leave) from the character spec's action order.
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, quantize, textureCompress } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
import type { AssetManifest, CharacterAsset } from "../../web/src/pure/manifest.ts";
import { CHARACTERS } from "./characters.ts";
import type { Checkpoint } from "./meshy.ts";

const form = process.argv[2];
const spec = form ? CHARACTERS[form] : undefined;
if (!spec) {
  console.error(`usage: pack.ts <${Object.keys(CHARACTERS).join("|")}>`);
  process.exit(2);
}
const root = resolve(import.meta.dirname, "..", "..");
const work = resolve(root, "asset-work", spec.form);
const cp = JSON.parse(readFileSync(resolve(work, "meshy-job.json"), "utf8")) as Checkpoint;
if (cp.tasks.animate?.status !== "SUCCEEDED")
  throw new Error(`${spec.form}: animate stage not done`);

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const doc = await io.read(resolve(work, "animate.glb"));

// Clips arrive in action_ids order; name them by role so the manifest maps 1:1.
const roles = Object.keys(spec.actions);
const clips = doc.getRoot().listAnimations();
if (clips.length !== roles.length)
  throw new Error(`${spec.form}: expected ${roles.length} clips, got ${clips.length}`);
const clipNames: Record<string, string> = {};
clips.forEach((clip, i) => {
  const role = roles[i] as string;
  clipNames[role] = clip.getName();
});

await doc.transform(
  dedup(),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 82 }),
  quantize(),
  meshopt({ encoder: MeshoptEncoder, level: "medium" }),
);

const file = `npc/${spec.form}.glb`;
const out = resolve(root, "web", "public", "assets", file);
const bytes = await io.writeBinary(doc);
writeFileSync(out, bytes);

let triangles = 0;
for (const mesh of doc.getRoot().listMeshes())
  for (const prim of mesh.listPrimitives()) triangles += (prim.getIndices()?.getCount() ?? 0) / 3;

const manifestPath = resolve(root, "web", "public", "assets", "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as AssetManifest;
const entry: CharacterAsset = {
  id: `npc-${spec.form}`,
  kind: "character",
  form: spec.form as CharacterAsset["form"],
  file,
  bytes: statSync(out).size,
  triangles,
  height: spec.heightMeters,
  clips: clipNames as CharacterAsset["clips"],
  ...(spec.selfLight !== undefined ? { selfLight: spec.selfLight } : {}),
  ...(spec.hover !== undefined ? { hover: spec.hover } : {}),
  provenance: {
    provider: "meshy",
    taskIds: (["concept", "model", "rig", "animate"] as const).map((s) => cp.tasks[s]?.id ?? ""),
    prompt: spec.prompt,
    license:
      "Meshy paid plan: the customer owns the output (Meshy Terms of Use 3.2); library animations licensed as incorporated into the output (3.1)",
    terms: "https://www.meshy.ai/terms-of-use",
    generatedAt: new Date().toISOString().slice(0, 10),
  },
};
manifest.assets = [...manifest.assets.filter((a) => a.form !== spec.form), entry].sort((a, b) =>
  a.id.localeCompare(b.id),
);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  JSON.stringify({
    file,
    bytes: entry.bytes,
    triangles,
    clips: clipNames,
    credits: totalCredits(cp),
  }),
);

function totalCredits(c: Checkpoint): number {
  return Object.values(c.tasks).reduce((s, t) => s + (t?.credits ?? 0), 0);
}
