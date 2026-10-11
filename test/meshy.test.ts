import { describe, expect, it } from "vitest";
import { CHARACTERS } from "../scripts/assets/characters.ts";
import {
  type Checkpoint,
  Meshy,
  MeshyError,
  nextStage,
  type PipelineIO,
  retryFrom,
  runPipeline,
  stageRequest,
} from "../scripts/assets/meshy.ts";

const spec = CHARACTERS.villager;
if (!spec) throw new Error("villager spec missing");

describe("Meshy client", () => {
  it("sends the key as a bearer token and returns the task id", async () => {
    const seen: { url: string; auth: string | null; body: unknown }[] = [];
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({
        url: String(url),
        auth: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return new Response(JSON.stringify({ result: "task-1" }), { status: 202 });
    }) as typeof fetch;
    const id = await new Meshy("msy_test", fake).submit("textTo3d", { mode: "preview" });
    expect(id).toBe("task-1");
    expect(seen[0]?.url).toBe("https://api.meshy.ai/openapi/v2/text-to-3d");
    expect(seen[0]?.auth).toBe("Bearer msy_test");
  });

  it("reports insufficient credits as permanent", async () => {
    const fake = (async () => new Response("{}", { status: 402 })) as typeof fetch;
    const err = await new Meshy("k", fake).balance().catch((e) => e);
    expect(err).toBeInstanceOf(MeshyError);
    expect(err.permanent).toBe(true);
    expect(err.message).toMatch(/credits/);
  });

  it("waits for a task without resubmitting, and fails on FAILED", async () => {
    let polls = 0;
    const fake = (async () => {
      polls++;
      const status = polls < 3 ? "IN_PROGRESS" : "FAILED";
      return new Response(JSON.stringify({ id: "t", status, progress: polls * 30 }));
    }) as typeof fetch;
    const err = await new Meshy("k", fake).wait("rigging", "t", { intervalMs: 1 }).catch((e) => e);
    expect(polls).toBe(3);
    expect(err.message).toMatch(/FAILED/);
  });
});

describe("character stages", () => {
  const empty: Checkpoint = { form: "villager", tasks: {}, files: {} };

  it("runs concept, model, rig, animate in order and stops where asked", () => {
    expect(nextStage(empty)).toBe("concept");
    const afterConcept: Checkpoint = {
      ...empty,
      tasks: { concept: { id: "c", status: "SUCCEEDED" } },
      files: { concept: "concept.png" },
    };
    expect(nextStage(afterConcept)).toBe("model");
    expect(nextStage(afterConcept, "concept")).toBeNull();
  });

  it("chains each stage on the previous task and never runs ahead", () => {
    expect(() => stageRequest("model", spec, empty)).toThrow(/concept first/);
    const cp: Checkpoint = {
      form: "villager",
      tasks: {
        concept: { id: "c", status: "SUCCEEDED" },
        model: { id: "m", status: "SUCCEEDED" },
        rig: { id: "g", status: "SUCCEEDED" },
      },
      files: {},
    };
    expect(stageRequest("model", spec, cp).body.input_task_id).toBe("c");
    expect(stageRequest("rig", spec, cp).body.input_task_id).toBe("m");
    const anim = stageRequest("animate", spec, cp).body;
    expect(anim.rig_task_id).toBe("g");
    expect(anim.action_ids).toEqual([0, 313, 28, 41]);
  });

  it("keeps every prompt within Meshy's 800-character limit", () => {
    for (const c of Object.values(CHARACTERS)) {
      expect(c.prompt.length).toBeLessThanOrEqual(800);
      expect(c.texturePrompt.length).toBeLessThanOrEqual(800);
    }
  });
});

describe("runPipeline", () => {
  /** A fake Meshy that counts POSTs and answers GETs with a finished task. */
  function fakeMeshy(status = "SUCCEEDED") {
    const calls = { posts: 0, gets: 0 };
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        calls.posts++;
        return new Response(JSON.stringify({ result: `new-${calls.posts}` }));
      }
      calls.gets++;
      return new Response(
        JSON.stringify({
          id: "t",
          status,
          progress: 100,
          consumed_credits: 5,
          finished_at: 1_791_700_000_000,
          image_urls: ["https://x/concept.png"],
          model_urls: { glb: "https://x/m.glb" },
          result: {
            rigged_character_glb_url: "https://x/r.glb",
            animation_glb_url: "https://x/a.glb",
          },
        }),
      );
    }) as typeof fetch;
    return { meshy: new Meshy("k", fetchFn), calls };
  }
  const io = (): PipelineIO & { saves: number; files: string[] } => {
    const o = {
      saves: 0,
      files: [] as string[],
      save: () => {
        o.saves++;
      },
      download: async () => new Uint8Array([1]),
      write: (name: string) => {
        o.files.push(name);
      },
      log: () => {},
    };
    return o;
  };
  const fast = (m: Meshy) => {
    // Keep polling instant in tests.
    const wait = m.wait.bind(m);
    m.wait = (kind, id, opts) => wait(kind, id, { ...opts, intervalMs: 1 });
    return m;
  };

  it("resumes a saved task id without submitting again", async () => {
    const { meshy, calls } = fakeMeshy();
    const cp: Checkpoint = { form: "villager", tasks: { concept: { id: "saved" } }, files: {} };
    await runPipeline(fast(meshy), spec, cp, io(), "concept");
    expect(calls.posts).toBe(0);
    expect(cp.files.concept).toBe("concept.png");
    expect(cp.tasks.concept?.finishedAt).toBe(1_791_700_000_000);
  });

  it("saves the submitting marker before the POST and the id right after", async () => {
    const { meshy, calls } = fakeMeshy();
    const cp: Checkpoint = { form: "villager", tasks: {}, files: {} };
    const o = io();
    await runPipeline(fast(meshy), spec, cp, o, "concept");
    expect(calls.posts).toBe(1);
    expect(cp.tasks.concept).toMatchObject({ id: "new-1", status: "SUCCEEDED" });
    expect(cp.tasks.concept?.submitting).toBeUndefined();
    expect(o.saves).toBeGreaterThanOrEqual(3);
  });

  it("refuses to submit when an earlier submission's outcome is unknown", async () => {
    const { meshy, calls } = fakeMeshy();
    const cp: Checkpoint = {
      form: "villager",
      tasks: { concept: { id: "", submitting: true } },
      files: {},
    };
    await expect(runPipeline(fast(meshy), spec, cp, io())).rejects.toThrow(/task list/);
    expect(calls.posts).toBe(0);
  });

  it("records a failed task and needs an explicit retry", async () => {
    const { meshy } = fakeMeshy("FAILED");
    const cp: Checkpoint = { form: "villager", tasks: { concept: { id: "c" } }, files: {} };
    await expect(runPipeline(fast(meshy), spec, cp, io())).rejects.toThrow(/FAILED/);
    expect(cp.tasks.concept?.status).toBe("FAILED");
    await expect(runPipeline(fast(meshy), spec, cp, io())).rejects.toThrow(/--retry concept/);
    retryFrom(cp, "concept");
    expect(cp.tasks.concept).toBeUndefined();
  });
});
