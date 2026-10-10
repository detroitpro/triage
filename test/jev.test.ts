import { describe, expect, it, vi } from "vitest";
import { assess, type JevClient } from "../src/jev.ts";
import { QUESTIONS } from "../src/questions.ts";
import { fakeAssessment } from "./helpers.ts";

describe("assess", () => {
  it("sends every question in one call with the item as structured state", async () => {
    const answers = fakeAssessment();
    const systemOne = vi.fn().mockResolvedValue({ model: "jev-test", answers, usage: {} });
    const client: JevClient = { systemOne };

    const result = await assess(client, { title: "Login broken", body: "500 on /login" });

    expect(result).toBe(answers);
    expect(systemOne).toHaveBeenCalledTimes(1);
    expect(systemOne).toHaveBeenCalledWith({
      state: { source: "unknown", title: "Login broken", body: "500 on /login" },
      questions: QUESTIONS,
    });
  });
});
