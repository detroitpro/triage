import type { Issue, IssueComment, IssueRef, IssuesFile } from "./types.ts";

export interface GitHubOptions {
  token: string;
  fetch?: typeof fetch;
  /** Include closed issues updated since this ISO date (for noticing external closes). */
  since?: string;
  log?: (msg: string) => void;
}

const API = "https://api.github.com";

interface RawLabel {
  name: string;
}
interface RawUser {
  login: string;
}
interface RawIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  labels: RawLabel[];
  milestone: { title: string } | null;
  assignees: RawUser[];
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  comments: number;
  pull_request?: unknown;
}
interface RawComment {
  user: RawUser | null;
  created_at: string;
  body: string | null;
}
interface RawTimeline {
  event: string;
  source?: { issue?: { number: number; pull_request?: unknown } };
}

async function getJson<T>(url: string, opts: GitHubOptions): Promise<{ data: T; next?: string }> {
  const res = await (opts.fetch ?? fetch)(url, {
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "triage",
    },
  });
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get("x-ratelimit-reset");
    throw new Error(`GitHub rate limited (${res.status}); resets at ${reset ?? "unknown"}`);
  }
  if (!res.ok)
    throw new Error(`GitHub ${res.status} for ${url}: ${(await res.text()).slice(0, 200)}`);
  const link = res.headers.get("link") ?? "";
  const next = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1];
  return { data: (await res.json()) as T, ...(next ? { next } : {}) };
}

async function getAll<T>(url: string, opts: GitHubOptions): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined = url;
  while (cursor) {
    const page: { data: T[]; next?: string } = await getJson<T[]>(cursor, opts);
    out.push(...page.data);
    cursor = page.next;
  }
  return out;
}

/** `#123` references in free text, in first-seen order, excluding `self`. */
export function extractRefs(text: string, self: number): number[] {
  const seen = new Set<number>();
  for (const m of text.matchAll(/(?<![\w/])#(\d+)\b/g)) {
    const n = Number(m[1]);
    if (n !== self) seen.add(n);
  }
  return [...seen];
}

export interface RepoLabel {
  name: string;
  color: string;
  description: string;
}

export async function fetchLabels(repo: string, opts: GitHubOptions): Promise<RepoLabel[]> {
  const raw = await getAll<{ name: string; color: string; description: string | null }>(
    `${API}/repos/${repo}/labels?per_page=100`,
    opts,
  );
  return raw
    .map((l) => ({ name: l.name, color: l.color, description: l.description ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchIssues(repo: string, opts: GitHubOptions): Promise<IssuesFile> {
  const log = opts.log ?? (() => {});
  const base = `${API}/repos/${repo}/issues?per_page=100`;
  const raw = await getAll<RawIssue>(
    opts.since ? `${base}&state=all&since=${encodeURIComponent(opts.since)}` : `${base}&state=open`,
    opts,
  );
  const issuesOnly = raw.filter((r) => !r.pull_request);
  log(`fetched ${issuesOnly.length} issues from ${repo}`);

  const issues: Issue[] = [];
  for (const r of issuesOnly) {
    const body = r.body ?? "";
    const comments: IssueComment[] =
      r.comments > 0
        ? (
            await getAll<RawComment>(
              `${API}/repos/${repo}/issues/${r.number}/comments?per_page=100`,
              opts,
            )
          ).map((c) => ({
            author: c.user?.login ?? "ghost",
            createdAt: c.created_at,
            body: c.body ?? "",
          }))
        : [];
    const timeline = await getAll<RawTimeline>(
      `${API}/repos/${repo}/issues/${r.number}/timeline?per_page=100`,
      opts,
    );

    const refs: IssueRef[] = [];
    const linkedPRs = new Set<number>();
    const add = (n: number, source: IssueRef["source"]) => {
      if (!refs.some((x) => x.number === n)) refs.push({ number: n, source });
    };
    for (const n of extractRefs(body, r.number)) add(n, "body");
    for (const c of comments) for (const n of extractRefs(c.body, r.number)) add(n, "comment");
    for (const t of timeline) {
      if (t.event !== "cross-referenced" || !t.source?.issue) continue;
      if (t.source.issue.pull_request) linkedPRs.add(t.source.issue.number);
      else add(t.source.issue.number, "timeline");
    }

    issues.push({
      number: r.number,
      title: r.title,
      body,
      url: r.html_url,
      state: r.state,
      labels: r.labels.map((l) => l.name).sort(),
      milestone: r.milestone?.title ?? null,
      assignees: r.assignees.map((a) => a.login).sort(),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      closedAt: r.closed_at,
      comments,
      references: refs,
      linkedPRs: [...linkedPRs].sort((a, b) => a - b),
    });
    log(`#${r.number} ${comments.length} comments, ${refs.length} refs`);
  }
  issues.sort((a, b) => a.number - b.number);
  return { version: 1, repo, fetchedAt: new Date().toISOString(), issues };
}
