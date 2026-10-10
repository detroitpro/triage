// Live round trip to each provider. Prints PASS / FAIL / SKIP per provider; exits 1 on any FAIL.
// Dev-ready requires no SKIP lines.
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { loadDotEnv } from "../src/env.ts";
import { assess } from "../src/jev.ts";
import { chat } from "../src/llm.ts";
import { decide } from "../src/route.ts";

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

await check("jev", "TYPESAFE_API_KEY", async () => {
  const d = decide(
    await assess(new TypeSafeClient(), {
      source: "smoke",
      title: "Checkout returns 500",
      body: "Since this morning every checkout returns HTTP 500. Customers cannot pay.",
    }),
  );
  return `route=${d.route} kind=${d.kind} urgency=${d.urgency}`;
});

process.exit(failed ? 1 : 0);
