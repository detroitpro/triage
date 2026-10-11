import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { type ClassifiedFile, classifyAll } from "./classify/index.ts";
import { loadDotEnv } from "./env.ts";
import { LENSES } from "./graph/lenses.ts";
import { relate } from "./graph/relate.ts";
import { type GraphFile, validateGraph } from "./graph/types.ts";
import { fetchIssues, fetchLabels, type RepoLabel } from "./ingest/github.ts";
import type { IssuesFile } from "./ingest/types.ts";
import { type AreasFile, interrogate } from "./interrogate/index.ts";
import { dataPath, readData, writeData } from "./io.ts";
import { pickSystemOne } from "./systemone.ts";
import { buildWorld, validateWorld } from "./world/build.ts";

const USAGE = `Usage:
  triage ingest        TRIAGE_REPO -> data/issues.json
  triage interrogate   TRIAGE_REPO_PATH -> data/areas.json
  triage classify      issues + areas -> data/classified.json
  triage relate        classified -> data/graph.json   [--no-infer] [--max-candidates N]
  triage build         graph -> data/world/<lens>.world.json for every lens
  triage run           all of the above
  triage validate      check graph.json and every world file

Env: TRIAGE_REPO (owner/repo), TRIAGE_REPO_PATH, GITHUB_TOKEN (falls back to \`gh auth token\`),
     OPENROUTER_API_KEY, TYPESAFE_API_KEY (optional; OpenRouter stand-in otherwise)`;

const log = (m: string) => console.error(m);

function githubToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("GITHUB_TOKEN not set and `gh auth token` failed");
  }
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function ingest(): Promise<void> {
  const repo = need("TRIAGE_REPO");
  const token = githubToken();
  const file = await fetchIssues(repo, { token, log });
  writeData(dataPath("issues.json"), file);
  writeData(dataPath("labels.json"), await fetchLabels(repo, { token, log }));
  log(`wrote data/issues.json (${file.issues.length} issues)`);
}

async function doInterrogate(): Promise<void> {
  const areas = await interrogate(need("TRIAGE_REPO_PATH"));
  writeData(dataPath("areas.json"), areas);
  log(
    `wrote data/areas.json (${areas.functional.length} functional, ${areas.code.length} code areas)`,
  );
}

async function classify(): Promise<void> {
  const issues = readData<IssuesFile>(dataPath("issues.json"));
  const areas = readData<AreasFile>(dataPath("areas.json"));
  const out = await classifyAll(pickSystemOne(log), issues, areas, { log });
  writeData(dataPath("classified.json"), out);
  log(`wrote data/classified.json (${out.issues.length} issues, model ${out.model})`);
}

async function doRelate(args: string[]): Promise<void> {
  const classified = readData<ClassifiedFile>(dataPath("classified.json"));
  const issues = readData<IssuesFile>(dataPath("issues.json"));
  const areas = readData<AreasFile>(dataPath("areas.json"));
  const maxIdx = args.indexOf("--max-candidates");
  const graph = await relate(classified, issues, areas, {
    infer: !args.includes("--no-infer"),
    client: args.includes("--no-infer") ? undefined : pickSystemOne(log),
    ...(maxIdx >= 0 ? { maxCandidates: Number(args[maxIdx + 1]) } : {}),
    log,
  });
  const errors = validateGraph(graph);
  if (errors.length)
    log(`graph invariants: ${errors.length} problems\n  ${errors.slice(0, 20).join("\n  ")}`);
  writeData(dataPath("graph.json"), graph);
  log(
    `wrote data/graph.json (${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.candidatePairs}/${graph.possiblePairs} pairs asked)`,
  );
}

function build(): void {
  const graph = readData<GraphFile>(dataPath("graph.json"));
  const labels = existsSync(dataPath("labels.json"))
    ? readData<RepoLabel[]>(dataPath("labels.json"))
    : [];
  for (const lens of LENSES) {
    const world = buildWorld(graph, lens, [...LENSES], labels);
    const errors = validateWorld(world);
    if (errors.length)
      log(`${lens}: ${errors.length} world problems\n  ${errors.slice(0, 10).join("\n  ")}`);
    writeData(dataPath("world", `${lens}.world.json`), world);
    log(
      `wrote data/world/${lens}.world.json (${world.regions.length} regions, ${world.doors.length} doors)`,
    );
  }
}

function validate(): number {
  let bad = 0;
  const graph = readData<GraphFile>(dataPath("graph.json"));
  const ge = validateGraph(graph);
  bad += ge.length;
  log(`graph.json: ${ge.length ? ge.join("\n") : "ok"}`);
  for (const lens of LENSES) {
    const p = dataPath("world", `${lens}.world.json`);
    if (!existsSync(p)) continue;
    const we = validateWorld(readData(p));
    bad += we.length;
    log(`${lens}.world.json: ${we.length ? we.join("\n") : "ok"}`);
  }
  return bad ? 1 : 0;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  loadDotEnv();
  switch (cmd) {
    case "ingest":
      await ingest();
      return 0;
    case "interrogate":
      await doInterrogate();
      return 0;
    case "classify":
      await classify();
      return 0;
    case "relate":
      await doRelate(rest);
      return 0;
    case "build":
      build();
      return 0;
    case "validate":
      return validate();
    case "run":
      await ingest();
      await doInterrogate();
      await classify();
      await doRelate(rest);
      build();
      return 0;
    default:
      console.error(USAGE);
      return cmd === "-h" || cmd === "--help" ? 0 : 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
