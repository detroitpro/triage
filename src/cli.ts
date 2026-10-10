import { readFileSync } from "node:fs";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { loadDotEnv } from "./env.ts";
import { parseItem } from "./item.ts";
import { assess } from "./jev.ts";
import { draftFollowUp } from "./llm.ts";
import { decide } from "./route.ts";

const USAGE = `Usage:
  triage classify [file|-] [--draft]

Reads one item (JSON {"title","body","source"} or plain text) and prints a JSON decision.
--draft  ask OpenRouter for follow-up questions when the route is needs-info`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd !== "classify") {
    console.error(USAGE);
    return cmd === "-h" || cmd === "--help" ? 0 : 2;
  }
  const draft = rest.includes("--draft");
  const file = rest.find((a) => !a.startsWith("--")) ?? "-";

  loadDotEnv();
  const item = parseItem(readFileSync(file === "-" ? 0 : file, "utf8"));
  const decision = decide(await assess(new TypeSafeClient(), item));
  const followUp = draft && decision.route === "needs-info" ? await draftFollowUp(item) : undefined;

  console.log(JSON.stringify({ ...decision, ...(followUp ? { followUp } : {}) }, null, 2));
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
