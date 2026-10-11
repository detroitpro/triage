import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyAll, mentionedPaths, toClassified } from "../src/classify/index.ts";
import { issueQuestions, THRESHOLDS } from "../src/questions.ts";
import type { SystemOne } from "../src/systemone.ts";
import { jevViaOpenRouter, llmSystemOne, pickSystemOne } from "../src/systemone.ts";
import { AREAS, ISSUES } from "./fixtures/issues.ts";

const Q = issueQuestions(AREAS.functional, AREAS.code);

function answers(over: Record<string, unknown> = {}) {
  const choice = (c: string, confidence = 0.9) => ({
    type: "choice",
    choice: c,
    confidence,
    probabilities: {},
  });
  const score = (s: number) => ({
    type: "score",
    score: s,
    confidence: 0.8,
    legend: {},
    probabilities: {},
  });
  const noul = (p: number) => ({ type: "noul", noul: p });
  return {
    functionalArea: choice("documents"),
    functionalFits: noul(0.9),
    codeArea: choice("apps_worker"),
    abstraction: score(1),
    security: score(0),
    complexity: score(1),
    userFacing: noul(0.6),
    kind: choice("bug"),
    actionable: noul(0.8),
    injection: noul(0.02),
    ...over,
  } as unknown as Parameters<typeof toClassified>[1];
}

describe("questions", () => {
  it("every choice has a catch-all and every score has 3 to 5 situation levels", () => {
    for (const q of Object.values(Q)) {
      if (q.type === "choice") expect(Object.keys(q.criteria)).toContain("other");
      if (q.type === "score") {
        expect(q.criteria.length).toBeGreaterThanOrEqual(3);
        expect(q.criteria.length).toBeLessThanOrEqual(5);
        for (const c of q.criteria) expect(String(c).length).toBeGreaterThan(20);
      }
    }
    expect(Object.keys(Q.kind.criteria)).toContain("noise");
  });
});

describe("toClassified", () => {
  const issue = ISSUES[1] as (typeof ISSUES)[number];

  it("keeps a confident, fitting area", () => {
    const c = toClassified(issue, answers());
    expect(c.functionalArea).toBe("documents");
    expect(c.quarantined).toBe(false);
  });

  it("sends low-confidence areas to unsorted", () => {
    const c = toClassified(
      issue,
      answers({
        functionalArea: { type: "choice", choice: "documents", confidence: 0.3, probabilities: {} },
      }),
    );
    expect(c.functionalArea).toBe("unsorted");
  });

  it("sends confident-but-not-fitting areas to unsorted", () => {
    const c = toClassified(
      issue,
      answers({ functionalFits: { type: "noul", noul: THRESHOLDS.areaFits - 0.1 } }),
    );
    expect(c.functionalArea).toBe("unsorted");
  });

  it("quarantines likely injection", () => {
    const c = toClassified(issue, answers({ injection: { type: "noul", noul: 0.95 } }));
    expect(c.quarantined).toBe(true);
  });

  it("extracts mentioned code paths", () => {
    expect(mentionedPaths("see apps/worker/src/upload.ts and `contexts/documents/x.ts`.")).toEqual([
      "apps/worker/src/upload.ts",
      "contexts/documents/x.ts",
    ]);
  });
});

describe("classifyAll", () => {
  it("asks every question for every issue in one call each and sorts output", async () => {
    const calls: unknown[] = [];
    const fake: SystemOne = {
      async systemOne(req) {
        calls.push(req);
        expect(Object.keys(req.questions).sort()).toEqual(Object.keys(Q).sort());
        return {
          model: "fake",
          answers: answers() as never,
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    };
    const out = await classifyAll(
      fake,
      { version: 1, repo: "x", fetchedAt: "", issues: ISSUES },
      AREAS,
    );
    expect(calls).toHaveLength(ISSUES.length);
    expect(out.issues.map((i) => i.number)).toEqual([1, 2, 3, 4, 5]);
    expect(out.model).toBe("fake");
  });
});

describe("jevViaOpenRouter", () => {
  it("sends the System One request to OpenRouter's gateway with the OpenRouter key", async () => {
    const seen: { url: string; auth: string | null; body: { model?: string } }[] = [];
    const fetchFake = async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({
        url: String(url),
        auth: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(
        JSON.stringify({
          model: "typesafe/jev-1.13",
          answers: { actionable: { type: "noul", noul: 0.9 } },
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const client = jevViaOpenRouter("or-key", fetchFake as typeof fetch);
    const { answers } = await client.systemOne({
      state: {},
      questions: { actionable: Q.actionable },
    });
    expect(seen[0]?.url).toMatch(/^https:\/\/openrouter\.ai\/api\//);
    expect(seen[0]?.auth).toBe("Bearer or-key");
    expect(seen[0]?.body.model).toBe("~typesafe/jev-latest");
    expect(answers.actionable.noul).toBe(0.9);
  });
});

describe("pickSystemOne", () => {
  afterEach(() => vi.unstubAllEnvs());
  const pick = (typesafe: string, openrouter: string) => {
    vi.stubEnv("TYPESAFE_API_KEY", typesafe);
    vi.stubEnv("OPENROUTER_API_KEY", openrouter);
    const logs: string[] = [];
    const client = pickSystemOne((m) => logs.push(m));
    return { client, log: logs.join("\n") };
  };

  it("prefers Jev direct, then Jev via OpenRouter", () => {
    expect(pick("ts-key", "or-key").log).toMatch(/systemone: jev \(/);
    expect(pick("", "or-key").log).toMatch(/jev via OpenRouter/);
  });

  it("fails every call clearly when neither key exists", async () => {
    const { client, log } = pick("", "");
    expect(log).toMatch(/none/);
    await expect(client.systemOne({ state: {}, questions: { a: Q.actionable } })).rejects.toThrow(
      /OPENROUTER_API_KEY or TYPESAFE_API_KEY/,
    );
  });
});

describe("llmSystemOne stand-in", () => {
  it("turns an LLM JSON reply into Jev-shaped answers", async () => {
    const reply = JSON.stringify({
      kind: { bug: 0.7, feature: 0.3 },
      complexity: { "0": 0.5, "1": 0.5, "2": 0, "3": 0 },
      actionable: 0.8,
    });
    const fetchFake = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200 });
    const client = llmSystemOne({ apiKey: "k", fetch: fetchFake as typeof fetch });
    const { answers: a } = await client.systemOne({
      state: {},
      questions: { kind: Q.kind, complexity: Q.complexity, actionable: Q.actionable },
    });
    expect(a.kind.choice).toBe("bug");
    expect(a.kind.confidence).toBeGreaterThan(0.6);
    expect(a.complexity.score).toBe(0.5);
    expect(a.actionable.noul).toBe(0.8);
  });
});
