// Generate one NPC character with Meshy, resumably:
//   tsx scripts/assets/character.ts <form> [--stop-after concept|model|rig|animate]
// Raw outputs and the checkpoint go to asset-work/<form>/ (gitignored). Accepted task ids are
// saved immediately and never resubmitted; rerun the same command to continue. Packing the
// result into web/public/assets is a separate step (scripts/assets/pack.ts).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadDotEnv } from "../../src/env.ts";
import { CHARACTERS } from "./characters.ts";
import {
  type Checkpoint,
  Meshy,
  MeshyError,
  nextStage,
  type Stage,
  stageOutput,
  stageRequest,
} from "./meshy.ts";

loadDotEnv();
const [form, ...rest] = process.argv.slice(2);
const stopAt = rest.indexOf("--stop-after");
const stopAfter = stopAt >= 0 ? (rest[stopAt + 1] as Stage) : undefined;
const spec = form ? CHARACTERS[form] : undefined;
if (!spec) {
  console.error(`usage: character.ts <${Object.keys(CHARACTERS).join("|")}> [--stop-after stage]`);
  process.exit(2);
}

const dir = resolve(import.meta.dirname, "..", "..", "asset-work", spec.form);
mkdirSync(dir, { recursive: true });
const cpPath = resolve(dir, "meshy-job.json");
const cp: Checkpoint = existsSync(cpPath)
  ? JSON.parse(readFileSync(cpPath, "utf8"))
  : { form: spec.form, tasks: {}, files: {} };
const save = () => writeFileSync(cpPath, `${JSON.stringify(cp, null, 2)}\n`, { mode: 0o600 });

const key = (process.env.MESHY_API_KEY ?? "").replace(/^['"]|['"]$/g, "");
const meshy = new Meshy(key);

try {
  console.error(`balance: ${(await meshy.balance()).balance} credits`);
  for (let stage = nextStage(cp, stopAfter); stage; stage = nextStage(cp, stopAfter)) {
    let task = cp.tasks[stage];
    const { kind, body } = stageRequest(stage, spec, cp);
    if (!task?.id) {
      const id = await meshy.submit(kind, body);
      task = { id };
      cp.tasks[stage] = task;
      save(); // the id is ours now: a crash after this point resumes, never resubmits
      console.error(`${stage}: submitted ${id}`);
    }
    let last = -1;
    const done = await meshy.wait(kind, task.id, {
      onProgress: (t) => {
        if (t.progress !== last) console.error(`${stage}: ${t.status} ${t.progress}%`);
        last = t.progress;
      },
    });
    task.status = done.status;
    task.credits = done.consumed_credits;
    const { url, ext } = stageOutput(stage, done);
    if (!url) throw new MeshyError(`${stage} succeeded without an output file`, 500, true);
    const res = await fetch(url);
    if (!res.ok) throw new MeshyError(`download ${stage}: HTTP ${res.status}`, res.status, false);
    const file = `${stage}.${ext}`;
    writeFileSync(resolve(dir, file), Buffer.from(await res.arrayBuffer()));
    if (done.thumbnail_url) {
      const thumb = await fetch(done.thumbnail_url);
      if (thumb.ok)
        writeFileSync(resolve(dir, `${stage}.png`), Buffer.from(await thumb.arrayBuffer()));
    }
    cp.files[stage] = file;
    save();
    console.error(
      `${stage}: done (${done.consumed_credits ?? "?"} credits) -> asset-work/${spec.form}/${file}`,
    );
  }
  const spent = Object.values(cp.tasks).reduce((s, t) => s + (t?.credits ?? 0), 0);
  console.log(JSON.stringify({ form: spec.form, stages: cp.files, credits: spent }));
} catch (err) {
  save();
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(err instanceof MeshyError && err.permanent ? 3 : 1);
}
