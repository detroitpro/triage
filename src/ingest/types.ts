// Normalized GitHub issue, the output of `triage ingest` (data/issues.json).
// Only fields later stages need.

export interface IssueComment {
  author: string;
  createdAt: string;
  body: string;
}

export interface IssueRef {
  /** Issue number in the same repo. */
  number: number;
  /** Where the reference came from. */
  source: "body" | "comment" | "timeline";
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  url: string;
  state: "open" | "closed";
  labels: string[];
  milestone: string | null;
  assignees: string[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  comments: IssueComment[];
  /** Issues this one mentions (deduplicated, in first-seen order). */
  references: IssueRef[];
  /** PR numbers linked through "closes #n" or the timeline. */
  linkedPRs: number[];
}

export interface IssuesFile {
  version: 1;
  repo: string;
  fetchedAt: string;
  issues: Issue[];
}
