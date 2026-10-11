// Classify every issue along the charter dimensions: one batched SystemOne call per issue.
import type { SystemOneResult } from "@typesafe-ai/sdk";
import type { Issue, IssuesFile } from "../ingest/types.ts";
import type { AreasFile } from "../interrogate/index.ts";
import { type IssueQuestions, issueQuestions, THRESHOLDS } from "../questions.ts";
import type { SystemOne } from "../systemone.ts";

export interface ClassifiedIssue {
  number: number;
  title: string;
  url: string;
  labels: string[];
  summary: string;
  /** Dimension values. Area keys are "unsorted" when below the floor. */
  functionalArea: string;
  codeArea: string;
  abstraction: number;
  security: number;
  complexity: number;
  userFacing: number;
  kind: string;
  actionable: number;
  injection: number;
  quarantined: boolean;
  confidence: Record<string, number>;
  /** Raw probabilities for later re-weighting without new calls. */
  probabilities: Record<string, Record<string, number>>;
  codePaths: string[];
}

export interface ClassifiedFile {
  version: 1;
  repo: string;
  model: string;
  classifiedAt: string;
  issues: ClassifiedIssue[];
}

export function issueState(issue: Issue) {
  return {
    number: issue.number,
    title: issue.title,
    labels: issue.labels,
    untrusted: {
      body: issue.body.slice(0, 6000),
      comments: issue.comments.slice(-5).map((c) => c.body.slice(0, 800)),
    },
  };
}

/** Paths and module names mentioned in text; matched against known code areas later. */
export function mentionedPaths(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(
    /(?:^|[\s`(])((?:apps|contexts|platform|src|packages|lib|web)\/[\w./-]+)/g,
  )) {
    out.add((m[1] ?? "").replace(/[.,:;)]+$/, ""));
  }
  return [...out].sort();
}

export type IssueAnswers = SystemOneResult<IssueQuestions>["answers"];

export function toClassified(issue: Issue, a: IssueAnswers): ClassifiedIssue {
  const quarantined = a.injection.noul >= THRESHOLDS.injection;
  const areaOk =
    a.functionalArea.confidence >= THRESHOLDS.areaAbstain &&
    a.functionalFits.noul >= THRESHOLDS.areaFits;
  const codeOk = a.codeArea.confidence >= THRESHOLDS.areaAbstain;
  const kindOk = a.kind.confidence >= THRESHOLDS.choiceAbstain;
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url,
    labels: issue.labels,
    summary: issue.body.replace(/\s+/g, " ").trim().slice(0, 400),
    functionalArea: areaOk ? a.functionalArea.choice : "unsorted",
    codeArea: codeOk ? a.codeArea.choice : "unsorted",
    abstraction: a.abstraction.score,
    security: a.security.score,
    complexity: a.complexity.score,
    userFacing: a.userFacing.noul,
    kind: kindOk ? a.kind.choice : "other",
    actionable: a.actionable.noul,
    injection: a.injection.noul,
    quarantined,
    confidence: {
      functionalArea: a.functionalArea.confidence,
      functionalFits: a.functionalFits.noul,
      codeArea: a.codeArea.confidence,
      abstraction: a.abstraction.confidence,
      security: a.security.confidence,
      complexity: a.complexity.confidence,
      kind: a.kind.confidence,
    },
    probabilities: {
      functionalArea: { ...a.functionalArea.probabilities },
      codeArea: { ...a.codeArea.probabilities },
      kind: { ...a.kind.probabilities },
      complexity: { ...a.complexity.probabilities },
      security: { ...a.security.probabilities },
    },
    codePaths: mentionedPaths(`${issue.body}\n${issue.comments.map((c) => c.body).join("\n")}`),
  };
}

export interface ClassifyOptions {
  concurrency?: number;
  log?: (m: string) => void;
}

export async function classifyAll(
  client: SystemOne,
  issues: IssuesFile,
  areas: AreasFile,
  opts: ClassifyOptions = {},
): Promise<ClassifiedFile> {
  const questions = issueQuestions(areas.functional, areas.code);
  const log = opts.log ?? (() => {});
  const out: ClassifiedIssue[] = [];
  let model = "";
  const queue = [...issues.issues];
  const worker = async () => {
    for (let issue = queue.shift(); issue; issue = queue.shift()) {
      const res = await client.systemOne({ state: issueState(issue), questions });
      model = res.model;
      const c = toClassified(issue, res.answers);
      out.push(c);
      log(
        `#${c.number} ${c.functionalArea}/${c.codeArea} cx=${c.complexity} sec=${c.security} ${c.kind}${c.quarantined ? " QUARANTINED" : ""}`,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 6, 8) }, worker));
  out.sort((a, b) => a.number - b.number);
  return {
    version: 1,
    repo: issues.repo,
    model,
    classifiedAt: new Date().toISOString(),
    issues: out,
  };
}
