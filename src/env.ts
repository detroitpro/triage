import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Loads `.env` from the repo root when present; real environment variables win. */
export function loadDotEnv(path = resolve(import.meta.dirname, "..", ".env")): void {
  if (existsSync(path)) process.loadEnvFile(path);
}
