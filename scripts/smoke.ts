// Live round trip to each provider. Prints PASS / FAIL / SKIP per provider; exits 1 on any FAIL.
// Dev-ready requires no SKIP lines.
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { loadDotEnv } from "../src/env.ts";
import { chat } from "../src/llm.ts";
import { issueQuestions } from "../src/questions.ts";
import { jevViaOpenRouter } from "../src/systemone.ts";

loadDotEnv();
let failed = false;

async function check(name: string, envVar: string, fn: () => Promise<string>): Promise<void> {
  if (!process.env[envVar]) {
    console.log(`SKIP ${name}: ${envVar} not set (make secrets-unlock)`);
    return;
  }
  try {
    console.log(`PASS ${name}: ${await fn()}`);
  } catch (err) {
    failed = true;
    console.log(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

await check("openrouter", "OPENROUTER_API_KEY", async () => {
  const reply = await chat([{ role: "user", content: "Reply with the single word: ok" }], {
    maxTokens: 1000,
  });
  return JSON.stringify(reply.trim().slice(0, 40));
});

const jevDirect = Boolean(process.env.TYPESAFE_API_KEY);
await check(
  jevDirect ? "jev" : "jev via openrouter",
  jevDirect ? "TYPESAFE_API_KEY" : "OPENROUTER_API_KEY",
  async () => {
    const client = jevDirect
      ? new TypeSafeClient()
      : jevViaOpenRouter(process.env.OPENROUTER_API_KEY ?? "");
    const { answers, model } = await client.systemOne({
      state: {
        title: "Checkout returns 500",
        untrusted: { body: "Every checkout returns HTTP 500." },
      },
      questions: { kind: issueQuestions([], []).kind },
    });
    return `model=${model} kind=${answers.kind.choice} (${answers.kind.confidence})`;
  },
);

process.exit(failed ? 1 : 0);
