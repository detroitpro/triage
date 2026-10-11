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

// ---- private notes ("Just thinking"): local only, never posted -------------------------

export function notesKey(repo: string, issue: number): string {
  return `triage:notes:${repo}#${issue}`;
}

export function listNotes(kv: KV, repo: string, issue: number): string[] {
  try {
    const raw = kv.getItem(notesKey(repo, issue));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function addNote(kv: KV, repo: string, issue: number, text: string): string[] {
  const next = [...listNotes(kv, repo, issue), text];
  kv.setItem(notesKey(repo, issue), JSON.stringify(next));
  return next;
}
