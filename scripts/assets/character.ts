// Generate one NPC character with Meshy, resumably:
//   tsx scripts/assets/character.ts <form> [--stop-after concept|model|rig|animate] [--retry <stage>]
// Raw outputs and the checkpoint go to asset-work/<form>/ (gitignored). Accepted task ids are
// saved immediately and never resubmitted; rerun the same command to continue. `--retry`
// forgets a failed (or unknown) stage and everything after it. Packing into web/public/assets
// is a separate step (scripts/assets/pack.ts).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadDotEnv } from "../../src/env.ts";
import { CHARACTERS } from "./characters.ts";
import {
  type Checkpoint,
  isStage,
  Meshy,
  MeshyError,
  retryFrom,
  runPipeline,
  STAGES,
} from "./meshy.ts";

const usage = `usage: character.ts <${Object.keys(CHARACTERS).join("|")}> [--stop-after ${STAGES.join("|")}] [--retry stage]`;
const [form, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(name);
  if (i < 0) return undefined;
  const value = rest[i + 1];
  // A typo here must not fall through to "run every paid stage".
  if (!isStage(value)) {
    console.error(`${name} needs one of ${STAGES.join(", ")}\n${usage}`);
    process.exit(2);
  }
  return value;
};
const spec = form ? CHARACTERS[form] : undefined;
if (!spec) {
  console.error(usage);
  process.exit(2);
}
const stopAfter = flag("--stop-after");
const retry = flag("--retry");

const dir = resolve(import.meta.dirname, "..", "..", "asset-work", spec.form);
mkdirSync(dir, { recursive: true });
const cpPath = resolve(dir, "meshy-job.json");
const cp: Checkpoint = existsSync(cpPath)
  ? JSON.parse(readFileSync(cpPath, "utf8"))
  : { form: spec.form, tasks: {}, files: {} };
const save = () => {
  const tmp = `${cpPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(cp, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, cpPath);
};
if (retry) {
  retryFrom(cp, retry);
  save();
}

try {
  loadDotEnv();
  const meshy = new Meshy(process.env.MESHY_API_KEY ?? "");
  console.error(`balance: ${(await meshy.balance()).balance} credits`);
  await runPipeline(
    meshy,
    spec,
    cp,
    {
      save,
      download: async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new MeshyError(`download: HTTP ${res.status}`, res.status, false);
        return new Uint8Array(await res.arrayBuffer());
      },
      write: (name, bytes) => writeFileSync(resolve(dir, name), bytes),
      log: (m) => console.error(m),
    },
    stopAfter,
  );
  const spent = Object.values(cp.tasks).reduce((s, t) => s + (t?.credits ?? 0), 0);
  console.log(JSON.stringify({ form: spec.form, stages: cp.files, credits: spent }));
} catch (err) {
  save();
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(err instanceof MeshyError && err.permanent ? 3 : 1);
}
