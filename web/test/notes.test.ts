import { describe, expect, it } from "vitest";
import { addNote, listNotes } from "../src/pure/progress.ts";

function memKv() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe("private notes", () => {
  it("appends per issue and survives junk", () => {
    const kv = memKv();
    expect(listNotes(kv, "o/r", 3)).toEqual([]);
    addNote(kv, "o/r", 3, "first");
    expect(addNote(kv, "o/r", 3, "second")).toEqual(["first", "second"]);
    expect(listNotes(kv, "o/r", 4)).toEqual([]);
    kv.setItem("triage:notes:o/r#3", "{not json");
    expect(listNotes(kv, "o/r", 3)).toEqual([]);
  });
});
