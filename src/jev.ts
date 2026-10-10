import type { SystemOneRequest, SystemOneResult, TypeSafeClient } from "@typesafe-ai/sdk";
import type { TriageItem } from "./item.ts";
import { QUESTIONS, type TriageQuestions } from "./questions.ts";

export type Assessment = SystemOneResult<TriageQuestions>["answers"];

export interface JevClient {
  systemOne(
    request: SystemOneRequest<TriageQuestions>,
  ): PromiseLike<SystemOneResult<TriageQuestions>>;
}

/** One Jev call per item: all questions are batched into a single request. */
export async function assess(
  client: JevClient | TypeSafeClient,
  item: TriageItem,
): Promise<Assessment> {
  const result = await client.systemOne({
    state: {
      source: item.source ?? "unknown",
      title: item.title ?? "",
      body: item.body,
    },
    questions: QUESTIONS,
  });
  return result.answers;
}
