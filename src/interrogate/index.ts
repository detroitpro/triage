// Interrogate a local clone: candidate functional areas and code areas with evidence.
// "Select, don't generate": these candidates become Choice keys for Jev.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { type ChatOptions, chat } from "../llm.ts";

export interface Area {
  key: string;
  label: string;
  description: string;
  evidence: string[];
}

export interface AreasFile {
  version: 1;
  repoPath: string;
  functional: Area[];
  code: Area[];
}

const SKIP = new Set(["node_modules", ".git", "dist", "build", "coverage", ".nx", ".turbo"]);

/** Directories at depth 1..2 that look like packages or bounded contexts. */
export function codeAreasFromTree(root: string): Area[] {
  const areas: Area[] = [];
  const visit = (dir: string, depth: number) => {
    for (const name of readdirSync(dir).sort()) {
      if (SKIP.has(name) || name.startsWith(".")) continue;
      const full = join(dir, name);
      if (!statSync(full).isDirectory()) continue;
      const rel = relative(root, full);
      const marker = ["package.json", "CONTEXT.md", "README.md"].find((m) =>
        existsSync(join(full, m)),
      );
      const hasSrc = existsSync(join(full, "src")) || existsSync(join(full, "index.ts"));
      if (depth >= 1 && (marker || hasSrc)) {
        areas.push({
          key: toKey(rel),
          label: rel,
          description: firstLine(full, marker) ?? `code under ${rel}/`,
          evidence: [rel],
        });
      } else if (depth < 2) {
        visit(full, depth + 1);
      }
    }
  };
  visit(root, 1);
  if (areas.length === 0) {
    for (const name of readdirSync(root).sort()) {
      const full = join(root, name);
      if (!SKIP.has(name) && !name.startsWith(".") && statSync(full).isDirectory()) {
        areas.push({
          key: toKey(name),
          label: name,
          description: `code under ${name}/`,
          evidence: [name],
        });
      }
    }
  }
  areas.push({
    key: "other",
    label: "other",
    description: "none of the listed code areas",
    evidence: [],
  });
  return areas;
}

function firstLine(dir: string, marker: string | undefined): string | undefined {
  if (!marker) return undefined;
  if (marker === "package.json") {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, marker), "utf8")) as { description?: string };
      return pkg.description;
    } catch {
      return undefined;
    }
  }
  const text = readFileSync(join(dir, marker), "utf8");
  return text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#") && !l.startsWith("<"))
    ?.slice(0, 200);
}

export function toKey(path: string): string {
  return (
    path
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "root"
  );
}

/** Text evidence an LLM can use to propose functional areas. */
export function gatherEvidence(root: string): string {
  const parts: string[] = [];
  for (const f of ["CONTEXT-MAP.md", "README.md", "docs/README.md", "ARCHITECTURE.md"]) {
    const p = join(root, f);
    if (existsSync(p)) parts.push(`### ${f}\n${readFileSync(p, "utf8").slice(0, 6000)}`);
  }
  const ctx: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 3) return;
    for (const name of readdirSync(dir).sort()) {
      if (SKIP.has(name) || name.startsWith(".")) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, depth + 1);
      else if (name === "CONTEXT.md" && ctx.length < 12) {
        ctx.push(`### ${relative(root, full)}\n${readFileSync(full, "utf8").slice(0, 1500)}`);
      }
    }
  };
  walk(root, 0);
  parts.push(...ctx);
  parts.push(
    `### tree\n${codeAreasFromTree(root)
      .map((a) => a.label)
      .join("\n")}`,
  );
  return parts.join("\n\n");
}

const PROPOSE_SYSTEM = `You map a software repository into user-facing functional areas for triaging issues.
Given evidence from the repo, output 8 to 20 distinct functional areas. Each area is a part of the product a user or operator would recognize (not a code layer). Prefer the repo's own vocabulary.
Output ONLY a JSON array of objects: {"key": snake_case, "label": short name, "description": one sentence stating what belongs here and what does not, "evidence": [relative paths]}.`;

export async function proposeFunctionalAreas(
  evidence: string,
  opts: ChatOptions = {},
): Promise<Area[]> {
  const text = await chat(
    [
      { role: "system", content: PROPOSE_SYSTEM },
      { role: "user", content: evidence },
    ],
    { maxTokens: 4000, ...opts },
  );
  const json = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  const raw = JSON.parse(json) as Partial<Area>[];
  const areas = raw
    .filter((a) => typeof a.key === "string" && typeof a.label === "string")
    .map((a) => ({
      key: toKey(a.key as string),
      label: a.label as string,
      description: a.description ?? "",
      evidence: Array.isArray(a.evidence) ? a.evidence.map(String) : [],
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  areas.push({
    key: "other",
    label: "other",
    description: "none of the listed areas",
    evidence: [],
  });
  return areas;
}

export async function interrogate(repoPath: string, opts: ChatOptions = {}): Promise<AreasFile> {
  const root = repoPath.replace(/^~/, process.env.HOME ?? "");
  if (!existsSync(root)) throw new Error(`TRIAGE_REPO_PATH not found: ${root}`);
  return {
    version: 1,
    repoPath: basename(root),
    functional: await proposeFunctionalAreas(gatherEvidence(root), opts),
    code: codeAreasFromTree(root),
  };
}
