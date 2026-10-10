/** Reviewed-progress bookkeeping. Storage is injected so it stays testable and pure. */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function progressKey(repo: string, issue: number): string {
  return `triage:reviewed:${repo}#${issue}`;
}

export function isReviewed(kv: KV, repo: string, issue: number): boolean {
  return kv.getItem(progressKey(repo, issue)) === "1";
}

export function setReviewed(kv: KV, repo: string, issue: number, on: boolean): void {
  kv.setItem(progressKey(repo, issue), on ? "1" : "0");
}
